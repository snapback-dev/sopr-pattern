/**
 * Tool Definition Factories (Composition Root)
 *
 * Creates complete {@link ToolDefinition} objects by wiring Zod input schemas,
 * handler factory outputs, and MCP annotations together. These are the objects
 * that consumers register in the {@link ToolRegistry}.
 *
 * This module lives at the src/ root level (outside any layer directory)
 * because it's a composition root that bridges Layer 2 (Registry types)
 * and Layer 3 (Tool handler factories). Neither layer may import the other
 * directly, but this wiring module is exempt from those constraints.
 *
 * Phase 4a (Read-Only): pulse + help
 *
 * @module definitions
 */

import type { HelpInput, PulseInput } from "./contracts/schemas/tool-inputs.js";
import { HelpInputSchema, PulseInputSchema } from "./contracts/schemas/tool-inputs.js";
import type { ToolDefinition } from "./registry/types.js";
import { createHelpHandlers } from "./tools/help.js";
import { createPulseHandlers, type PulseDeps } from "./tools/pulse.js";

// ---------------------------------------------------------------------------
// Individual Tool Definition Factories
// ---------------------------------------------------------------------------

/**
 * Create the `pulse` ToolDefinition.
 *
 * Pulse is a read-only health monitoring tool that aggregates status from
 * validation, integration, and graph services in parallel.
 *
 * @param deps - Service dependencies for the pulse handler.
 * @returns A registrable ToolDefinition for the pulse tool.
 */
export function createPulseToolDef(deps: PulseDeps): ToolDefinition<PulseInput> {
	return {
		name: "pulse",
		description: "System health. Modes: health (aggregate service and codebase status).",
		inputSchema: PulseInputSchema,
		annotations: {
			title: "System Health",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
		},
		modes: createPulseHandlers(deps),
	};
}

/**
 * Create the `help` ToolDefinition.
 *
 * Help is a pure documentation tool with no service dependencies.
 * It returns plain text for maximum LLM comprehension.
 *
 * @returns A registrable ToolDefinition for the help tool.
 */
export function createHelpToolDef(): ToolDefinition<HelpInput> {
	return {
		name: "help",
		description: "Tool discovery and documentation. Modes: tools, wire, modes, thresholds, decision, status, all.",
		inputSchema: HelpInputSchema,
		annotations: {
			title: "Help & Discovery",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
		},
		modes: createHelpHandlers(),
	};
}

// ---------------------------------------------------------------------------
// Composite Factory
// ---------------------------------------------------------------------------

/**
 * Dependencies for all read-only tools (Phase 4a).
 *
 * Pulse requires service dependencies; help has none.
 */
export interface ReadOnlyToolDeps {
	readonly pulse: PulseDeps;
}

/**
 * Create all read-only ToolDefinitions (Phase 4a).
 *
 * Returns an array of ToolDefinition objects ready for registration:
 * - `pulse` — system health monitoring
 * - `help`  — tool discovery and documentation
 *
 * @param deps - Service dependencies for tools that need them.
 * @returns Array of registrable ToolDefinition objects.
 *
 * @example
 * ```ts
 * import { createReadOnlyTools, createSOPRServer } from "@snapback-oss/sopr-mcp";
 *
 * const tools = createReadOnlyTools({
 *   pulse: {
 *     validationService: myValidationService,
 *     integrationService: myIntegrationService,
 *     graphService: myGraphService,
 *   },
 * });
 *
 * const server = createSOPRServer({
 *   serverName: "my-server",
 *   serverVersion: "1.0.0",
 *   workspacePath: process.cwd(),
 *   tools,
 * });
 * ```
 */
export function createReadOnlyTools(deps: ReadOnlyToolDeps): ToolDefinition[] {
	// Cast to unparameterized ToolDefinition for array compatibility.
	// Safe: the ToolRegistry validates inputs via .safeParse() before dispatch.
	return [createPulseToolDef(deps.pulse) as ToolDefinition, createHelpToolDef() as ToolDefinition];
}
