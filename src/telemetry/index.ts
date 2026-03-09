/**
 * Telemetry module — privacy-first usage analytics for the data flywheel.
 *
 * SPDX-License-Identifier: MIT
 *
 * @module telemetry
 */

export type {
	ContextFetchEvent,
	SessionPatternEvent,
	TelemetryConfig,
	TelemetryEvent,
	ToolCallEvent,
	UndoTriggeredEvent,
} from "./tracker.js";
export {
	ContextFetchEventSchema,
	SessionPatternEventSchema,
	TelemetryEventSchema,
	TelemetryTracker,
	ToolCallEventSchema,
	UndoTriggeredEventSchema,
} from "./tracker.js";
