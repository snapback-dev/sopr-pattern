/**
 * Registry-level types for the SOPR Tool Registry (Layer 2).
 *
 * These types define the generic `ToolDefinition` shape, mode handler
 * signature, and supporting interfaces consumed by the registry
 * implementation. No business logic types belong here.
 *
 * @module registry/types
 */

import type { ZodType } from "zod";
import type { ToolContext } from "../contracts/context.js";

// ---------------------------------------------------------------------------
// Mode Handler
// ---------------------------------------------------------------------------

/**
 * A mode handler is a single async function that implements one mode of a
 * tool. It receives validated (parsed) input and an immutable context.
 *
 * Mode handlers live in Layer 3 (Tools) but their type is defined here so
 * the registry can reference them without importing tool implementations.
 *
 * @typeParam TInput  - The Zod-parsed input type for this tool.
 * @typeParam TOutput - The structured output returned by the handler.
 */
export type ModeHandler<TInput = unknown, TOutput = unknown> = (
	params: TInput,
	context: ToolContext,
) => Promise<TOutput>;

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

/**
 * A complete tool definition registered in the Tool Registry.
 *
 * Each tool has:
 * - A unique `name` that maps to the MCP `tools/call` name.
 * - A short `description` (under 60 tokens) for efficient discovery.
 * - A Zod `inputSchema` that validates the raw `arguments` object.
 * - A `modes` map from mode string to handler function.
 * - An optional `outputSchema` for validating handler outputs.
 *
 * @typeParam TInput  - The Zod-inferred input type.
 * @typeParam TOutput - The output type produced by mode handlers.
 */
/**
 * MCP Tool Annotations for LLM safety and discovery.
 *
 * These hints help LLMs make better decisions about when and how to use tools.
 * All fields are optional and advisory — they do not enforce behavior.
 *
 * @see https://modelcontextprotocol.io/specification/2025-03-26/server/tools
 */
export interface ToolAnnotations {
	/** Human-readable title for UI display. */
	readonly title?: string;
	/** If true, the tool only reads data (no side effects). */
	readonly readOnlyHint?: boolean;
	/** If true, the tool may cause destructive/irreversible changes. */
	readonly destructiveHint?: boolean;
	/** If true, calling the tool repeatedly with same args yields same result. */
	readonly idempotentHint?: boolean;
	/** If true, the tool interacts with external entities outside the model's context. */
	readonly openWorldHint?: boolean;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
	/** Tool name exposed via the MCP protocol (lowercase, short). */
	readonly name: string;

	/**
	 * Human-readable description shown during tool discovery.
	 * Must be under 60 tokens to keep discovery overhead low.
	 */
	readonly description: string;

	/**
	 * Zod schema that validates the raw `arguments` object from `tools/call`.
	 * The registry calls `.safeParse()` on this before dispatching to a handler.
	 */
	readonly inputSchema: ZodType<TInput>;

	/**
	 * Optional Zod schema that validates handler outputs.
	 * When provided, the registry validates outputs before returning to the client.
	 * This catches bugs early and ensures contract compliance.
	 */
	readonly outputSchema?: ZodType<TOutput>;

	/**
	 * MCP tool annotations for LLM safety hints.
	 * Passed through to the MCP `tools/list` response verbatim.
	 */
	readonly annotations?: ToolAnnotations;

	/**
	 * Map of mode name to handler function.
	 *
	 * The registry extracts the `mode` field from validated input and looks
	 * up the corresponding handler here. If the mode is missing, the registry
	 * returns a `ModeNotFoundError`.
	 */
	readonly modes: Readonly<Record<string, ModeHandler<TInput, TOutput>>>;
}

// ---------------------------------------------------------------------------
// Registry Configuration
// ---------------------------------------------------------------------------

/**
 * Optional configuration for the Tool Registry.
 */
export interface ToolRegistryConfig {
	/**
	 * If true, the registry logs validation failures and dispatch events
	 * to stderr. Defaults to false.
	 */
	readonly verbose: boolean;

	/**
	 * Default timeout in milliseconds for tool handler execution.
	 * Defaults to 30000 (30 seconds). Set to 0 to disable.
	 */
	readonly defaultTimeoutMs: number;

	/**
	 * If true, validate handler outputs against outputSchema when present.
	 * Defaults to true in development, false in production for performance.
	 */
	readonly validateOutputs: boolean;
}

/**
 * Default registry configuration.
 */
export const DEFAULT_REGISTRY_CONFIG: ToolRegistryConfig = Object.freeze({
	verbose: false,
	defaultTimeoutMs: 30_000,
	validateOutputs: true, // Enable by default; disable in production via config override
});
