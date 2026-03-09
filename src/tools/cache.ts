/**
 * cache — Data caching tool.
 *
 * Modes: errors | patterns
 *
 * Thin orchestrator that delegates to the CacheService.
 * Contains no business logic — only parameter mapping and
 * response shaping.
 *
 * @module tools/cache
 */

import type { ToolContext } from "../contracts/context.js";
import type { CacheInput } from "../contracts/schemas/tool-inputs.js";
import type { ICacheService, ServiceResult } from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface CacheDeps {
	readonly cacheService: ICacheService;
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

/** Creates cache tool mode handlers with injected dependencies. */
export function createCacheHandlers(deps: CacheDeps) {
	return {
		async errors(params: CacheInput, ctx: ToolContext) {
			ctx.progress("Fetching error cache...", 0);

			const result = await deps.cacheService.getErrors({
				workspacePath: ctx.workspacePath,
				refresh: params.value !== undefined,
				limit: undefined,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "CacheService.getErrors", ctx);
		},

		async patterns(params: CacheInput, ctx: ToolContext) {
			ctx.progress("Fetching pattern cache...", 0);

			const result = await deps.cacheService.getPatterns({
				workspacePath: ctx.workspacePath,
				refresh: params.value !== undefined,
				patternFilter: typeof params.key === "string" ? params.key : undefined,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "CacheService.getPatterns", ctx);
		},
	};
}
