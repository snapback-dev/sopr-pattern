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
  IGraphService,
  IIntegrationService,
  ISecurityService,
  IValidationService,
  ServiceResult,
} from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface CheckDeps {
  readonly validationService: IValidationService;
  readonly securityService: ISecurityService;
  readonly graphService: IGraphService;
  readonly integrationService: IIntegrationService;
}

/**
 * Helper to log service errors and extract data.
 * Returns null on error, logs warning with context.
 */
function unwrapResult<T>(
  result: ServiceResult<T>,
  serviceName: string,
  ctx: ToolContext,
): T | null {
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

/** Creates check tool mode handlers with injected dependencies. */
export function createCheckHandlers(deps: CheckDeps) {
  return {
    async quick(params: CheckInput, ctx: ToolContext) {
      ctx.progress("Running quick validation...", 0);

      const result = await deps.validationService.quickCheck({
        workspacePath: ctx.workspacePath,
        files: params.file ? [params.file] : undefined,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "ValidationService.quickCheck", ctx);
    },

    async full(params: CheckInput, ctx: ToolContext) {
      ctx.progress("Starting full validation...", 0);

      // Check for cancellation before starting long operation
      if (ctx.signal.aborted) {
        ctx.logger.info("Request cancelled before full check");
        return { validation: null, security: null, graphHealth: null };
      }

      ctx.progress("Running validation, security scan, and graph analysis...", 10);

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

      ctx.progress("Complete", 100);

      return {
        validation: unwrapResult(validation, "ValidationService.fullCheck", ctx),
        security: unwrapResult(security, "SecurityService.scan", ctx),
        graphHealth: unwrapResult(graphHealth, "GraphService.computeHealth", ctx),
      };
    },

    async patterns(params: CheckInput, ctx: ToolContext) {
      ctx.progress("Checking patterns...", 0);

      const result = await deps.validationService.checkPatterns({
        workspacePath: ctx.workspacePath,
        code: params.code ?? "",
        filePath: params.file ?? "",
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "ValidationService.checkPatterns", ctx);
    },

    async build(_params: CheckInput, ctx: ToolContext) {
      ctx.progress("Running build check...", 0);

      const result = await deps.validationService.checkBuild({
        workspacePath: ctx.workspacePath,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "ValidationService.checkBuild", ctx);
    },

    async circular(_params: CheckInput, ctx: ToolContext) {
      ctx.progress("Detecting circular dependencies...", 0);

      const result = await deps.graphService.detectCircularDeps({
        workspacePath: ctx.workspacePath,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "GraphService.detectCircularDeps", ctx);
    },

    async security(params: CheckInput, ctx: ToolContext) {
      ctx.progress("Running security scan...", 0);

      const result = await deps.securityService.scan({
        workspacePath: ctx.workspacePath,
        files: params.file ? [params.file] : undefined,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "SecurityService.scan", ctx);
    },

    async coverage(_params: CheckInput, ctx: ToolContext) {
      ctx.progress("Analyzing test coverage...", 0);

      const result = await deps.validationService.checkCoverage({
        workspacePath: ctx.workspacePath,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "ValidationService.checkCoverage", ctx);
    },

    async orphans(_params: CheckInput, ctx: ToolContext) {
      ctx.progress("Detecting orphaned files...", 0);

      const result = await deps.graphService.detectOrphans({
        workspacePath: ctx.workspacePath,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "GraphService.detectOrphans", ctx);
    },

    async health(_params: CheckInput, ctx: ToolContext) {
      ctx.progress("Computing health scores...", 0);

      const [validationHealth, graphHealth] = await Promise.all([
        deps.validationService.computeHealthScore({
          workspacePath: ctx.workspacePath,
        }),
        deps.graphService.computeHealth({
          workspacePath: ctx.workspacePath,
        }),
      ]);

      ctx.progress("Complete", 100);

      return {
        validationHealth: unwrapResult(
          validationHealth,
          "ValidationService.computeHealthScore",
          ctx,
        ),
        graphHealth: unwrapResult(graphHealth, "GraphService.computeHealth", ctx),
      };
    },

    async evolution(_params: CheckInput, ctx: ToolContext) {
      ctx.progress("Analyzing evolution...", 0);

      const result = await deps.validationService.analyzeEvolution({
        workspacePath: ctx.workspacePath,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "ValidationService.analyzeEvolution", ctx);
    },

    async integrations(_params: CheckInput, ctx: ToolContext) {
      ctx.progress("Checking integrations...", 0);

      const result = await deps.integrationService.checkConfig({
        workspacePath: ctx.workspacePath,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "IntegrationService.checkConfig", ctx);
    },
  };
}
