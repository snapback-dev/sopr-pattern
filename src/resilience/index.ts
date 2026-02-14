/**
 * Resilience -- barrel export.
 *
 * Re-exports every public API from the resilience sub-modules so that
 * consumers can import from a single path:
 *
 * ```ts
 * import { withResilience, ConcurrencyLimiter, ConsoleLogger } from "./resilience/index.js";
 * ```
 *
 * @module resilience
 */

// Circuit breaker
export {
  type CircuitBreakerConfig,
  type CircuitState,
  type CircuitStateInfo,
  type BreakerRegistry,
  createBreakerRegistry,
} from "./circuit-breaker.js";

// Retry
export { type RetryConfig, withRetry } from "./retry.js";

// Concurrency limiter
export { type ConcurrencyConfig, ConcurrencyLimiter } from "./concurrency-limiter.js";

// Graceful degradation & logging
export {
  type Logger,
  type GracefulDegradationOptions,
  ConsoleLogger,
  withGracefulDegradation,
} from "./graceful.js";

// Composer
export { type ResilienceConfig, withResilience } from "./compose.js";
