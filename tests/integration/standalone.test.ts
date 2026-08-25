/**
 * Standalone Execution Tests
 *
 * Proves that @sopr/mcp-server works entirely standalone:
 *   1. Server starts with NO proprietary dependencies
 *   2. Tools list correctly via MCP protocol
 *   3. Tool execution works with NoOp adapters
 *   4. Static check: no @snapback/* imports in src/
 *
 * This test validates the OSS package can be used independently,
 * without any proprietary infrastructure.
 *
 * @see SOPR Integration Plan — Sprint 3: Validation and Boundaries
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

// Import OSS components only — NO @snapback/* imports allowed here
import {
  ConsoleLoggerAdapter,
  createHelpToolDef,
  createPulseToolDef,
  createReadOnlyTools,
  createSOPRServer,
  InMemoryStorage,
  LocalRouter,
  NoOpTelemetry,
  TOOL_COUNT,
  TOOL_MAP,
  TOTAL_MODE_COUNT,
  type ToolDefinition,
  ToolRegistry,
} from "../../src/index.js";
import { createMockContext } from "../helpers/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PKG_ROOT = join(__dirname, "../..");
const SRC_DIR = join(PKG_ROOT, "src");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all TypeScript source files. */
function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getTypeScriptFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Standalone Execution — @sopr/mcp-server", () => {
  describe("Static Analysis: No Proprietary Imports", () => {
    const sourceFiles = getTypeScriptFiles(SRC_DIR);

    it("should have source files to check", () => {
      expect(sourceFiles.length).toBeGreaterThan(20);
    });

    it("src/ has NO @snapback/* imports (proprietary scopes forbidden)", () => {
      const violations: Array<{ file: string; line: number; raw: string }> = [];
      const forbiddenPattern = /(?:import|export)\s+.*from\s+["']@snapback\//;

      for (const filePath of sourceFiles) {
        const content = readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) {
            continue;
          }
          if (forbiddenPattern.test(line)) {
            violations.push({
              file: relative(PKG_ROOT, filePath),
              line: i + 1,
              raw: line.trim(),
            });
          }
        }
      }

      expect(
        violations,
        `Found ${violations.length} proprietary @snapback/* imports in OSS src/:\n${violations.map((v) => `  ${v.file}:${v.line} — ${v.raw}`).join("\n")}`,
      ).toHaveLength(0);
    });
  });

  describe("Default Implementations Are Provided", () => {
    it("exports InMemoryStorage as default IStorage implementation", () => {
      const storage = new InMemoryStorage();
      expect(storage).toBeDefined();
      expect(typeof storage.get).toBe("function");
      expect(typeof storage.set).toBe("function");
      expect(typeof storage.delete).toBe("function");
    });

    it("exports NoOpTelemetry as default ITelemetry implementation", () => {
      const telemetry = new NoOpTelemetry();
      expect(telemetry).toBeDefined();
      expect(typeof telemetry.track).toBe("function");
      // Should not throw when called
      telemetry.track({
        event: "test",
        tool: "test",
        mode: "test",
        tier: "free",
        durationMs: 0,
        success: true,
      });
    });

    it("exports LocalRouter as default ITierRouter implementation", () => {
      const router = new LocalRouter();
      expect(router).toBeDefined();
      expect(typeof router.route).toBe("function");
      expect(typeof router.getMode).toBe("function");
    });

    it("exports ConsoleLoggerAdapter as default ContextLogger implementation", () => {
      const logger = new ConsoleLoggerAdapter("test");
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });
  });

  describe("Tool Map Integrity", () => {
    it("TOOL_MAP contains expected number of tools", () => {
      expect(TOOL_COUNT).toBe(8);
    });

    it("TOOL_MAP contains expected total modes", () => {
      expect(TOTAL_MODE_COUNT).toBe(34);
    });

    it("all tools have required fields", () => {
      for (const [toolName, tool] of Object.entries(TOOL_MAP)) {
        expect(tool.name, `${toolName}.name`).toBe(toolName);
        expect(tool.description, `${toolName}.description`).toBeDefined();
        expect(tool.description.length, `${toolName}.description length`).toBeLessThan(250);
        expect(Object.keys(tool.modes).length, `${toolName}.modes count`).toBeGreaterThan(0);
      }
    });

    it("all modes have valid service references", () => {
      const validServices = [
        "SnapshotService",
        "ValidationService",
        "LearningService",
        "IntegrationService",
        "SecurityService",
        "GraphService",
        "CacheService",
      ];

      for (const [toolName, tool] of Object.entries(TOOL_MAP)) {
        for (const [modeName, mode] of Object.entries(tool.modes)) {
          // help tool has no service dependencies
          if (toolName === "help") {
            expect(
              mode.services,
              `${toolName}.${modeName} should have empty services`,
            ).toHaveLength(0);
            continue;
          }
          for (const service of mode.services) {
            expect(
              validServices.includes(service),
              `${toolName}.${modeName} references unknown service: ${service}`,
            ).toBe(true);
          }
        }
      }
    });
  });

  describe("Tool Registry Standalone Operation", () => {
    it("can register and list tools without external dependencies", () => {
      const registry = new ToolRegistry();

      // Register a minimal tool
      const testTool: ToolDefinition = {
        name: "test-tool",
        description: "A test tool for standalone verification",
        inputSchema: z.object({
          mode: z.literal("ping"),
        }),
        modes: {
          ping: async () => ({ status: "pong" }),
        },
      };

      registry.register(testTool);

      const listing = registry.list();
      expect(listing).toHaveLength(1);
      expect(listing[0]?.name).toBe("test-tool");
      expect(listing[0]?.description).toBe("A test tool for standalone verification");
    });

    it("can execute tools with mock context (no external services)", async () => {
      const registry = new ToolRegistry();

      const echoTool: ToolDefinition = {
        name: "echo",
        description: "Echo the input message",
        inputSchema: z.object({
          mode: z.literal("echo"),
          message: z.string(),
        }),
        modes: {
          echo: async (params: unknown) => ({
            echoed: (params as { message: string }).message,
          }),
        },
      };

      registry.register(echoTool);

      const context = createMockContext();
      const result = await registry.execute(
        "echo",
        { mode: "echo", message: "hello standalone" },
        context,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(result.content[0]?.type).toBe("text");

      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed.echoed).toBe("hello standalone");
    });

    it("tool with outputSchema populates structuredContent", async () => {
      const registry = new ToolRegistry({
        validateOutputs: true,
        defaultTimeoutMs: 5000,
        verbose: false,
      });

      const outputSchema = z.object({
        count: z.number(),
        items: z.array(z.string()),
      });

      const structuredTool: ToolDefinition = {
        name: "structured",
        description: "Returns structured output",
        inputSchema: z.object({ mode: z.literal("list") }),
        outputSchema,
        modes: {
          list: async () => ({
            count: 2,
            items: ["apple", "banana"],
          }),
        },
      };

      registry.register(structuredTool);

      const context = createMockContext();
      const result = await registry.execute("structured", { mode: "list" }, context);

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toBeDefined();
      expect(result.structuredContent).toEqual({
        count: 2,
        items: ["apple", "banana"],
      });
    });
  });

  describe("Server Factory Standalone Creation", () => {
    it("createSOPRServer creates a valid server with minimal config", () => {
      const minimalTool: ToolDefinition = {
        name: "minimal",
        description: "Minimal standalone tool",
        inputSchema: z.object({ mode: z.literal("noop") }),
        modes: {
          noop: async () => ({ ok: true }),
        },
      };

      const server = createSOPRServer({
        serverName: "standalone-test-server",
        serverVersion: "0.0.0-test",
        workspacePath: "/tmp/standalone-test",
        tools: [minimalTool],
        // NO router, telemetry, or other external dependencies
      });

      expect(server).toBeDefined();
      expect(server.getServer()).toBeDefined();
    });

    it("createSOPRServer accepts optional router and telemetry", () => {
      const router = new LocalRouter();
      const telemetry = new NoOpTelemetry();

      const tool: ToolDefinition = {
        name: "configured",
        description: "Tool with full config",
        inputSchema: z.object({ mode: z.literal("check") }),
        modes: {
          check: async () => ({ configured: true }),
        },
      };

      const server = createSOPRServer({
        serverName: "configured-server",
        serverVersion: "1.0.0",
        workspacePath: "/workspace",
        tools: [tool],
        router,
        telemetry,
        timeoutMs: 10_000,
        capabilities: ["standalone", "test"],
      });

      expect(server).toBeDefined();
    });
  });

  describe("Wire Format Independence", () => {
    it("wire format functions work without external config", async () => {
      const { encode, decode, getWirePrefix, getWireFormat, WireType } = await import(
        "../../src/contracts/wire-format.js"
      );

      // Test default prefix
      const defaultPrefix = getWirePrefix();
      expect(typeof defaultPrefix).toBe("string");
      expect(defaultPrefix.length).toBeGreaterThan(0);

      // Test encoding produces valid wire format string
      const encoded = encode(WireType.Snap, { status: "ok" });
      expect(typeof encoded).toBe("string");
      expect(encoded).toContain(defaultPrefix);
      expect(encoded).toContain("status:ok");

      // Test decoding the encoded string
      const decoded = decode(encoded);
      expect(decoded).toBeDefined();
      expect(decoded.type).toBe(WireType.Snap);
      expect(decoded.data.status).toBe("ok");

      // Test wire format config
      const config = getWireFormat();
      expect(config.version).toBe(1);
      expect(config.prefix).toBe(defaultPrefix);
    });
  });

  describe("Resilience Utilities Independence", () => {
    it("withRetry works standalone", async () => {
      const { withRetry } = await import("../../src/resilience/index.js");

      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error("Transient failure");
        }
        return "success";
      };

      // withRetry returns a Promise directly, not a wrapper function
      const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, jitter: false });

      expect(result).toBe("success");
      expect(attempts).toBe(2);
    });

    it("ConcurrencyLimiter works standalone", async () => {
      const { ConcurrencyLimiter } = await import("../../src/resilience/index.js");

      const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
      let concurrent = 0;
      let maxConcurrent = 0;

      const task = async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 50));
        concurrent--;
        return "done";
      };

      // ConcurrencyLimiter uses .execute(), not .run()
      const results = await Promise.all([
        limiter.execute(task),
        limiter.execute(task),
        limiter.execute(task),
        limiter.execute(task),
      ]);

      expect(results).toEqual(["done", "done", "done", "done"]);
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });
  });

  describe("Phase 4a: Read-Only Tool Definitions (pulse + help)", () => {
    // NoOp service stubs for pulse dependencies
    const noOpValidationService = {
      quickCheck: async () => ({
        ok: true as const,
        data: { passed: true, diagnostics: [], errorCount: 0, warningCount: 0, duration: 0 },
      }),
      fullCheck: async () => ({
        ok: true as const,
        data: { passed: true, diagnostics: [], errorCount: 0, warningCount: 0, duration: 0 },
      }),
      checkPatterns: async () => ({
        ok: true as const,
        data: { compliant: true, violations: [], suggestions: [] },
      }),
      checkBuild: async () => ({
        ok: true as const,
        data: { success: true, diagnostics: [], duration: 0 },
      }),
      checkCoverage: async () => ({
        ok: true as const,
        data: {
          totalPercent: 100,
          filesCovered: 0,
          filesTotal: 0,
          belowThreshold: [],
          passed: true,
        },
      }),
      computeHealthScore: async () => ({
        ok: true as const,
        data: { overall: 95, dimensions: {}, trend: "stable" as const },
      }),
      analyzeEvolution: async () => ({
        ok: true as const,
        data: { snapshots: [], trend: "stable" as const },
      }),
    };

    const noOpIntegrationService = {
      getGitContext: async () => ({
        ok: true as const,
        data: { branch: "main", status: "clean" as const, uncommittedFiles: [], recentCommits: [] },
      }),
      getSentryContext: async () => ({
        ok: true as const,
        data: { recentErrors: [], errorRate: 0, topIssues: [] },
      }),
      getGitHubContext: async () => ({
        ok: true as const,
        data: { openPRs: [], relevantIssues: [], checkStatus: "passing" as const },
      }),
      enrichContext: async () => ({
        ok: true as const,
        data: { riskScore: 0, activeIntegrations: [], git: null, sentry: null, github: null },
      }),
      checkHealth: async () => [],
      checkConfig: async () => ({ ok: true as const, data: { valid: true, integrations: [] } }),
    };

    const noOpGraphService = {
      computeDependencyGraph: async () => ({
        ok: true as const,
        data: { nodes: [], edges: [], totalModules: 0, maxDepth: 0 },
      }),
      detectCircularDeps: async () => ({
        ok: true as const,
        data: { cycles: [], affectedFiles: [] },
      }),
      detectOrphans: async () => ({
        ok: true as const,
        data: { orphanedFiles: [], deadExports: [], totalFiles: 0 },
      }),
      computeFileGraph: async () => ({
        ok: true as const,
        data: { nodes: [], edges: [], clusters: [] },
      }),
      computeHealth: async () => ({
        ok: true as const,
        data: { circularCount: 0, orphanCount: 0, maxFanOut: 0, avgFanOut: 0, modularity: 1 },
      }),
    };

    it("createHelpToolDef creates a valid help ToolDefinition", () => {
      const helpDef = createHelpToolDef();
      expect(helpDef.name).toBe("help");
      expect(helpDef.annotations?.readOnlyHint).toBe(true);
      expect(Object.keys(helpDef.modes)).toEqual(
        expect.arrayContaining([
          "tools",
          "status",
          "wire",
          "modes",
          "thresholds",
          "decision",
          "all",
        ]),
      );
      expect(Object.keys(helpDef.modes)).toHaveLength(7);
    });

    it("help tool executes all modes via ToolRegistry", async () => {
      const registry = new ToolRegistry();
      const helpDef = createHelpToolDef();
      registry.register(helpDef as ToolDefinition);

      const ctx = createMockContext();
      const helpModes = ["tools", "status", "wire", "modes", "thresholds", "decision", "all"];

      for (const mode of helpModes) {
        const result = await registry.execute("help", { mode }, ctx);
        expect(result.isError, `help.${mode} should not error`).toBeUndefined();
        expect(result.content).toHaveLength(1);

        const parsed = JSON.parse(result.content[0]?.text);
        expect(parsed.text, `help.${mode} should return text`).toBeDefined();
        expect(typeof parsed.text).toBe("string");
        expect(parsed.text.length).toBeGreaterThan(10);
      }
    });

    it("createPulseToolDef creates a valid pulse ToolDefinition", () => {
      const pulseDef = createPulseToolDef({
        validationService: noOpValidationService,
        integrationService: noOpIntegrationService,
        graphService: noOpGraphService,
      });
      expect(pulseDef.name).toBe("pulse");
      expect(pulseDef.annotations?.readOnlyHint).toBe(true);
      expect(Object.keys(pulseDef.modes)).toEqual(["health"]);
    });

    it("pulse tool executes health mode with NoOp services", async () => {
      const registry = new ToolRegistry();
      const pulseDef = createPulseToolDef({
        validationService: noOpValidationService,
        integrationService: noOpIntegrationService,
        graphService: noOpGraphService,
      });
      registry.register(pulseDef as ToolDefinition);

      const ctx = createMockContext();
      const result = await registry.execute("pulse", { mode: "health" }, ctx);

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(result.content[0]?.text);
      expect(parsed.validationHealth).toBeDefined();
      expect(parsed.integrationHealth).toBeDefined();
      expect(parsed.graphHealth).toBeDefined();
    });

    it("createReadOnlyTools returns both pulse and help definitions", () => {
      const tools = createReadOnlyTools({
        pulse: {
          validationService: noOpValidationService,
          integrationService: noOpIntegrationService,
          graphService: noOpGraphService,
        },
      });
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(["help", "pulse"]);
    });

    it("createReadOnlyTools integrates with createSOPRServer", () => {
      const tools = createReadOnlyTools({
        pulse: {
          validationService: noOpValidationService,
          integrationService: noOpIntegrationService,
          graphService: noOpGraphService,
        },
      });

      const server = createSOPRServer({
        serverName: "phase4a-test",
        serverVersion: "0.0.0-test",
        workspacePath: "/tmp/test",
        tools,
      });

      expect(server).toBeDefined();
      expect(server.getServer()).toBeDefined();
    });
  });
});
