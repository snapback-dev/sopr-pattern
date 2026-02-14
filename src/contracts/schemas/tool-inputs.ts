/**
 * Zod schemas for every SOPR tool's input payload.
 *
 * Each schema uses a `mode` discriminator that controls which optional
 * fields are relevant. The Protocol Server validates incoming params
 * against these schemas before dispatching to the Tool Registry.
 *
 * @module contracts/schemas/tool-inputs
 */

import { z } from "zod";
import { PatternTypeSchema } from "./shared.js";

// ---------------------------------------------------------------------------
// snap — Snapshot lifecycle management
// Modes: start | check | context | end
// ---------------------------------------------------------------------------

export const SnapInputSchema = z.object({
  /** Operation mode for the snap tool. */
  mode: z.enum(["start", "check", "context", "end", "undo"]),
  /** Task summary — required when mode is "start". */
  task: z.string().min(1).optional(),
  /** Files relevant to this operation. */
  files: z.array(z.string().min(1)).optional(),
  /** Keywords for pattern matching and context retrieval. */
  keywords: z.array(z.string().min(1)).optional(),
  /** Developer intent hint for context-aware behaviour. */
  intent: z.enum(["implement", "debug", "refactor", "review", "explore"]).optional(),
});

export type SnapInput = z.infer<typeof SnapInputSchema>;

// ---------------------------------------------------------------------------
// check — Code validation & quality gates
// Modes: quick | full | patterns | build | circular | security
//        | coverage | orphans | health | evolution | integrations
// ---------------------------------------------------------------------------

export const CheckInputSchema = z.object({
  /** Validation mode selecting the analysis depth and focus. */
  mode: z.enum([
    "quick",
    "full",
    "patterns",
    "build",
    "circular",
    "security",
    "coverage",
    "orphans",
    "health",
    "evolution",
    "integrations",
  ]),
  /** File path to scope the check to a single file. */
  file: z.string().min(1).optional(),
  /** Raw source code to validate (alternative to file path). */
  code: z.string().optional(),
});

export type CheckInput = z.infer<typeof CheckInputSchema>;

// ---------------------------------------------------------------------------
// learn — Learning lifecycle (load, save, search)
// Modes: load | save | search
// ---------------------------------------------------------------------------

export const LearnInputSchema = z.object({
  /** Learning operation mode. */
  mode: z.enum(["load", "save", "search"]),
  /** Trigger condition for the learning (used in save). */
  trigger: z.string().min(1).optional(),
  /** Action to record (used in save). */
  action: z.string().min(1).optional(),
  /** Learning classification (used in save). */
  type: PatternTypeSchema.optional(),
  /** Free-text search query (used in search). */
  query: z.string().min(1).optional(),
  /** Intent hint for contextual loading. */
  intent: z.string().min(1).optional(),
  /** File paths to scope learning retrieval. */
  filePaths: z.array(z.string().min(1)).optional(),
});

export type LearnInput = z.infer<typeof LearnInputSchema>;

// ---------------------------------------------------------------------------
// integrate — External service integrations
// Modes: git | sentry | github
// ---------------------------------------------------------------------------

export const IntegrateInputSchema = z.object({
  /** Integration provider to activate. */
  mode: z.enum(["git", "sentry", "github"]),
  /** Files relevant to the integration context. */
  files: z.array(z.string().min(1)).optional(),
  /** Additional context string (e.g. commit message, issue body). */
  context: z.string().optional(),
});

export type IntegrateInput = z.infer<typeof IntegrateInputSchema>;

// ---------------------------------------------------------------------------
// pulse — System health monitoring
// Modes: health
// ---------------------------------------------------------------------------

export const PulseInputSchema = z.object({
  /** Pulse operation mode. */
  mode: z.literal("health"),
});

export type PulseInput = z.infer<typeof PulseInputSchema>;

// ---------------------------------------------------------------------------
// graph — Dependency & file graph analysis
// Modes: deps | files
// ---------------------------------------------------------------------------

export const GraphInputSchema = z.object({
  /** Graph analysis mode. */
  mode: z.enum(["deps", "files"]),
  /** Entry point file or module to start traversal from. */
  entryPoint: z.string().min(1).optional(),
  /** Maximum traversal depth (default: 3). */
  depth: z.number().int().positive().default(3),
});

export type GraphInput = z.infer<typeof GraphInputSchema>;

// ---------------------------------------------------------------------------
// cache — Error & pattern cache operations
// Modes: errors | patterns
// ---------------------------------------------------------------------------

export const CacheInputSchema = z.object({
  /** Cache domain to operate on. */
  mode: z.enum(["errors", "patterns"]),
  /** Cache lookup key. */
  key: z.string().min(1).optional(),
  /** Value to store (write operation). Omit for read. */
  value: z.unknown().optional(),
});

export type CacheInput = z.infer<typeof CacheInputSchema>;

// ---------------------------------------------------------------------------
// Per-tool schema map (used by ToolRegistry for dispatch)
// ---------------------------------------------------------------------------

/**
 * Maps each tool name to its input schema.
 *
 * A cross-tool discriminated union is not possible because mode enum
 * values overlap across tools (e.g. "health" appears in both check and
 * pulse). The ToolRegistry selects the correct per-tool schema before
 * validation instead.
 */
export const ToolInputSchemas = {
  snap: SnapInputSchema,
  check: CheckInputSchema,
  learn: LearnInputSchema,
  integrate: IntegrateInputSchema,
  pulse: PulseInputSchema,
  graph: GraphInputSchema,
  cache: CacheInputSchema,
} as const;

/** Tool names derived from the schema map. */
export type ToolName = keyof typeof ToolInputSchemas;
