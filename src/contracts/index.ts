/**
 * Contracts barrel export.
 *
 * This module re-exports every type, interface, const, and utility
 * defined in the contracts layer. Other SOPR layers import from
 * `../contracts/index.js` (or `../contracts`) rather than reaching
 * into individual files.
 *
 * @module contracts
 */

// Context (Layer 1 creates, Layers 3-4 consume)
export type { ToolContext, CreateContextInput } from "./context.js";
export { createToolContext } from "./context.js";

// Tool Consolidation Map (Layer 2 consumes for registration)
export type {
  ExecutionStrategy,
  ServiceName,
  ModeDefinition,
  ToolMapEntry,
  ToolName,
  ModeName,
  ModeDefinitionFor,
} from "./tool-map.js";
export { TOOL_MAP, TOTAL_MODE_COUNT, TOOL_COUNT } from "./tool-map.js";

// Service Interfaces (Layer 3 consumes for orchestration, Layer 4 implements)
export type {
  // Shared
  Severity,
  Diagnostic,
  ServiceResult,
  RiskScore,

  // ISnapshotService
  ISnapshotService,
  CreateSnapshotInput,
  Snapshot,
  GetSnapshotInput,
  SnapshotState,
  FinalizeSnapshotInput,
  FinalizeSnapshotResult,

  // IValidationService
  IValidationService,
  ValidationInput,
  ValidationResult,
  PatternValidationInput,
  PatternValidationResult,
  BuildValidationInput,
  BuildValidationResult,
  CoverageInput,
  CoverageResult,
  HealthScoreInput,
  HealthScore,
  EvolutionInput,
  EvolutionResult,
  EvolutionSnapshot,

  // ILearningService
  ILearningService,
  LearningType,
  Learning,
  LoadLearningsInput,
  LoadLearningsResult,
  SaveLearningInput,
  SearchLearningsInput,
  SearchLearningsResult,
  RecordLearningsInput,
  RecordLearningsResult,

  // IIntegrationService
  IIntegrationService,
  GitContext,
  GitCommit,
  GitContextInput,
  SentryContext,
  SentryError,
  SentryContextInput,
  GitHubContext,
  GitHubPR,
  GitHubIssue,
  GitHubContextInput,
  EnrichmentContext,
  EnrichContextInput,
  IntegrationHealthInput,
  IntegrationHealth,
  IntegrationConfigInput,
  IntegrationConfigResult,
  IntegrationConfigEntry,

  // ISecurityService
  ISecurityService,
  SecuritySeverity,
  SecurityFinding,
  SecurityScanInput,
  SecurityScanResult,

  // IGraphService
  IGraphService,
  GraphNode,
  GraphEdge,
  CircularDependency,
  DependencyGraphInput,
  DependencyGraphResult,
  CircularDepsInput,
  CircularDepsResult,
  OrphanDetectionInput,
  OrphanDetectionResult,
  DeadExport,
  FileGraphInput,
  FileGraphResult,
  FileCluster,
  GraphHealthInput,
  GraphHealthResult,

  // ICacheService
  ICacheService,
  CachedError,
  CachedPattern,
  ErrorCacheInput,
  ErrorCacheResult,
  PatternCacheInput,
  PatternCacheResult,

  // Service Container
  ServiceContainer,
} from "./services.js";

// Dependency Graph (composition root consumes for wiring order)
export type { ServiceDependency } from "./dependency-graph.js";
export {
  SERVICE_DEPENDENCY_GRAPH,
  SERVICE_INIT_ORDER,
  SERVICE_ADJACENCY,
  hasCycle,
  topologicalSort,
} from "./dependency-graph.js";
