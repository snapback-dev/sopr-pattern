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
import type { IGraphService } from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface GraphDeps {
  readonly graphService: IGraphService;
}

/** Creates graph tool mode handlers with injected dependencies. */
export function createGraphHandlers(deps: GraphDeps) {
  return {
    async deps(params: GraphInput, ctx: ToolContext) {
      const result = await deps.graphService.computeDependencyGraph({
        workspacePath: ctx.workspacePath,
        entryPoints: params.entryPoint ? [params.entryPoint] : undefined,
        depth: params.depth,
      });

      return result.ok ? result.data : null;
    },

    async files(params: GraphInput, ctx: ToolContext) {
      const result = await deps.graphService.computeFileGraph({
        workspacePath: ctx.workspacePath,
        rootFile: params.entryPoint,
        depth: params.depth,
      });

      return result.ok ? result.data : null;
    },
  };
}
