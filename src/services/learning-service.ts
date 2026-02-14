/**
 * Learning Service Implementation
 *
 * Manages the knowledge/learning store: load, save, search, and batch
 * record learnings. Learnings are categorized by type (pattern, pitfall,
 * efficiency, discovery, workflow) and retrieved with relevance scoring.
 *
 * Stateless: all state lives in the injected StorageAdapter.
 *
 * @module services/learning-service
 */

import { randomUUID } from "node:crypto";

import type {
  ILearningService,
  Learning,
  LearningType,
  LoadLearningsInput,
  LoadLearningsResult,
  SaveLearningInput,
  SearchLearningsInput,
  SearchLearningsResult,
  RecordLearningsInput,
  RecordLearningsResult,
  ServiceResult,
} from "../contracts/services.js";
import type { StorageAdapter } from "./adapters.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface LearningServiceConfig {
  /** Maximum learnings stored per workspace. */
  readonly maxLearnings: number;
  /** Default limit for load/search results. */
  readonly defaultLimit: number;
}

const DEFAULT_CONFIG: LearningServiceConfig = {
  maxLearnings: 1000,
  defaultLimit: 50,
};

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

function learningKey(id: string): string {
  return `learning:${id}`;
}

function workspaceIndexKey(workspacePath: string): string {
  return `learning-index:${workspacePath}`;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class LearningServiceImpl implements ILearningService {
  private readonly config: LearningServiceConfig;

  constructor(
    config: Partial<LearningServiceConfig>,
    private readonly storage: StorageAdapter,
    private readonly logger: Logger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async loadTiered(
    input: LoadLearningsInput,
  ): Promise<ServiceResult<LoadLearningsResult>> {
    try {
      const allLearnings = await this.loadAllForWorkspace(input.workspacePath);
      const limit = input.limit ?? this.config.defaultLimit;

      // Score and sort learnings by relevance
      const scored = allLearnings.map((learning) => ({
        learning,
        score: this.computeRelevance(learning, input),
      }));

      scored.sort((a, b) => b.score - a.score);

      const selected = scored.slice(0, limit).map((s) => ({
        ...s.learning,
        accessCount: s.learning.accessCount + 1,
      }));

      // Update access counts for returned learnings
      for (const learning of selected) {
        await this.storage.write(
          learningKey(learning.id),
          JSON.stringify(learning),
        );
      }

      this.logger.debug("Loaded tiered learnings", {
        workspace: input.workspacePath,
        total: allLearnings.length,
        returned: selected.length,
      });

      return {
        ok: true,
        data: {
          learnings: selected,
          totalAvailable: allLearnings.length,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to load learnings", { error: message });
      return { ok: false, error: message, code: "LEARNING_LOAD_FAILED" };
    }
  }

  async save(input: SaveLearningInput): Promise<ServiceResult<Learning>> {
    try {
      // Deduplicate: check for existing learning with same trigger+action
      const existing = await this.loadAllForWorkspace(input.workspacePath);
      const duplicate = existing.find(
        (l) => l.trigger === input.trigger && l.action === input.action,
      );

      if (duplicate) {
        this.logger.info("Deduplicated learning", { id: duplicate.id });
        return { ok: true, data: duplicate };
      }

      const learning: Learning = {
        id: randomUUID(),
        trigger: input.trigger,
        action: input.action,
        type: input.type,
        createdAt: Date.now(),
        accessCount: 0,
      };

      // Persist the learning
      await this.storage.write(
        learningKey(learning.id),
        JSON.stringify(learning),
      );

      // Update workspace index
      const index = await this.loadIndex(input.workspacePath);
      index.push(learning.id);

      // Enforce max learnings by evicting oldest
      if (index.length > this.config.maxLearnings) {
        const toEvict = index.splice(
          0,
          index.length - this.config.maxLearnings,
        );
        for (const evictId of toEvict) {
          await this.storage.delete(learningKey(evictId));
        }
      }

      await this.storage.write(
        workspaceIndexKey(input.workspacePath),
        JSON.stringify(index),
      );

      this.logger.info("Learning saved", {
        id: learning.id,
        type: learning.type,
        workspace: input.workspacePath,
      });

      return { ok: true, data: learning };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to save learning", { error: message });
      return { ok: false, error: message, code: "LEARNING_SAVE_FAILED" };
    }
  }

  async search(
    input: SearchLearningsInput,
  ): Promise<ServiceResult<SearchLearningsResult>> {
    try {
      const allLearnings = await this.loadAllForWorkspace(input.workspacePath);
      const limit = input.limit ?? this.config.defaultLimit;
      const queryLower = input.query.toLowerCase();

      // Filter by type if specified, then by text match
      let matches = allLearnings;

      if (input.type) {
        matches = matches.filter((l) => l.type === input.type);
      }

      // Simple text search across trigger and action fields
      matches = matches.filter(
        (l) =>
          l.trigger.toLowerCase().includes(queryLower) ||
          l.action.toLowerCase().includes(queryLower),
      );

      const totalMatches = matches.length;

      // Sort by access count (most accessed first), then by recency
      matches.sort((a, b) => {
        if (b.accessCount !== a.accessCount) {
          return b.accessCount - a.accessCount;
        }
        return b.createdAt - a.createdAt;
      });

      const results = matches.slice(0, limit);

      this.logger.debug("Learning search completed", {
        query: input.query,
        totalMatches,
        returned: results.length,
      });

      return {
        ok: true,
        data: {
          learnings: results,
          totalMatches,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to search learnings", { error: message });
      return { ok: false, error: message, code: "LEARNING_SEARCH_FAILED" };
    }
  }

  async recordBatch(
    input: RecordLearningsInput,
  ): Promise<ServiceResult<RecordLearningsResult>> {
    try {
      let stored = 0;
      let deduplicated = 0;

      for (const learningText of input.learnings) {
        const result = await this.save({
          workspacePath: input.workspacePath,
          trigger: `session:${input.sessionId}`,
          action: learningText,
          type: "discovery" as LearningType,
        });

        if (result.ok) {
          // Check if it was deduplicated by comparing created time
          const isNew =
            Date.now() - result.data.createdAt < 1000;
          if (isNew) {
            stored++;
          } else {
            deduplicated++;
          }
        }
      }

      this.logger.info("Batch learnings recorded", {
        sessionId: input.sessionId,
        stored,
        deduplicated,
      });

      return {
        ok: true,
        data: { stored, deduplicated },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to record batch learnings", {
        error: message,
      });
      return {
        ok: false,
        error: message,
        code: "LEARNING_BATCH_FAILED",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async loadIndex(workspacePath: string): Promise<string[]> {
    const data = await this.storage.read(workspaceIndexKey(workspacePath));
    if (!data) return [];
    return JSON.parse(data) as string[];
  }

  private async loadAllForWorkspace(
    workspacePath: string,
  ): Promise<Learning[]> {
    const index = await this.loadIndex(workspacePath);
    const learnings: Learning[] = [];

    for (const id of index) {
      const data = await this.storage.read(learningKey(id));
      if (data) {
        learnings.push(JSON.parse(data) as Learning);
      }
    }

    return learnings;
  }

  private computeRelevance(
    learning: Learning,
    input: LoadLearningsInput,
  ): number {
    let score = 0;

    // Recency boost: more recent learnings score higher
    const ageMs = Date.now() - learning.createdAt;
    const ageHours = ageMs / (1000 * 60 * 60);
    score += Math.max(0, 100 - ageHours);

    // Access count boost
    score += learning.accessCount * 5;

    // Intent relevance: if the learning trigger matches the intent
    if (input.intent) {
      const intentLower = input.intent.toLowerCase();
      if (learning.trigger.toLowerCase().includes(intentLower)) {
        score += 50;
      }
      if (learning.action.toLowerCase().includes(intentLower)) {
        score += 30;
      }
    }

    // File path relevance: boost if learning relates to current files
    if (input.filePaths && input.filePaths.length > 0) {
      for (const filePath of input.filePaths) {
        const fileName = filePath.split("/").pop() ?? "";
        if (
          learning.trigger.includes(fileName) ||
          learning.action.includes(fileName)
        ) {
          score += 20;
        }
      }
    }

    // Type-based priority: patterns and pitfalls score higher
    const typePriority: Record<LearningType, number> = {
      pattern: 20,
      pitfall: 18,
      efficiency: 15,
      workflow: 12,
      discovery: 10,
    };
    score += typePriority[learning.type];

    return score;
  }
}
