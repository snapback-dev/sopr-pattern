/**
 * Protocol-level types for the SOPR MCP server (Layer 1).
 *
 * These types define the configuration and error taxonomy used exclusively
 * at the protocol boundary. No business logic types belong here.
 *
 * @module protocol/types
 */

// ---------------------------------------------------------------------------
// Protocol Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration provided at server startup.
 *
 * The protocol server uses this to construct a {@link ToolContext} for each
 * incoming request. Fields here are "per-session" or "per-server" values;
 * per-request values (like `requestId`) are generated at call time.
 */
export interface ProtocolConfig {
  /** Absolute path to the workspace root directory. */
  readonly workspacePath: string;

  /** Opaque session identifier, stable for the lifetime of the connection. */
  readonly sessionId: string;

  /**
   * Feature capabilities advertised by the server or client.
   * Used to conditionally enable/disable behaviour downstream.
   */
  readonly capabilities: readonly string[];

  /** Human-readable server name exposed during MCP initialization. */
  readonly serverName: string;

  /** Semantic version string for the server. */
  readonly serverVersion: string;
}

// ---------------------------------------------------------------------------
// MCP-compatible CallToolResult
// ---------------------------------------------------------------------------

/**
 * Content block within a tool call result.
 *
 * The MCP protocol supports text, image, audio, and resource content types.
 * We define only text here since SOPR tools return structured text payloads.
 * Additional content types can be added as discriminated union members
 * if future tools require them.
 */
export interface TextContent {
  readonly type: "text";
  readonly text: string;
}

/**
 * Result shape returned from `tools/call` handlers.
 *
 * Conforms to the MCP `CallToolResult` schema: an array of content blocks
 * plus an optional `isError` flag.
 */
export interface CallToolResult {
  readonly content: readonly TextContent[];
  readonly isError?: boolean;
}

// ---------------------------------------------------------------------------
// Protocol Error Taxonomy
// ---------------------------------------------------------------------------

/**
 * Base class for all protocol-level errors.
 *
 * Protocol errors produce client-safe messages (no stack traces, no internal
 * paths). Each subclass carries a stable `code` string for programmatic
 * error handling on the client side.
 */
export abstract class ProtocolError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when a tool name in `tools/call` does not match any registered tool.
 */
export class ToolNotFoundError extends ProtocolError {
  readonly code = "TOOL_NOT_FOUND" as const;

  constructor(toolName: string) {
    super(`Unknown tool: "${toolName}"`);
  }
}

/**
 * Thrown when the input arguments fail Zod schema validation.
 */
export class InvalidInputError extends ProtocolError {
  readonly code = "INVALID_INPUT" as const;

  /** Structured validation issues safe to expose to clients. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid input: ${issues.join("; ")}`);
    this.issues = issues;
  }
}

/**
 * Thrown when the requested mode does not exist for the resolved tool.
 */
export class ModeNotFoundError extends ProtocolError {
  readonly code = "MODE_NOT_FOUND" as const;

  constructor(toolName: string, mode: string) {
    super(`Unknown mode "${mode}" for tool "${toolName}"`);
  }
}

/**
 * Thrown when a mode handler fails with an unexpected runtime error.
 *
 * The original error details are intentionally excluded from the message
 * to prevent leaking internal implementation details to MCP clients.
 */
export class HandlerExecutionError extends ProtocolError {
  readonly code = "HANDLER_ERROR" as const;

  constructor(toolName: string, mode: string) {
    super(`Tool "${toolName}" failed during "${mode}" execution`);
  }
}
