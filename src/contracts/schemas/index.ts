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
  // Enums / atomic schemas
  SeveritySchema,
  PatternTypeSchema,
  ServiceStatusSchema,
  CircuitStateSchema,
  GraphNodeTypeSchema,

  // Composite schemas
  FileInfoSchema,
  ValidationErrorSchema,
  PatternSchema,
  ViolationSchema,
  LearningSchema,
  RiskScoreSchema,
  HealthStatusSchema,
  GraphNodeSchema,
  GraphEdgeSchema,

  // Inferred types
  type Severity,
  type PatternType,
  type ServiceStatus,
  type CircuitState,
  type GraphNodeType,
  type FileInfo,
  type ValidationError,
  type Pattern,
  type Violation,
  type Learning,
  type RiskScore,
  type HealthStatus,
  type GraphNode,
  type GraphEdge,
} from "./shared.js";

// ---------------------------------------------------------------------------
// Tool input schemas
// ---------------------------------------------------------------------------

export {
  SnapInputSchema,
  CheckInputSchema,
  LearnInputSchema,
  IntegrateInputSchema,
  PulseInputSchema,
  GraphInputSchema,
  CacheInputSchema,
  ToolInputSchemas,

  type SnapInput,
  type CheckInput,
  type LearnInput,
  type IntegrateInput,
  type PulseInput,
  type GraphInput,
  type CacheInput,
  type ToolName,
} from "./tool-inputs.js";

// ---------------------------------------------------------------------------
// Tool output schemas
// ---------------------------------------------------------------------------

export {
  SnapOutputSchema,
  CheckOutputSchema,
  LearnOutputSchema,
  IntegrateOutputSchema,
  PulseOutputSchema,
  GraphOutputSchema,
  CacheOutputSchema,
  ToolOutputSchemas,

  type SnapOutput,
  type CheckOutput,
  type LearnOutput,
  type IntegrateOutput,
  type PulseOutput,
  type GraphOutput,
  type CacheOutput,
} from "./tool-outputs.js";

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

export {
  WireType,
  WireFormatError,
  encode,
  decode,
  encodeSnap,
  encodeCheck,
  encodeEnd,
  encodeViolation,
  encodeLearning,
  encodePulse,
  encodeGraph,
  encodeCache,
  encodeIntegrate,
} from "../wire-format.js";
