/**
 * LearningService unit tests.
 *
 * Validates:
 *   - Saving a new learning (persist + index update)
 *   - Deduplication on save (same trigger + action returns existing)
 *   - Loading tiered learnings with relevance scoring
 *   - Access count incremented on load
 *   - Search by text query (trigger and action fields)
 *   - Search filtered by learning type
 *   - Search sorting: access count desc, then recency desc
 *   - Batch recording via recordBatch
 *   - Deduplication tracking in batch recording
 *   - Max learnings eviction on save
 *   - Limit parameter respected on loadTiered and search
 *   - Error handling returns ServiceResult with ok: false
 *   - Graceful degradation when save fails inside recordBatch
 *
 * Uses the real InMemoryStorage adapter for isolated storage per test.
 *
 * @module tests/unit/learning-service
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Learning, LearningType } from "../../src/contracts/services.js";
import { InMemoryStorage } from "../../src/services/adapters.js";
import { LearningServiceImpl } from "../../src/services/learning-service.js";
import { createMockLogger, type MockLogger } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WORKSPACE = "/test/workspace";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LearningServiceImpl", () => {
  let logger: MockLogger;
  let storage: InMemoryStorage;

  beforeEach(() => {
    logger = createMockLogger();
    storage = new InMemoryStorage();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // save
  // -------------------------------------------------------------------------

  describe("save", () => {
    it("saves a new learning and returns it with generated id", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const result = await service.save({
        workspacePath: WORKSPACE,
        trigger: "modifying auth middleware",
        action: "always validate JWT expiry before checking claims",
        type: "pattern",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBeDefined();
        expect(result.data.id.length).toBeGreaterThan(0);
        expect(result.data.trigger).toBe("modifying auth middleware");
        expect(result.data.action).toBe("always validate JWT expiry before checking claims");
        expect(result.data.type).toBe("pattern");
        expect(result.data.accessCount).toBe(0);
        expect(result.data.createdAt).toBe(1_700_000_000_000);
      }
    });

    it("persists learning to storage", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const result = await service.save({
        workspacePath: WORKSPACE,
        trigger: "test trigger",
        action: "test action",
        type: "discovery",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const stored = await storage.read(`learning:${result.data.id}`);
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!) as Learning;
      expect(parsed.trigger).toBe("test trigger");
    });

    it("updates workspace index after saving", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const result = await service.save({
        workspacePath: WORKSPACE,
        trigger: "trigger",
        action: "action",
        type: "pattern",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const indexData = await storage.read(`learning-index:${WORKSPACE}`);
      expect(indexData).not.toBeNull();
      const index = JSON.parse(indexData!) as string[];
      expect(index).toContain(result.data.id);
    });

    it("deduplicates learning with same trigger and action", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const first = await service.save({
        workspacePath: WORKSPACE,
        trigger: "same trigger",
        action: "same action",
        type: "pattern",
      });

      vi.advanceTimersByTime(5000);

      const second = await service.save({
        workspacePath: WORKSPACE,
        trigger: "same trigger",
        action: "same action",
        type: "pitfall", // even with different type, trigger+action match
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.data.id).toBe(first.data.id);
      }

      // Verify only one entry in the index
      const indexData = await storage.read(`learning-index:${WORKSPACE}`);
      const index = JSON.parse(indexData!) as string[];
      expect(index).toHaveLength(1);
    });

    it("allows different trigger+action combinations", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const first = await service.save({
        workspacePath: WORKSPACE,
        trigger: "trigger A",
        action: "action A",
        type: "pattern",
      });

      const second = await service.save({
        workspacePath: WORKSPACE,
        trigger: "trigger B",
        action: "action B",
        type: "pattern",
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (first.ok && second.ok) {
        expect(second.data.id).not.toBe(first.data.id);
      }
    });

    it("evicts oldest learnings when exceeding maxLearnings", async () => {
      const service = new LearningServiceImpl({ maxLearnings: 2 }, storage, logger);

      const r1 = await service.save({
        workspacePath: WORKSPACE,
        trigger: "t1",
        action: "a1",
        type: "pattern",
      });
      const r2 = await service.save({
        workspacePath: WORKSPACE,
        trigger: "t2",
        action: "a2",
        type: "pitfall",
      });
      const r3 = await service.save({
        workspacePath: WORKSPACE,
        trigger: "t3",
        action: "a3",
        type: "discovery",
      });

      expect(r1.ok && r2.ok && r3.ok).toBe(true);
      if (!r1.ok || !r2.ok || !r3.ok) return;

      // First learning should be evicted from storage
      const evicted = await storage.read(`learning:${r1.data.id}`);
      expect(evicted).toBeNull();

      // Second and third should still exist
      const kept2 = await storage.read(`learning:${r2.data.id}`);
      const kept3 = await storage.read(`learning:${r3.data.id}`);
      expect(kept2).not.toBeNull();
      expect(kept3).not.toBeNull();
    });

    it("logs info on successful save", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "t",
        action: "a",
        type: "pattern",
      });

      const infoEntries = logger.entriesAt("info");
      expect(infoEntries.some((e) => e.message.includes("Learning saved"))).toBe(true);
    });

    it("returns error result when storage throws", async () => {
      const failingStorage = {
        read: vi.fn().mockRejectedValue(new Error("storage down")),
        write: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
      };
      const service = new LearningServiceImpl({}, failingStorage, logger);

      const result = await service.save({
        workspacePath: WORKSPACE,
        trigger: "t",
        action: "a",
        type: "pattern",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("LEARNING_SAVE_FAILED");
        expect(result.error).toContain("storage down");
      }
    });
  });

  // -------------------------------------------------------------------------
  // loadTiered
  // -------------------------------------------------------------------------

  describe("loadTiered", () => {
    it("returns empty result when no learnings exist", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const result = await service.loadTiered({ workspacePath: WORKSPACE });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(0);
        expect(result.data.totalAvailable).toBe(0);
      }
    });

    it("returns all learnings when count is below limit", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "t1",
        action: "a1",
        type: "pattern",
      });
      await service.save({
        workspacePath: WORKSPACE,
        trigger: "t2",
        action: "a2",
        type: "pitfall",
      });

      const result = await service.loadTiered({ workspacePath: WORKSPACE });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(2);
        expect(result.data.totalAvailable).toBe(2);
      }
    });

    it("respects the limit parameter", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(100);
        await service.save({
          workspacePath: WORKSPACE,
          trigger: `t${i}`,
          action: `a${i}`,
          type: "pattern",
        });
      }

      const result = await service.loadTiered({
        workspacePath: WORKSPACE,
        limit: 2,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(2);
        expect(result.data.totalAvailable).toBe(5);
      }
    });

    it("increments access count for returned learnings", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const saved = await service.save({
        workspacePath: WORKSPACE,
        trigger: "t1",
        action: "a1",
        type: "pattern",
      });
      expect(saved.ok).toBe(true);
      if (!saved.ok) return;
      expect(saved.data.accessCount).toBe(0);

      // Load once -- should increment access count
      const loaded1 = await service.loadTiered({ workspacePath: WORKSPACE });
      expect(loaded1.ok).toBe(true);
      if (loaded1.ok) {
        expect(loaded1.data.learnings[0]?.accessCount).toBe(1);
      }

      // Load again -- should be 2 now
      const loaded2 = await service.loadTiered({ workspacePath: WORKSPACE });
      expect(loaded2.ok).toBe(true);
      if (loaded2.ok) {
        expect(loaded2.data.learnings[0]?.accessCount).toBe(2);
      }
    });

    it("boosts relevance for intent-matching learnings", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "working on database queries",
        action: "always use parameterized queries",
        type: "pattern",
      });
      await service.save({
        workspacePath: WORKSPACE,
        trigger: "working on auth middleware",
        action: "check token expiry",
        type: "pattern",
      });

      const result = await service.loadTiered({
        workspacePath: WORKSPACE,
        intent: "auth",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // The auth-related learning should rank first due to intent match
        expect(result.data.learnings[0]?.trigger).toContain("auth");
      }
    });

    it("boosts relevance for file path matching learnings", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "editing utils.ts",
        action: "remember to export new functions",
        type: "pattern",
      });
      await service.save({
        workspacePath: WORKSPACE,
        trigger: "unrelated trigger",
        action: "unrelated action",
        type: "discovery",
      });

      const result = await service.loadTiered({
        workspacePath: WORKSPACE,
        filePaths: ["/project/src/utils.ts"],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings[0]?.trigger).toContain("utils.ts");
      }
    });

    it("prioritizes patterns and pitfalls over other types", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      // Create learnings at the same time so recency is equal
      const types: LearningType[] = ["discovery", "pattern", "workflow", "pitfall", "efficiency"];
      for (const type of types) {
        await service.save({
          workspacePath: WORKSPACE,
          trigger: `trigger-${type}`,
          action: `action-${type}`,
          type,
        });
      }

      const result = await service.loadTiered({ workspacePath: WORKSPACE });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Pattern and pitfall should be in the top 2 due to type priority
        const topTypes = result.data.learnings.slice(0, 2).map((l: Learning) => l.type);
        expect(topTypes).toContain("pattern");
        expect(topTypes).toContain("pitfall");
      }
    });

    it("returns error result when storage throws", async () => {
      const failingStorage = {
        read: vi.fn().mockRejectedValue(new Error("read failure")),
        write: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
      };
      const service = new LearningServiceImpl({}, failingStorage, logger);

      const result = await service.loadTiered({ workspacePath: WORKSPACE });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("LEARNING_LOAD_FAILED");
      }
    });
  });

  // -------------------------------------------------------------------------
  // search
  // -------------------------------------------------------------------------

  describe("search", () => {
    it("returns empty result when no learnings match", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "auth middleware",
        action: "validate tokens",
        type: "pattern",
      });

      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "database",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(0);
        expect(result.data.totalMatches).toBe(0);
      }
    });

    it("matches against trigger field (case-insensitive)", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "Modifying AUTH Middleware",
        action: "check expiry",
        type: "pattern",
      });

      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "auth",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(1);
        expect(result.data.learnings[0]?.trigger).toContain("AUTH");
      }
    });

    it("matches against action field (case-insensitive)", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "some trigger",
        action: "Always use PARAMETERIZED queries",
        type: "pitfall",
      });

      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "parameterized",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(1);
      }
    });

    it("filters by type when specified", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "auth trigger",
        action: "auth action",
        type: "pattern",
      });
      await service.save({
        workspacePath: WORKSPACE,
        trigger: "auth trigger 2",
        action: "auth action 2",
        type: "pitfall",
      });

      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "auth",
        type: "pitfall",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(1);
        expect(result.data.learnings[0]?.type).toBe("pitfall");
      }
    });

    it("sorts by access count descending, then by recency", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      // Save two learnings with "test" in them at different times
      await service.save({
        workspacePath: WORKSPACE,
        trigger: "test popular",
        action: "action A",
        type: "pattern",
      });

      vi.advanceTimersByTime(1000);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "test unpopular",
        action: "action B",
        type: "pattern",
      });

      // Load tiered with limit=1 and intent targeting "popular" to only
      // increment the access count of the first learning.
      // The intent "popular" matches the trigger "test popular", giving it
      // a higher relevance score so it is the one selected within limit=1.
      await service.loadTiered({
        workspacePath: WORKSPACE,
        intent: "popular",
        limit: 1,
      });
      // Call again to get accessCount to 2 for the popular one
      await service.loadTiered({
        workspacePath: WORKSPACE,
        intent: "popular",
        limit: 1,
      });

      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "test",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(2);
        // "test popular" has accessCount=2, "test unpopular" has accessCount=0
        // so "test popular" should be first
        expect(result.data.learnings[0]?.trigger).toContain("popular");
        expect(result.data.learnings[1]?.trigger).toContain("unpopular");
      }
    });

    it("breaks access count ties by recency descending", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      // Create two learnings with same type (same accessCount=0)
      await service.save({
        workspacePath: WORKSPACE,
        trigger: "test older entry",
        action: "action old",
        type: "pattern",
      });

      vi.advanceTimersByTime(5000);

      await service.save({
        workspacePath: WORKSPACE,
        trigger: "test newer entry",
        action: "action new",
        type: "pattern",
      });

      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "test",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(2);
        // Both have accessCount=0, so newer one should come first
        expect(result.data.learnings[0]?.trigger).toContain("newer");
        expect(result.data.learnings[1]?.trigger).toContain("older");
      }
    });

    it("respects limit parameter", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      for (let i = 0; i < 5; i++) {
        await service.save({
          workspacePath: WORKSPACE,
          trigger: `test trigger ${i}`,
          action: `test action ${i}`,
          type: "pattern",
        });
      }

      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "test",
        limit: 2,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(2);
        expect(result.data.totalMatches).toBe(5);
      }
    });

    it("returns error result when storage throws", async () => {
      const failingStorage = {
        read: vi.fn().mockRejectedValue(new Error("search failure")),
        write: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
      };
      const service = new LearningServiceImpl({}, failingStorage, logger);

      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "test",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("LEARNING_SEARCH_FAILED");
      }
    });
  });

  // -------------------------------------------------------------------------
  // recordBatch
  // -------------------------------------------------------------------------

  describe("recordBatch", () => {
    it("records multiple learnings from a batch", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const result = await service.recordBatch({
        workspacePath: WORKSPACE,
        learnings: ["cooldown should be set after success", "always log errors in catch blocks"],
        sessionId: "sess-1",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stored).toBe(2);
        expect(result.data.deduplicated).toBe(0);
      }
    });

    it("uses session ID as trigger prefix and discovery as type", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.recordBatch({
        workspacePath: WORKSPACE,
        learnings: ["test insight"],
        sessionId: "sess-42",
      });

      // Search for the recorded learning
      const result = await service.search({
        workspacePath: WORKSPACE,
        query: "test insight",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.learnings).toHaveLength(1);
        expect(result.data.learnings[0]?.trigger).toBe("session:sess-42");
        expect(result.data.learnings[0]?.type).toBe("discovery");
      }
    });

    it("detects duplicates in batch recording", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      // First batch
      await service.recordBatch({
        workspacePath: WORKSPACE,
        learnings: ["important insight"],
        sessionId: "sess-1",
      });

      // Advance time so the duplicate detection threshold is crossed
      vi.advanceTimersByTime(2000);

      // Second batch with the same text and same session trigger
      const result = await service.recordBatch({
        workspacePath: WORKSPACE,
        learnings: ["important insight"],
        sessionId: "sess-1",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stored).toBe(0);
        expect(result.data.deduplicated).toBe(1);
      }
    });

    it("handles empty learnings array", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      const result = await service.recordBatch({
        workspacePath: WORKSPACE,
        learnings: [],
        sessionId: "sess-1",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stored).toBe(0);
        expect(result.data.deduplicated).toBe(0);
      }
    });

    it("succeeds with zero stored when individual saves fail internally", async () => {
      // recordBatch delegates to save(), which catches its own errors and
      // returns ok:false. The for-loop in recordBatch checks result.ok and
      // simply skips failed saves without incrementing counters. The outer
      // try/catch in recordBatch is only reached if something outside save()
      // throws, so the overall result is ok:true with stored=0.
      const failingStorage = {
        read: vi.fn().mockRejectedValue(new Error("batch failure")),
        write: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
      };
      const service = new LearningServiceImpl({}, failingStorage, logger);

      const result = await service.recordBatch({
        workspacePath: WORKSPACE,
        learnings: ["test"],
        sessionId: "sess-1",
      });

      // save() catches internally, so recordBatch succeeds with stored=0
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stored).toBe(0);
        expect(result.data.deduplicated).toBe(0);
      }
    });

    it("logs info on successful batch recording", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.recordBatch({
        workspacePath: WORKSPACE,
        learnings: ["insight A", "insight B"],
        sessionId: "sess-1",
      });

      const infoEntries = logger.entriesAt("info");
      expect(infoEntries.some((e) => e.message.includes("Batch learnings recorded"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Workspace isolation
  // -------------------------------------------------------------------------

  describe("workspace isolation", () => {
    it("isolates learnings by workspace path", async () => {
      const service = new LearningServiceImpl({}, storage, logger);

      await service.save({
        workspacePath: "/workspace-a",
        trigger: "trigger A",
        action: "action A",
        type: "pattern",
      });

      await service.save({
        workspacePath: "/workspace-b",
        trigger: "trigger B",
        action: "action B",
        type: "pitfall",
      });

      const resultA = await service.loadTiered({ workspacePath: "/workspace-a" });
      const resultB = await service.loadTiered({ workspacePath: "/workspace-b" });

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.data.learnings).toHaveLength(1);
        expect(resultA.data.learnings[0]?.trigger).toBe("trigger A");
        expect(resultB.data.learnings).toHaveLength(1);
        expect(resultB.data.learnings[0]?.trigger).toBe("trigger B");
      }
    });
  });
});
