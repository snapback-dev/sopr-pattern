/**
 * SnapshotService unit tests.
 *
 * Validates:
 *   - Creating snapshots with correct metadata and hash
 *   - Snapshot reuse detection when files match
 *   - Workspace index management and eviction of old snapshots
 *   - Retrieving snapshot state for a session
 *   - Returning empty state for unknown sessions
 *   - Finalizing snapshots (success and not-found cases)
 *   - Error handling returns ServiceResult with ok: false
 *
 * Uses the real InMemoryStorage adapter for a clean, isolated
 * storage backend per test.
 *
 * @module tests/unit/snapshot-service
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Snapshot } from "../../src/contracts/services.js";
import { InMemoryStorage } from "../../src/services/adapters.js";
import { SnapshotServiceImpl } from "../../src/services/snapshot-service.js";
import { createMockLogger, type MockLogger } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const WORKSPACE = "/test/workspace";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SnapshotServiceImpl", () => {
  let logger: MockLogger;
  let storage: InMemoryStorage;

  beforeEach(() => {
    logger = createMockLogger();
    storage = new InMemoryStorage();
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe("create", () => {
    it("creates a snapshot and returns it with a unique id and hash", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      const result = await service.create({
        files: ["src/a.ts", "src/b.ts"],
        workspacePath: WORKSPACE,
        description: "initial snapshot",
        trigger: "manual",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBeDefined();
        expect(result.data.id.length).toBeGreaterThan(0);
        expect(result.data.hash).toBeDefined();
        expect(result.data.hash.length).toBe(16);
        expect(result.data.files).toEqual(["src/a.ts", "src/b.ts"]);
        expect(result.data.reused).toBe(false);
        expect(result.data.metadata).toEqual({});
        expect(result.data.createdAt).toBeGreaterThan(0);
      }
    });

    it("persists the snapshot to storage", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      const result = await service.create({
        files: ["src/a.ts"],
        workspacePath: WORKSPACE,
        description: "test",
        trigger: "auto",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const stored = await storage.read(`snapshot:${result.data.id}`);
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored!) as Snapshot;
        expect(parsed.id).toBe(result.data.id);
      }
    });

    it("stores metadata when provided", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      const result = await service.create({
        files: ["src/a.ts"],
        workspacePath: WORKSPACE,
        description: "with metadata",
        trigger: "manual",
        metadata: { author: "tester", branch: "main" },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.metadata).toEqual({
          author: "tester",
          branch: "main",
        });
      }
    });

    it("detects reuse when last snapshot has the same files", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);
      const files = ["src/a.ts", "src/b.ts"];

      // First snapshot
      const first = await service.create({
        files,
        workspacePath: WORKSPACE,
        description: "first",
        trigger: "manual",
      });

      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.reused).toBe(false);

      // Second snapshot with the same files
      const second = await service.create({
        files,
        workspacePath: WORKSPACE,
        description: "second",
        trigger: "auto",
      });

      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.data.reused).toBe(true);
        // Should still get a new ID
        expect(second.data.id).not.toBe(first.data.id);
      }
    });

    it("detects reuse regardless of file order", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      await service.create({
        files: ["src/b.ts", "src/a.ts"],
        workspacePath: WORKSPACE,
        description: "first",
        trigger: "manual",
      });

      const result = await service.create({
        files: ["src/a.ts", "src/b.ts"],
        workspacePath: WORKSPACE,
        description: "second",
        trigger: "manual",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.reused).toBe(true);
      }
    });

    it("does not detect reuse when files differ", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      await service.create({
        files: ["src/a.ts"],
        workspacePath: WORKSPACE,
        description: "first",
        trigger: "manual",
      });

      const result = await service.create({
        files: ["src/a.ts", "src/c.ts"],
        workspacePath: WORKSPACE,
        description: "second",
        trigger: "manual",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.reused).toBe(false);
      }
    });

    it("evicts oldest snapshots when exceeding maxSnapshots", async () => {
      const service = new SnapshotServiceImpl({ maxSnapshots: 2 }, storage, logger);

      const snap1 = await service.create({
        files: ["a.ts"],
        workspacePath: WORKSPACE,
        description: "snap1",
        trigger: "manual",
      });
      const snap2 = await service.create({
        files: ["b.ts"],
        workspacePath: WORKSPACE,
        description: "snap2",
        trigger: "manual",
      });
      const snap3 = await service.create({
        files: ["c.ts"],
        workspacePath: WORKSPACE,
        description: "snap3",
        trigger: "manual",
      });

      expect(snap1.ok && snap2.ok && snap3.ok).toBe(true);
      if (!snap1.ok || !snap2.ok || !snap3.ok) return;

      // snap1 should have been evicted from storage
      const evicted = await storage.read(`snapshot:${snap1.data.id}`);
      expect(evicted).toBeNull();

      // snap2 and snap3 should still exist
      const kept2 = await storage.read(`snapshot:${snap2.data.id}`);
      const kept3 = await storage.read(`snapshot:${snap3.data.id}`);
      expect(kept2).not.toBeNull();
      expect(kept3).not.toBeNull();
    });

    it("updates the workspace index after creation", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      const result = await service.create({
        files: ["src/a.ts"],
        workspacePath: WORKSPACE,
        description: "test",
        trigger: "manual",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const indexData = await storage.read(`workspace-index:${WORKSPACE}`);
      expect(indexData).not.toBeNull();
      const index = JSON.parse(indexData!) as string[];
      expect(index).toContain(result.data.id);
    });

    it("logs info on successful creation", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      await service.create({
        files: ["src/a.ts"],
        workspacePath: WORKSPACE,
        description: "test",
        trigger: "manual",
      });

      const infoEntries = logger.entriesAt("info");
      expect(infoEntries.some((e) => e.message.includes("Snapshot created"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getState
  // -------------------------------------------------------------------------

  describe("getState", () => {
    it("returns empty state for an unknown session", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      const result = await service.getState({
        workspacePath: WORKSPACE,
        sessionId: "nonexistent-session",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.activeSnapshotId).toBeNull();
        expect(result.data.snapshotCount).toBe(0);
        expect(result.data.lastSnapshotAt).toBeNull();
      }
    });

    it("returns session state when session data exists in storage", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      // Manually write session data to storage to simulate an active session
      const sessionRecord = {
        activeSnapshotId: "snap-abc",
        snapshotIds: ["snap-abc", "snap-def"],
        lastSnapshotAt: 1_700_000_001_000,
      };
      await storage.write(`session:${WORKSPACE}:sess-1`, JSON.stringify(sessionRecord));

      const result = await service.getState({
        workspacePath: WORKSPACE,
        sessionId: "sess-1",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.activeSnapshotId).toBe("snap-abc");
        expect(result.data.snapshotCount).toBe(2);
        expect(result.data.lastSnapshotAt).toBe(1_700_000_001_000);
      }
    });

    it("returns error result when storage read throws", async () => {
      const failingStorage = {
        ...storage,
        read: vi.fn().mockRejectedValue(new Error("disk read failed")),
        write: storage.write.bind(storage),
        delete: storage.delete.bind(storage),
        list: storage.list.bind(storage),
      };
      const service = new SnapshotServiceImpl({}, failingStorage, logger);

      const result = await service.getState({
        workspacePath: WORKSPACE,
        sessionId: "sess-1",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("disk read failed");
        expect(result.code).toBe("SNAPSHOT_STATE_FAILED");
      }
    });
  });

  // -------------------------------------------------------------------------
  // finalize
  // -------------------------------------------------------------------------

  describe("finalize", () => {
    it("finalizes an existing snapshot successfully", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      // Create a snapshot first
      const created = await service.create({
        files: ["src/a.ts"],
        workspacePath: WORKSPACE,
        description: "to finalize",
        trigger: "manual",
      });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await service.finalize({
        workspacePath: WORKSPACE,
        sessionId: "sess-1",
        snapshotId: created.data.id,
        outcome: "completed",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.finalized).toBe(true);
        expect(result.data.snapshotId).toBe(created.data.id);
        expect(result.data.duration).toBeGreaterThanOrEqual(0);
      }
    });

    it("returns not-found error for nonexistent snapshot", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      const result = await service.finalize({
        workspacePath: WORKSPACE,
        sessionId: "sess-1",
        snapshotId: "nonexistent-id",
        outcome: "completed",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("not found");
        expect(result.code).toBe("SNAPSHOT_NOT_FOUND");
      }
    });

    it("clears active snapshot in session record after finalization", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      // Create a snapshot
      const created = await service.create({
        files: ["src/a.ts"],
        workspacePath: WORKSPACE,
        description: "active snap",
        trigger: "manual",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Write a session record with the snapshot as active
      const sessionRecord = {
        activeSnapshotId: created.data.id,
        snapshotIds: [created.data.id],
        lastSnapshotAt: Date.now(),
      };
      await storage.write(`session:${WORKSPACE}:sess-1`, JSON.stringify(sessionRecord));

      // Finalize
      await service.finalize({
        workspacePath: WORKSPACE,
        sessionId: "sess-1",
        snapshotId: created.data.id,
        outcome: "completed",
      });

      // Read session state -- activeSnapshotId should be null
      const result = await service.getState({
        workspacePath: WORKSPACE,
        sessionId: "sess-1",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.activeSnapshotId).toBeNull();
      }
    });

    it("logs info on successful finalization", async () => {
      const service = new SnapshotServiceImpl({}, storage, logger);

      const created = await service.create({
        files: ["src/a.ts"],
        workspacePath: WORKSPACE,
        description: "for logging",
        trigger: "manual",
      });

      expect(created.ok).toBe(true);
      if (!created.ok) return;

      logger.clear();

      await service.finalize({
        workspacePath: WORKSPACE,
        sessionId: "sess-1",
        snapshotId: created.data.id,
        outcome: "abandoned",
      });

      const infoEntries = logger.entriesAt("info");
      expect(infoEntries.some((e) => e.message.includes("finalized"))).toBe(true);
    });

    it("returns error result when storage throws during finalization", async () => {
      const failingStorage = {
        ...storage,
        read: vi.fn().mockRejectedValue(new Error("storage failure")),
        write: storage.write.bind(storage),
        delete: storage.delete.bind(storage),
        list: storage.list.bind(storage),
      };
      const service = new SnapshotServiceImpl({}, failingStorage, logger);

      const result = await service.finalize({
        workspacePath: WORKSPACE,
        sessionId: "sess-1",
        snapshotId: "any-id",
        outcome: "blocked",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("storage failure");
        expect(result.code).toBe("SNAPSHOT_FINALIZE_FAILED");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe("error handling", () => {
    it("returns error result when storage throws during create", async () => {
      const failingStorage = {
        read: vi.fn().mockResolvedValue(null),
        write: vi.fn().mockRejectedValue(new Error("write failed")),
        delete: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
      };
      const service = new SnapshotServiceImpl({}, failingStorage, logger);

      const result = await service.create({
        files: ["a.ts"],
        workspacePath: WORKSPACE,
        description: "will fail",
        trigger: "manual",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("write failed");
        expect(result.code).toBe("SNAPSHOT_CREATE_FAILED");
      }
    });

    it("logs error when operations fail", async () => {
      const failingStorage = {
        read: vi.fn().mockRejectedValue(new Error("boom")),
        write: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(false),
        list: vi.fn().mockResolvedValue([]),
      };
      const service = new SnapshotServiceImpl({}, failingStorage, logger);

      await service.getState({ workspacePath: WORKSPACE, sessionId: "s1" });

      const errorEntries = logger.entriesAt("error");
      expect(errorEntries.length).toBeGreaterThan(0);
      expect(errorEntries[0]?.message).toContain("Failed to get snapshot state");
    });
  });
});
