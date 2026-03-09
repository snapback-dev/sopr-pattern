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
// Security: Input Bounds
// ---------------------------------------------------------------------------

/** Maximum length for short text fields (task summaries, queries, keys). */
const MAX_SHORT_TEXT = 2_000;
/** Maximum length for long text fields (code, context blobs). */
const MAX_LONG_TEXT = 1_000_000;
/** Maximum file path length. */
const MAX_PATH_LENGTH = 500;
/** Maximum number of files per request. */
const MAX_FILES = 200;
/** Maximum number of keywords/tags per request. */
const MAX_KEYWORDS = 50;
/** Maximum graph traversal depth. */
const MAX_DEPTH = 20;

// ---------------------------------------------------------------------------
// Security: Safe Path Schema
// ---------------------------------------------------------------------------

/**
 * A file path schema that rejects path traversal attempts.
 *
 * Blocks:
 *   - `..` segments (directory traversal)
 *   - Absolute paths (escaping workspace root)
 *   - Null bytes (C-string truncation attacks)
 */
export const SafePathSchema = z
	.string()
	.min(1)
	.max(MAX_PATH_LENGTH)
	.refine((p) => !p.includes("\0"), "Path must not contain null bytes")
	.refine((p) => !p.startsWith("/") && !p.startsWith("\\"), "Absolute paths are not allowed")
	.refine((p) => !/(^|[\\/])\.\.($|[\\/])/.test(p), "Path traversal (../) is not allowed");

// ---------------------------------------------------------------------------
// snap — Snapshot lifecycle management
// Modes: start | check | context | end
// ---------------------------------------------------------------------------

export const SnapInputSchema = z.object({
	/** Operation mode for the snap tool. */
	mode: z.enum(["start", "check", "context", "end", "undo"]),
	/** Task summary — required when mode is "start". */
	task: z.string().min(1).max(MAX_SHORT_TEXT).optional(),
	/** Files relevant to this operation. */
	files: z.array(SafePathSchema).max(MAX_FILES).optional(),
	/** Keywords for pattern matching and context retrieval. */
	keywords: z.array(z.string().min(1).max(MAX_SHORT_TEXT)).max(MAX_KEYWORDS).optional(),
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
	file: SafePathSchema.optional(),
	/** Raw source code to validate (alternative to file path). */
	code: z.string().max(MAX_LONG_TEXT).optional(),
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
	trigger: z.string().min(1).max(MAX_SHORT_TEXT).optional(),
	/** Action to record (used in save). */
	action: z.string().min(1).max(MAX_SHORT_TEXT).optional(),
	/** Learning classification (used in save). */
	type: PatternTypeSchema.optional(),
	/** Free-text search query (used in search). */
	query: z.string().min(1).max(MAX_SHORT_TEXT).optional(),
	/** Intent hint for contextual loading. */
	intent: z.string().min(1).max(MAX_SHORT_TEXT).optional(),
	/** File paths to scope learning retrieval. */
	filePaths: z.array(SafePathSchema).max(MAX_FILES).optional(),
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
	files: z.array(SafePathSchema).max(MAX_FILES).optional(),
	/** Additional context string (e.g. commit message, issue body). */
	context: z.string().max(MAX_LONG_TEXT).optional(),
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
	entryPoint: SafePathSchema.optional(),
	/** Maximum traversal depth (default: 3). */
	depth: z.number().int().positive().max(MAX_DEPTH).default(3),
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
	key: z.string().min(1).max(MAX_SHORT_TEXT).optional(),
	/** Value to store (write operation). JSON-serialized size capped at 1MB. */
	value: z
		.unknown()
		.optional()
		.refine(
			(v) => v === undefined || JSON.stringify(v).length <= MAX_LONG_TEXT,
			"Cache value exceeds maximum size (1MB serialized)",
		),
});

export type CacheInput = z.infer<typeof CacheInputSchema>;

// ---------------------------------------------------------------------------
// help — Tool discovery and documentation
// Modes: tools | status | wire | modes | thresholds | decision | all
// ---------------------------------------------------------------------------

export const HelpInputSchema = z.object({
	/** Help topic to display. */
	mode: z.enum(["tools", "status", "wire", "modes", "thresholds", "decision", "all"]),
});

export type HelpInput = z.infer<typeof HelpInputSchema>;

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
	help: HelpInputSchema,
} as const;

/** Tool names derived from the schema map. */
export type ToolName = keyof typeof ToolInputSchemas;
