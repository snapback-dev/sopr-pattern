/**
 * ToolContext unit tests.
 *
 * Validates:
 *   - createToolContext produces deeply-frozen objects
 *   - Timestamp is captured at creation time
 *   - Capabilities array is defensively copied and frozen
 *   - noOpLogger and noOpProgress do not throw when invoked
 *   - createConsoleLogger produces a functional logger with correct behavior
 *   - ToolContext immutability (cannot assign to properties)
 *
 * @module tests/unit/context
 */

import { describe, expect, it, vi } from "vitest";
import type { CreateContextInput } from "../../src/contracts/context.js";
import {
  createConsoleLogger,
  createToolContext,
  noOpLogger,
  noOpProgress,
} from "../../src/contracts/context.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a valid CreateContextInput with sensible defaults. */
function makeInput(overrides: Partial<CreateContextInput> = {}): CreateContextInput {
  return {
    workspacePath: "/projects/test",
    sessionId: "sess_001",
    capabilities: ["git", "sentry"],
    requestId: "req_001",
    signal: new AbortController().signal,
    logger: noOpLogger,
    progress: noOpProgress,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// createToolContext
// ---------------------------------------------------------------------------

describe("createToolContext", () => {
  it("returns an object with all expected properties", () => {
    const ctx = createToolContext(makeInput());
    expect(ctx).toHaveProperty("workspacePath");
    expect(ctx).toHaveProperty("sessionId");
    expect(ctx).toHaveProperty("capabilities");
    expect(ctx).toHaveProperty("timestamp");
    expect(ctx).toHaveProperty("requestId");
    expect(ctx).toHaveProperty("signal");
    expect(ctx).toHaveProperty("logger");
    expect(ctx).toHaveProperty("progress");
  });

  it("copies workspacePath from input", () => {
    const ctx = createToolContext(makeInput({ workspacePath: "/my/project" }));
    expect(ctx.workspacePath).toBe("/my/project");
  });

  it("copies sessionId from input", () => {
    const ctx = createToolContext(makeInput({ sessionId: "sess_xyz" }));
    expect(ctx.sessionId).toBe("sess_xyz");
  });

  it("copies requestId from input", () => {
    const ctx = createToolContext(makeInput({ requestId: "req_abc" }));
    expect(ctx.requestId).toBe("req_abc");
  });

  it("copies signal from input", () => {
    const controller = new AbortController();
    const ctx = createToolContext(makeInput({ signal: controller.signal }));
    expect(ctx.signal).toBe(controller.signal);
  });

  it("copies logger from input", () => {
    const logger = createConsoleLogger("test");
    const ctx = createToolContext(makeInput({ logger }));
    expect(ctx.logger).toBe(logger);
  });

  it("copies progress from input", () => {
    const progress = vi.fn();
    const ctx = createToolContext(makeInput({ progress }));
    expect(ctx.progress).toBe(progress);
  });

  // -------------------------------------------------------------------------
  // Timestamp behavior
  // -------------------------------------------------------------------------

  it("sets timestamp to a number close to Date.now()", () => {
    const before = Date.now();
    const ctx = createToolContext(makeInput());
    const after = Date.now();
    expect(ctx.timestamp).toBeGreaterThanOrEqual(before);
    expect(ctx.timestamp).toBeLessThanOrEqual(after);
  });

  it("produces different timestamps for contexts created at different times", async () => {
    const ctx1 = createToolContext(makeInput());
    // Small delay to get a different timestamp
    await new Promise((resolve) => setTimeout(resolve, 5));
    const ctx2 = createToolContext(makeInput());
    expect(ctx2.timestamp).toBeGreaterThanOrEqual(ctx1.timestamp);
  });

  // -------------------------------------------------------------------------
  // Capabilities defensive copy and freeze
  // -------------------------------------------------------------------------

  it("defensively copies the capabilities array", () => {
    const original = ["git", "sentry"];
    const ctx = createToolContext(makeInput({ capabilities: original }));
    // Mutating the original should not affect the context
    (original as string[]).push("github");
    expect(ctx.capabilities).toHaveLength(2);
    expect(ctx.capabilities).toEqual(["git", "sentry"]);
  });

  it("freezes the capabilities array", () => {
    const ctx = createToolContext(makeInput({ capabilities: ["git"] }));
    expect(Object.isFrozen(ctx.capabilities)).toBe(true);
  });

  it("handles empty capabilities array", () => {
    const ctx = createToolContext(makeInput({ capabilities: [] }));
    expect(ctx.capabilities).toEqual([]);
    expect(Object.isFrozen(ctx.capabilities)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Immutability (frozen object)
  // -------------------------------------------------------------------------

  it("returns a frozen object", () => {
    const ctx = createToolContext(makeInput());
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("throws TypeError when assigning to workspacePath", () => {
    const ctx = createToolContext(makeInput());
    expect(() => {
      (ctx as Record<string, unknown>).workspacePath = "/other";
    }).toThrow(TypeError);
  });

  it("throws TypeError when assigning to sessionId", () => {
    const ctx = createToolContext(makeInput());
    expect(() => {
      (ctx as Record<string, unknown>).sessionId = "changed";
    }).toThrow(TypeError);
  });

  it("throws TypeError when assigning to timestamp", () => {
    const ctx = createToolContext(makeInput());
    expect(() => {
      (ctx as Record<string, unknown>).timestamp = 0;
    }).toThrow(TypeError);
  });

  it("throws TypeError when adding a new property", () => {
    const ctx = createToolContext(makeInput());
    expect(() => {
      (ctx as Record<string, unknown>).extraProp = "nope";
    }).toThrow(TypeError);
  });

  it("prevents modification of the capabilities array", () => {
    const ctx = createToolContext(makeInput({ capabilities: ["git"] }));
    expect(() => {
      (ctx.capabilities as string[]).push("new-cap");
    }).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// noOpLogger
// ---------------------------------------------------------------------------

describe("noOpLogger", () => {
  it("has debug, info, warn, and error methods", () => {
    expect(typeof noOpLogger.debug).toBe("function");
    expect(typeof noOpLogger.info).toBe("function");
    expect(typeof noOpLogger.warn).toBe("function");
    expect(typeof noOpLogger.error).toBe("function");
  });

  it("debug does not throw when called", () => {
    expect(() => noOpLogger.debug("test message")).not.toThrow();
  });

  it("info does not throw when called", () => {
    expect(() => noOpLogger.info("test message")).not.toThrow();
  });

  it("warn does not throw when called", () => {
    expect(() => noOpLogger.warn("test message")).not.toThrow();
  });

  it("error does not throw when called", () => {
    expect(() => noOpLogger.error("test message")).not.toThrow();
  });

  it("debug does not throw when called with context", () => {
    expect(() => noOpLogger.debug("msg", { key: "value" })).not.toThrow();
  });

  it("info does not throw when called with context", () => {
    expect(() => noOpLogger.info("msg", { key: "value" })).not.toThrow();
  });

  it("warn does not throw when called with context", () => {
    expect(() => noOpLogger.warn("msg", { key: "value" })).not.toThrow();
  });

  it("error does not throw when called with context", () => {
    expect(() => noOpLogger.error("msg", { key: "value" })).not.toThrow();
  });

  it("methods return undefined", () => {
    expect(noOpLogger.debug("test")).toBeUndefined();
    expect(noOpLogger.info("test")).toBeUndefined();
    expect(noOpLogger.warn("test")).toBeUndefined();
    expect(noOpLogger.error("test")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// noOpProgress
// ---------------------------------------------------------------------------

describe("noOpProgress", () => {
  it("is a function", () => {
    expect(typeof noOpProgress).toBe("function");
  });

  it("does not throw when called with message and percent", () => {
    expect(() => noOpProgress("Processing...", 50)).not.toThrow();
  });

  it("does not throw when called with message, percent, and total", () => {
    expect(() => noOpProgress("Processing...", 50, 100)).not.toThrow();
  });

  it("returns undefined", () => {
    expect(noOpProgress("msg", 0)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createConsoleLogger
// ---------------------------------------------------------------------------

describe("createConsoleLogger", () => {
  it("returns an object with debug, info, warn, and error methods", () => {
    const logger = createConsoleLogger();
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("debug does not throw", () => {
    const logger = createConsoleLogger();
    expect(() => logger.debug("test")).not.toThrow();
  });

  it("info does not throw", () => {
    const logger = createConsoleLogger();
    expect(() => logger.info("test")).not.toThrow();
  });

  it("warn calls console.warn with prefix and message", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createConsoleLogger("myprefix");
    logger.warn("something went wrong");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("[myprefix]");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("WARN");
    expect(warnSpy.mock.calls[0]?.[0]).toContain("something went wrong");
    warnSpy.mockRestore();
  });

  it("error calls console.error with prefix and message", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createConsoleLogger("myprefix");
    logger.error("critical failure");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]?.[0]).toContain("[myprefix]");
    expect(errorSpy.mock.calls[0]?.[0]).toContain("ERROR");
    expect(errorSpy.mock.calls[0]?.[0]).toContain("critical failure");
    errorSpy.mockRestore();
  });

  it("warn passes context to console.warn", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createConsoleLogger();
    const ctx = { file: "test.ts", line: 42 };
    logger.warn("issue", ctx);
    // The second argument should be the context object
    expect(warnSpy.mock.calls[0]?.[1]).toEqual(ctx);
    warnSpy.mockRestore();
  });

  it("error passes context to console.error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createConsoleLogger();
    const ctx = { stack: "Error..." };
    logger.error("crash", ctx);
    expect(errorSpy.mock.calls[0]?.[1]).toEqual(ctx);
    errorSpy.mockRestore();
  });

  it("works without a prefix", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createConsoleLogger();
    logger.warn("no prefix");
    // Should not contain brackets when no prefix provided
    const output = warnSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain("WARN");
    expect(output).not.toContain("[");
    warnSpy.mockRestore();
  });

  it("warn outputs empty string when no context provided", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = createConsoleLogger("tag");
    logger.warn("msg");
    // Second argument should be empty string for missing context
    expect(warnSpy.mock.calls[0]?.[1]).toBe("");
    warnSpy.mockRestore();
  });

  it("error outputs empty string when no context provided", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createConsoleLogger("tag");
    logger.error("msg");
    expect(errorSpy.mock.calls[0]?.[1]).toBe("");
    errorSpy.mockRestore();
  });
});
