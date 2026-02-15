/**
 * Unit tests for the Tool Registry (Layer 2).
 *
 * Validates:
 *   - Tool registration and duplicate detection
 *   - Tool listing with JSON Schema conversion
 *   - Tool lookup by name
 *   - Input validation via Zod schema enforcement
 *   - Mode extraction and handler dispatch
 *   - Unknown tool and unknown mode error paths
 *   - Mode handler execution with correct args and context
 *   - Output validation when enabled
 *   - Request timeout handling
 *   - Request cancellation via AbortSignal
 *   - Handler execution error wrapping
 *   - Result formatting (string and object payloads)
 *
 * @module tests/unit/tool-registry
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolContext } from "../../src/contracts/context.js";
import {
  HandlerExecutionError,
  InvalidInputError,
  ModeNotFoundError,
  RequestCancelledError,
  RequestTimeoutError,
  ToolNotFoundError,
} from "../../src/protocol/types.js";
import { ToolRegistry } from "../../src/registry/tool-registry.js";
import type { ToolDefinition } from "../../src/registry/types.js";
import { createMockContext } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal tool schema with a required `mode` field. */
const simpleInputSchema = z.object({
  mode: z.enum(["start", "stop"]),
  target: z.string().optional(),
});

/** Creates a minimal tool definition for testing. */
function createTestTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  const startHandler = vi.fn().mockResolvedValue({ status: "started" });
  const stopHandler = vi.fn().mockResolvedValue({ status: "stopped" });

  return {
    name: "test-tool",
    description: "A test tool for unit tests",
    inputSchema: simpleInputSchema,
    modes: {
      start: startHandler,
      stop: stopHandler,
    },
    ...overrides,
  };
}

