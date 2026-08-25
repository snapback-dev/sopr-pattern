/**
 * Local Router — Default implementation that always routes locally.
 *
 * Use this as the default when no remote executor is configured.
 * All tool calls execute locally in free tier mode.
 *
 * @module adapters/local-router
 */

import type { ITierRouter, RouteDecision, TierMode } from "../contracts/router.js";

/**
 * Local-only router implementation.
 *
 * Always returns `{ action: "local" }` — no delegation, no upgrade prompts.
 * Suitable for OSS deployments where all execution is local.
 *
 * @example
 * ```ts
 * import { LocalRouter } from "@sopr/mcp-server";
 *
 * const router = new LocalRouter();
 * const decision = await router.route("snap"); // { action: "local" }
 * ```
 */
export class LocalRouter implements ITierRouter {
  async route(_toolName: string): Promise<RouteDecision> {
    return { action: "local" };
  }

  async getMode(): Promise<TierMode> {
    return "free";
  }

  async delegate(_toolName: string, _args: unknown): Promise<unknown> {
    throw new Error(
      "LocalRouter does not support delegation. Configure a remote router to delegate tool calls.",
    );
  }

  createUpgradePrompt(toolName: string): unknown {
    return {
      message: `${toolName} is running in local mode. Configure a remote router for enhanced capabilities.`,
    };
  }
}
