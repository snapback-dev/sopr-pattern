/**
 * Service Interface Definitions
 *
 * Every service in the SOPR system is defined here as a TypeScript interface.
 * Services are the bottom layer (Layer 4) -- stateless, pure business logic
 * that receives explicit inputs and returns explicit outputs.
 *
 * Design rules:
 *   - Services depend on abstractions (injected via constructor), never
 *     on concrete implementations or singletons.
 *   - Every method has a named input type and a named output type.
 *   - Services never access ToolContext directly; the tool layer extracts
 *     what the service needs and passes it as typed parameters.
 *   - Services never throw for recoverable errors -- they return typed
 *     result objects with success/failure discriminants.
 *
 * @module contracts/services
 */

// ═══════════════════════════════════════════════════════════════════════════
// Shared Types
// ═══════════════════════════════════════════════════════════════════════════

/** Severity level for diagnostic messages. */
export type Severity = "error" | "warning" | "info";

/** A single diagnostic finding from validation, security, or graph analysis. */
export interface Diagnostic {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
}

/** Discriminated result type used across all services. */
export type ServiceResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string; readonly code: string };

/** Risk score between 0 (none) and 1 (critical). */
export type RiskScore = number;

// ═══════════════════════════════════════════════════════════════════════════
// 1. ISnapshotService
// ═══════════════════════════════════════════════════════════════════════════

/** Options for creating a new snapshot. */
export interface CreateSnapshotInput {
  readonly files: readonly string[];
  readonly workspacePath: string;
  readonly description: string;
  readonly trigger: "manual" | "auto" | "pre-commit";
  readonly metadata?: Readonly<Record<string, string>>;
}

/** A persisted snapshot record. */
export interface Snapshot {
  readonly id: string;
  readonly hash: string;
  readonly files: readonly string[];
  readonly createdAt: number;
  readonly reused: boolean;
  readonly metadata: Readonly<Record<string, string>>;
}

/** Input for retrieving snapshot state. */
export interface GetSnapshotInput {
  readonly workspacePath: string;
  readonly sessionId: string;
}

/** Summary of current snapshot state. */
export interface SnapshotState {
  readonly activeSnapshotId: string | null;
  readonly snapshotCount: number;
  readonly lastSnapshotAt: number | null;
}

/** Input for finalizing a task's snapshot. */
export interface FinalizeSnapshotInput {
  readonly workspacePath: string;
  readonly sessionId: string;
  readonly snapshotId: string;
  readonly outcome: "completed" | "abandoned" | "blocked";
}

/** Result of snapshot finalization. */
export interface FinalizeSnapshotResult {
  readonly finalized: boolean;
  readonly snapshotId: string;
  readonly duration: number;
}

/**
 * Manages snapshot creation, retrieval, and lifecycle.
 *
 * Used by: `snap.start`, `snap.context`, `snap.end`
 */
export interface ISnapshotService {
  /** Create a snapshot from the specified files. */
  create(input: CreateSnapshotInput): Promise<ServiceResult<Snapshot>>;

  /** Retrieve the current snapshot state for a session. */
  getState(input: GetSnapshotInput): Promise<ServiceResult<SnapshotState>>;

