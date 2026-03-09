/**
 * Tool Registry — Layer 2 of the SOPR pattern.
 *
 * Responsibilities:
 *   1. Store tool definitions keyed by name.
 *   2. Validate incoming arguments against each tool's Zod schema.
 *   3. Resolve the correct mode handler from validated input.
 *   4. Return MCP-formatted tool listings for `tools/list`.
 *   5. Apply per-request timeout to prevent hung requests.
 *   6. Optionally validate outputs against schema.
 *
 * The registry contains ZERO business logic. It validates, dispatches,
 * and formats — nothing more.
 *
 * @module registry/tool-registry
 */

import type { ToolContext } from "../contracts/context.js";
import type { ITierRouter, TierMode } from "../contracts/router.js";
import type { ITelemetry } from "../contracts/telemetry.js";
import type { CallToolResult, TextContent } from "../protocol/types.js";
import {
	HandlerExecutionError,
	InvalidInputError,
	ModeNotFoundError,
	OutputValidationError,
	RequestCancelledError,
	RequestTimeoutError,
	ToolNotFoundError,
} from "../protocol/types.js";
import type { JsonSchemaObject } from "./schema-converter.js";
import { zodSchemaToJsonSchema } from "./schema-converter.js";
import type { ToolDefinition, ToolRegistryConfig } from "./types.js";
import { DEFAULT_REGISTRY_CONFIG } from "./types.js";

// ---------------------------------------------------------------------------
// Timeout Helper
// ---------------------------------------------------------------------------

