/**
 * Snapshot Service Implementation
 *
 * Manages task snapshots and workspace state. Snapshots are point-in-time
 * records of file states that enable rollback and session tracking.
 *
 * Stateless: all state lives in the injected StorageAdapter.
 * Pure business logic: fully testable without filesystem or network.
 *
 * @module services/snapshot-service
 */

import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import type {
  ISnapshotService,
  CreateSnapshotInput,
  Snapshot,
  GetSnapshotInput,
  SnapshotState,
  FinalizeSnapshotInput,
  FinalizeSnapshotResult,
  ServiceResult,
} from "../contracts/services.js";
import type { StorageAdapter } from "./adapters.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SnapshotServiceConfig {
  /** Maximum number of snapshots to retain per workspace. */
  readonly maxSnapshots: number;
}

const DEFAULT_CONFIG: SnapshotServiceConfig = {
  maxSnapshots: 100,
};

// ---------------------------------------------------------------------------
// Internal Storage Keys
// ---------------------------------------------------------------------------

function snapshotKey(id: string): string {
  return `snapshot:${id}`;
}

function sessionKey(workspacePath: string, sessionId: string): string {
  return `session:${workspacePath}:${sessionId}`;
}

function workspaceIndexKey(workspacePath: string): string {
  return `workspace-index:${workspacePath}`;
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface SessionRecord {
  activeSnapshotId: string | null;
  snapshotIds: string[];
  lastSnapshotAt: number | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SnapshotServiceImpl implements ISnapshotService {
  private readonly config: SnapshotServiceConfig;

  constructor(
    config: Partial<SnapshotServiceConfig>,
    private readonly storage: StorageAdapter,
    private readonly logger: Logger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async create(input: CreateSnapshotInput): Promise<ServiceResult<Snapshot>> {
    const startTime = Date.now();

    try {
      // Compute a content hash from the file list for deduplication
      const hash = createHash("sha256")
        .update(input.files.join("\n"))
        .update(input.description)
        .update(String(startTime))
        .digest("hex")
        .slice(0, 16);

      // Check for duplicate snapshot (same files, same workspace)
      const existingIndex = await this.loadWorkspaceIndex(input.workspacePath);
      let reused = false;

      if (existingIndex.length > 0) {
        const lastId = existingIndex[existingIndex.length - 1];
        if (lastId) {
          const lastSnapshot = await this.loadSnapshot(lastId);
          if (lastSnapshot && this.filesMatch(lastSnapshot.files, input.files)) {
            reused = true;
            this.logger.info("Reusing existing snapshot", {
              snapshotId: lastId,
              workspace: input.workspacePath,
            });
          }
        }
      }

      const snapshot: Snapshot = {
        id: randomUUID(),
        hash,
        files: [...input.files],
        createdAt: startTime,
        reused,
        metadata: input.metadata ?? {},
      };

      // Persist the snapshot
      await this.storage.write(
        snapshotKey(snapshot.id),
        JSON.stringify(snapshot),
      );

      // Update workspace index
      const updatedIndex = [...existingIndex, snapshot.id];
      if (updatedIndex.length > this.config.maxSnapshots) {
        // Evict oldest snapshots beyond the limit
        const toEvict = updatedIndex.splice(
          0,
          updatedIndex.length - this.config.maxSnapshots,
        );
        for (const evictId of toEvict) {
          await this.storage.delete(snapshotKey(evictId));
          this.logger.debug("Evicted old snapshot", { snapshotId: evictId });
        }
      }
      await this.storage.write(
        workspaceIndexKey(input.workspacePath),
        JSON.stringify(updatedIndex),
      );

      this.logger.info("Snapshot created", {
        snapshotId: snapshot.id,
        files: input.files.length,
        reused,
        durationMs: Date.now() - startTime,
      });

      return { ok: true, data: snapshot };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to create snapshot", { error: message });
      return { ok: false, error: message, code: "SNAPSHOT_CREATE_FAILED" };
    }
  }

  async getState(input: GetSnapshotInput): Promise<ServiceResult<SnapshotState>> {
    try {
      const sessionData = await this.storage.read(
        sessionKey(input.workspacePath, input.sessionId),
      );

      if (!sessionData) {
        return {
          ok: true,
          data: {
            activeSnapshotId: null,
            snapshotCount: 0,
            lastSnapshotAt: null,
          },
        };
      }

      const session = JSON.parse(sessionData) as SessionRecord;

      return {
        ok: true,
        data: {
          activeSnapshotId: session.activeSnapshotId,
          snapshotCount: session.snapshotIds.length,
          lastSnapshotAt: session.lastSnapshotAt,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to get snapshot state", { error: message });
      return { ok: false, error: message, code: "SNAPSHOT_STATE_FAILED" };
    }
  }

  async finalize(
    input: FinalizeSnapshotInput,
  ): Promise<ServiceResult<FinalizeSnapshotResult>> {
    const startTime = Date.now();

    try {
      // Verify the snapshot exists
      const snapshotData = await this.storage.read(
        snapshotKey(input.snapshotId),
      );

      if (!snapshotData) {
        return {
          ok: false,
          error: `Snapshot ${input.snapshotId} not found`,
          code: "SNAPSHOT_NOT_FOUND",
        };
      }

      const snapshot = JSON.parse(snapshotData) as Snapshot;

      // Update session to clear active snapshot
      const sKey = sessionKey(input.workspacePath, input.sessionId);
      const sessionData = await this.storage.read(sKey);
      const session: SessionRecord = sessionData
        ? (JSON.parse(sessionData) as SessionRecord)
        : { activeSnapshotId: null, snapshotIds: [], lastSnapshotAt: null };

      session.activeSnapshotId = null;
      await this.storage.write(sKey, JSON.stringify(session));

      const duration = Date.now() - snapshot.createdAt;

      this.logger.info("Snapshot finalized", {
        snapshotId: input.snapshotId,
        outcome: input.outcome,
        durationMs: duration,
      });

      return {
        ok: true,
        data: {
          finalized: true,
          snapshotId: input.snapshotId,
          duration,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to finalize snapshot", { error: message });
      return { ok: false, error: message, code: "SNAPSHOT_FINALIZE_FAILED" };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async loadWorkspaceIndex(workspacePath: string): Promise<string[]> {
    const data = await this.storage.read(workspaceIndexKey(workspacePath));
    if (!data) return [];
    return JSON.parse(data) as string[];
  }

  private async loadSnapshot(id: string): Promise<Snapshot | null> {
    const data = await this.storage.read(snapshotKey(id));
    if (!data) return null;
    return JSON.parse(data) as Snapshot;
  }

  private filesMatch(
    a: readonly string[],
    b: readonly string[],
  ): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, idx) => val === sortedB[idx]);
  }
}