  /** Finalize a snapshot when a task completes. */
  finalize(input: FinalizeSnapshotInput): Promise<ServiceResult<FinalizeSnapshotResult>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. IValidationService
// ═══════════════════════════════════════════════════════════════════════════

/** Scope for a validation run. */
export interface ValidationInput {
  readonly workspacePath: string;
  readonly files?: readonly string[];
  readonly fix?: boolean;
}

/** Result of a validation pass. */
export interface ValidationResult {
  readonly passed: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly duration: number;
}

/** Input for pattern-specific validation. */
export interface PatternValidationInput {
  readonly workspacePath: string;
  readonly code: string;
  readonly filePath: string;
}

/** Result of pattern validation. */
export interface PatternValidationResult {
  readonly compliant: boolean;
  readonly violations: readonly Diagnostic[];
  readonly suggestions: readonly string[];
}

/** Input for build verification. */
export interface BuildValidationInput {
  readonly workspacePath: string;
}

/** Result of build verification. */
export interface BuildValidationResult {
  readonly success: boolean;
  readonly diagnostics: readonly Diagnostic[];
  readonly duration: number;
}

/** Input for test coverage evaluation. */
export interface CoverageInput {
  readonly workspacePath: string;
  readonly threshold?: number;
}

/** Result of coverage evaluation. */
export interface CoverageResult {
  readonly totalPercent: number;
  readonly filesCovered: number;
  readonly filesTotal: number;
  readonly belowThreshold: readonly string[];
  readonly passed: boolean;
}

/** Input for codebase health scoring. */
export interface HealthScoreInput {
  readonly workspacePath: string;
}

/** Composite health score. */
export interface HealthScore {
  readonly overall: number;
  readonly dimensions: Readonly<Record<string, number>>;
  readonly trend: "improving" | "stable" | "declining";
}

/** Input for evolution trend analysis. */
export interface EvolutionInput {
  readonly workspacePath: string;
  readonly since?: number;
}

/** Result of evolution analysis. */
export interface EvolutionResult {
  readonly snapshots: readonly EvolutionSnapshot[];
  readonly trend: "improving" | "stable" | "declining";
}

/** A single point in the evolution timeline. */
export interface EvolutionSnapshot {
  readonly timestamp: number;
  readonly score: number;
  readonly errorCount: number;
  readonly warningCount: number;
}

/**
 * Validates code quality, patterns, builds, coverage, and health.
 *
 * Used by: `snap.check`, `check.quick`, `check.full`, `check.patterns`,
 *          `check.build`, `check.coverage`, `check.health`, `check.evolution`
 */
export interface IValidationService {
  /** Run a quick lint + typecheck pass. */
  quickCheck(input: ValidationInput): Promise<ServiceResult<ValidationResult>>;

  /** Run comprehensive validation (types, lint, patterns). */
  fullCheck(input: ValidationInput): Promise<ServiceResult<ValidationResult>>;

  /** Validate code against project-specific patterns. */
  checkPatterns(input: PatternValidationInput): Promise<ServiceResult<PatternValidationResult>>;

  /** Verify the project builds cleanly. */
  checkBuild(input: BuildValidationInput): Promise<ServiceResult<BuildValidationResult>>;

  /** Evaluate test coverage. */
  checkCoverage(input: CoverageInput): Promise<ServiceResult<CoverageResult>>;

  /** Compute codebase health score. */
  computeHealthScore(input: HealthScoreInput): Promise<ServiceResult<HealthScore>>;

  /** Analyze quality evolution over time. */
  analyzeEvolution(input: EvolutionInput): Promise<ServiceResult<EvolutionResult>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. ILearningService
// ═══════════════════════════════════════════════════════════════════════════

/** Category of a learning entry. */
export type LearningType = "pattern" | "pitfall" | "efficiency" | "discovery" | "workflow";

/** A single learning record. */
export interface Learning {
  readonly id: string;
  readonly trigger: string;
  readonly action: string;
  readonly type: LearningType;
  readonly createdAt: number;
  readonly accessCount: number;
}

/** Input for loading context-relevant learnings. */
export interface LoadLearningsInput {
  readonly workspacePath: string;
  readonly intent?: string;
  readonly filePaths?: readonly string[];
  readonly limit?: number;
}

/** Result of a learning load operation. */
export interface LoadLearningsResult {
  readonly learnings: readonly Learning[];
  readonly totalAvailable: number;
}

/** Input for persisting a new learning. */
export interface SaveLearningInput {
  readonly workspacePath: string;
  readonly trigger: string;
  readonly action: string;
  readonly type: LearningType;
}

/** Input for searching learnings. */
export interface SearchLearningsInput {
  readonly workspacePath: string;
  readonly query: string;
  readonly type?: LearningType;
  readonly limit?: number;
}

/** Result of a learning search. */
export interface SearchLearningsResult {
  readonly learnings: readonly Learning[];
  readonly totalMatches: number;
}

/** Input for recording learnings at task end. */
export interface RecordLearningsInput {
  readonly workspacePath: string;
  readonly learnings: readonly string[];
  readonly sessionId: string;
}

/** Result of recording learnings at task end. */
export interface RecordLearningsResult {
  readonly stored: number;
  readonly deduplicated: number;
}

/**
 * Manages the learning knowledge base: load, save, search, and record.
 *
 * Used by: `snap.start`, `snap.context`, `snap.end`,
 *          `learn.load`, `learn.save`, `learn.search`
 */
export interface ILearningService {
  /** Load learnings relevant to the current context (tiered by relevance). */
  loadTiered(input: LoadLearningsInput): Promise<ServiceResult<LoadLearningsResult>>;

