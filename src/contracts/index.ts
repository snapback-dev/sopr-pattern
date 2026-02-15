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
export type { CreateContextInput, ToolContext } from "./context.js";
export { createToolContext } from "./context.js";
// Dependency Graph (composition root consumes for wiring order)
export type { ServiceDependency } from "./dependency-graph.js";
export {
  hasCycle,
  SERVICE_ADJACENCY,
  SERVICE_DEPENDENCY_GRAPH,
  SERVICE_INIT_ORDER,
  topologicalSort,
} from "./dependency-graph.js";

// Service Interfaces (Layer 3 consumes for orchestration, Layer 4 implements)
export type {
  BuildValidationInput,
  BuildValidationResult,
  CachedError,
  CachedPattern,
  CircularDependency,
  CircularDepsInput,
  CircularDepsResult,
  CoverageInput,
  CoverageResult,
  CreateSnapshotInput,
  DeadExport,
  DependencyGraphInput,
  DependencyGraphResult,
  Diagnostic,
  EnrichContextInput,
  EnrichmentContext,
  ErrorCacheInput,
  ErrorCacheResult,
  EvolutionInput,
  EvolutionResult,
  EvolutionSnapshot,
  FileCluster,
  FileGraphInput,
  FileGraphResult,
  FinalizeSnapshotInput,
  FinalizeSnapshotResult,
  GetSnapshotInput,
  GitCommit,
  GitContext,
  GitContextInput,
  GitHubContext,
  GitHubContextInput,
  GitHubIssue,
  GitHubPR,
  GraphEdge,
  GraphHealthInput,
  GraphHealthResult,
  GraphNode,
  HealthScore,
  HealthScoreInput,
  // ICacheService
  ICacheService,
  // IGraphService
  IGraphService,
  // IIntegrationService
  IIntegrationService,
  // ILearningService
  ILearningService,
  IntegrationConfigEntry,
  IntegrationConfigInput,
  IntegrationConfigResult,
  IntegrationHealth,
  IntegrationHealthInput,
  // ISecurityService
  ISecurityService,
  // ISnapshotService
  ISnapshotService,
  // IValidationService
  IValidationService,
  Learning,
  LearningType,
  LoadLearningsInput,
  LoadLearningsResult,
  OrphanDetectionInput,
  OrphanDetectionResult,
  PatternCacheInput,
  PatternCacheResult,
  PatternValidationInput,
  PatternValidationResult,
  RecordLearningsInput,
  RecordLearningsResult,
  RiskScore,
  SaveLearningInput,
  SearchLearningsInput,
  SearchLearningsResult,
  SecurityFinding,
  SecurityScanInput,
  SecurityScanResult,
  SecuritySeverity,
  SentryContext,
  SentryContextInput,
  SentryError,
  // Service Container
  ServiceContainer,
  ServiceResult,
  // Shared
  Severity,
  Snapshot,
  SnapshotState,
  ValidationInput,
  ValidationResult,
} from "./services.js";
// Tool Consolidation Map (Layer 2 consumes for registration)
export type {
  ExecutionStrategy,
  ModeDefinition,
  ModeDefinitionFor,
  ModeName,
  ServiceName,
  ToolMapEntry,
  ToolName,
} from "./tool-map.js";
export { TOOL_COUNT, TOOL_MAP, TOTAL_MODE_COUNT } from "./tool-map.js";
