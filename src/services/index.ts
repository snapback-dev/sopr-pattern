/**
 * Services Barrel Export
 *
 * Re-exports all service implementations, configurations, adapters,
 * and the logger from the services layer.
 *
 * Other SOPR layers import from `../services/index.js` rather than
 * reaching into individual files.
 *
 * @module services
 */

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export type { StorageAdapter } from "./adapters.js";
export { InMemoryStorage } from "./adapters.js";

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export type { Logger, LogContext } from "./logger.js";
export { ConsoleLogger, NoOpLogger } from "./logger.js";

// ---------------------------------------------------------------------------
// 1. Snapshot Service
// ---------------------------------------------------------------------------

export type { SnapshotServiceConfig } from "./snapshot-service.js";
export { SnapshotServiceImpl } from "./snapshot-service.js";

// ---------------------------------------------------------------------------
// 2. Validation Service
// ---------------------------------------------------------------------------

export type {
  ValidationServiceConfig,
  CommandRunner,
} from "./validation-service.js";
export { ValidationServiceImpl } from "./validation-service.js";

// ---------------------------------------------------------------------------
// 3. Learning Service
// ---------------------------------------------------------------------------

export type { LearningServiceConfig } from "./learning-service.js";
export { LearningServiceImpl } from "./learning-service.js";

// ---------------------------------------------------------------------------
// 4. Integration Service
// ---------------------------------------------------------------------------

export type {
  IntegrationServiceConfig,
  SentryFetcher,
  GitHubFetcher,
  GitCommandRunner,
} from "./integration-service.js";
export { IntegrationServiceImpl } from "./integration-service.js";

// ---------------------------------------------------------------------------
// 5. Security Service
// ---------------------------------------------------------------------------

export type {
  SecurityServiceConfig,
  FileReader as SecurityFileReader,
} from "./security-service.js";
export { SecurityServiceImpl } from "./security-service.js";

// ---------------------------------------------------------------------------
// 6. Graph Service
// ---------------------------------------------------------------------------

export type {
  GraphServiceConfig,
  FileReader as GraphFileReader,
  DirectoryLister,
  PathChecker,
} from "./graph-service.js";
export { GraphServiceImpl } from "./graph-service.js";

// ---------------------------------------------------------------------------
// 7. Cache Service
// ---------------------------------------------------------------------------

export type { CacheServiceConfig } from "./cache-service.js";
export { CacheServiceImpl } from "./cache-service.js";
