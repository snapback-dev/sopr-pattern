/**
 * Telemetry Tracker — Privacy-first usage analytics for the data flywheel.
 *
 * Captures metadata-only events (tool calls, context fetches, undo triggers,
 * session patterns) and flushes them in batches to a remote endpoint.
 *
 * Design constraints:
 *   - ZERO code content or file paths in events (privacy-first).
 *   - Best-effort delivery — silent failures, no retries.
 *   - Buffered batching to minimize network overhead.
 *   - Works identically in free and pro tiers.
 *
 * SPDX-License-Identifier: MIT
 *
 * @module telemetry/tracker
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Event Schemas
// ---------------------------------------------------------------------------

export const ToolCallEventSchema = z.object({
  event: z.literal("tool_call"),
  /** Tool name (e.g. "snap", "check"). */
  tool: z.string(),
  /** Mode within the tool (e.g. "start", "quick"). */
  mode: z.string(),
  /** Execution tier at time of call. */
  tier: z.enum(["free", "pro"]),
  /** Wall-clock duration in milliseconds. */
  durationMs: z.number().nonnegative(),
  /** Whether the call completed without error. */
  success: z.boolean(),
});

export const ContextFetchEventSchema = z.object({
  event: z.literal("context_fetch"),
  /** Number of files requested in this context fetch. */
  filesRequested: z.number().int().nonnegative(),
  /** Approximate token count returned. */
  tokensReturned: z.number().int().nonnegative(),
  /** Whether the result was served from cache. */
  cacheHit: z.boolean(),
});

export const UndoTriggeredEventSchema = z.object({
  event: z.literal("undo_triggered"),
  /** Number of files affected by the undo. */
  filesAffected: z.number().int().nonnegative(),
  /** Number of conversation turns rolled back. */
  turnsRolledBack: z.number().int().nonnegative(),
  /** What triggered the undo. */
  trigger: z.enum(["user_explicit", "ai_suggested", "error_recovery"]),
});

export const SessionPatternEventSchema = z.object({
  event: z.literal("session_pattern"),
  /** Total session duration in milliseconds. */
  sessionDurationMs: z.number().nonnegative(),
  /** Number of tool calls in the session. */
  toolCallCount: z.number().int().nonnegative(),
  /** Count of unique files touched (not paths — just count). */
  uniqueFilesTouched: z.number().int().nonnegative(),
  /** Number of undo operations in the session. */
  undoCount: z.number().int().nonnegative(),
});

export const TelemetryEventSchema = z.discriminatedUnion("event", [
  ToolCallEventSchema,
  ContextFetchEventSchema,
  UndoTriggeredEventSchema,
  SessionPatternEventSchema,
]);

export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type ContextFetchEvent = z.infer<typeof ContextFetchEventSchema>;
export type UndoTriggeredEvent = z.infer<typeof UndoTriggeredEventSchema>;
export type SessionPatternEvent = z.infer<typeof SessionPatternEventSchema>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface TelemetryConfig {
  /** Remote endpoint for event submission. */
  readonly endpoint: string;
  /** Optional API key for authenticated submission. */
  readonly apiKey?: string;
  /** Flush interval in milliseconds (default: 30s). */
  readonly flushIntervalMs: number;
  /** Maximum buffer size before forced flush (default: 50). */
  readonly maxBufferSize: number;
  /** Whether telemetry collection is enabled (default: true). */
  readonly enabled: boolean;
}

const DEFAULT_CONFIG: TelemetryConfig = {
  endpoint: "https://api.snapback.dev/telemetry",
  flushIntervalMs: 30_000,
  maxBufferSize: 50,
  enabled: true,
};

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export class TelemetryTracker {
  private readonly buffer: TelemetryEvent[] = [];
  private readonly config: TelemetryConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<TelemetryConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.enabled && this.config.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => void this.flush(), this.config.flushIntervalMs);
      // Allow process to exit even if timer is active
      if (this.flushTimer && typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
        this.flushTimer.unref();
      }
    }
  }

  /**
   * Buffer a telemetry event for eventual flush.
   *
   * Events are validated against the schema before buffering.
   * Invalid events are silently dropped.
   */
  track(event: TelemetryEvent): void {
    if (!this.config.enabled) return;

    const parsed = TelemetryEventSchema.safeParse(event);
    if (!parsed.success) return;

    this.buffer.push(parsed.data);

    if (this.buffer.length >= this.config.maxBufferSize) {
      void this.flush();
    }
  }

  /**
   * Flush buffered events to the remote endpoint.
   *
   * Best-effort: silently swallows network errors.
   * Returns the number of events flushed.
   */
  async flush(): Promise<number> {
    if (this.buffer.length === 0) return 0;

    const events = this.buffer.splice(0, this.buffer.length);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.config.apiKey) {
        headers.Authorization = `Bearer ${this.config.apiKey}`;
      }

      await fetch(this.config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ events, ts: Date.now() }),
        signal: AbortSignal.timeout(5_000),
      });

      return events.length;
    } catch {
      // Best-effort: silently drop on network failure.
      // Events are already removed from buffer — acceptable loss
      // for telemetry that must never block the main flow.
      return 0;
    }
  }

  /** Return current buffer size (for testing/monitoring). */
  get pendingCount(): number {
    return this.buffer.length;
  }

  /** Drain buffer and stop periodic flushing. */
  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }
}
