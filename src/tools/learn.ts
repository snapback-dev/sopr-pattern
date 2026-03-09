/**
 * learn — Knowledge management tool.
 *
 * Modes: load | save | search
 *
 * Thin orchestrator that delegates to the LearningService.
 * Contains no business logic — only parameter mapping and
 * response shaping.
 *
 * @module tools/learn
 */

import type { ToolContext } from "../contracts/context.js";
import type { LearnInput } from "../contracts/schemas/tool-inputs.js";
import type { ILearningService, LearningType, ServiceResult } from "../contracts/services.js";

/** Default learning type when none specified. */
const DEFAULT_LEARNING_TYPE: LearningType = "pattern";

/** Maps schema pattern types to service learning types. */
const LEARNING_TYPE_MAP: Readonly<Record<string, LearningType>> = {
	pat: "pattern",
	pit: "pitfall",
	eff: "efficiency",
	disc: "discovery",
	wf: "workflow",
};

/** Service dependencies injected at registration time. */
export interface LearnDeps {
	readonly learningService: ILearningService;
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

/** Creates learn tool mode handlers with injected dependencies. */
export function createLearnHandlers(deps: LearnDeps) {
	return {
		async load(params: LearnInput, ctx: ToolContext) {
			ctx.progress("Loading learnings...", 0);

			const result = await deps.learningService.loadTiered({
				workspacePath: ctx.workspacePath,
				intent: params.intent,
				filePaths: params.filePaths,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "LearningService.loadTiered", ctx);
		},

		async save(params: LearnInput, ctx: ToolContext) {
			ctx.progress("Saving learning...", 0);

			const result = await deps.learningService.save({
				workspacePath: ctx.workspacePath,
				trigger: params.trigger ?? "",
				action: params.action ?? "",
				type: LEARNING_TYPE_MAP[params.type ?? "pat"] ?? DEFAULT_LEARNING_TYPE,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "LearningService.save", ctx);
		},

		async search(params: LearnInput, ctx: ToolContext) {
			ctx.progress("Searching learnings...", 0);

			const result = await deps.learningService.search({
				workspacePath: ctx.workspacePath,
				query: params.query ?? "",
				type: params.type ? LEARNING_TYPE_MAP[params.type] : undefined,
			});

			ctx.progress("Complete", 100);
			return unwrapResult(result, "LearningService.search", ctx);
		},
	};
}
