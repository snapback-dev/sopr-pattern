/**
 * TelemetryTracker unit tests.
 *
 * Validates:
 *   - Event buffering and flushing
 *   - Privacy: no PII or code content in events
 *   - Schema validation (invalid events dropped)
 *   - Disabled mode skips all tracking
 *   - Graceful failure on network errors
 *
 * @module tests/unit/telemetry-tracker
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type TelemetryEvent, TelemetryTracker } from "../../src/telemetry/tracker.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTracker(overrides?: Record<string, unknown>): TelemetryTracker {
	return new TelemetryTracker({
		endpoint: "https://test.example.com/telemetry",
		flushIntervalMs: 0, // Disable periodic flushing in tests
		enabled: true,
		...overrides,
	});
}

function toolCallEvent(overrides?: Partial<TelemetryEvent>): TelemetryEvent {
	return {
		event: "tool_call",
		tool: "snap",
		mode: "start",
		tier: "free",
		durationMs: 150,
		success: true,
		...overrides,
	} as TelemetryEvent;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TelemetryTracker", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("event buffering", () => {
		it("buffers events without immediate flush", () => {
			const tracker = createTracker();
			tracker.track(toolCallEvent());

			expect(tracker.pendingCount).toBe(1);
			expect(fetch).not.toHaveBeenCalled();
		});

		it("flushes events on explicit flush()", async () => {
			const tracker = createTracker();
			tracker.track(toolCallEvent());
			tracker.track(toolCallEvent({ tool: "check" } as unknown as TelemetryEvent));

			const flushed = await tracker.flush();

			expect(flushed).toBe(2);
			expect(tracker.pendingCount).toBe(0);
			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it("auto-flushes when buffer exceeds maxBufferSize", () => {
			const tracker = createTracker({ maxBufferSize: 3 });

			tracker.track(toolCallEvent());
			tracker.track(toolCallEvent());
			tracker.track(toolCallEvent()); // Should trigger flush

			expect(fetch).toHaveBeenCalledTimes(1);
		});

		it("returns 0 when flushing empty buffer", async () => {
			const tracker = createTracker();
			const flushed = await tracker.flush();

			expect(flushed).toBe(0);
			expect(fetch).not.toHaveBeenCalled();
		});
	});

	describe("schema validation", () => {
		it("accepts valid tool_call events", () => {
			const tracker = createTracker();
			tracker.track(toolCallEvent());
			expect(tracker.pendingCount).toBe(1);
		});

		it("accepts valid context_fetch events", () => {
			const tracker = createTracker();
			tracker.track({
				event: "context_fetch",
				filesRequested: 5,
				tokensReturned: 1200,
				cacheHit: false,
			});
			expect(tracker.pendingCount).toBe(1);
		});

		it("accepts valid undo_triggered events", () => {
			const tracker = createTracker();
			tracker.track({
				event: "undo_triggered",
				filesAffected: 3,
				turnsRolledBack: 2,
				trigger: "user_explicit",
			});
			expect(tracker.pendingCount).toBe(1);
		});

		it("accepts valid session_pattern events", () => {
			const tracker = createTracker();
			tracker.track({
				event: "session_pattern",
				sessionDurationMs: 300_000,
				toolCallCount: 15,
				uniqueFilesTouched: 8,
				undoCount: 1,
			});
			expect(tracker.pendingCount).toBe(1);
		});

		it("silently drops invalid events", () => {
			const tracker = createTracker();
			tracker.track({ event: "invalid_type" } as unknown as TelemetryEvent);
			expect(tracker.pendingCount).toBe(0);
		});

		it("silently drops events with missing required fields", () => {
			const tracker = createTracker();
			tracker.track({ event: "tool_call", tool: "snap" } as unknown as TelemetryEvent);
			expect(tracker.pendingCount).toBe(0);
		});
	});

	describe("privacy guarantees", () => {
		it("tool_call events contain no file paths or code content", async () => {
			const tracker = createTracker();
			tracker.track(toolCallEvent());
			await tracker.flush();

			const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			const body = JSON.parse(callArgs[1].body as string);
			const event = body.events[0];

			// Assert no PII fields exist
			expect(event).not.toHaveProperty("filePath");
			expect(event).not.toHaveProperty("code");
			expect(event).not.toHaveProperty("userId");
			expect(event).not.toHaveProperty("email");
			expect(event).not.toHaveProperty("workspacePath");

			// Assert only expected fields
			const allowedFields = ["event", "tool", "mode", "tier", "durationMs", "success"];
			for (const key of Object.keys(event)) {
				expect(allowedFields).toContain(key);
			}
		});

		it("context_fetch events contain counts, not file names", async () => {
			const tracker = createTracker();
			tracker.track({
				event: "context_fetch",
				filesRequested: 5,
				tokensReturned: 1200,
				cacheHit: false,
			});
			await tracker.flush();

			const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			const body = JSON.parse(callArgs[1].body as string);
			const event = body.events[0];

			expect(event).not.toHaveProperty("files");
			expect(event).not.toHaveProperty("filePaths");
			expect(typeof event.filesRequested).toBe("number");
		});
	});

	describe("disabled mode", () => {
		it("does not buffer events when disabled", () => {
			const tracker = createTracker({ enabled: false });
			tracker.track(toolCallEvent());
			expect(tracker.pendingCount).toBe(0);
		});
	});

	describe("network resilience", () => {
		it("silently handles fetch failures", async () => {
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

			const tracker = createTracker();
			tracker.track(toolCallEvent());

			const flushed = await tracker.flush();
			expect(flushed).toBe(0); // Events lost, no error thrown
		});
	});

	describe("shutdown", () => {
		it("flushes remaining events on shutdown", async () => {
			const tracker = createTracker();
			tracker.track(toolCallEvent());
			tracker.track(toolCallEvent());

			await tracker.shutdown();

			expect(tracker.pendingCount).toBe(0);
			expect(fetch).toHaveBeenCalledTimes(1);
		});
	});

	describe("request format", () => {
		it("sends events with correct headers and body structure", async () => {
			const tracker = createTracker({ apiKey: "test-key-123" });
			tracker.track(toolCallEvent());
			await tracker.flush();

			const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			const [url, options] = callArgs;

			expect(url).toBe("https://test.example.com/telemetry");
			expect(options.method).toBe("POST");
			expect(options.headers["Content-Type"]).toBe("application/json");
			expect(options.headers.Authorization).toBe("Bearer test-key-123");

			const body = JSON.parse(options.body as string);
			expect(body).toHaveProperty("events");
			expect(body).toHaveProperty("ts");
			expect(Array.isArray(body.events)).toBe(true);
		});

		it("omits Authorization header when no apiKey provided", async () => {
			const tracker = createTracker();
			tracker.track(toolCallEvent());
			await tracker.flush();

			const callArgs = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
			const options = callArgs[1];
			expect(options.headers).not.toHaveProperty("Authorization");
		});
	});
});
