/**
 * graph — Dependency analysis tool.
 *
 * Modes: deps | files
 *
 * Thin orchestrator that delegates to the GraphService.
 * Contains no business logic — only parameter mapping and
 * response shaping.
 *
 * @module tools/graph
 */

import type { ToolContext } from "../contracts/context.js";
import type { GraphInput } from "../contracts/schemas/tool-inputs.js";
import type { IGraphService, ServiceResult } from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface GraphDeps {
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

/** Creates graph tool mode handlers with injected dependencies. */
export function createGraphHandlers(deps: GraphDeps) {
	return {
		async deps(params: GraphInput, ctx: ToolContext) {
			ctx.progress("Computing dependency graph...", 0);

			const result = await deps.graphService.computeDependencyGraph({
				workspacePath: ctx.workspacePath,
				entryPoints: params.entryPoint ? [params.entryPoint] : undefined,
				depth: params.depth,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "GraphService.computeDependencyGraph", ctx);
		},

		async files(params: GraphInput, ctx: ToolContext) {
			ctx.progress("Computing file graph...", 0);

			const result = await deps.graphService.computeFileGraph({
				workspacePath: ctx.workspacePath,
				rootFile: params.entryPoint,
				depth: params.depth,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "GraphService.computeFileGraph", ctx);
		},
	};
}
