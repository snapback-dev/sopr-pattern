/**
 * RiskService (free tier stub) unit tests.
 *
 * Validates:
 *   - Heuristic risk scoring based on file count
 *   - Upgrade availability always indicated
 *   - Pro features listed in response
 *
 * @module tests/unit/risk-service
 */

import { describe, expect, it } from "vitest";
import { RiskServiceImpl } from "../../src/services/risk-service.js";
import { createMockLogger } from "../helpers/index.js";

describe("RiskServiceImpl (free tier stub)", () => {
  it("returns low risk for 0 files", async () => {
    const logger = createMockLogger();
    const service = new RiskServiceImpl(logger);

    const result = await service.analyze({
      workspacePath: "/test",
      files: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.score).toBe(0);
      expect(result.data.level).toBe("low");
      expect(result.data.upgradeAvailable).toBe(true);
    }
  });

  it("returns low risk for 1-3 files", async () => {
    const logger = createMockLogger();
    const service = new RiskServiceImpl(logger);

    const result = await service.analyze({
      workspacePath: "/test",
      files: ["a.ts", "b.ts"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.score).toBe(20);
      expect(result.data.level).toBe("low");
    }
  });

  it("returns medium risk for 4-10 files", async () => {
    const logger = createMockLogger();
    const service = new RiskServiceImpl(logger);

    const result = await service.analyze({
      workspacePath: "/test",
      files: Array.from({ length: 7 }, (_, i) => `file${i}.ts`),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.score).toBe(45);
      expect(result.data.level).toBe("medium");
    }
  });

  it("returns high risk for >10 files", async () => {
    const logger = createMockLogger();
    const service = new RiskServiceImpl(logger);

    const result = await service.analyze({
      workspacePath: "/test",
      files: Array.from({ length: 15 }, (_, i) => `file${i}.ts`),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.score).toBe(65);
      expect(result.data.level).toBe("high");
    }
  });

  it("always includes pro features list", async () => {
    const logger = createMockLogger();
    const service = new RiskServiceImpl(logger);

    const result = await service.analyze({
      workspacePath: "/test",
      files: ["test.ts"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.proFeatures).toBeDefined();
      expect(result.data.proFeatures?.length).toBeGreaterThan(0);
      expect(result.data.proFeatures).toContain("DBSCAN session clustering");
    }
  });

  it("indicates upgrade is available in message", async () => {
    const logger = createMockLogger();
    const service = new RiskServiceImpl(logger);

    const result = await service.analyze({
      workspacePath: "/test",
      files: ["a.ts"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.message).toContain("Pro tier");
    }
  });
});
