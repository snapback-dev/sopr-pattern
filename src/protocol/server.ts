/**
 * Protocol Server — Layer 1 of the SOPR pattern.
 *
 * Responsibilities:
 *   1. Create the MCP `Server` instance and register request handlers.
 *   2. Construct an immutable `ToolContext` for each incoming request.
 *   3. Delegate `tools/list` and `tools/call` to the Tool Registry.
 *   4. Provide an error boundary that never leaks internal details.
 *   5. Handle graceful shutdown on SIGTERM/SIGINT.
 *   6. Provide request cancellation via AbortController.
 *   7. Support both stdio and Streamable HTTP transports.
 *
 * Anti-patterns enforced:
 *   - No `if`/`switch` on tool names in this file.
 *   - No direct service imports.
 *   - No mutable context objects.
 *   - No business logic of any kind.
 *
 * @module protocol/server
 */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
	type ContextLogger,
	createConsoleLogger,
	createToolContext,
	noOpProgress,
	type ProgressReporter,
} from "../contracts/context.js";
import type { ToolRegistry } from "../registry/tool-registry.js";
import type { CallToolResult, ProtocolConfig } from "./types.js";
import { formatStructuredError, ProtocolError } from "./types.js";

// ---------------------------------------------------------------------------
// Request ID Generation
// ---------------------------------------------------------------------------

let requestCounter = 0;

/**
 * Generate a unique request identifier.
 *
 * Uses a monotonic counter combined with a random suffix to produce
 * identifiers that are unique within a session and across restarts.
 */
function generateRequestId(): string {
	requestCounter += 1;
	const random = Math.random().toString(36).slice(2, 8);
	return `req_${requestCounter}_${random}`;
}

// ---------------------------------------------------------------------------
// HTTP Transport Options
// ---------------------------------------------------------------------------

/**
 * Options for starting the HTTP transport.
 */
export interface HttpTransportOptions {
	/** Port to listen on (default: 8080). */
	port?: number;
	/** Hostname to bind to (default: "0.0.0.0"). */
	hostname?: string;
	/** Enable JSON-only response mode (no SSE streaming). Default: true. */
	enableJsonResponse?: boolean;
	/** Maximum concurrent sessions (default: 1000). */
	maxSessions?: number;
	/** Session timeout in milliseconds (default: 30 minutes). */
	sessionTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Protocol Server
// ---------------------------------------------------------------------------

export class ProtocolServer {
	private readonly server: Server;
	private readonly registry: ToolRegistry;
	private readonly config: ProtocolConfig;
	private readonly activeRequests: Map<string, AbortController> = new Map();
	private isShuttingDown = false;

	constructor(registry: ToolRegistry, config: ProtocolConfig) {
		this.registry = registry;
		this.config = config;

		this.server = new Server(
			{
				name: config.serverName,
				version: config.serverVersion,
			},
			{
				capabilities: {
					tools: {},
				},
			},
		);

		this.registerHandlers();
	}

	// -----------------------------------------------------------------------
	// Handler Registration
	// -----------------------------------------------------------------------

	/**
	 * Wire up MCP request handlers.
	 *
	 * `tools/list` — returns all registered tool definitions.
	 * `tools/call` — validates, creates context, and dispatches to registry.
	 */
	private registerHandlers(): void {
		// tools/list
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return { tools: this.registry.list() };
		});

