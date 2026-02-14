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
import type { IIntegrationService } from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface IntegrateDeps {
  readonly integrationService: IIntegrationService;
}

/** Creates integrate tool mode handlers with injected dependencies. */
export function createIntegrateHandlers(deps: IntegrateDeps) {
  return {
    async git(_params: IntegrateInput, ctx: ToolContext) {
      const result = await deps.integrationService.getGitContext({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },

    async sentry(_params: IntegrateInput, ctx: ToolContext) {
      const result = await deps.integrationService.getSentryContext({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },

    async github(_params: IntegrateInput, ctx: ToolContext) {
      const result = await deps.integrationService.getGitHubContext({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },
  };
}