  /** Persist a single new learning. */
  save(input: SaveLearningInput): Promise<ServiceResult<Learning>>;

  /** Search learnings by query and optional filters. */
  search(input: SearchLearningsInput): Promise<ServiceResult<SearchLearningsResult>>;

  /** Batch-record learnings at task completion. */
  recordBatch(input: RecordLearningsInput): Promise<ServiceResult<RecordLearningsResult>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. IIntegrationService
// ═══════════════════════════════════════════════════════════════════════════

/** Git repository context. */
export interface GitContext {
  readonly branch: string;
  readonly status: "clean" | "dirty";
  readonly uncommittedFiles: readonly string[];
  readonly recentCommits: readonly GitCommit[];
}

/** A git commit summary. */
export interface GitCommit {
  readonly hash: string;
  readonly message: string;
  readonly author: string;
  readonly timestamp: number;
}

/** Input for git context retrieval. */
export interface GitContextInput {
  readonly workspacePath: string;
  readonly commitLimit?: number;
}

/** Sentry error context. */
export interface SentryContext {
  readonly recentErrors: readonly SentryError[];
  readonly errorRate: number;
  readonly topIssues: readonly string[];
}

/** A sentry error summary. */
export interface SentryError {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly lastSeen: number;
  readonly level: "fatal" | "error" | "warning";
}

/** Input for Sentry context retrieval. */
export interface SentryContextInput {
  readonly workspacePath: string;
  readonly hoursBack?: number;
}

/** GitHub context for PRs and issues. */
export interface GitHubContext {
  readonly openPRs: readonly GitHubPR[];
  readonly relevantIssues: readonly GitHubIssue[];
  readonly checkStatus: "passing" | "failing" | "pending" | "unknown";
}

/** A GitHub PR summary. */
export interface GitHubPR {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  readonly author: string;
}

/** A GitHub issue summary. */
export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed";
  readonly labels: readonly string[];
}

/** Input for GitHub context retrieval. */
export interface GitHubContextInput {
  readonly workspacePath: string;
  readonly prLimit?: number;
}

/** Enrichment context assembled from all active integrations. */
export interface EnrichmentContext {
  readonly riskScore: RiskScore;
  readonly activeIntegrations: readonly string[];
  readonly git: GitContext | null;
  readonly sentry: SentryContext | null;
  readonly github: GitHubContext | null;
}

/** Input for context enrichment (used during snap.start). */
export interface EnrichContextInput {
  readonly workspacePath: string;
  readonly files: readonly string[];
  readonly intent?: string;
  readonly capabilities: readonly string[];
}

/** Input for integration health check. */
export interface IntegrationHealthInput {
  readonly workspacePath: string;
  readonly capabilities: readonly string[];
}

/** Health status for a single integration. */
export interface IntegrationHealth {
  readonly name: string;
  readonly status: "healthy" | "degraded" | "unavailable";
  readonly latencyMs: number | null;
  readonly lastChecked: number;
}

/** Input for checking integration configurations. */
export interface IntegrationConfigInput {
  readonly workspacePath: string;
}

/** Result of an integration configuration check. */
export interface IntegrationConfigResult {
  readonly valid: boolean;
  readonly integrations: readonly IntegrationConfigEntry[];
}

/** Single integration configuration entry. */
export interface IntegrationConfigEntry {
  readonly name: string;
  readonly configured: boolean;
  readonly issues: readonly string[];
}

/**
 * Coordinates external integrations (git, Sentry, GitHub).
 *
 * All external calls go through circuit breakers and return null on failure
 * rather than throwing, enabling graceful degradation.
 *
 * Used by: `snap.start`, `integrate.git`, `integrate.sentry`,
 *          `integrate.github`, `check.integrations`, `pulse.health`
 */
export interface IIntegrationService {
  /** Gather git repository context. */
  getGitContext(input: GitContextInput): Promise<ServiceResult<GitContext>>;

