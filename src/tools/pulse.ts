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
import type {
  IValidationService,
  IIntegrationService,
  IGraphService,
} from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface PulseDeps {
  readonly validationService: IValidationService;
  readonly integrationService: IIntegrationService;
  readonly graphService: IGraphService;
}

/** Creates pulse tool mode handlers with injected dependencies. */
export function createPulseHandlers(deps: PulseDeps) {
  return {
    async health(_params: PulseInput, ctx: ToolContext) {
      const [validationHealth, integrationHealth, graphHealth] =
        await Promise.all([
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

      return {
        validationHealth: validationHealth.ok ? validationHealth.data : null,
        integrationHealth,
        graphHealth: graphHealth.ok ? graphHealth.data : null,
      };
    },
  };
}
