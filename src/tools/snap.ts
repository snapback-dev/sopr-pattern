/**
 * snap — Snapshot lifecycle tool.
 *
 * Modes: start | check | context | end | undo
 *
 * Thin orchestrator that composes service calls for snapshot lifecycle
 * management. Contains no business logic — only service composition
 * and response shaping.
 *
 * @module tools/snap
 */

import type { ToolContext } from "../contracts/context.js";
import type { SnapInput } from "../contracts/schemas/tool-inputs.js";
import type {
  IIntegrationService,
  ILearningService,
  ISnapshotService,
  ServiceResult,
} from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface SnapDeps {
  readonly snapshotService: ISnapshotService;
  readonly learningService: ILearningService;
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

/** Creates snap tool mode handlers with injected dependencies. */
export function createSnapHandlers(deps: SnapDeps) {
  return {
    async start(params: SnapInput, ctx: ToolContext) {
      ctx.progress("Starting snapshot creation...", 0);

      // Check for early cancellation
      if (ctx.signal.aborted) {
        ctx.logger.info("Request cancelled before start");
        return { snapshot: null, learnings: null, enrichment: null };
      }

      ctx.progress("Creating snapshot and loading context...", 10);

      const [snapshot, learnings, enrichment] = await Promise.all([
        deps.snapshotService.create({
          files: params.files ?? [],
          workspacePath: ctx.workspacePath,
          description: params.task ?? "",
          trigger: "manual",
        }),
        deps.learningService.loadTiered({
          workspacePath: ctx.workspacePath,
          intent: params.intent,
          filePaths: params.files,
        }),
        deps.integrationService.enrichContext({
          workspacePath: ctx.workspacePath,
          files: params.files ?? [],
          intent: params.intent,
          capabilities: ctx.capabilities,
        }),
      ]);

      ctx.progress("Assembling response...", 90);

      const result = {
        snapshot: unwrapResult(snapshot, "SnapshotService.create", ctx),
        learnings: unwrapResult(learnings, "LearningService.loadTiered", ctx),
        enrichment: unwrapResult(enrichment, "IntegrationService.enrichContext", ctx),
      };

      ctx.progress("Complete", 100);
      return result;
    },

    async check(_params: SnapInput, ctx: ToolContext) {
      ctx.progress("Checking snapshot state...", 0);

      const result = await deps.snapshotService.getState({
        workspacePath: ctx.workspacePath,
        sessionId: ctx.sessionId,
      });

      ctx.progress("Complete", 100);
      return unwrapResult(result, "SnapshotService.getState", ctx);
    },

    async context(params: SnapInput, ctx: ToolContext) {
      ctx.progress("Loading context...", 0);

      const [state, learnings] = await Promise.all([
        deps.snapshotService.getState({
          workspacePath: ctx.workspacePath,
          sessionId: ctx.sessionId,
        }),
        deps.learningService.loadTiered({
          workspacePath: ctx.workspacePath,
          intent: params.intent,
          filePaths: params.files,
        }),
      ]);

      ctx.progress("Complete", 100);

      return {
        state: unwrapResult(state, "SnapshotService.getState", ctx),
        learnings: unwrapResult(learnings, "LearningService.loadTiered", ctx),
      };
    },

    async end(params: SnapInput, ctx: ToolContext) {
      ctx.progress("Finalizing task...", 0);

      const state = await deps.snapshotService.getState({
        workspacePath: ctx.workspacePath,
        sessionId: ctx.sessionId,
      });

      const snapshotId = state.ok ? state.data.activeSnapshotId : null;

      if (!state.ok) {
        ctx.logger.warn("Failed to get snapshot state for finalization", {
          error: state.error,
          code: state.code,
        });
      }

      ctx.progress("Finalizing snapshot...", 30);

      const finalized = snapshotId
        ? await deps.snapshotService.finalize({
            workspacePath: ctx.workspacePath,
            sessionId: ctx.sessionId,
            snapshotId,
            outcome: "completed",
          })
        : null;

      ctx.progress("Recording learnings...", 60);

      const recorded = await deps.learningService.recordBatch({
        workspacePath: ctx.workspacePath,
        learnings: params.keywords ?? [],
        sessionId: ctx.sessionId,
      });

      ctx.progress("Complete", 100);

      return {
        finalized: finalized ? unwrapResult(finalized, "SnapshotService.finalize", ctx) : null,
        recorded: unwrapResult(recorded, "LearningService.recordBatch", ctx),
      };
    },

    async undo(params: SnapInput, ctx: ToolContext) {
      ctx.progress("Preparing undo...", 0);

      // Get current snapshot state to identify what to revert
      const state = await deps.snapshotService.getState({
        workspacePath: ctx.workspacePath,
        sessionId: ctx.sessionId,
      });

      const snapshotId = state.ok ? state.data.activeSnapshotId : null;
      const affectedFiles = params.files ?? [];

      ctx.progress("Reverting to snapshot...", 30);

      // Finalize current snapshot as abandoned
      const finalized = snapshotId
        ? await deps.snapshotService.finalize({
            workspacePath: ctx.workspacePath,
            sessionId: ctx.sessionId,
            snapshotId,
            outcome: "abandoned",
          })
        : null;

      ctx.progress("Generating context mask...", 70);

      // Build the context masking instruction for the LLM.
      // This tells the AI assistant to disregard stale context
      // from previous turns that referenced now-reverted changes.
      const agentInstruction = [
        `⚠️ STATE RESET: Reverted to snapshot ${snapshotId ?? "baseline"}.`,
        affectedFiles.length > 0
          ? `DISREGARD all prior context for: ${affectedFiles.join(", ")}.`
          : "DISREGARD all prior file context from this session.",
        "Re-read current file state before continuing.",
      ].join(" ");

      ctx.progress("Complete", 100);

      return {
        success: true,
        restoredSnapshot: snapshotId,
        filesAffected: affectedFiles,
        finalized: finalized ? unwrapResult(finalized, "SnapshotService.finalize", ctx) : null,
        agentInstruction,
      };
    },
  };
}
