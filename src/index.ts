/**
 * Entry Point — Wires all SOPR layers together and starts the server.
 *
 * Wiring order:
 *   1. Infrastructure (logger, storage)
 *   2. Layer 4: Pure services (no cross-service deps first, then dependent ones)
 *   3. Open Core: Router + Telemetry (cross-cutting concerns)
 *   4. Layer 3: Tool handler factories (injected with services)
 *   5. Layer 2: Tool registry (register tool definitions with schemas)
 *   6. Layer 1: Protocol server (start MCP transport)
 *
 * @module index
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
// Schemas
import {
  CacheInputSchema,
  CheckInputSchema,
  GraphInputSchema,
  IntegrateInputSchema,
  LearnInputSchema,
  PulseInputSchema,
  SnapInputSchema,
} from "./contracts/schemas/tool-inputs.js";
// Tool map descriptions
import { TOOL_MAP } from "./contracts/tool-map.js";
import { ProtocolServer } from "./protocol/server.js";
import type { ProtocolConfig } from "./protocol/types.js";
import { ToolRegistry } from "./registry/tool-registry.js";
import type { ModeHandler } from "./registry/types.js";
// Open Core: Router + Telemetry
import { TierRouter } from "./router/tier-router.js";
import { InMemoryStorage } from "./services/adapters.js";
import { CacheServiceImpl } from "./services/cache-service.js";
import { GraphServiceImpl } from "./services/graph-service.js";
import { IntegrationServiceImpl } from "./services/integration-service.js";
import { LearningServiceImpl } from "./services/learning-service.js";
// Service implementations
import { ConsoleLogger } from "./services/logger.js";
import { SecurityServiceImpl } from "./services/security-service.js";
import { SnapshotServiceImpl } from "./services/snapshot-service.js";
import { ValidationServiceImpl } from "./services/validation-service.js";
import { validateWorkspacePath, WorkspaceBoundary } from "./services/workspace-boundary.js";
import { TelemetryTracker } from "./telemetry/tracker.js";
import { createCacheHandlers } from "./tools/cache.js";
import { createCheckHandlers } from "./tools/check.js";
import { createGraphHandlers } from "./tools/graph.js";
import { createIntegrateHandlers } from "./tools/integrate.js";
import { createLearnHandlers } from "./tools/learn.js";
import { createPulseHandlers } from "./tools/pulse.js";
// Tool handler factories
import { createSnapHandlers } from "./tools/snap.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const workspacePath = validateWorkspacePath(process.cwd());
const boundary = new WorkspaceBoundary(workspacePath);
const execFileAsync = promisify(execFile);

/**
 * Cast a typed handler map to the registry's generic ModeHandler record.
 * Safe because the registry always passes Zod-validated input.
 */
function asModes(
  handlers: Record<string, (...args: never[]) => Promise<unknown>>,
): Record<string, ModeHandler> {
  return handlers as Record<string, ModeHandler>;
}

// ---------------------------------------------------------------------------
// 1. Infrastructure
// ---------------------------------------------------------------------------

const logger = new ConsoleLogger("sopr");
const storage = new InMemoryStorage();

// ---------------------------------------------------------------------------
// 2. Layer 4 — Services (construct in dependency order)
// ---------------------------------------------------------------------------

// SECURITY: File adapters enforce workspace containment. All paths are
// resolved against the workspace root before any I/O operation.

const readFileAdapter = (filePath: string) => {
  const resolved = path.isAbsolute(filePath) ? filePath : boundary.resolve(filePath);
  if (!boundary.contains(resolved)) {
    return Promise.reject(new Error(`Access denied: path outside workspace`));
  }
  return readFile(resolved, "utf-8");
};

const listDirAdapter = (dir: string) => {
  const resolved = path.isAbsolute(dir) ? dir : boundary.resolve(dir);
  if (!boundary.contains(resolved)) {
    return Promise.reject(new Error(`Access denied: path outside workspace`));
  }
  return readdir(resolved, { withFileTypes: true }).then((entries) =>
    entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      path: `${resolved}/${e.name}`,
    })),
  );
};

const checkPathAdapter = (filePath: string) => {
  const resolved = path.isAbsolute(filePath) ? filePath : boundary.resolve(filePath);
  if (!boundary.contains(resolved)) {
    return Promise.resolve(false);
  }
  return access(resolved)
    .then(() => true)
    .catch(() => false);
};

