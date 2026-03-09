/**
 * No-Op Telemetry — Default implementation that silently drops all events.
 *
 * Use this as the default when no telemetry backend is configured.
 * Suitable for OSS deployments, testing, and development.
 *
 * @module adapters/no-op-telemetry
 */

import type { ITelemetry, TelemetryEvent } from "../contracts/telemetry.js";

/**
 * No-op telemetry implementation.
 *
 * All events are silently discarded. Shutdown is instant.
 *
 * @example
 * ```ts
 * import { NoOpTelemetry } from "@snapback-oss/sopr-mcp";
 *
 * const telemetry = new NoOpTelemetry();
 * telemetry.track({ event: "tool_call", tool: "snap", mode: "start", tier: "free", durationMs: 100, success: true });
 * // Does nothing
 * ```
 */
export class NoOpTelemetry implements ITelemetry {
	track(_event: TelemetryEvent): void {
		// Intentionally empty — no-op adapter
	}

	async shutdown(): Promise<void> {
		// Nothing to flush
	}
}
