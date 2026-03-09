/**
 * Barrel file for all SOPR contract schemas.
 *
 * Re-exports shared types, tool input/output schemas, and the
 * wire-format encoder/decoder from a single entry point.
 *
 * @module contracts/schemas
 */

// ---------------------------------------------------------------------------
// Shared domain types
// ---------------------------------------------------------------------------

export {
	type CircuitState,
	CircuitStateSchema,
	type FileInfo,
	// Composite schemas
	FileInfoSchema,
	type GraphEdge,
	GraphEdgeSchema,
	type GraphNode,
	GraphNodeSchema,
	type GraphNodeType,
	GraphNodeTypeSchema,
	type HealthStatus,
	HealthStatusSchema,
	type Learning,
	LearningSchema,
	type Pattern,
	PatternSchema,
	type PatternType,
	PatternTypeSchema,
	type RiskScore,
	RiskScoreSchema,
	type ServiceStatus,
	ServiceStatusSchema,
	// Inferred types
	type Severity,
	// Enums / atomic schemas
	SeveritySchema,
	type ValidationError,
	ValidationErrorSchema,
	type Violation,
	ViolationSchema,
} from "./shared.js";

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

export {
	type CacheInput,
	CacheInputSchema,
	type CheckInput,
	CheckInputSchema,
	type GraphInput,
	GraphInputSchema,
	type IntegrateInput,
	IntegrateInputSchema,
	type LearnInput,
	LearnInputSchema,
	type PulseInput,
	PulseInputSchema,
	type SnapInput,
	SnapInputSchema,
	ToolInputSchemas,
	type ToolName,
} from "./tool-inputs.js";

// ---------------------------------------------------------------------------
// Tool output schemas
// ---------------------------------------------------------------------------

export {
	type CacheOutput,
	CacheOutputSchema,
	type CheckOutput,
	CheckOutputSchema,
	type GraphOutput,
	GraphOutputSchema,
	type IntegrateOutput,
	IntegrateOutputSchema,
	type LearnOutput,
	LearnOutputSchema,
	type PulseOutput,
	PulseOutputSchema,
	type SnapOutput,
	SnapOutputSchema,
	ToolOutputSchemas,
} from "./tool-outputs.js";

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export {
	decode,
	encode,
	encodeCache,
	encodeCheck,
	encodeEnd,
	encodeGraph,
	encodeIntegrate,
	encodeLearning,
	encodePulse,
	encodeSnap,
	encodeViolation,
	WireFormatError,
	WireType,
} from "../wire-format.js";
