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

  /**
   * Per-request timeout in milliseconds.
   * Defaults to 30000 (30 seconds). Set to 0 to disable.
   */
  readonly requestTimeoutMs?: number;
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
  type: "text";
  text: string;
}

/**
 * Result shape returned from `tools/call` handlers.
 *
 * Conforms to the MCP `CallToolResult` schema: an array of content blocks
 * plus an optional `isError` flag. Field types are intentionally mutable
 * to remain structurally compatible with the MCP SDK's inferred types.
 */
export interface CallToolResult {
  content: TextContent[];
  isError?: boolean;
  /** Index signature required for MCP SDK compatibility. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Structured Error Response
// ---------------------------------------------------------------------------

/**
 * Structured error details for machine-readable error handling.
 *
 * Clients can parse this to handle specific error types programmatically.
 */
export interface StructuredError {
  /** Stable error code for programmatic handling. */
  readonly code: string;
  /** Human-readable error message. */
  readonly message: string;
  /** Additional details (validation issues, context, etc.). */
  readonly details?: Readonly<Record<string, unknown>>;
  /** Whether the error is recoverable with a retry. */
  readonly recoverable: boolean;
}

/**
 * Format a StructuredError as a text content block for MCP responses.
 */
export function formatStructuredError(error: StructuredError): TextContent {
  return {
    type: "text",
    text: JSON.stringify(error, null, 2),
  };
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
  /** Whether this error type is potentially recoverable with a retry. */
  abstract readonly recoverable: boolean;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }

  /** Convert to structured error format for client consumption. */
  toStructuredError(details?: Record<string, unknown>): StructuredError {
    return {
      code: this.code,
      message: this.message,
      details,
      recoverable: this.recoverable,
    };
  }
}

/**
 * Thrown when a tool name in `tools/call` does not match any registered tool.
 */
export class ToolNotFoundError extends ProtocolError {
  readonly code = "TOOL_NOT_FOUND" as const;
  readonly recoverable = false;

  constructor(toolName: string) {
    super(`Unknown tool: "${toolName}"`);
  }
}

/**
 * Thrown when the input arguments fail Zod schema validation.
 */
export class InvalidInputError extends ProtocolError {
  readonly code = "INVALID_INPUT" as const;
  readonly recoverable = false;

  /** Structured validation issues safe to expose to clients. */
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid input: ${issues.join("; ")}`);
    this.issues = issues;
  }

  override toStructuredError(): StructuredError {
    return {
      code: this.code,
      message: this.message,
      details: { issues: this.issues },
      recoverable: this.recoverable,
    };
  }
}

/**
 * Thrown when the requested mode does not exist for the resolved tool.
 */
export class ModeNotFoundError extends ProtocolError {
  readonly code = "MODE_NOT_FOUND" as const;
  readonly recoverable = false;

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
  readonly recoverable = true; // May be transient

  constructor(toolName: string, mode: string) {
    super(`Tool "${toolName}" failed during "${mode}" execution`);
  }
}

/**
 * Thrown when a request exceeds the configured timeout.
 */
export class RequestTimeoutError extends ProtocolError {
  readonly code = "REQUEST_TIMEOUT" as const;
  readonly recoverable = true; // Can be retried

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
  }
}

/**
 * Thrown when a request is cancelled via AbortSignal.
 */
export class RequestCancelledError extends ProtocolError {
  readonly code = "REQUEST_CANCELLED" as const;
  readonly recoverable = false;

  constructor() {
    super("Request was cancelled");
  }
}

/**
 * Thrown when output validation fails (response doesn't match schema).
 */
export class OutputValidationError extends ProtocolError {
  readonly code = "OUTPUT_VALIDATION_ERROR" as const;
  readonly recoverable = false;

  /** Structured validation issues. */
  readonly issues: readonly string[];

  constructor(toolName: string, issues: readonly string[]) {
    super(`Output validation failed for tool "${toolName}": ${issues.join("; ")}`);
    this.issues = issues;
  }

  override toStructuredError(): StructuredError {
    return {
      code: this.code,
      message: this.message,
      details: { issues: this.issues },
      recoverable: this.recoverable,
    };
  }
}