  /** Fetch recent Sentry error data. */
  getSentryContext(input: SentryContextInput): Promise<ServiceResult<SentryContext>>;

  /** Retrieve GitHub PR and issue context. */
  getGitHubContext(input: GitHubContextInput): Promise<ServiceResult<GitHubContext>>;

  /** Enrich task context by assembling data from all available integrations. */
  enrichContext(input: EnrichContextInput): Promise<ServiceResult<EnrichmentContext>>;

  /** Check health status of all configured integrations. */
  checkHealth(input: IntegrationHealthInput): Promise<readonly IntegrationHealth[]>;

  /** Validate integration configurations. */
  checkConfig(input: IntegrationConfigInput): Promise<ServiceResult<IntegrationConfigResult>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. ISecurityService
// ═══════════════════════════════════════════════════════════════════════════

/** Severity of a security finding. */
export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info";

/** A single security finding. */
export interface SecurityFinding {
  readonly severity: SecuritySeverity;
  readonly rule: string;
  readonly message: string;
  readonly file: string;
  readonly line?: number;
  readonly cwe?: string;
  readonly recommendation: string;
}

/** Input for a security scan. */
export interface SecurityScanInput {
  readonly workspacePath: string;
  readonly files?: readonly string[];
  readonly rules?: readonly string[];
}

/** Result of a security scan. */
export interface SecurityScanResult {
  readonly findings: readonly SecurityFinding[];
  readonly criticalCount: number;
  readonly highCount: number;
  readonly scannedFiles: number;
  readonly duration: number;
}

/**
 * Runs security vulnerability scans against source code.
 *
 * Used by: `check.full`, `check.security`
 */
export interface ISecurityService {
  /** Scan files for security vulnerabilities. */
  scan(input: SecurityScanInput): Promise<ServiceResult<SecurityScanResult>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. IGraphService
// ═══════════════════════════════════════════════════════════════════════════

/** A node in the dependency graph. */
export interface GraphNode {
  readonly id: string;
  readonly path: string;
  readonly type: "file" | "module" | "package";
  readonly imports: readonly string[];
  readonly exports: readonly string[];
}

/** An edge in the dependency graph. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly type: "import" | "re-export" | "dynamic";
}

/** A circular dependency chain. */
export interface CircularDependency {
  readonly chain: readonly string[];
  readonly severity: Severity;
}

/** Input for dependency graph computation. */
export interface DependencyGraphInput {
  readonly workspacePath: string;
  readonly entryPoints?: readonly string[];
  readonly depth?: number;
}

/** Result of dependency graph computation. */
export interface DependencyGraphResult {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly totalModules: number;
  readonly maxDepth: number;
}

/** Input for circular dependency detection. */
export interface CircularDepsInput {
  readonly workspacePath: string;
}

/** Result of circular dependency detection. */
export interface CircularDepsResult {
  readonly cycles: readonly CircularDependency[];
  readonly affectedFiles: readonly string[];
}

/** Input for orphaned file detection. */
export interface OrphanDetectionInput {
  readonly workspacePath: string;
  readonly ignorePatterns?: readonly string[];
}

/** Result of orphan detection. */
export interface OrphanDetectionResult {
  readonly orphanedFiles: readonly string[];
  readonly deadExports: readonly DeadExport[];
  readonly totalFiles: number;
}

/** A dead (unreferenced) export. */
export interface DeadExport {
  readonly file: string;
  readonly exportName: string;
}

/** Input for file relationship mapping. */
export interface FileGraphInput {
  readonly workspacePath: string;
  readonly rootFile?: string;
  readonly depth?: number;
}

/** Result of file relationship mapping. */
export interface FileGraphResult {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly clusters: readonly FileCluster[];
}

/** A cluster of closely-related files. */
export interface FileCluster {
  readonly name: string;
  readonly files: readonly string[];
  readonly cohesion: number;
}

/** Input for graph-based health metrics. */
export interface GraphHealthInput {
  readonly workspacePath: string;
}

/** Graph-specific health metrics. */
export interface GraphHealthResult {
  readonly circularCount: number;
  readonly orphanCount: number;
  readonly maxFanOut: number;
  readonly avgFanOut: number;
  readonly modularity: number;
}

/**
 * Analyzes module dependency graphs, detects circular dependencies,
 * finds orphaned files, and maps file relationships.
 *
 * Used by: `check.full`, `check.circular`, `check.orphans`, `check.health`,
 *          `graph.deps`, `graph.files`, `pulse.health`
 */
export interface IGraphService {
  /** Compute the module-level dependency graph. */
  computeDependencyGraph(
    input: DependencyGraphInput,
  ): Promise<ServiceResult<DependencyGraphResult>>;

