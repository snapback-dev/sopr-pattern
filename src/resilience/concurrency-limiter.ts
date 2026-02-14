/**
 * Concurrency Limiter
 *
 * Bounds the number of concurrent async operations to protect external
 * services from being overwhelmed. Excess callers are queued and released
 * in FIFO order as in-flight operations complete.
 *
 * Design constraints:
 *   - Class-based (maintains mutable slot & queue state by necessity).
 *   - Supports an optional queue timeout to prevent unbounded waiting.
 *   - Fully async-safe: the queue is drained on microtask boundaries.
 *
 * @module resilience/concurrency-limiter
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Tuning knobs for the concurrency limiter. */
export interface ConcurrencyConfig {
  /** Maximum number of operations that may execute concurrently. */
  maxConcurrent: number;
  /**
   * Optional maximum time (ms) a caller may wait in the queue.
   * When exceeded the returned promise rejects with a timeout error.
   * If omitted or `undefined`, callers wait indefinitely.
   */
  queueTimeout?: number;
}

const DEFAULTS: ConcurrencyConfig = {
  maxConcurrent: 10,
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface QueueEntry {
  resolve: () => void;
  reject: (reason: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * A concurrency limiter that queues excess work and releases it in FIFO
 * order as slots become available.
 *
 * @example
 * ```ts
 * const limiter = new ConcurrencyLimiter({ maxConcurrent: 5 });
 *
 * // All 20 calls will execute, but at most 5 at a time.
 * const results = await Promise.all(
 *   ids.map(id => limiter.execute(() => fetchUser(id))),
 * );
 * ```
 */
export class ConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private readonly queueTimeout: number | undefined;
  private runningCount = 0;
  private readonly queue: QueueEntry[] = [];

  constructor(config?: Partial<ConcurrencyConfig>) {
    const resolved = { ...DEFAULTS, ...config };
    this.maxConcurrent = resolved.maxConcurrent;
    this.queueTimeout = resolved.queueTimeout;
  }

  // -----------------------------------------------------------------------
  // Public
  // -----------------------------------------------------------------------

  /**
   * Execute `fn` when a concurrency slot is available.
   *
   * If fewer than `maxConcurrent` operations are currently running, `fn`
   * starts immediately. Otherwise the call is queued and resolved in FIFO
   * order.
   *
   * @param fn - The async operation to execute.
   * @returns The resolved value of `fn`.
   * @throws If the queue timeout expires before a slot becomes available,
   *         or if `fn` itself throws.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  /** Number of operations currently waiting in the queue. */
  get pending(): number {
    return this.queue.length;
  }

  /** Number of operations currently executing. */
  get running(): number {
    return this.runningCount;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** Wait until a concurrency slot is available. */
  private acquire(): Promise<void> {
    if (this.runningCount < this.maxConcurrent) {
      this.runningCount++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const entry: QueueEntry = { resolve, reject };

      if (this.queueTimeout !== undefined) {
        entry.timer = setTimeout(() => {
          // Remove ourselves from the queue on timeout.
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) {
            this.queue.splice(idx, 1);
          }
          reject(
            new Error(
              `ConcurrencyLimiter: queue timeout after ${this.queueTimeout}ms`,
            ),
          );
        }, this.queueTimeout);
      }

      this.queue.push(entry);
    });
  }

  /** Release a slot and unblock the next queued caller, if any. */
  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the slot directly to the next waiter (no count change).
      if (next.timer !== undefined) {
        clearTimeout(next.timer);
      }
      next.resolve();
    } else {
      this.runningCount--;
    }
  }
}
