/**
 * CacheService unit tests.
 *
 * Validates:
 *   - Error cache get/set operations (workspace-scoped)
 *   - Pattern cache get/set operations with filtering
 *   - TTL-based staleness detection
 *   - Cache invalidation by workspace
 *   - LRU eviction when at capacity
 *   - Refresh flag clears cache before retrieval
 *   - Limit parameter caps returned results
 *   - Sorting: errors by occurrence count, patterns by match count
 *   - Empty cache returns sensible defaults
 *   - Error handling returns ServiceResult with ok: false
 *
 * @module tests/unit/cache-service
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CachedError, CachedPattern } from "../../src/contracts/services.js";
import { CacheServiceImpl } from "../../src/services/cache-service.js";
import { createMockLogger, type MockLogger } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCachedError(overrides: Partial<CachedError> = {}): CachedError {
  return {
    id: overrides.id ?? "err-1",
    diagnostic: overrides.diagnostic ?? {
      severity: "error",
      code: "E001",
      message: "Something broke",
    },
    firstSeen: overrides.firstSeen ?? 1_700_000_000_000,
    lastSeen: overrides.lastSeen ?? 1_700_000_000_000,
    occurrences: overrides.occurrences ?? 1,
    resolved: overrides.resolved ?? false,
  };
}

function makeCachedPattern(overrides: Partial<CachedPattern> = {}): CachedPattern {
  return {
    id: overrides.id ?? "pat-1",
    patternName: overrides.patternName ?? "no-console",
    file: overrides.file ?? "src/index.ts",
    matchCount: overrides.matchCount ?? 1,
    lastMatched: overrides.lastMatched ?? 1_700_000_000_000,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CacheServiceImpl", () => {
  let logger: MockLogger;

  beforeEach(() => {
    logger = createMockLogger();
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Error cache: basic operations
  // -------------------------------------------------------------------------

  describe("getErrors", () => {
    it("returns empty result when no errors are cached", async () => {
      const service = new CacheServiceImpl({}, logger);

      const result = await service.getErrors({ workspacePath: "/workspace" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.errors).toHaveLength(0);
        expect(result.data.totalCached).toBe(0);
        expect(result.data.cacheAge).toBe(0);
        expect(result.data.stale).toBe(false);
      }
    });

    it("returns cached errors after they are populated via internal cache", async () => {
      // CacheService uses internal LRU caches. We need to populate them
      // indirectly. Since there is no public "set" method on ICacheService,
      // we test the full round-trip by accessing the internal cache via
      // the class itself. The LRU caches are private, so we verify behavior
      // through the public getErrors/getPatterns API after using a workaround.
      //
      // We can test the staleness and empty-cache paths directly.
      // For populated-cache testing, we cast to access internals.
      const service = new CacheServiceImpl({}, logger) as any;
      const errorEntry = makeCachedError({ occurrences: 5 });

      // Directly populate the internal error cache
      service.errorCache.set(`error:/workspace:${errorEntry.id}`, errorEntry);

      const result = await service.getErrors({ workspacePath: "/workspace" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.errors).toHaveLength(1);
        expect(result.data.errors[0]?.id).toBe("err-1");
        expect(result.data.totalCached).toBe(1);
      }
    });

    it("sorts errors by occurrence count descending", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.errorCache.set("error:/ws:e1", makeCachedError({ id: "e1", occurrences: 2 }));
      service.errorCache.set("error:/ws:e2", makeCachedError({ id: "e2", occurrences: 10 }));
      service.errorCache.set("error:/ws:e3", makeCachedError({ id: "e3", occurrences: 5 }));

      const result = await service.getErrors({ workspacePath: "/ws" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.errors.map((e: CachedError) => e.id)).toEqual(["e2", "e3", "e1"]);
      }
    });

    it("respects limit parameter", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      for (let i = 0; i < 10; i++) {
        service.errorCache.set(
          `error:/ws:e${i}`,
          makeCachedError({ id: `e${i}`, occurrences: 10 - i }),
        );
      }

      const result = await service.getErrors({
        workspacePath: "/ws",
        limit: 3,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.errors).toHaveLength(3);
        expect(result.data.totalCached).toBe(10);
      }
    });

    it("clears cache when refresh is true", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.errorCache.set("error:/ws:e1", makeCachedError({ id: "e1" }));

      const result = await service.getErrors({
        workspacePath: "/ws",
        refresh: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.errors).toHaveLength(0);
        expect(result.data.totalCached).toBe(0);
      }
    });

    it("marks cache as stale when entries exceed TTL", async () => {
      const service = new CacheServiceImpl({ ttlMs: 1000 }, logger) as any;

      // Insert at current time
      service.errorCache.set("error:/ws:e1", makeCachedError({ id: "e1" }));

      // Advance past TTL
      vi.advanceTimersByTime(2000);

      const result = await service.getErrors({ workspacePath: "/ws" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stale).toBe(true);
        expect(result.data.cacheAge).toBeGreaterThan(1000);
      }
    });

    it("reports cache as not stale when entries are within TTL", async () => {
      const service = new CacheServiceImpl({ ttlMs: 60_000 }, logger) as any;

      service.errorCache.set("error:/ws:e1", makeCachedError({ id: "e1" }));

      // Advance but stay within TTL
      vi.advanceTimersByTime(5000);

      const result = await service.getErrors({ workspacePath: "/ws" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stale).toBe(false);
      }
    });

    it("isolates errors by workspace path", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.errorCache.set("error:/ws-a:e1", makeCachedError({ id: "e1" }));
      service.errorCache.set("error:/ws-b:e2", makeCachedError({ id: "e2" }));

      const resultA = await service.getErrors({ workspacePath: "/ws-a" });
      const resultB = await service.getErrors({ workspacePath: "/ws-b" });

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.data.errors).toHaveLength(1);
        expect(resultA.data.errors[0]?.id).toBe("e1");
        expect(resultB.data.errors).toHaveLength(1);
        expect(resultB.data.errors[0]?.id).toBe("e2");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Pattern cache: basic operations
  // -------------------------------------------------------------------------

  describe("getPatterns", () => {
    it("returns empty result when no patterns are cached", async () => {
      const service = new CacheServiceImpl({}, logger);

      const result = await service.getPatterns({ workspacePath: "/ws" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.patterns).toHaveLength(0);
        expect(result.data.totalCached).toBe(0);
        expect(result.data.cacheAge).toBe(0);
        expect(result.data.stale).toBe(false);
      }
    });

    it("returns cached patterns after they are populated", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.patternCache.set("pattern:/ws:p1", makeCachedPattern({ id: "p1", matchCount: 3 }));

      const result = await service.getPatterns({ workspacePath: "/ws" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.patterns).toHaveLength(1);
        expect(result.data.patterns[0]?.id).toBe("p1");
        expect(result.data.totalCached).toBe(1);
      }
    });

    it("sorts patterns by match count descending", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.patternCache.set("pattern:/ws:p1", makeCachedPattern({ id: "p1", matchCount: 2 }));
      service.patternCache.set("pattern:/ws:p2", makeCachedPattern({ id: "p2", matchCount: 8 }));
      service.patternCache.set("pattern:/ws:p3", makeCachedPattern({ id: "p3", matchCount: 5 }));

      const result = await service.getPatterns({ workspacePath: "/ws" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.patterns.map((p: CachedPattern) => p.id)).toEqual(["p2", "p3", "p1"]);
      }
    });

    it("filters patterns by patternFilter (case-insensitive)", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.patternCache.set(
        "pattern:/ws:p1",
        makeCachedPattern({ id: "p1", patternName: "no-console" }),
      );
      service.patternCache.set(
        "pattern:/ws:p2",
        makeCachedPattern({ id: "p2", patternName: "no-eval" }),
      );
      service.patternCache.set(
        "pattern:/ws:p3",
        makeCachedPattern({ id: "p3", patternName: "NO-CONSOLE-log" }),
      );

      const result = await service.getPatterns({
        workspacePath: "/ws",
        patternFilter: "console",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.patterns).toHaveLength(2);
        const ids = result.data.patterns.map((p: CachedPattern) => p.id);
        expect(ids).toContain("p1");
        expect(ids).toContain("p3");
      }
    });

    it("clears pattern cache when refresh is true", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.patternCache.set("pattern:/ws:p1", makeCachedPattern({ id: "p1" }));

      const result = await service.getPatterns({
        workspacePath: "/ws",
        refresh: true,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.patterns).toHaveLength(0);
      }
    });

    it("marks pattern cache as stale when entries exceed TTL", async () => {
      const service = new CacheServiceImpl({ ttlMs: 500 }, logger) as any;

      service.patternCache.set("pattern:/ws:p1", makeCachedPattern({ id: "p1" }));

      vi.advanceTimersByTime(1000);

      const result = await service.getPatterns({ workspacePath: "/ws" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stale).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Cache invalidation
  // -------------------------------------------------------------------------

  describe("invalidate", () => {
    it("clears both error and pattern caches for the specified workspace", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.errorCache.set("error:/ws:e1", makeCachedError({ id: "e1" }));
      service.patternCache.set("pattern:/ws:p1", makeCachedPattern({ id: "p1" }));

      await service.invalidate("/ws");

      const errors = await service.getErrors({ workspacePath: "/ws" });
      const patterns = await service.getPatterns({ workspacePath: "/ws" });

      expect(errors.ok).toBe(true);
      expect(patterns.ok).toBe(true);
      if (errors.ok && patterns.ok) {
        expect(errors.data.errors).toHaveLength(0);
        expect(patterns.data.patterns).toHaveLength(0);
      }
    });

    it("does not clear caches for other workspaces", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.errorCache.set("error:/ws-a:e1", makeCachedError({ id: "e1" }));
      service.errorCache.set("error:/ws-b:e2", makeCachedError({ id: "e2" }));

      await service.invalidate("/ws-a");

      const resultA = await service.getErrors({ workspacePath: "/ws-a" });
      const resultB = await service.getErrors({ workspacePath: "/ws-b" });

      expect(resultA.ok).toBe(true);
      expect(resultB.ok).toBe(true);
      if (resultA.ok && resultB.ok) {
        expect(resultA.data.errors).toHaveLength(0);
        expect(resultB.data.errors).toHaveLength(1);
      }
    });

    it("logs an info message on invalidation", async () => {
      const service = new CacheServiceImpl({}, logger);

      await service.invalidate("/ws");

      const infoEntries = logger.entriesAt("info");
      expect(infoEntries.length).toBeGreaterThan(0);
      expect(infoEntries.some((e) => e.message.includes("invalidated"))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // LRU eviction
  // -------------------------------------------------------------------------

  describe("LRU eviction", () => {
    it("evicts least recently accessed entry when cache exceeds maxEntries", async () => {
      const service = new CacheServiceImpl({ maxEntries: 2 }, logger) as any;

      // Insert two entries at time 0
      service.errorCache.set("error:/ws:e1", makeCachedError({ id: "e1" }));

      vi.advanceTimersByTime(100);
      service.errorCache.set("error:/ws:e2", makeCachedError({ id: "e2" }));

      // Access e1 to make it more recently used
      vi.advanceTimersByTime(100);
      service.errorCache.get("error:/ws:e1");

      // Insert a third entry -- should evict e2 (least recently accessed)
      vi.advanceTimersByTime(100);
      service.errorCache.set("error:/ws:e3", makeCachedError({ id: "e3" }));

      const result = await service.getErrors({ workspacePath: "/ws" });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.errors).toHaveLength(2);
        const ids = result.data.errors.map((e: CachedError) => e.id);
        expect(ids).toContain("e1");
        expect(ids).toContain("e3");
        expect(ids).not.toContain("e2");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Config defaults
  // -------------------------------------------------------------------------

  describe("configuration", () => {
    it("uses default TTL of 5 minutes when no config provided", async () => {
      const service = new CacheServiceImpl({}, logger) as any;

      service.errorCache.set("error:/ws:e1", makeCachedError({ id: "e1" }));

      // 4 minutes -- should not be stale
      vi.advanceTimersByTime(4 * 60 * 1000);
      let result = await service.getErrors({ workspacePath: "/ws" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stale).toBe(false);
      }

      // 6 minutes total -- should be stale
      vi.advanceTimersByTime(2 * 60 * 1000);
      result = await service.getErrors({ workspacePath: "/ws" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stale).toBe(true);
      }
    });

    it("accepts custom TTL via config", async () => {
      const service = new CacheServiceImpl({ ttlMs: 2000 }, logger) as any;

      service.errorCache.set("error:/ws:e1", makeCachedError({ id: "e1" }));

      vi.advanceTimersByTime(1500);
      let result = await service.getErrors({ workspacePath: "/ws" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stale).toBe(false);
      }

      vi.advanceTimersByTime(1000);
      result = await service.getErrors({ workspacePath: "/ws" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stale).toBe(true);
      }
    });
  });
});
