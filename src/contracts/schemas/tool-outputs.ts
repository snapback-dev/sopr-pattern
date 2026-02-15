/**
 * Zod schemas for every SOPR tool's output payload.
 *
 * Output schemas provide the contract that tool implementations must
 * satisfy. They are used for:
 *   - Runtime validation of tool return values in development/test.
 *   - TypeScript type inference via `z.infer<>`.
 *   - Wire-format encoding/decoding (see wire-format.ts).
 *   - Validation in the Tool Registry to catch service bugs early.
 *
 * @module contracts/schemas/tool-outputs
 */

import { z } from "zod";
import {
  GraphEdgeSchema,
  GraphNodeSchema,
  HealthStatusSchema,
  LearningSchema,
  PatternSchema,
  RiskScoreSchema,
  ServiceStatusSchema,
  ValidationErrorSchema,
  ViolationSchema,
} from "./shared.js";

// ---------------------------------------------------------------------------
// snap — Snapshot lifecycle output
// ---------------------------------------------------------------------------

export const SnapOutputSchema = z.object({
  /** Unique task identifier assigned by the snapshot subsystem. */
  taskId: z.string().min(1),
  /** Patterns relevant to the current task context. */
  patterns: z.array(PatternSchema),
  /** Known violations in the affected scope. */
  violations: z.array(ViolationSchema),
  /** Calculated risk score for this operation. */
  riskScore: RiskScoreSchema,
  /** Recommended next actions for the caller. */
  nextActions: z.array(z.string().min(1)),
});

export type SnapOutput = z.infer<typeof SnapOutputSchema>;

// ---------------------------------------------------------------------------
// check — Validation & quality gate output
// ---------------------------------------------------------------------------

export const CheckOutputSchema = z.object({
  /** Whether the validation passed all gates. */
  passed: z.boolean(),
  /** Errors that must be resolved before proceeding. */
  errors: z.array(ValidationErrorSchema),
  /** Warnings that should be reviewed but are not blocking. */
  warnings: z.array(ValidationErrorSchema),
});

export type CheckOutput = z.infer<typeof CheckOutputSchema>;

// ---------------------------------------------------------------------------
// learn — Learning lifecycle output
// ---------------------------------------------------------------------------

export const LearnOutputSchema = z.object({
  /** Learnings loaded from storage (mode: load). */
  learnings: z.array(LearningSchema).optional(),
  /** ID of the newly saved learning (mode: save). */
  learningId: z.string().min(1).optional(),
  /** Search results matching the query (mode: search). */
  results: z.array(LearningSchema).optional(),
});

export type LearnOutput = z.infer<typeof LearnOutputSchema>;

// ---------------------------------------------------------------------------
// integrate — External integration output
// ---------------------------------------------------------------------------

export const IntegrateOutputSchema = z.object({
  /** Name of the integration provider (git, sentry, github). */
  provider: z.string().min(1),
  /** Provider-specific response data. */
  data: z.record(z.string(), z.unknown()),
  /** Whether the response was enriched with external context. */
  enriched: z.boolean(),
});

export type IntegrateOutput = z.infer<typeof IntegrateOutputSchema>;

// ---------------------------------------------------------------------------
// pulse — System health output
// ---------------------------------------------------------------------------

export const PulseOutputSchema = z.object({
  /** Overall system status (worst status across services). */
  status: ServiceStatusSchema,
  /** Per-service health details. */
  services: z.array(HealthStatusSchema),
  /** System uptime in seconds. */
  uptime: z.number().nonnegative(),
});

export type PulseOutput = z.infer<typeof PulseOutputSchema>;

// ---------------------------------------------------------------------------
// graph — Dependency / file graph output
// ---------------------------------------------------------------------------

export const GraphOutputSchema = z.object({
  /** Graph vertices. */
  nodes: z.array(GraphNodeSchema),
  /** Directed edges between nodes. */
  edges: z.array(GraphEdgeSchema),
  /** Optional metadata about the graph traversal. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type GraphOutput = z.infer<typeof GraphOutputSchema>;

// ---------------------------------------------------------------------------
// cache — Cache operation output
// ---------------------------------------------------------------------------

export const CacheOutputSchema = z.object({
  /** Whether the requested key was found in cache. */
  hit: z.boolean(),
  /** Cached data (present only on cache hit). */
  data: z.unknown().optional(),
  /** The cache key that was looked up or written. */
  key: z.string().min(1),
});

export type CacheOutput = z.infer<typeof CacheOutputSchema>;

// ---------------------------------------------------------------------------
// Service Result Schema (for wrapping service responses)
// ---------------------------------------------------------------------------

/**
 * Schema for ServiceResult<T> - the discriminated union used by all services.
 * This captures both success and failure cases for validation purposes.
 */
export const ServiceResultSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.union([
    z.object({
      ok: z.literal(true),
      data: dataSchema,
    }),
    z.object({
      ok: z.literal(false),
      error: z.string(),
      code: z.string(),
    }),
  ]);

// ---------------------------------------------------------------------------
// Per-tool output schema map
// ---------------------------------------------------------------------------

/**
 * Maps each tool name to its output schema.
 * Mirrors {@link ToolInputSchemas} from tool-inputs.ts.
 */
export const ToolOutputSchemas = {
  snap: SnapOutputSchema,
  check: CheckOutputSchema,
  learn: LearnOutputSchema,
  integrate: IntegrateOutputSchema,
  pulse: PulseOutputSchema,
  graph: GraphOutputSchema,
  cache: CacheOutputSchema,
} as const;

/**
 * Type helper to get the output schema for a given tool.
 */
export type ToolOutput<T extends keyof typeof ToolOutputSchemas> = z.infer<
  (typeof ToolOutputSchemas)[T]
>;
