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
  type BreakerRegistry,
  type CircuitBreakerConfig,
  type CircuitState,
  type CircuitStateInfo,
  createBreakerRegistry,
} from "./circuit-breaker.js";
// Composer
export { type ResilienceConfig, withResilience } from "./compose.js";

// Concurrency limiter
export { type ConcurrencyConfig, ConcurrencyLimiter } from "./concurrency-limiter.js";

// Graceful degradation & logging
export {
  ConsoleLogger,
  type GracefulDegradationOptions,
  type Logger,
  withGracefulDegradation,
} from "./graceful.js";
// Retry
export { type RetryConfig, withRetry } from "./retry.js";
