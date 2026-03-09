/**
 * pulse — System health monitoring tool.
 *
 * Modes: health
 *
 * Thin orchestrator that aggregates health checks across validation,
 * integration, and graph services in parallel. Contains no business
 * logic — only service composition and response shaping.
 *
 * @module tools/pulse
 */

import type { ToolContext } from "../contracts/context.js";
import type { PulseInput } from "../contracts/schemas/tool-inputs.js";
import type { IGraphService, IIntegrationService, IValidationService, ServiceResult } from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface PulseDeps {
	readonly validationService: IValidationService;
	readonly integrationService: IIntegrationService;
	readonly graphService: IGraphService;
}

/**
 * Helper to log service errors and extract data.
 */
function unwrapResult<T>(result: ServiceResult<T>, serviceName: string, ctx: ToolContext): T | null {
	if (result.ok) {
		return result.data;
	}
	ctx.logger.warn(`${serviceName} failed`, {
		error: result.error,
		code: result.code,
		requestId: ctx.requestId,
	});
	return null;
}

/** Creates pulse tool mode handlers with injected dependencies. */
export function createPulseHandlers(deps: PulseDeps) {
	return {
		async health(_params: PulseInput, ctx: ToolContext) {
			ctx.progress("Checking system health...", 0);

			const [validationHealth, integrationHealth, graphHealth] = await Promise.all([
				deps.validationService.computeHealthScore({
					workspacePath: ctx.workspacePath,
				}),
				deps.integrationService.checkHealth({
					workspacePath: ctx.workspacePath,
					capabilities: ctx.capabilities,
				}),
				deps.graphService.computeHealth({
					workspacePath: ctx.workspacePath,
				}),
			]);

			ctx.progress("Complete", 100);

			return {
				validationHealth: unwrapResult(validationHealth, "ValidationService.computeHealthScore", ctx),
				integrationHealth,
				graphHealth: unwrapResult(graphHealth, "GraphService.computeHealth", ctx),
			};
		},
	};
}
