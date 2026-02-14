/**
 * check — Code validation tool.
 *
 * Modes: quick | full | patterns | build | circular | security
 *        | coverage | orphans | health | evolution | integrations
 *
 * Thin orchestrator that composes validation, security, and graph
 * service calls. Contains no business logic — only service composition
 * and response shaping.
 *
 * @module tools/check
 */

import type { ToolContext } from "../contracts/context.js";
import type { CheckInput } from "../contracts/schemas/tool-inputs.js";
import type {
  IValidationService,
  ISecurityService,
  IGraphService,
  IIntegrationService,
} from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface CheckDeps {
  readonly validationService: IValidationService;
  readonly securityService: ISecurityService;
  readonly graphService: IGraphService;
  readonly integrationService: IIntegrationService;
}

/** Creates check tool mode handlers with injected dependencies. */
export function createCheckHandlers(deps: CheckDeps) {
  return {
    async quick(params: CheckInput, ctx: ToolContext) {
      const result = await deps.validationService.quickCheck({
        workspacePath: ctx.workspacePath,
        files: params.file ? [params.file] : undefined,
      });

      return result.ok ? result.data : null;
    },

    async full(params: CheckInput, ctx: ToolContext) {
      const [validation, security, graphHealth] = await Promise.all([
        deps.validationService.fullCheck({
          workspacePath: ctx.workspacePath,
          files: params.file ? [params.file] : undefined,
        }),
        deps.securityService.scan({
          workspacePath: ctx.workspacePath,
          files: params.file ? [params.file] : undefined,
        }),
        deps.graphService.computeHealth({
          workspacePath: ctx.workspacePath,
        }),
      ]);

      return {
        validation: validation.ok ? validation.data : null,
        security: security.ok ? security.data : null,
        graphHealth: graphHealth.ok ? graphHealth.data : null,
      };
    },

    async patterns(params: CheckInput, ctx: ToolContext) {
      const result = await deps.validationService.checkPatterns({
        workspacePath: ctx.workspacePath,
        code: params.code ?? "",
        filePath: params.file ?? "",
      });

      return result.ok ? result.data : null;
    },

    async build(_params: CheckInput, ctx: ToolContext) {
      const result = await deps.validationService.checkBuild({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },

    async circular(_params: CheckInput, ctx: ToolContext) {
      const result = await deps.graphService.detectCircularDeps({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },

    async security(params: CheckInput, ctx: ToolContext) {
      const result = await deps.securityService.scan({
        workspacePath: ctx.workspacePath,
        files: params.file ? [params.file] : undefined,
      });

      return result.ok ? result.data : null;
    },

    async coverage(_params: CheckInput, ctx: ToolContext) {
      const result = await deps.validationService.checkCoverage({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },

    async orphans(_params: CheckInput, ctx: ToolContext) {
      const result = await deps.graphService.detectOrphans({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },

    async health(_params: CheckInput, ctx: ToolContext) {
      const [validationHealth, graphHealth] = await Promise.all([
        deps.validationService.computeHealthScore({
          workspacePath: ctx.workspacePath,
        }),
        deps.graphService.computeHealth({
          workspacePath: ctx.workspacePath,
        }),
      ]);

      return {
        validationHealth: validationHealth.ok ? validationHealth.data : null,
        graphHealth: graphHealth.ok ? graphHealth.data : null,
      };
    },

    async evolution(_params: CheckInput, ctx: ToolContext) {
      const result = await deps.validationService.analyzeEvolution({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },

    async integrations(_params: CheckInput, ctx: ToolContext) {
      const result = await deps.integrationService.checkConfig({
        workspacePath: ctx.workspacePath,
      });

      return result.ok ? result.data : null;
    },
  };
}
