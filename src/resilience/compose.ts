/**
 * Resilience Composer
 *
 * Combines multiple resilience patterns -- circuit breaker, retry, concurrency
 * limiting, and graceful degradation -- into a single wrapped function.
 *
 * The composition order (innermost to outermost) is:
 *
 *   1. **Original function** -- the raw external call.
 *   2. **Retry** -- retries transient failures with exponential backoff.
 *   3. **Concurrency limiter** -- bounds parallelism to protect the upstream.
 *   4. **Circuit breaker** -- trips open on sustained failure to shed load.
 *   5. **Graceful degradation** -- converts terminal failures to a fallback.
 *
 * This layering ensures that:
 *   - Retries happen *inside* the circuit breaker so each breaker "fire"
 *     represents one logical attempt (possibly with internal retries).
 *   - The concurrency limiter gates entry to the retry loop so we never
 *     overwhelm an already-struggling upstream.
 *   - Graceful degradation wraps everything so the caller never sees an
 *     exception from the resilience stack itself.
 *
 * Design constraints:
 *   - Pure function (creates and returns a closure, no module-level state).
 *   - Each call to {@link withResilience} creates its own limiter and
 *     registers its own breaker in the provided (or internal) registry.
 *   - All sub-patterns are independently configurable and individually
 *     optional (though all are enabled by default for maximum safety).
 *
 * @module resilience/compose
 */

import { type BreakerRegistry, type CircuitBreakerConfig, createBreakerRegistry } from "./circuit-breaker.js";
import { type ConcurrencyConfig, ConcurrencyLimiter } from "./concurrency-limiter.js";
import { type Logger, withGracefulDegradation } from "./graceful.js";
import { type RetryConfig, withRetry } from "./retry.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Full set of knobs for {@link withResilience}. */
export interface ResilienceConfig {
	/** Circuit breaker tuning. Pass `false` to disable. */
	circuitBreaker?: Partial<CircuitBreakerConfig> | false;
	/** Retry tuning. Pass `false` to disable. */
	retry?: Partial<RetryConfig> | false;
	/** Concurrency limiter tuning. Pass `false` to disable. */
	concurrency?: Partial<ConcurrencyConfig> | false;
	/**
	 * When `true` (the default), failures from the resilience stack
	 * are caught and a `null` fallback is returned.
	 * When `false`, errors propagate to the caller.
	 */
	graceful?: boolean;
	/** Logger shared across all resilience layers. */
	logger?: Logger;
	/**
	 * An existing breaker registry to register the circuit breaker in.
	 * When omitted, a private registry is created. Pass a shared registry
	 * if you want health endpoints to see this breaker's state.
	 */
	registry?: BreakerRegistry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compose a resilient wrapper around an async function.
 *
 * @param name   - Logical name for the external dependency (used as the
 *                 circuit breaker key and in log messages).
 * @param fn     - The raw async function to protect.
 * @param config - Optional per-pattern configuration overrides.
 * @returns A wrapped function that applies the full resilience stack.
 *
 * @example
 * ```ts
 * const fetchUser = withResilience(
 *   "user-service",
 *   async (id: string) => httpGet(`/users/${id}`),
 *   {
 *     circuitBreaker: { timeoutMs: 3_000 },
 *     retry: { maxRetries: 2 },
 *     concurrency: { maxConcurrent: 5 },
 *     graceful: true,
 *   },
 * );
 *
 * // Returns the user on success, or `null` after all retries and the
 * // circuit breaker are exhausted.
 * const user = await fetchUser("u_42");
 * ```
 */
export function withResilience<TInput, TOutput>(
	name: string,
	fn: (input: TInput) => Promise<TOutput>,
	config?: ResilienceConfig,
): (input: TInput) => Promise<TOutput | null> {
	const logger = config?.logger;

	// Extract config values, normalising `false` (disabled) to `undefined`.
	const retryOpt = config?.retry === false ? undefined : config?.retry;
	const concurrencyOpt = config?.concurrency === false ? undefined : config?.concurrency;
	const breakerOpt = config?.circuitBreaker === false ? undefined : config?.circuitBreaker;

	const retryDisabled = config?.retry === false;
	const concurrencyDisabled = config?.concurrency === false;
	const breakerDisabled = config?.circuitBreaker === false;

	// -- Layer 1: Build the retry wrapper (innermost) -----------------------
	let retryWrapped: (input: TInput) => Promise<TOutput>;

	if (retryDisabled) {
		retryWrapped = fn;
	} else {
		retryWrapped = (input: TInput) => withRetry(() => fn(input), retryOpt);
	}

	// -- Layer 2: Concurrency limiter --------------------------------------
	let concurrencyWrapped: (input: TInput) => Promise<TOutput>;

	if (concurrencyDisabled) {
		concurrencyWrapped = retryWrapped;
	} else {
		const limiter = new ConcurrencyLimiter(concurrencyOpt);
		concurrencyWrapped = (input: TInput) => limiter.execute(() => retryWrapped(input));
	}

	// -- Layer 3: Circuit breaker -------------------------------------------
	let breakerWrapped: (input: TInput) => Promise<TOutput>;

	if (breakerDisabled) {
		breakerWrapped = concurrencyWrapped;
	} else {
		const registry = config?.registry ?? createBreakerRegistry();
		breakerWrapped = registry.withCircuitBreaker<TInput, TOutput>(name, concurrencyWrapped, breakerOpt);
	}

	// -- Layer 4: Graceful degradation (outermost) --------------------------
	const useGraceful = config?.graceful !== false;

	if (useGraceful) {
		return withGracefulDegradation<TInput, TOutput>(breakerWrapped, {
			logger,
		});
	}

	// When graceful is disabled, the caller gets back a function that may
	// throw. We still type it as `TOutput | null` for a uniform signature,
	// but in practice it will always return `TOutput` or throw.
	return breakerWrapped as (input: TInput) => Promise<TOutput | null>;
}
