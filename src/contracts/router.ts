/**
 * ITierRouter — Port interface for tier-based routing decisions.
 *
 * The registry depends on this interface, never on a concrete router
 * implementation. Proprietary adapters (e.g. daemon-backed routing)
 * implement this interface outside the OSS core.
 *
 * @module contracts/router
 */

// ---------------------------------------------------------------------------
// Route Decision
// ---------------------------------------------------------------------------

/**
 * The outcome of a routing decision for a tool call.
 *
 * - `"local"`          — Execute the tool locally.
 * - `"delegate"`       — Forward the call to a remote executor (e.g. daemon).
 * - `"upgrade-prompt"` — Return an upgrade prompt instead of executing.
 */
export type RouteDecision =
	| { readonly action: "local" }
	| { readonly action: "delegate" }
	| { readonly action: "upgrade-prompt" };

// ---------------------------------------------------------------------------
// Tier Mode
// ---------------------------------------------------------------------------

/**
 * The current tier the server is operating in.
 *
 * Implementations determine tier based on their own logic (daemon
 * detection, license checks, config files, etc.).
 */
export type TierMode = "free" | "pro" | "enterprise";

// ---------------------------------------------------------------------------
// ITierRouter Interface
// ---------------------------------------------------------------------------

/**
 * Port interface for tier-based routing.
 *
 * The registry calls `route()` before every tool execution to determine
 * whether the call should run locally, be delegated, or trigger an
 * upgrade prompt.
 *
 * @example
 * ```ts
 * // No-op router that always runs locally (default for OSS)
 * const localRouter: ITierRouter = {
 *   route: async () => ({ action: "local" }),
 *   getMode: async () => "free",
 *   delegate: async () => { throw new Error("No delegation configured"); },
 *   createUpgradePrompt: (tool) => `${tool} requires an upgrade.`,
 * };
 * ```
 */
export interface ITierRouter {
	/** Decide how to handle a tool call. */
	route(toolName: string): Promise<RouteDecision>;

	/** Return the current tier mode. */
	getMode(): Promise<TierMode>;

	/** Delegate a tool call to a remote executor. */
	delegate(toolName: string, args: unknown): Promise<unknown>;

	/** Generate an upgrade prompt response for the given tool. */
	createUpgradePrompt(toolName: string): unknown;
}
