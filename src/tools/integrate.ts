/**
 * integrate — External integrations tool.
 *
 * Modes: git | sentry | github
 *
 * Thin orchestrator that delegates to the IntegrationService.
 * Contains no business logic — only parameter mapping and
 * response shaping.
 *
 * @module tools/integrate
 */

import type { ToolContext } from "../contracts/context.js";
import type { IntegrateInput } from "../contracts/schemas/tool-inputs.js";
import type { IIntegrationService, ServiceResult } from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface IntegrateDeps {
	readonly integrationService: IIntegrationService;
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

/** Creates integrate tool mode handlers with injected dependencies. */
export function createIntegrateHandlers(deps: IntegrateDeps) {
	return {
		async git(_params: IntegrateInput, ctx: ToolContext) {
			ctx.progress("Fetching git context...", 0);

			const result = await deps.integrationService.getGitContext({
				workspacePath: ctx.workspacePath,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "IntegrationService.getGitContext", ctx);
		},

		async sentry(_params: IntegrateInput, ctx: ToolContext) {
			ctx.progress("Fetching Sentry context...", 0);

			const result = await deps.integrationService.getSentryContext({
				workspacePath: ctx.workspacePath,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "IntegrationService.getSentryContext", ctx);
		},

		async github(_params: IntegrateInput, ctx: ToolContext) {
			ctx.progress("Fetching GitHub context...", 0);

			const result = await deps.integrationService.getGitHubContext({
				workspacePath: ctx.workspacePath,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "IntegrationService.getGitHubContext", ctx);
		},
	};
}
