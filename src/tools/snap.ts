/**
 * snap — Snapshot lifecycle tool.
 *
 * Modes: start | check | context | end
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
  ISnapshotService,
  ILearningService,
  IIntegrationService,
} from "../contracts/services.js";

/** Service dependencies injected at registration time. */
export interface SnapDeps {
  readonly snapshotService: ISnapshotService;
  readonly learningService: ILearningService;
  readonly integrationService: IIntegrationService;
}

/** Creates snap tool mode handlers with injected dependencies. */
export function createSnapHandlers(deps: SnapDeps) {
  return {
    async start(params: SnapInput, ctx: ToolContext) {
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

      return {
        snapshot: snapshot.ok ? snapshot.data : null,
        learnings: learnings.ok ? learnings.data : null,
        enrichment: enrichment.ok ? enrichment.data : null,
      };
    },

    async check(_params: SnapInput, ctx: ToolContext) {
      const result = await deps.snapshotService.getState({
        workspacePath: ctx.workspacePath,
        sessionId: ctx.sessionId,
      });

      return result.ok ? result.data : null;
    },

    async context(params: SnapInput, ctx: ToolContext) {
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

      return {
        state: state.ok ? state.data : null,
        learnings: learnings.ok ? learnings.data : null,
      };
    },

    async end(params: SnapInput, ctx: ToolContext) {
      const state = await deps.snapshotService.getState({
        workspacePath: ctx.workspacePath,
        sessionId: ctx.sessionId,
      });

      const snapshotId = state.ok ? state.data.activeSnapshotId : null;

      const finalized = snapshotId
        ? await deps.snapshotService.finalize({
            workspacePath: ctx.workspacePath,
            sessionId: ctx.sessionId,
            snapshotId,
            outcome: "completed",
          })
        : null;

      const recorded = await deps.learningService.recordBatch({
        workspacePath: ctx.workspacePath,
        learnings: params.keywords ?? [],
        sessionId: ctx.sessionId,
      });

      return {
        finalized: finalized?.ok ? finalized.data : null,
        recorded: recorded.ok ? recorded.data : null,
      };
    },
  };
}