  /** Detect circular dependency chains. */
  detectCircularDeps(input: CircularDepsInput): Promise<ServiceResult<CircularDepsResult>>;

  /** Find orphaned files and dead exports. */
  detectOrphans(input: OrphanDetectionInput): Promise<ServiceResult<OrphanDetectionResult>>;

  /** Map file relationships and clusters. */
  computeFileGraph(input: FileGraphInput): Promise<ServiceResult<FileGraphResult>>;

  /** Compute graph-based health metrics. */
  computeHealth(input: GraphHealthInput): Promise<ServiceResult<GraphHealthResult>>;
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. ICacheService
// ═══════════════════════════════════════════════════════════════════════════

/** A cached error diagnostic entry. */
export interface CachedError {
  readonly id: string;
  readonly diagnostic: Diagnostic;
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly occurrences: number;
  readonly resolved: boolean;
}

/** A cached pattern match entry. */
export interface CachedPattern {
  readonly id: string;
  readonly patternName: string;
  readonly file: string;
  readonly matchCount: number;
  readonly lastMatched: number;
}

/** Input for error cache operations. */
export interface ErrorCacheInput {
  readonly workspacePath: string;
  readonly refresh?: boolean;
  readonly limit?: number;
}

/** Result of error cache retrieval. */
export interface ErrorCacheResult {
  readonly errors: readonly CachedError[];
  readonly totalCached: number;
  readonly cacheAge: number;
  readonly stale: boolean;
}

/** Input for pattern cache operations. */
export interface PatternCacheInput {
  readonly workspacePath: string;
  readonly refresh?: boolean;
  readonly patternFilter?: string;
}

/** Result of pattern cache retrieval. */
export interface PatternCacheResult {
  readonly patterns: readonly CachedPattern[];
  readonly totalCached: number;
  readonly cacheAge: number;
  readonly stale: boolean;
}

/**
 * Manages cached error diagnostics and pattern matches for fast retrieval.
 *
 * Caches are workspace-scoped and support both retrieval and forced refresh.
 *
 * Used by: `cache.errors`, `cache.patterns`
 */
export interface ICacheService {
  /** Retrieve or refresh cached error diagnostics. */
  getErrors(input: ErrorCacheInput): Promise<ServiceResult<ErrorCacheResult>>;

  /** Retrieve or refresh cached pattern matches. */
  getPatterns(input: PatternCacheInput): Promise<ServiceResult<PatternCacheResult>>;

  /** Invalidate all caches for a workspace. */
  invalidate(workspacePath: string): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Service Container (Dependency Injection)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The service container holds all injectable services.
 *
 * Layer 3 (Mode-Based Tools) receives this container and plucks out
 * the services each mode handler needs. This is the composition root --
 * concrete implementations are wired here, never inside tools or services.
 *
 * @example
 * ```ts
 * function createServiceContainer(config: AppConfig): ServiceContainer {
 *   const cache = new CacheServiceImpl(config);
 *   const graph = new GraphServiceImpl(config);
 *   const security = new SecurityServiceImpl(config);
 *   const validation = new ValidationServiceImpl(config, graph, security);
 *   // ... etc
 *   return { snapshot, validation, learning, integration, security, graph, cache };
 * }
 * ```
 */
export interface ServiceContainer {
  readonly snapshot: ISnapshotService;
  readonly validation: IValidationService;
  readonly learning: ILearningService;
  readonly integration: IIntegrationService;
  readonly security: ISecurityService;
  readonly graph: IGraphService;
  readonly cache: ICacheService;
}
