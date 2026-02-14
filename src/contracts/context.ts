/**
 * ToolContext -- the immutable request-scoped context passed down through
 * every SOPR layer.
 *
 * Design constraints:
 *   - Core fields kept minimal (keeps per-request token cost low).
 *   - Frozen at construction time -- no layer may mutate it.
 *   - Created once by the Protocol Server (Layer 1), consumed read-only
 *     by Tools (Layer 3) and Services (Layer 4).
 *
 * @module contracts/context
 */

// ---------------------------------------------------------------------------
// Logger Interface (for context-scoped logging)
// ---------------------------------------------------------------------------

/** Structured log context fields. */
export type LogContext = Readonly<Record<string, unknown>>;

/** MCP-compatible log levels. */
export type LogLevel =
  | "debug"
  | "info"
  | "notice"
  | "warning"
  | "error"
  | "critical"
  | "alert"
  | "emergency";

/**
 * Context-scoped logger that tools use to report diagnostic information.
 *
 * When running under MCP, this sends logs to the client via the protocol.
 * In standalone mode, it falls back to console logging.
 */
export interface ContextLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

// ---------------------------------------------------------------------------
// Progress Reporting
// ---------------------------------------------------------------------------

/**
 * Progress reporter for long-running operations.
 *
 * Tools call this to report incremental progress to the client.
 * The MCP protocol supports progress notifications that clients
 * can display as progress bars or status updates.
 */
export type ProgressReporter = (message: string, progressPercent: number, total?: number) => void;

// ---------------------------------------------------------------------------
// Core Context Type
// ---------------------------------------------------------------------------

/**
 * Immutable context that accompanies every tool invocation.
 *
 * Fields are intentionally minimal. Domain-specific data belongs in tool
 * params or service inputs, never in the context.
 */
export interface ToolContext {
  /** Absolute path to the workspace root (e.g. project directory). */
  readonly workspacePath: string;

  /** Opaque session identifier -- stable for the lifetime of a client session. */
  readonly sessionId: string;

  /**
   * Feature capabilities advertised by the client.
   * Services use this to conditionally enable or disable behaviour
   * (e.g. "git", "sentry", "github").
   */
  readonly capabilities: readonly string[];

  /** Unix-epoch millisecond timestamp of request receipt. */
  readonly timestamp: number;

  /**
   * Unique identifier for this individual request.
   * Used for correlation in logs, traces, and error reports.
   */
  readonly requestId: string;

  /**
   * Cancellation signal for this request.
   *
   * Tools and services SHOULD check `signal.aborted` before starting
   * expensive operations and SHOULD abort early when the signal fires.
   * This enables responsive cancellation of long-running operations.
   */
  readonly signal: AbortSignal;

  /**
   * Context-scoped logger for diagnostic output.
   *
   * Tools use this to log warnings, errors, and debug information
   * that will be visible to the client or recorded for debugging.
   */
  readonly logger: ContextLogger;

  /**
   * Progress reporter for long-running operations.
   *
   * Tools call this to report incremental progress. The function
   * is a no-op if the client doesn't support progress notifications.
   */
  readonly progress: ProgressReporter;
}

// ---------------------------------------------------------------------------
// Factory Input
// ---------------------------------------------------------------------------

/** Raw inputs accepted by the context factory. */
export interface CreateContextInput {
  /** Absolute path to the workspace root. */
  workspacePath: string;

  /** Opaque session identifier. */
  sessionId: string;

  /** Client-advertised capabilities. Defensively copied during creation. */
  capabilities: readonly string[];

  /** Unique request identifier. */
  requestId: string;

  /** Cancellation signal for this request. */
  signal: AbortSignal;

  /** Logger for diagnostic output. */
  logger: ContextLogger;

  /** Progress reporter callback. */
  progress: ProgressReporter;
}

// ---------------------------------------------------------------------------
// Default Implementations
// ---------------------------------------------------------------------------

/**
 * Console-based logger implementation for standalone use.
 *
 * Used when MCP logging is not available (e.g., in tests or standalone mode).
 */
export function createConsoleLogger(prefix = ""): ContextLogger {
  const tag = prefix ? `[${prefix}] ` : "";
  return {
    debug: (_message, _context) => {},
    info: (_message, _context) => {},
    warn: (message, context) => {
      console.warn(`${tag}WARN: ${message}`, context ?? "");
    },
    error: (message, context) => {
      console.error(`${tag}ERROR: ${message}`, context ?? "");
    },
  };
}

/**
 * No-op progress reporter for when progress reporting is not supported.
 */
export const noOpProgress: ProgressReporter = () => {
  /* intentionally empty */
};

/**
 * No-op logger for testing or silent operation.
 */
export const noOpLogger: ContextLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Construct a deeply-frozen {@link ToolContext}.
 *
 * The returned object (and its `capabilities` array) are frozen with
 * `Object.freeze` so that no downstream layer can mutate request state.
 * The `timestamp` is captured at creation time and cannot be overridden.
 *
 * @param input - Raw context fields provided by the Protocol Server.
 * @returns A frozen, immutable ToolContext.
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 * const ctx = createToolContext({
 *   workspacePath: "/projects/my-app",
 *   sessionId: "sess_abc123",
 *   capabilities: ["git", "sentry"],
 *   requestId: "req_xyz789",
 *   signal: controller.signal,
 *   logger: createConsoleLogger("my-tool"),
 *   progress: noOpProgress,
 * });
 *
 * ctx.workspacePath = "/other"; // TypeError: Cannot assign to read only property
 * ```
 */
export function createToolContext(input: CreateContextInput): ToolContext {
  const ctx: ToolContext = {
    workspacePath: input.workspacePath,
    sessionId: input.sessionId,
    capabilities: Object.freeze([...input.capabilities]),
    timestamp: Date.now(),
    requestId: input.requestId,
    signal: input.signal,
    logger: input.logger,
    progress: input.progress,
  };

  return Object.freeze(ctx);
}
