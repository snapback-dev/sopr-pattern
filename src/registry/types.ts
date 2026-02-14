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
 *
 * @typeParam TInput  - The Zod-inferred input type.
 * @typeParam TOutput - The output type produced by mode handlers.
 */
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
}

/**
 * Default registry configuration.
 */
export const DEFAULT_REGISTRY_CONFIG: ToolRegistryConfig = Object.freeze({
  verbose: false,
});