/** Creates a non-aborted context (overrides the default pre-aborted signal). */
function createActiveContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return createMockContext({
    signal: new AbortController().signal,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new ToolRegistry({ defaultTimeoutMs: 5000 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe("register()", () => {
    it("registers a tool definition successfully", () => {
      const tool = createTestTool();
      registry.register(tool);

      expect(registry.get("test-tool")).toBe(tool);
    });

    it("throws when registering a duplicate tool name", () => {
      const tool = createTestTool();
      registry.register(tool);

      expect(() => registry.register(tool)).toThrow('Tool "test-tool" is already registered');
    });

    it("registers multiple tools with different names", () => {
      const tool1 = createTestTool({ name: "tool-alpha" });
      const tool2 = createTestTool({ name: "tool-beta" });

      registry.register(tool1);
      registry.register(tool2);

      expect(registry.get("tool-alpha")).toBe(tool1);
      expect(registry.get("tool-beta")).toBe(tool2);
    });
  });

  // -----------------------------------------------------------------------
  // Lookup
  // -----------------------------------------------------------------------

  describe("get()", () => {
    it("returns the tool definition for a registered name", () => {
      const tool = createTestTool();
      registry.register(tool);

      expect(registry.get("test-tool")).toBe(tool);
    });

    it("returns undefined for an unregistered name", () => {
      expect(registry.get("nonexistent")).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Listing
  // -----------------------------------------------------------------------

  describe("list()", () => {
    it("returns empty array when no tools are registered", () => {
      expect(registry.list()).toEqual([]);
    });

    it("returns MCP-compatible listings for registered tools", () => {
      const tool = createTestTool();
      registry.register(tool);

      const listings = registry.list();

      expect(listings).toHaveLength(1);
      expect(listings[0]?.name).toBe("test-tool");
      expect(listings[0]?.description).toBe("A test tool for unit tests");
      expect(listings[0]?.inputSchema.type).toBe("object");
    });

    it("includes JSON Schema properties from Zod schema", () => {
      const tool = createTestTool();
      registry.register(tool);

      const listings = registry.list();
      const inputSchema = listings[0]?.inputSchema;

      expect(inputSchema?.properties?.mode).toEqual({
        type: "string",
        enum: ["start", "stop"],
      });
    });

    it("lists multiple registered tools", () => {
      registry.register(createTestTool({ name: "tool-a", description: "Tool A" }));
      registry.register(createTestTool({ name: "tool-b", description: "Tool B" }));

      const listings = registry.list();

      expect(listings).toHaveLength(2);
      const names = listings.map((l) => l.name);
      expect(names).toContain("tool-a");
      expect(names).toContain("tool-b");
    });
  });

  // -----------------------------------------------------------------------
  // Execution: dispatch (via execute)
  // -----------------------------------------------------------------------

  describe("execute() — dispatch to mode handler", () => {
    it("dispatches to the correct mode handler", async () => {
      const tool = createTestTool();
      registry.register(tool);
      const ctx = createActiveContext();

      await registry.execute("test-tool", { mode: "start" }, ctx);

      expect(tool.modes.start).toHaveBeenCalledTimes(1);
      expect(tool.modes.stop).not.toHaveBeenCalled();
    });

    it("dispatches to stop handler when mode is 'stop'", async () => {
      const tool = createTestTool();
      registry.register(tool);
      const ctx = createActiveContext();

      await registry.execute("test-tool", { mode: "stop" }, ctx);

      expect(tool.modes.stop).toHaveBeenCalledTimes(1);
      expect(tool.modes.start).not.toHaveBeenCalled();
    });

    it("passes validated input to the handler", async () => {
      const tool = createTestTool();
      registry.register(tool);
      const ctx = createActiveContext();

      await registry.execute("test-tool", { mode: "start", target: "/app" }, ctx);

      expect(tool.modes.start).toHaveBeenCalledWith({ mode: "start", target: "/app" }, ctx);
    });

    it("passes the context to the handler", async () => {
      const tool = createTestTool();
      registry.register(tool);
      const ctx = createActiveContext({ sessionId: "session-xyz" });

      await registry.execute("test-tool", { mode: "start" }, ctx);

      const callArgs = (tool.modes.start as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(callArgs?.[1]?.sessionId).toBe("session-xyz");
    });

    it("returns MCP-formatted CallToolResult with text content", async () => {
      const tool = createTestTool();
      registry.register(tool);
      const ctx = createActiveContext();

      const result = await registry.execute("test-tool", { mode: "start" }, ctx);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");
      expect(typeof result.content[0]?.text).toBe("string");
    });

    it("JSON-serializes object results", async () => {
      const handler = vi.fn().mockResolvedValue({ count: 42, items: ["a"] });
      const tool = createTestTool({
        modes: { start: handler, stop: vi.fn() },
      });
      registry.register(tool);
      const ctx = createActiveContext();

      const result = await registry.execute("test-tool", { mode: "start" }, ctx);

      const parsed = JSON.parse(result.content[0]?.text ?? "");
      expect(parsed.count).toBe(42);
      expect(parsed.items).toEqual(["a"]);
    });

    it("returns string results as-is in text content", async () => {
      const handler = vi.fn().mockResolvedValue("plain text response");
      const tool = createTestTool({
        modes: { start: handler, stop: vi.fn() },
      });
      registry.register(tool);
      const ctx = createActiveContext();

      const result = await registry.execute("test-tool", { mode: "start" }, ctx);

      expect(result.content[0]?.text).toBe("plain text response");
    });
  });

  // -----------------------------------------------------------------------
  // Input Validation
  // -----------------------------------------------------------------------

  describe("execute() — input validation", () => {
    it("throws InvalidInputError when mode field is missing", async () => {
      const tool = createTestTool();
      registry.register(tool);
      const ctx = createActiveContext();

      await expect(registry.execute("test-tool", {}, ctx)).rejects.toThrow(InvalidInputError);
    });

    it("throws InvalidInputError when mode value is not in enum", async () => {
      const tool = createTestTool();
      registry.register(tool);
      const ctx = createActiveContext();

      await expect(registry.execute("test-tool", { mode: "invalid-mode" }, ctx)).rejects.toThrow(
        InvalidInputError,
      );
    });

    it("throws InvalidInputError when required field has wrong type", async () => {
      const strictSchema = z.object({
        mode: z.enum(["run"]),
        count: z.number(),
      });
      const tool = createTestTool({
        inputSchema: strictSchema,
        modes: { run: vi.fn().mockResolvedValue("ok") },
      });
      registry.register(tool);
      const ctx = createActiveContext();

      await expect(
        registry.execute("test-tool", { mode: "run", count: "not-a-number" }, ctx),
      ).rejects.toThrow(InvalidInputError);
    });

    it("InvalidInputError contains issue descriptions", async () => {
      const tool = createTestTool();
      registry.register(tool);
      const ctx = createActiveContext();

      try {
        await registry.execute("test-tool", {}, ctx);
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidInputError);
        expect((error as InvalidInputError).issues.length).toBeGreaterThan(0);
      }
    });

    it("strips unknown fields via Zod parsing (passthrough not enabled)", async () => {
      const handler = vi.fn().mockResolvedValue("ok");
      const tool = createTestTool({
        modes: { start: handler, stop: vi.fn() },
      });
      registry.register(tool);
      const ctx = createActiveContext();

      await registry.execute("test-tool", { mode: "start", extraField: "should-be-stripped" }, ctx);

      const calledWith = handler.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(calledWith.extraField).toBeUndefined();
      expect(calledWith.mode).toBe("start");
    });
  });

  // -----------------------------------------------------------------------
  // Unknown Tool / Unknown Mode
  // -----------------------------------------------------------------------

  describe("execute() — error paths", () => {
    it("throws ToolNotFoundError for unregistered tool name", async () => {
      const ctx = createActiveContext();

      await expect(registry.execute("nonexistent-tool", { mode: "start" }, ctx)).rejects.toThrow(
        ToolNotFoundError,
      );
    });

    it("ToolNotFoundError contains the tool name", async () => {
      const ctx = createActiveContext();

      try {
        await registry.execute("ghost-tool", { mode: "start" }, ctx);
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ToolNotFoundError);
        expect((error as ToolNotFoundError).message).toContain("ghost-tool");
      }
    });

    it("throws ModeNotFoundError for unregistered mode", async () => {
      const schema = z.object({ mode: z.string() });
      const tool = createTestTool({
        inputSchema: schema,
        modes: { start: vi.fn().mockResolvedValue("ok") },
      });
      registry.register(tool);
      const ctx = createActiveContext();

      await expect(registry.execute("test-tool", { mode: "unknown-mode" }, ctx)).rejects.toThrow(
        ModeNotFoundError,
      );
    });

    it("ModeNotFoundError contains tool name and mode", async () => {
      const schema = z.object({ mode: z.string() });
      const tool = createTestTool({
        inputSchema: schema,
        modes: { start: vi.fn().mockResolvedValue("ok") },
      });
      registry.register(tool);
      const ctx = createActiveContext();

      try {
        await registry.execute("test-tool", { mode: "bogus" }, ctx);
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ModeNotFoundError);
        const msg = (error as ModeNotFoundError).message;
        expect(msg).toContain("test-tool");
        expect(msg).toContain("bogus");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Handler Execution Errors
  // -----------------------------------------------------------------------

  describe("execute() — handler errors", () => {
    it("wraps handler errors in HandlerExecutionError", async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error("boom"));
      const tool = createTestTool({
        modes: { start: failingHandler, stop: vi.fn() },
      });
      registry.register(tool);
      const ctx = createActiveContext();

      await expect(registry.execute("test-tool", { mode: "start" }, ctx)).rejects.toThrow(
        HandlerExecutionError,
      );
    });

    it("HandlerExecutionError does not leak original error message", async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error("secret internal details"));
      const tool = createTestTool({
        modes: { start: failingHandler, stop: vi.fn() },
      });
      registry.register(tool);
      const ctx = createActiveContext();

      try {
        await registry.execute("test-tool", { mode: "start" }, ctx);
        expect.fail("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(HandlerExecutionError);
        expect((error as HandlerExecutionError).message).not.toContain("secret internal details");
      }
    });
  });

  // -----------------------------------------------------------------------
  // Timeout
  // -----------------------------------------------------------------------

  describe("execute() — timeout", () => {
    it("throws RequestTimeoutError when handler exceeds timeout", async () => {
      const slowRegistry = new ToolRegistry({ defaultTimeoutMs: 50 });
      const slowHandler = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("late"), 200)));
      const tool = createTestTool({
        modes: { start: slowHandler, stop: vi.fn() },
      });
      slowRegistry.register(tool);
      const ctx = createActiveContext();

      await expect(slowRegistry.execute("test-tool", { mode: "start" }, ctx)).rejects.toThrow(
        RequestTimeoutError,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Cancellation
  // -----------------------------------------------------------------------

  describe("execute() — cancellation", () => {
    it("throws RequestCancelledError when signal is already aborted", async () => {
      const tool = createTestTool();
      registry.register(tool);
      // Explicitly pass a pre-aborted signal (createMockContext defaults to
      // a fresh non-aborted signal despite MOCK_CONTEXT_DEFAULTS)
      const ctx = createMockContext({ signal: AbortSignal.abort() });

      await expect(registry.execute("test-tool", { mode: "start" }, ctx)).rejects.toThrow(
        RequestCancelledError,
      );
    });

    it("throws RequestCancelledError when signal aborts mid-execution", async () => {
      const slowRegistry = new ToolRegistry({ defaultTimeoutMs: 5000 });
      const controller = new AbortController();
      const slowHandler = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("done"), 500)));
      const tool = createTestTool({
        modes: { start: slowHandler, stop: vi.fn() },
      });
      slowRegistry.register(tool);
      const ctx = createActiveContext({ signal: controller.signal });

      const executePromise = slowRegistry.execute("test-tool", { mode: "start" }, ctx);

      // Abort after a short delay
      setTimeout(() => controller.abort(), 30);

      await expect(executePromise).rejects.toThrow(RequestCancelledError);
    });
  });

  // -----------------------------------------------------------------------
  // Output Validation
  // -----------------------------------------------------------------------

  describe("execute() — output validation", () => {
    it("passes when output matches outputSchema", async () => {
      const outputSchema = z.object({ status: z.string() });
      const handler = vi.fn().mockResolvedValue({ status: "ok" });
      const tool = createTestTool({
        outputSchema,
        modes: { start: handler, stop: vi.fn() },
      });

      const validatingRegistry = new ToolRegistry({
        defaultTimeoutMs: 5000,
        validateOutputs: true,
      });
      validatingRegistry.register(tool);
      const ctx = createActiveContext();

      const result = await validatingRegistry.execute("test-tool", { mode: "start" }, ctx);

      expect(result.content).toHaveLength(1);
    });

    it("throws OutputValidationError when output violates outputSchema", async () => {
      const outputSchema = z.object({ status: z.string() });
      const handler = vi.fn().mockResolvedValue({ status: 123 }); // wrong type
      const tool = createTestTool({
        outputSchema,
        modes: { start: handler, stop: vi.fn() },
      });

      const validatingRegistry = new ToolRegistry({
        defaultTimeoutMs: 5000,
        validateOutputs: true,
      });
      validatingRegistry.register(tool);
      const ctx = createActiveContext();

      await expect(validatingRegistry.execute("test-tool", { mode: "start" }, ctx)).rejects.toThrow(
        "Output validation failed",
      );
    });

    it("skips output validation when validateOutputs is false", async () => {
      const outputSchema = z.object({ status: z.string() });
      const handler = vi.fn().mockResolvedValue({ status: 123 }); // wrong type
      const tool = createTestTool({
        outputSchema,
        modes: { start: handler, stop: vi.fn() },
      });

      const noValidateRegistry = new ToolRegistry({
        defaultTimeoutMs: 5000,
        validateOutputs: false,
      });
      noValidateRegistry.register(tool);
      const ctx = createActiveContext();

      // Should not throw despite invalid output
      const result = await noValidateRegistry.execute("test-tool", { mode: "start" }, ctx);
      expect(result.content).toHaveLength(1);
    });

    it("skips output validation when no outputSchema is defined", async () => {
      const handler = vi.fn().mockResolvedValue({ anything: "goes" });
      const tool = createTestTool({
        // No outputSchema
        modes: { start: handler, stop: vi.fn() },
      });

      const validatingRegistry = new ToolRegistry({
        defaultTimeoutMs: 5000,
        validateOutputs: true,
      });
      validatingRegistry.register(tool);
      const ctx = createActiveContext();

      const result = await validatingRegistry.execute("test-tool", { mode: "start" }, ctx);
      expect(result.content).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  describe("configuration", () => {
    it("uses default config when none provided", () => {
      const defaultRegistry = new ToolRegistry();
      const tool = createTestTool();
      defaultRegistry.register(tool);

      // Listing should work without error
      const listings = defaultRegistry.list();
      expect(listings).toHaveLength(1);
    });

    it("accepts partial config overrides", () => {
      const customRegistry = new ToolRegistry({ verbose: true });
      const tool = createTestTool();
      customRegistry.register(tool);

      expect(customRegistry.list()).toHaveLength(1);
    });
  });
});
