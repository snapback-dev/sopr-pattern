/**
 * Retry Utility
 *
 * Exponential-backoff retry with optional jitter. Wraps any async function
 * and transparently retries on transient failures.
 *
 * Design constraints:
 *   - Pure function (no module-level state).
 *   - Jitter prevents thundering-herd on shared external services.
 *   - Caller may supply a predicate (`retryOn`) to filter which errors
 *     are retryable (e.g. skip 4xx HTTP errors).
 *
 * @module resilience/retry
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Tuning knobs for retry behaviour. */
export interface RetryConfig {
  /** Maximum number of retry attempts (does not count the initial call). */
  maxRetries: number;
  /** Base delay in milliseconds before the first retry. */
  baseDelayMs: number;
  /** Upper bound on computed delay to prevent unreasonable waits. */
  maxDelayMs: number;
  /** When true, add random jitter to the delay to spread out retries. */
  jitter: boolean;
  /**
   * Optional predicate. When provided, only errors for which this returns
   * `true` will trigger a retry. All other errors propagate immediately.
   */
  retryOn?: (error: unknown) => boolean;
}

/** Safe production defaults. */
const DEFAULTS: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  jitter: true,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the delay for a given attempt using truncated exponential backoff.
 *
 * Formula: min(baseDelay * 2^attempt, maxDelay) + optional jitter.
 * Jitter is uniformly distributed over [0, computedDelay) so the result
 * is always in [computedDelay, 2 * computedDelay).
 */
function computeDelay(attempt: number, config: RetryConfig): number {
  const exponential = config.baseDelayMs * 2 ** attempt;
  const capped = Math.min(exponential, config.maxDelayMs);

  if (!config.jitter) return capped;

  // Full jitter: uniform random in [0, capped]
  return capped + Math.floor(Math.random() * capped);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute `fn` with automatic retry on failure.
 *
 * The initial invocation is **not** counted as a retry. With the default
 * `maxRetries: 3` the function may execute up to 4 times total.
 *
 * @param fn     - The async operation to attempt.
 * @param config - Optional overrides for retry behaviour.
 * @returns The resolved value of `fn`.
 * @throws The last error encountered after all retries are exhausted,
 *         or the first error that fails the `retryOn` predicate.
 *
 * @example
 * ```ts
 * const data = await withRetry(
 *   () => fetch("https://api.example.com/data").then(r => r.json()),
 *   { maxRetries: 5, baseDelayMs: 500 },
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config?: Partial<RetryConfig>,
): Promise<T> {
  const resolved: RetryConfig = { ...DEFAULTS, ...config };
  let lastError: unknown;

  for (let attempt = 0; attempt <= resolved.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // If a retryOn predicate is supplied and it rejects this error,
      // propagate immediately -- no further retries.
      if (resolved.retryOn && !resolved.retryOn(error)) {
        throw error;
      }

      // If this was the last allowed attempt, do not sleep -- just throw.
      if (attempt === resolved.maxRetries) {
        break;
      }

      const delayMs = computeDelay(attempt, resolved);
      await sleep(delayMs);
    }
  }

  // All attempts exhausted.
  throw lastError;
}
