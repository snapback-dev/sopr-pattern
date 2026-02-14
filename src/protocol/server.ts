/**
 * Protocol Server — Layer 1 of the SOPR pattern.
 *
 * Responsibilities:
 *   1. Create the MCP `Server` instance and register request handlers.
 *   2. Construct an immutable `ToolContext` for each incoming request.
 *   3. Delegate `tools/list` and `tools/call` to the Tool Registry.
 *   4. Provide an error boundary that never leaks internal details.
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
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { createToolContext } from "../contracts/context.js";
import type { ToolRegistry } from "../registry/tool-registry.js";
import type { ProtocolConfig, CallToolResult } from "./types.js";
import { ProtocolError } from "./types.js";

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
   * 1. Creates an immutable ToolContext from the server config.
   * 2. Delegates entirely to the registry — no tool-name branching here.
   * 3. Catches all errors at the protocol boundary.
   *
   * @param name - Tool name from the MCP request.
   * @param args - Raw arguments from the MCP request.
   * @returns An MCP-compliant CallToolResult.
   */
  private async handleToolCall(
    name: string,
    args: unknown,
  ): Promise<CallToolResult> {
    const context = createToolContext({
      workspacePath: this.config.workspacePath,
      sessionId: this.config.sessionId,
      capabilities: this.config.capabilities,
      requestId: generateRequestId(),
    });

    try {
      return await this.registry.execute(name, args, context);
    } catch (error: unknown) {
      return this.toErrorResult(error);
    }
  }

  // -----------------------------------------------------------------------
  // Error Boundary
  // -----------------------------------------------------------------------

  /**
   * Convert any error into a safe MCP error result.
   *
   * - `ProtocolError` subclasses produce their client-safe message.
   * - Unknown errors produce a generic message — no stack traces,
   *   no internal paths, no implementation details.
   */
  private toErrorResult(error: unknown): CallToolResult {
    if (error instanceof ProtocolError) {
      return {
        content: [{ type: "text", text: `[${error.code}] ${error.message}` }],
        isError: true,
      };
    }

    // Unknown / unexpected error — never leak details
    return {
      content: [
        { type: "text", text: "An internal error occurred. Please try again." },
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
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Gracefully shut down the server.
   */
  async stop(): Promise<void> {
    await this.server.close();
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
}
