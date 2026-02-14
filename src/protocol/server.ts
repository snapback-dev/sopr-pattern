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
 *
 * Anti-patterns enforced:
 *   - No `if`/`switch` on tool names in this file.
 *   - No direct service imports.
 *   - No mutable context objects.
 *   - No business logic of any kind.
 *
 * @module protocol/server
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
}