/**
 * Wraps a promise with a timeout. Rejects with RequestTimeoutError if
 * the promise doesn't resolve within the specified time.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
	if (timeoutMs <= 0) {
		return promise;
	}

	return new Promise<T>((resolve, reject) => {
		// Handle abort signal
		if (signal?.aborted) {
			reject(new RequestCancelledError());
			return;
		}

		const timeoutId = setTimeout(() => {
			reject(new RequestTimeoutError(timeoutMs));
		}, timeoutMs);

		const abortHandler = () => {
			clearTimeout(timeoutId);
			reject(new RequestCancelledError());
		};

		signal?.addEventListener("abort", abortHandler, { once: true });

		promise
			.then((result) => {
				clearTimeout(timeoutId);
				signal?.removeEventListener("abort", abortHandler);
				resolve(result);
			})
			.catch((error) => {
				clearTimeout(timeoutId);
				signal?.removeEventListener("abort", abortHandler);
				reject(error);
			});
	});
}

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
	annotations?: {
		title?: string;
		readOnlyHint?: boolean;
		destructiveHint?: boolean;
		idempotentHint?: boolean;
		openWorldHint?: boolean;
	};
}

// ---------------------------------------------------------------------------
// Tool Registry
// ---------------------------------------------------------------------------

export class ToolRegistry {
	private readonly tools: Map<string, ToolDefinition> = new Map();
	private readonly config: ToolRegistryConfig;
	private router: ITierRouter | null = null;
	private telemetry: ITelemetry | null = null;

	constructor(config?: Partial<ToolRegistryConfig>) {
		this.config = { ...DEFAULT_REGISTRY_CONFIG, ...config };
	}

	/**
	 * Attach a tier router for free/pro delegation.
	 * When set, the registry checks whether tool calls should be
	 * delegated to the daemon before executing locally.
	 */
	setRouter(router: ITierRouter): void {
		this.router = router;
	}

	/**
	 * Attach a telemetry tracker for usage analytics.
	 * When set, all tool executions are tracked for the data flywheel.
	 */
	setTelemetry(telemetry: ITelemetry): void {
		this.telemetry = telemetry;
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
			throw new Error(`Tool "${definition.name}" is already registered`);
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
			const listing: McpToolListing = {
				name: tool.name,
				description: tool.description,
				inputSchema: zodSchemaToJsonSchema(tool.inputSchema),
			};

			if (tool.annotations) {
				listing.annotations = tool.annotations;
			}

			listings.push(listing);
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
	 *   1. Check for early cancellation        → RequestCancelledError
	 *   2. Look up tool by name                → ToolNotFoundError
	 *   3. Parse input with Zod safeParse      → InvalidInputError
	 *   4. Extract mode from parsed input      → InvalidInputError
	 *   5. Look up mode handler                → ModeNotFoundError
	 *   6. Execute handler with timeout        → HandlerExecutionError | RequestTimeoutError
	 *   7. Validate output (if schema exists)  → OutputValidationError
	 *   8. Format result as CallToolResult
	 *
	 * @param name    - Tool name from the MCP `tools/call` request.
	 * @param args    - Raw arguments object from the MCP request.
	 * @param context - Frozen, immutable request-scoped context.
	 * @returns An MCP-compliant `CallToolResult`.
	 */
	async execute(name: string, args: unknown, context: ToolContext): Promise<CallToolResult> {
		const startTime = Date.now();
		let tier: TierMode = "free";
		let mode = "unknown";
		let success = false;

		try {
			const result = await this.executeInternal(name, args, context);

			// Extract mode for telemetry (best effort)
			if (typeof args === "object" && args !== null && "mode" in args) {
				mode = String((args as Record<string, unknown>).mode);
			}
			tier = await this.getCurrentTier();
			success = true;
			return result;
		} finally {
			this.trackToolCall(name, mode, tier, Date.now() - startTime, success);
		}
	}

	// -----------------------------------------------------------------------
	// Internal Execution Pipeline
	// -----------------------------------------------------------------------

	private async executeInternal(name: string, args: unknown, context: ToolContext): Promise<CallToolResult> {
		if (context.signal.aborted) {
			throw new RequestCancelledError();
		}

		const delegated = await this.tryDaemonDelegation(name, args, context);
		if (delegated) {
			return delegated;
		}

		const tool = this.tools.get(name);
		if (!tool) {
			throw new ToolNotFoundError(name);
		}

		const validatedInput = this.validateInput(tool, args);
		const mode = this.extractMode(validatedInput);
		const handler = this.resolveHandler(tool, name, mode);
		const result = await this.invokeHandler(handler, validatedInput, name, mode, context);
		this.validateOutput(tool, result, name, mode, context);

		return this.formatResult(result, tool);
	}

	private async tryDaemonDelegation(
		name: string,
		args: unknown,
		context: ToolContext,
	): Promise<CallToolResult | null> {
		if (!this.router) {
			return null;
		}

		const decision = await this.router.route(name);

		if (decision.action === "upgrade-prompt") {
			return this.formatResult(this.router.createUpgradePrompt(name));
		}

		if (decision.action === "delegate") {
			try {
				return this.formatResult(await this.router.delegate(name, args));
			} catch {
				context.logger.warn(`Daemon delegation failed for ${name}, falling back to local`, {
					tool: name,
				});
			}
		}

		return null;
	}

	private validateInput(tool: ToolDefinition, args: unknown): Record<string, unknown> {
		const parseResult = tool.inputSchema.safeParse(args);
		if (!parseResult.success) {
			const issues = parseResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
			throw new InvalidInputError(issues);
		}
		return parseResult.data as Record<string, unknown>;
	}

	private extractMode(validatedInput: Record<string, unknown>): string {
		const mode = validatedInput.mode;
		if (typeof mode !== "string") {
			throw new InvalidInputError(["mode: Expected a string mode field"]);
		}
		return mode;
	}

	private resolveHandler(tool: ToolDefinition, name: string, mode: string): ToolDefinition["modes"][string] {
		const handler = tool.modes[mode];
		if (!handler) {
			throw new ModeNotFoundError(name, mode);
		}
		return handler;
	}

	private async invokeHandler(
		handler: ToolDefinition["modes"][string],
		input: Record<string, unknown>,
		name: string,
		mode: string,
		context: ToolContext,
	): Promise<unknown> {
		try {
			return await withTimeout(handler(input, context), this.config.defaultTimeoutMs, context.signal);
		} catch (error: unknown) {
			if (error instanceof RequestTimeoutError || error instanceof RequestCancelledError) {
				throw error;
			}
			if (this.config.verbose) {
				const message = error instanceof Error ? error.message : String(error);
				context.logger.error(`Handler error in ${name}/${mode}`, {
					error: message,
					tool: name,
					mode,
				});
			}
			throw new HandlerExecutionError(name, mode);
		}
	}

	private validateOutput(
		tool: ToolDefinition,
		result: unknown,
		name: string,
		mode: string,
		context: ToolContext,
	): void {
		if (!this.config.validateOutputs || !tool.outputSchema) {
			return;
		}

		const outputResult = tool.outputSchema.safeParse(result);
		if (!outputResult.success) {
			const issues = outputResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
			if (this.config.verbose) {
				context.logger.error(`Output validation failed for ${name}/${mode}`, {
					issues,
					tool: name,
					mode,
				});
			}
			throw new OutputValidationError(name, issues);
		}
	}

	// -----------------------------------------------------------------------
	// Router & Telemetry Helpers
	// -----------------------------------------------------------------------

	private async getCurrentTier(): Promise<TierMode> {
		if (!this.router) {
			return "free";
		}
		return this.router.getMode();
	}

	private trackToolCall(tool: string, mode: string, tier: TierMode, durationMs: number, success: boolean): void {
		if (!this.telemetry) {
			return;
		}
		this.telemetry.track({
			event: "tool_call",
			tool,
			mode,
			tier,
			durationMs,
			success,
		});
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/**
	 * Convert an arbitrary handler result to an MCP `CallToolResult`.
	 *
	 * If the result is already a string, it becomes a single text content block.
	 * Otherwise, it is JSON-serialized into a text block.
	 *
	 * When the originating tool has an `outputSchema` and the result is a
	 * non-null object, it is also attached as `structuredContent` so that
	 * MCP clients can consume typed, machine-readable output alongside the
	 * human-readable text.
	 */
	private formatResult(result: unknown, tool?: ToolDefinition): CallToolResult {
		const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);

		const content: TextContent[] = [{ type: "text", text }];

		const callResult: CallToolResult = { content };

		// Attach structuredContent when the tool declares an outputSchema
		// and the handler returned a non-null object.
		if (tool?.outputSchema && typeof result === "object" && result !== null) {
			callResult.structuredContent = result as Record<string, unknown>;
		}

		return callResult;
	}
}
