/**
 * ToolContext -- the immutable request-scoped context passed down through
 * every SOPR layer.
 *
 * Design constraints:
 *   - Maximum 5 core fields (keeps per-request token cost low).
 *   - Frozen at construction time -- no layer may mutate it.
 *   - Created once by the Protocol Server (Layer 1), consumed read-only
 *     by Tools (Layer 3) and Services (Layer 4).
 *
 * @module contracts/context
 */

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
}

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
 * const ctx = createToolContext({
 *   workspacePath: "/projects/my-app",
 *   sessionId: "sess_abc123",
 *   capabilities: ["git", "sentry"],
 *   requestId: "req_xyz789",
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
  };

  return Object.freeze(ctx);
}