		// tools/call
		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const name = request.params.name;
			const args = request.params.arguments ?? {};
			return this.handleToolCall(name, args);
		});
	}

	// -----------------------------------------------------------------------
	// Core Dispatch
	// -----------------------------------------------------------------------

	/**
	 * Handle a single `tools/call` request.
	 *
	 * 1. Creates an AbortController for this request.
	 * 2. Creates an immutable ToolContext with signal, logger, and progress.
	 * 3. Delegates entirely to the registry — no tool-name branching here.
	 * 4. Catches all errors at the protocol boundary.
	 * 5. Cleans up the AbortController on completion.
	 *
	 * @param name - Tool name from the MCP request.
	 * @param args - Raw arguments from the MCP request.
	 * @returns An MCP-compliant CallToolResult.
	 */
	private async handleToolCall(name: string, args: unknown): Promise<CallToolResult> {
		// Reject new requests during shutdown
		if (this.isShuttingDown) {
			return {
				content: [{ type: "text", text: "Server is shutting down" }],
				isError: true,
			};
		}

		const requestId = generateRequestId();
		const controller = new AbortController();

		// Track active request for graceful shutdown
		this.activeRequests.set(requestId, controller);

		// Create request-scoped logger
		const logger = this.createRequestLogger(requestId);

		// Create progress reporter (no-op for stdio, could be enhanced for HTTP)
		const progress = this.createProgressReporter(requestId);

		const context = createToolContext({
			workspacePath: this.config.workspacePath,
			sessionId: this.config.sessionId,
			capabilities: this.config.capabilities,
			requestId,
			signal: controller.signal,
			logger,
			progress,
		});

		try {
			return await this.registry.execute(name, args, context);
		} catch (error: unknown) {
			return this.toErrorResult(error, requestId);
		} finally {
			// Clean up
			this.activeRequests.delete(requestId);
		}
	}

	// -----------------------------------------------------------------------
	// Logger & Progress Factories
	// -----------------------------------------------------------------------

	/**
	 * Create a request-scoped logger.
	 *
	 * In production, this could integrate with MCP's logging notifications.
	 * For now, it uses console logging with request correlation.
	 */
	private createRequestLogger(requestId: string): ContextLogger {
		return createConsoleLogger(`req:${requestId}`);
	}

	/**
	 * Create a progress reporter for a request.
	 *
	 * For stdio transport, progress notifications aren't supported,
	 * so this returns a no-op. For HTTP transport, this could send
	 * progress notifications to the client.
	 */
	private createProgressReporter(_requestId: string): ProgressReporter {
		// TODO: Implement MCP progress notifications for HTTP transport
		return noOpProgress;
	}

	// -----------------------------------------------------------------------
	// Error Boundary
	// -----------------------------------------------------------------------

	/**
	 * Convert any error into a safe MCP error result.
	 *
	 * - `ProtocolError` subclasses produce structured error responses.
	 * - Unknown errors produce a generic message — no stack traces,
	 *   no internal paths, no implementation details.
	 */
	private toErrorResult(error: unknown, requestId: string): CallToolResult {
		if (error instanceof ProtocolError) {
			const structured = error.toStructuredError({ requestId });
			return {
				content: [formatStructuredError(structured)],
				isError: true,
			};
		}

		// Unknown / unexpected error — never leak details
		return {
			content: [
				formatStructuredError({
					code: "INTERNAL_ERROR",
					message: "An internal error occurred. Please try again.",
					details: { requestId },
					recoverable: true,
				}),
			],
			isError: true,
		};
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Start the protocol server using stdio transport.
	 *
	 * This connects the MCP server to stdin/stdout for communication
	 * with the MCP client (e.g. Claude Code, an IDE plugin, etc.).
	 *
	 * Also registers signal handlers for graceful shutdown.
	 */
	async start(): Promise<void> {
		// Register shutdown handlers
		this.registerShutdownHandlers();

		const transport = new StdioServerTransport();
		await this.server.connect(transport);
	}

	/**
	 * Start the protocol server using Streamable HTTP transport.
	 *
	 * This starts an HTTP server that accepts MCP protocol messages
	 * via the Streamable HTTP transport (MCP 2025-03-26 spec).
	 *
	 * Supports:
	 * - POST: Client-to-server messages (initialize, tool calls)
	 * - GET: Server-to-client SSE stream (notifications)
	 * - DELETE: Session termination
	 *
	 * Sessions are managed automatically via the `mcp-session-id` header.
	 *
	 * @param options - HTTP transport configuration
	 * @returns The underlying HTTP server instance (for external control)
	 */
	async startHttp(options?: HttpTransportOptions): Promise<HttpServer> {
		const port = options?.port ?? 8080;
		const hostname = options?.hostname ?? "0.0.0.0";
		const maxSessions = options?.maxSessions ?? 1000;
		const sessionTimeoutMs = options?.sessionTimeoutMs ?? 30 * 60 * 1000;
		const enableJsonResponse = options?.enableJsonResponse ?? true;

		// Session store
		const sessions = new Map<string, { transport: StreamableHTTPServerTransport; lastAccess: number }>();

		// Session cleanup interval
		const cleanupInterval = setInterval(() => {
			const now = Date.now();
			for (const [id, entry] of sessions) {
				if (now - entry.lastAccess > sessionTimeoutMs) {
					void entry.transport.close();
					sessions.delete(id);
				}
			}
		}, 60_000);

		const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
			try {
				// Parse URL
				const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

				// Only handle /mcp path
				if (url.pathname !== "/mcp" && url.pathname !== "/") {
					res.writeHead(404, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Not found" }));
					return;
				}

				// Handle unsupported methods early (before body read)
				if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
					res.writeHead(405, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Method not allowed" }));
					return;
				}

				// Handle DELETE before body read (DELETE typically has no body)
				if (req.method === "DELETE") {
					const sessionId = req.headers["mcp-session-id"] as string | undefined;
					if (sessionId && sessions.has(sessionId)) {
						const entry = sessions.get(sessionId)!;
						await entry.transport.close();
						sessions.delete(sessionId);
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ status: "session_closed" }));
					} else {
						res.writeHead(404, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Session not found" }));
					}
					return;
				}

				// Read request body for POST/GET
				const body = await this.readRequestBody(req);
				const sessionId = req.headers["mcp-session-id"] as string | undefined;

				if (req.method === "POST") {
					if (sessionId && sessions.has(sessionId)) {
						// Existing session
						const entry = sessions.get(sessionId)!;
						entry.lastAccess = Date.now();
						await entry.transport.handleRequest(req, res, body);
					} else if (!sessionId) {
						// New session initialization
						if (sessions.size >= maxSessions) {
							res.writeHead(503, { "Content-Type": "application/json" });
							res.end(
								JSON.stringify({
									jsonrpc: "2.0",
									error: { code: -32000, message: "Server at capacity" },
									id: null,
								}),
							);
							return;
						}

						const transport = new StreamableHTTPServerTransport({
							sessionIdGenerator: () => `sopr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
							enableJsonResponse,
							onsessioninitialized: (id) => {
								sessions.set(id, { transport, lastAccess: Date.now() });
							},
						});

						// Connect a new MCP server instance for this session
						const sessionServer = new Server(
							{ name: this.config.serverName, version: this.config.serverVersion },
							{ capabilities: { tools: {} } },
						);

						// Wire the same handlers to the session server
						this.registerHandlersOnServer(sessionServer);

						await sessionServer.connect(transport);
						await transport.handleRequest(req, res, body);
					} else {
						// Unknown session
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(
							JSON.stringify({
								jsonrpc: "2.0",
								error: { code: -32000, message: "Session not found or expired" },
								id: null,
							}),
						);
					}
				} else {
					// GET — SSE stream for existing session
					if (sessionId && sessions.has(sessionId)) {
						const entry = sessions.get(sessionId)!;
						entry.lastAccess = Date.now();
						await entry.transport.handleRequest(req, res);
					} else {
						res.writeHead(400, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "Session not found" }));
					}
				}
			} catch (_err) {
				if (!res.headersSent) {
					res.writeHead(500, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "Internal server error" }));
				} else if (!res.writableEnded) {
					res.end();
				}
			}
		});

		// Register shutdown handlers
		const shutdown = async (signal: string) => {
			console.error(`\n[ProtocolServer] Received ${signal}, shutting down HTTP server...`);
			clearInterval(cleanupInterval);

			// Close all sessions
			for (const [id, entry] of sessions) {
				void entry.transport.close();
				sessions.delete(id);
			}

			httpServer.close();
			await this.stop();
			process.exit(0);
		};

		process.on("SIGTERM", () => shutdown("SIGTERM"));
		process.on("SIGINT", () => shutdown("SIGINT"));

		return new Promise<HttpServer>((resolve) => {
			httpServer.listen(port, hostname, () => {
				console.error(`[ProtocolServer] Streamable HTTP server listening on ${hostname}:${port}`);
				resolve(httpServer);
			});
		});
	}

	/**
	 * Gracefully shut down the server.
	 *
	 * 1. Sets shutdown flag to reject new requests.
	 * 2. Aborts all active requests.
	 * 3. Waits briefly for cleanup.
	 * 4. Closes the MCP server.
	 */
	async stop(): Promise<void> {
		if (this.isShuttingDown) {
			return;
		}

		this.isShuttingDown = true;

		// Abort all active requests
		for (const [requestId, controller] of this.activeRequests) {
			controller.abort();
			this.activeRequests.delete(requestId);
		}

		// Give handlers a moment to clean up
		await new Promise((resolve) => setTimeout(resolve, 100));

		await this.server.close();
	}

	/**
	 * Register handlers on an external Server instance.
	 *
	 * Used by startHttp() to wire tools/list and tools/call handlers
	 * onto per-session Server instances.
	 */
	private registerHandlersOnServer(server: Server): void {
		server.setRequestHandler(ListToolsRequestSchema, async () => {
			return { tools: this.registry.list() };
		});

		server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const name = request.params.name;
			const args = request.params.arguments ?? {};
			return this.handleToolCall(name, args);
		});
	}

	/**
	 * Read the full request body from an IncomingMessage.
	 */
	private async readRequestBody(req: IncomingMessage): Promise<unknown> {
		return new Promise<unknown>((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on("data", (chunk: Buffer) => chunks.push(chunk));
			req.on("end", () => {
				const raw = Buffer.concat(chunks).toString("utf-8");
				if (!raw) {
					resolve(undefined);
					return;
				}
				try {
					resolve(JSON.parse(raw));
				} catch {
					resolve(raw);
				}
			});
			req.on("error", reject);
		});
	}

	/**
	 * Register handlers for SIGTERM and SIGINT to enable graceful shutdown.
	 */
	private registerShutdownHandlers(): void {
		const shutdown = async (signal: string) => {
			// Using console.error intentionally for stderr output
			console.error(`\n[ProtocolServer] Received ${signal}, shutting down...`);
			await this.stop();
			process.exit(0);
		};

		process.on("SIGTERM", () => shutdown("SIGTERM"));
		process.on("SIGINT", () => shutdown("SIGINT"));
	}

	/**
	 * Access the underlying MCP Server instance.
	 *
	 * Exposed for testing and advanced configuration scenarios.
	 * Production code should not need to access this directly.
	 */
	getServer(): Server {
		return this.server;
	}

	/**
	 * Cancel a specific request by ID.
	 *
	 * This allows external components to cancel requests, for example
	 * when a client disconnects or explicitly requests cancellation.
	 */
	cancelRequest(requestId: string): boolean {
		const controller = this.activeRequests.get(requestId);
		if (controller) {
			controller.abort();
			this.activeRequests.delete(requestId);
			return true;
		}
		return false;
	}

	/**
	 * Get the number of active sessions (for HTTP transport health checks).
	 */
	getActiveRequestCount(): number {
		return this.activeRequests.size;
	}
}
