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
import type { ICacheService } from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface CacheDeps {
  readonly cacheService: ICacheService;
}

/** Creates cache tool mode handlers with injected dependencies. */
export function createCacheHandlers(deps: CacheDeps) {
  return {
    async errors(params: CacheInput, ctx: ToolContext) {
      const result = await deps.cacheService.getErrors({
        workspacePath: ctx.workspacePath,
        refresh: params.value !== undefined,
        limit: undefined,
      });

      return result.ok ? result.data : null;
    },

    async patterns(params: CacheInput, ctx: ToolContext) {
      const result = await deps.cacheService.getPatterns({
        workspacePath: ctx.workspacePath,
        refresh: params.value !== undefined,
        patternFilter: typeof params.key === "string" ? params.key : undefined,
      });

      return result.ok ? result.data : null;
    },
  };
}