const cacheService = new CacheServiceImpl({}, logger);
const graphService = new GraphServiceImpl(
  {},
  readFileAdapter,
  listDirAdapter,
  checkPathAdapter,
  logger,
);
const securityService = new SecurityServiceImpl({ workspacePath }, readFileAdapter, logger);
const snapshotService = new SnapshotServiceImpl({}, storage, logger);
const learningService = new LearningServiceImpl({}, storage, logger);
const integrationService = new IntegrationServiceImpl(
  {},
  logger,
  async (args: readonly string[], cwd: string) => {
    const result = await execFileAsync("git", [...args], { cwd });
    return result.stdout ?? "";
  },
);

const commandRunner = async (command: string, args: readonly string[], cwd: string) => {
  const result = await execFileAsync(command, [...args], { cwd });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: 0,
  };
};

const validationService = new ValidationServiceImpl(
  {},
  commandRunner,
  storage,
  graphService,
  securityService,
  logger,
);

// ---------------------------------------------------------------------------
// 3. Open Core — Router + Telemetry
// ---------------------------------------------------------------------------

const tierRouter = new TierRouter({
  daemonPort: Number(process.env.SNAPBACK_DAEMON_PORT ?? 4200),
  checkIntervalMs: 30_000,
});

const telemetry = new TelemetryTracker({
  endpoint: process.env.SNAPBACK_TELEMETRY_URL ?? "https://api.snapback.dev/telemetry",
  apiKey: process.env.SNAPBACK_API_KEY,
  enabled: process.env.SNAPBACK_TELEMETRY_DISABLED !== "1",
});

// ---------------------------------------------------------------------------
// 4. Layer 3 — Tool Handlers
// ---------------------------------------------------------------------------

const snapHandlers = createSnapHandlers({
  snapshotService,
  learningService,
  integrationService,
});

const checkHandlers = createCheckHandlers({
  validationService,
  securityService,
  graphService,
  integrationService,
});

const learnHandlers = createLearnHandlers({ learningService });
const integrateHandlers = createIntegrateHandlers({ integrationService });
const pulseHandlers = createPulseHandlers({
  validationService,
  integrationService,
  graphService,
});
const graphHandlers = createGraphHandlers({ graphService });
const cacheHandlers = createCacheHandlers({ cacheService });

// ---------------------------------------------------------------------------
// 5. Layer 2 — Tool Registry (with Router + Telemetry)
// ---------------------------------------------------------------------------

const registry = new ToolRegistry({
  defaultTimeoutMs: 30_000,
  validateOutputs: false,
  verbose: false,
});

// Attach open core cross-cutting concerns
registry.setRouter(tierRouter);
registry.setTelemetry(telemetry);

registry.register({
  name: "snap",
  description: TOOL_MAP.snap.description,
  inputSchema: SnapInputSchema,
  modes: asModes(snapHandlers),
});

registry.register({
  name: "check",
  description: TOOL_MAP.check.description,
  inputSchema: CheckInputSchema,
  modes: asModes(checkHandlers),
});

registry.register({
  name: "learn",
  description: TOOL_MAP.learn.description,
  inputSchema: LearnInputSchema,
  modes: asModes(learnHandlers),
});

registry.register({
  name: "integrate",
  description: TOOL_MAP.integrate.description,
  inputSchema: IntegrateInputSchema,
  modes: asModes(integrateHandlers),
});

registry.register({
  name: "pulse",
  description: TOOL_MAP.pulse.description,
  inputSchema: PulseInputSchema,
  modes: asModes(pulseHandlers),
});

registry.register({
  name: "graph",
  description: TOOL_MAP.graph.description,
  inputSchema: GraphInputSchema,
  modes: asModes(graphHandlers),
});

registry.register({
  name: "cache",
  description: TOOL_MAP.cache.description,
  inputSchema: CacheInputSchema,
  modes: asModes(cacheHandlers),
});

// ---------------------------------------------------------------------------
// 6. Layer 1 — Protocol Server
// ---------------------------------------------------------------------------

const config: ProtocolConfig = {
  workspacePath,
  sessionId: randomUUID(),
  capabilities: ["git"],
  serverName: "sopr-mcp-server",
  serverVersion: "0.1.0",
  requestTimeoutMs: 30_000,
};

const server = new ProtocolServer(registry, config);

server.start().catch((error: unknown) => {
  console.error("[SOPR] Failed to start server:", error);
  process.exit(1);
});

// Graceful telemetry shutdown
process.on("SIGTERM", () => void telemetry.shutdown());
process.on("SIGINT", () => void telemetry.shutdown());
