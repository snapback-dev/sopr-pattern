/**
 * Tool Registry — Layer 2 of the SOPR pattern.
 *
 * Responsibilities:
 *   1. Store tool definitions keyed by name.
 *   2. Validate incoming arguments against each tool's Zod schema.
 *   3. Resolve the correct mode handler from validated input.
 *   4. Return MCP-formatted tool listings for `tools/list`.
 *
 * The registry contains ZERO business logic. It validates, dispatches,
 * and formats — nothing more.
 *
 * @module registry/tool-registry
 */

import type { ToolContext } from "../contracts/context.js";
import type { CallToolResult, TextContent } from "../protocol/types.js";
import {
  ToolNotFoundError,
  InvalidInputError,
  ModeNotFoundError,
  HandlerExecutionError,
} from "../protocol/types.js";
import type { ToolDefinition, ToolRegistryConfig } from "./types.js";
import { DEFAULT_REGISTRY_CONFIG } from "./types.js";
import { zodSchemaToJsonSchema } from "./schema-converter.js";
import type { JsonSchemaObject } from "./schema-converter.js";

// ---------------------------------------------------------------------------
// MCP Tool Listing Types
// ---------------------------------------------------------------------------

/**
 * Shape of a single tool in the MCP `tools/list` response.
 */
interface McpToolListing {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
  private readonly tools: Map<string, ToolDefinition> = new Map();
  private readonly config: ToolRegistryConfig;

  constructor(config?: Partial<ToolRegistryConfig>) {
    this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a tool definition.
   *
   * @param definition - Complete tool definition with name, schema, and mode handlers.
   * @throws {Error} If a tool with the same name is already registered.
   */
  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(
        `Tool "${definition.name}" is already registered`,
      );
    }
    this.tools.set(definition.name, definition);
  }

  // -----------------------------------------------------------------------
  // Lookup
  // -----------------------------------------------------------------------

  /**
   * Retrieve a tool definition by name.
   *
   * @param name - The tool name.
   * @returns The tool definition, or `undefined` if not found.
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Return all registered tool definitions as MCP-compatible listings.
   *
   * Each entry includes the tool name, description, and its input schema
   * converted to JSON Schema format. This is the payload for `tools/list`.
   */
  list(): McpToolListing[] {
    const listings: McpToolListing[] = [];

    for (const tool of this.tools.values()) {
      listings.push({
        name: tool.name,
        description: tool.description,
        inputSchema: zodSchemaToJsonSchema(tool.inputSchema),
      });
    }

    return listings;
  }

  // -----------------------------------------------------------------------
  // Execution
  // -----------------------------------------------------------------------

  /**
   * Validate input and dispatch to the appropriate mode handler.
   *
   * Execution pipeline:
   *   1. Look up tool by name            → ToolNotFoundError
   *   2. Parse input with Zod safeParse   → InvalidInputError
   *   3. Extract mode from parsed input   → ModeNotFoundError
   *   4. Look up mode handler             → ModeNotFoundError
   *   5. Call handler(params, context)     → HandlerExecutionError
   *   6. Format result as CallToolResult
   *
   * @param name    - Tool name from the MCP `tools/call` request.
   * @param args    - Raw arguments object from the MCP request.
   * @param context - Frozen, immutable request-scoped context.
   * @returns An MCP-compliant `CallToolResult`.
   */
  async execute(
    name: string,
    args: unknown,
    context: ToolContext,
  ): Promise<CallToolResult> {
    // 1. Look up tool
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    // 2. Validate input with Zod
    const parseResult = tool.inputSchema.safeParse(args);
    if (!parseResult.success) {
      const issues = parseResult.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
      throw new InvalidInputError(issues);
    }

    const validatedInput = parseResult.data as Record<string, unknown>;

    // 3. Extract mode
    const mode = validatedInput["mode"];
    if (typeof mode !== "string") {
      throw new InvalidInputError(["mode: Expected a string mode field"]);
    }

    // 4. Look up mode handler
    const handler = tool.modes[mode];
    if (!handler) {
      throw new ModeNotFoundError(name, mode);
    }

    // 5. Execute handler
    let result: unknown;
    try {
      result = await handler(validatedInput, context);
    } catch (error: unknown) {
      if (this.config.verbose) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[ToolRegistry] Handler error in ${name}/${mode}: ${message}`,
        );
      }
      throw new HandlerExecutionError(name, mode);
    }

    // 6. Format result
    return this.formatResult(result);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Convert an arbitrary handler result to an MCP `CallToolResult`.
   *
   * If the result is already a string, it becomes a single text content block.
   * Otherwise, it is JSON-serialized into a text block.
   */
  private formatResult(result: unknown): CallToolResult {
    const text =
      typeof result === "string" ? result : JSON.stringify(result, null, 2);

    const content: TextContent[] = [{ type: "text", text }];

    return { content };
  }
}
