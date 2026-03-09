/**
 * Shared Zod schemas used across multiple SOPR tools.
 *
 * These schemas define the reusable domain types that appear in tool
 * inputs, outputs, and wire-format payloads. All tool-specific schemas
 * import from here rather than duplicating definitions.
 *
 * @module contracts/schemas/shared
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export const SeveritySchema = z.enum(["error", "warning", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

// ---------------------------------------------------------------------------
// FileInfo
// ---------------------------------------------------------------------------

export const FileInfoSchema = z.object({
	/** Absolute or workspace-relative file path. */
	path: z.string().min(1),
	/** Content hash (e.g. SHA-256 hex digest) for change detection. */
	contentHash: z.string(),
	/** File size in bytes. */
	size: z.number().int().nonnegative(),
});

export type FileInfo = z.infer<typeof FileInfoSchema>;

// ---------------------------------------------------------------------------
// ValidationError
// ---------------------------------------------------------------------------

export const ValidationErrorSchema = z.object({
	/** 1-based line number where the issue was detected. */
	line: z.number().int().positive(),
	/** 1-based column number (optional for linter-style errors). */
	column: z.number().int().positive(),
	/** Human-readable description of the issue. */
	message: z.string().min(1),
	/** Error severity. */
	severity: SeveritySchema,
});

export type ValidationError = z.infer<typeof ValidationErrorSchema>;

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

export const PatternTypeSchema = z.enum(["pat", "pit", "eff", "disc", "wf"]);
export type PatternType = z.infer<typeof PatternTypeSchema>;

export const PatternSchema = z.object({
	/** Unique pattern identifier. */
	id: z.string().min(1),
	/** Trigger condition — when this pattern should be applied. */
	trigger: z.string().min(1),
	/** Action to take when the trigger matches. */
	action: z.string().min(1),
	/**
	 * Pattern classification:
	 *   pat = pattern, pit = pitfall, eff = efficiency,
	 *   disc = discovery, wf = workflow
	 */
	type: PatternTypeSchema,
});

export type Pattern = z.infer<typeof PatternSchema>;

// ---------------------------------------------------------------------------
// Violation
// ---------------------------------------------------------------------------

export const ViolationSchema = z.object({
	/** Violation category (e.g. "silent-catch", "missing-await"). */
	type: z.string().min(1),
	/** File where the violation was detected. */
	file: z.string().min(1),
	/** What went wrong. */
	what: z.string().min(1),
	/** Root cause — why it happened. */
	why: z.string().min(1),
	/** Preventive action for the future. */
	prevent: z.string().min(1),
});

export type Violation = z.infer<typeof ViolationSchema>;

// ---------------------------------------------------------------------------
// Learning
// ---------------------------------------------------------------------------

export const LearningSchema = z.object({
	/** Unique learning identifier. */
	id: z.string().min(1),
	/** Trigger condition — when this learning applies. */
	trigger: z.string().min(1),
	/** Action to take when the trigger fires. */
	action: z.string().min(1),
	/** Learning classification (same taxonomy as Pattern). */
	type: PatternTypeSchema,
	/** ISO-8601 timestamp of when the learning was recorded. */
	timestamp: z.string().datetime(),
});

export type Learning = z.infer<typeof LearningSchema>;

// ---------------------------------------------------------------------------
// RiskScore
// ---------------------------------------------------------------------------

export const RiskScoreSchema = z.object({
	/** Normalized risk value between 0 (safe) and 1 (critical). */
	value: z.number().min(0).max(1),
	/** Human-readable factors that contributed to the score. */
	factors: z.array(z.string().min(1)),
});

export type RiskScore = z.infer<typeof RiskScoreSchema>;

// ---------------------------------------------------------------------------
// HealthStatus
// ---------------------------------------------------------------------------

export const ServiceStatusSchema = z.enum(["healthy", "degraded", "down"]);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;

export const CircuitStateSchema = z.enum(["closed", "open", "half-open"]);
export type CircuitState = z.infer<typeof CircuitStateSchema>;

export const HealthStatusSchema = z.object({
	/** Service or subsystem name. */
	service: z.string().min(1),
	/** Current operational status. */
	status: ServiceStatusSchema,
	/** Last observed latency in milliseconds. */
	latencyMs: z.number().nonnegative(),
	/** Circuit breaker state for this service. */
	circuitState: CircuitStateSchema,
});

export type HealthStatus = z.infer<typeof HealthStatusSchema>;

// ---------------------------------------------------------------------------
// Graph primitives (used by GraphOutputSchema)
// ---------------------------------------------------------------------------

export const GraphNodeTypeSchema = z.enum(["file", "module", "package", "service", "function", "class"]);
export type GraphNodeType = z.infer<typeof GraphNodeTypeSchema>;

export const GraphNodeSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	type: GraphNodeTypeSchema,
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
	from: z.string().min(1),
	to: z.string().min(1),
	weight: z.number().optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
