/**
 * Default Implementations — Swappable implementations of port interfaces.
 *
 * These adapters ship with the OSS core and provide sensible defaults.
 * Replace them with your own implementations for production use.
 *
 * @module adapters
 */

export { ConsoleLoggerAdapter } from "./console-logger.js";
export { InMemoryStorage } from "./in-memory-storage.js";
export { LocalRouter } from "./local-router.js";
export { NoOpTelemetry } from "./no-op-telemetry.js";
