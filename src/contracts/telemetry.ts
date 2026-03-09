/**
 * ITelemetry — Port interface for usage analytics.
 *
 * The registry depends on this interface, never on a concrete telemetry
 * implementation. Proprietary adapters implement
 * this interface outside the OSS core.
 *
 * @module contracts/telemetry
 */

// ---------------------------------------------------------------------------
// Telemetry Event
// ---------------------------------------------------------------------------

/**
 * Minimal telemetry event shape tracked by the registry.
 *
 * This captures only the metadata needed for the data flywheel.
 * Implementations may extend this with additional fields internally,
 * but the registry only produces this shape.
 */
export interface TelemetryEvent {
	/** Event type identifier (e.g. "tool_call"). */
	readonly event: string;
	/** Tool name. */
	readonly tool: string;
	/** Mode within the tool. */
	readonly mode: string;
	/** Execution tier at time of call. */
	readonly tier: string;
	/** Wall-clock duration in milliseconds. */
	readonly durationMs: number;
	/** Whether the call completed without error. */
	readonly success: boolean;
}

// ---------------------------------------------------------------------------
// ITelemetry Interface
// ---------------------------------------------------------------------------

/**
 * Port interface for telemetry tracking.
 *
 * The registry calls `track()` after every tool execution. Implementations
 * decide how to buffer, batch, and deliver events.
 *
 * @example
 * ```ts
 * // No-op telemetry (default for OSS)
 * const noOpTelemetry: ITelemetry = {
 *   track: () => {},
 *   shutdown: async () => {},
 * };
 * ```
 */
export interface ITelemetry {
	/** Record a telemetry event. Fire-and-forget semantics. */
	track(event: TelemetryEvent): void;

	/** Flush pending events and release resources. */
	shutdown(): Promise<void>;
}
