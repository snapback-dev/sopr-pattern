/**
 * Circuit Breaker Wrapper
 *
 * Provides a typed, ergonomic API around the `opossum` circuit breaker library.
 * Breakers are cached by name so that the same logical breaker is reused across
 * call sites -- e.g. every caller that wraps "github-api" shares one breaker
 * instance and its failure statistics.
 *
 * Design constraints:
 *   - Factory functions return new caches; no module-level mutable state.
 *   - All configuration fields have safe production defaults.
 *   - State queries are O(1) and safe to call from health-check endpoints.
 *
 * @module resilience/circuit-breaker
 */

import CircuitBreaker from "opossum";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Tuning knobs for a circuit breaker instance. */
export interface CircuitBreakerConfig {
  /** Maximum milliseconds the wrapped function may run before being timed out. */
  timeoutMs: number;
  /** Percentage of failures (0-100) that trips the breaker open. */
  errorThresholdPercentage: number;
  /** Milliseconds to wait in the open state before probing with a half-open attempt. */
  resetTimeoutMs: number;
  /** Minimum number of requests in the rolling window before the breaker can trip. */
  volumeThreshold: number;
}

/** Safe production defaults. */
const DEFAULTS: CircuitBreakerConfig = {
  timeoutMs: 5_000,
  errorThresholdPercentage: 50,
  resetTimeoutMs: 30_000,
  volumeThreshold: 10,
};

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

/** The three observable states of a circuit breaker. */
export type CircuitState = "open" | "closed" | "half-open";

/** Snapshot of a single breaker's state, suitable for serialisation. */
export interface CircuitStateInfo {
  name: string;
  state: CircuitState;
}

// ---------------------------------------------------------------------------
// Breaker registry
// ---------------------------------------------------------------------------

/**
 * A registry that owns and caches circuit breaker instances by name.
 *
 * Obtain one via {@link createBreakerRegistry}. The registry is the
 * single source of truth for all breaker state within a process.
 */
export interface BreakerRegistry {
  /**
   * Create (or retrieve from cache) a circuit breaker for the given name.
   *
   * If a breaker with `name` already exists the cached instance is returned
   * and `fn` / `config` are ignored. This is intentional: the first caller
   * to register a name "wins", and all subsequent callers share its breaker.
   */
  createCircuitBreaker<TInput, TOutput>(
    name: string,
    fn: (input: TInput) => Promise<TOutput>,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreaker<[TInput], TOutput>;

  /**
   * Return a plain async function that delegates to a circuit breaker.
   *
   * This is the preferred API for service code: it hides the breaker
   * entirely and lets callers treat it as a normal async function.
   */
  withCircuitBreaker<TInput, TOutput>(
    name: string,
    fn: (input: TInput) => Promise<TOutput>,
    config?: Partial<CircuitBreakerConfig>,
  ): (input: TInput) => Promise<TOutput>;

  /** Return the current state of a named breaker, or `undefined` if not registered. */
  getCircuitState(name: string): CircuitState | undefined;

  /** Return a snapshot of every registered breaker's state. */
  getAllCircuitStates(): ReadonlyArray<CircuitStateInfo>;

  /** Manually reset (close) a named breaker. No-op if the name is unknown. */
  resetCircuitBreaker(name: string): void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveState(breaker: CircuitBreaker): CircuitState {
  if (breaker.opened) return "open";
  if (breaker.halfOpen) return "half-open";
  return "closed";
}

function mergeConfig(
  partial?: Partial<CircuitBreakerConfig>,
): CircuitBreakerConfig {
  return { ...DEFAULTS, ...partial };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an isolated breaker registry.
 *
 * Each registry maintains its own `Map` of named breakers. In production
 * you will typically create one registry per process and pass it through
 * your dependency-injection layer.
 *
 * @example
 * ```ts
 * const registry = createBreakerRegistry();
 *
 * const fetchUser = registry.withCircuitBreaker(
 *   "user-service",
 *   async (id: string) => fetchFromApi(`/users/${id}`),
 *   { timeoutMs: 3_000 },
 * );
 *
 * const user = await fetchUser("u_123");
 * ```
 */
export function createBreakerRegistry(): BreakerRegistry {
  const breakers = new Map<string, CircuitBreaker>();

  function getOrCreate<TInput, TOutput>(
    name: string,
    fn: (input: TInput) => Promise<TOutput>,
    config?: Partial<CircuitBreakerConfig>,
  ): CircuitBreaker<[TInput], TOutput> {
    const existing = breakers.get(name);
    if (existing) {
      return existing as CircuitBreaker<[TInput], TOutput>;
    }

    const resolved = mergeConfig(config);

    const breaker = new CircuitBreaker<[TInput], TOutput>(
      (input: TInput) => fn(input),
      {
        timeout: resolved.timeoutMs,
        errorThresholdPercentage: resolved.errorThresholdPercentage,
        resetTimeout: resolved.resetTimeoutMs,
        volumeThreshold: resolved.volumeThreshold,
        name,
      },
    );

    breakers.set(name, breaker as CircuitBreaker);
    return breaker;
  }

  return {
    createCircuitBreaker<TInput, TOutput>(
      name: string,
      fn: (input: TInput) => Promise<TOutput>,
      config?: Partial<CircuitBreakerConfig>,
    ): CircuitBreaker<[TInput], TOutput> {
      return getOrCreate(name, fn, config);
    },

    withCircuitBreaker<TInput, TOutput>(
      name: string,
      fn: (input: TInput) => Promise<TOutput>,
      config?: Partial<CircuitBreakerConfig>,
    ): (input: TInput) => Promise<TOutput> {
      const breaker = getOrCreate<TInput, TOutput>(name, fn, config);
      return (input: TInput) => breaker.fire(input);
    },

    getCircuitState(name: string): CircuitState | undefined {
      const breaker = breakers.get(name);
      if (!breaker) return undefined;
      return resolveState(breaker);
    },

    getAllCircuitStates(): ReadonlyArray<CircuitStateInfo> {
      const states: CircuitStateInfo[] = [];
      for (const [name, breaker] of breakers) {
        states.push({ name, state: resolveState(breaker) });
      }
      return states;
    },

    resetCircuitBreaker(name: string): void {
      const breaker = breakers.get(name);
      if (breaker) {
        breaker.close();
      }
    },
  };
}
