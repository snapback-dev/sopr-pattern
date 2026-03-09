/**
 * @snapback-oss/sopr-mcp — Public API
 *
 * SOPR (Service-Oriented Protocol Router) framework for building
 * MCP servers with mode-based tools, composable resilience, and
 * hexagonal architecture.
 *
 * ## Quick Start
 *
 * ```ts
 * import { createSOPRServer } from "@snapback-oss/sopr-mcp";
 *
 * const server = createSOPRServer({
 *   serverName: "my-mcp-server",
 *   serverVersion: "1.0.0",
 *   workspacePath: process.cwd(),
 *   tools: [
 *     { name: "my-tool", description: "...", inputSchema: MySchema, modes: { ... } },
 *   ],
 * });
 *
 * await server.start();
 * ```
 *
 * @module @snapback-oss/sopr-mcp
 */

import { randomUUID } from "node:crypto";
import type { ITierRouter } from "./contracts/router.js";
import type { ITelemetry } from "./contracts/telemetry.js";
import { ProtocolServer } from "./protocol/server.js";
import type { ProtocolConfig } from "./protocol/types.js";
import { ToolRegistry } from "./registry/tool-registry.js";
import type { ToolDefinition } from "./registry/types.js";

// ---------------------------------------------------------------------------
// createSOPRServer() Factory
// ---------------------------------------------------------------------------

/**
 * Configuration for the SOPR server factory.
 */
export interface SOPRServerConfig {
	/** Human-readable server name exposed during MCP initialization. */
	serverName: string;

	/** Semantic version string for the server. */
	serverVersion: string;

	/** Absolute path to the workspace root directory. */
	workspacePath: string;

	/** Tool definitions to register. */
	tools: ToolDefinition[];

	/** Optional tier router for free/pro delegation. */
	router?: ITierRouter;

	/** Optional telemetry tracker for usage analytics. */
	telemetry?: ITelemetry;

	/** Default timeout in milliseconds for tool handler execution (default: 30000). */
	timeoutMs?: number;

	/** Client capabilities to advertise (default: []). */
	capabilities?: string[];

	/** Session ID (default: auto-generated UUID). */
	sessionId?: string;
}

/**
 * Create a fully-wired SOPR MCP server.
 *
 * This is the primary entry point for consumers. It wires together:
 * - Tool Registry (Layer 2) with registered tools
 * - Protocol Server (Layer 1) with MCP transport
 * - Optional router and telemetry adapters
 *
 * @param config - Server configuration.
 * @returns A ready-to-start ProtocolServer instance.
 *
 * @example
 * ```ts
 * const server = createSOPRServer({
 *   serverName: "my-mcp-server",
 *   serverVersion: "1.0.0",
 *   workspacePath: process.cwd(),
 *   tools: myTools,
 *   router: new MyCustomRouter(),
 *   telemetry: new MyTelemetry(),
 * });
 *
 * await server.start();
 * ```
 */
export function createSOPRServer(config: SOPRServerConfig): ProtocolServer {
	const registry = new ToolRegistry({
		defaultTimeoutMs: config.timeoutMs ?? 30_000,
		validateOutputs: false,
		verbose: false,
	});

	if (config.router) {
		registry.setRouter(config.router);
	}

	if (config.telemetry) {
		registry.setTelemetry(config.telemetry);
	}

	for (const tool of config.tools) {
		registry.register(tool);
	}

	const protocolConfig: ProtocolConfig = {
		workspacePath: config.workspacePath,
		sessionId: config.sessionId ?? randomUUID(),
		capabilities: config.capabilities ?? [],
		serverName: config.serverName,
		serverVersion: config.serverVersion,
		requestTimeoutMs: config.timeoutMs ?? 30_000,
	};

	return new ProtocolServer(registry, protocolConfig);
}

// ---------------------------------------------------------------------------
// Public API — Re-exports
// ---------------------------------------------------------------------------

// Default Implementations
export { ConsoleLoggerAdapter } from "./adapters/console-logger.js";
export { InMemoryStorage } from "./adapters/in-memory-storage.js";
export { LocalRouter } from "./adapters/local-router.js";
export { NoOpTelemetry } from "./adapters/no-op-telemetry.js";
// Contracts (Port interfaces + types)
export type {
	// Context
	ContextLogger,
	CreateContextInput,
	LogContext,
	LogLevel,
	ProgressReporter,
	ToolContext,
} from "./contracts/context.js";
export { createConsoleLogger, createToolContext, noOpLogger, noOpProgress } from "./contracts/context.js";
// Dependency graph utilities
export {
	hasCycle,
	SERVICE_ADJACENCY,
	SERVICE_DEPENDENCY_GRAPH,
	SERVICE_INIT_ORDER,
	topologicalSort,
} from "./contracts/dependency-graph.js";
// Port interfaces
export type { ITierRouter, RouteDecision, TierMode } from "./contracts/router.js";
// Service interfaces
export type {
	ICacheService,
	IGraphService,
	IIntegrationService,
	ILearningService,
	ISecurityService,
	ISnapshotService,
	IValidationService,
	ServiceContainer,
	ServiceResult,
} from "./contracts/services.js";
export type { IStorage } from "./contracts/storage.js";
export type { ITelemetry, TelemetryEvent } from "./contracts/telemetry.js";
// Tool map
export type {
	CoreServiceName,
	ExecutionStrategy,
	ModeDefinition,
	ModeDefinitionFor,
	ModeName,
	ServiceName,
	ToolMapEntry,
	ToolName,
} from "./contracts/tool-map.js";
export { TOOL_COUNT, TOOL_MAP, TOTAL_MODE_COUNT } from "./contracts/tool-map.js";
export type { WireFormatConfig } from "./contracts/wire-format.js";
// Wire format
export {
	decode,
	encode,
	getWireFormat,
	getWirePrefix,
	setWireFormat,
	setWirePrefix,
	WireFormatError,
	WireType,
} from "./contracts/wire-format.js";
// Tool Definition Factories (Composition Root)
export {
	createHelpToolDef,
	createPulseToolDef,
	createReadOnlyTools,
	type ReadOnlyToolDeps,
} from "./definitions.js";
export type { HttpTransportOptions } from "./protocol/server.js";
// Protocol (Layer 1)
export { ProtocolServer } from "./protocol/server.js";
export type { CallToolResult, ProtocolConfig, StructuredError, TextContent } from "./protocol/types.js";
export {
	formatStructuredError,
	HandlerExecutionError,
	InvalidInputError,
	ModeNotFoundError,
	OutputValidationError,
	ProtocolError,
	RequestCancelledError,
	RequestTimeoutError,
	ToolNotFoundError,
} from "./protocol/types.js";
// Registry (Layer 2)
export { ToolRegistry } from "./registry/tool-registry.js";
export type { ModeHandler, ToolAnnotations, ToolDefinition, ToolRegistryConfig } from "./registry/types.js";
// Resilience
export {
	type BreakerRegistry,
	type CircuitBreakerConfig,
	type CircuitState,
	type CircuitStateInfo,
	type ConcurrencyConfig,
	ConcurrencyLimiter,
	ConsoleLogger,
	createBreakerRegistry,
	type GracefulDegradationOptions,
	type Logger,
	type ResilienceConfig,
	type RetryConfig,
	withGracefulDegradation,
	withResilience,
	withRetry,
} from "./resilience/index.js";
export { createHelpHandlers } from "./tools/help.js";
export { createPulseHandlers, type PulseDeps } from "./tools/pulse.js";
