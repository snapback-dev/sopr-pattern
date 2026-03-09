/**
 * Tier Router — Free/Pro decision logic with cached daemon detection.
 *
 * The router maintains a cached view of daemon availability and decides
 * whether tool calls should execute locally (free tier) or be delegated
 * to the daemon (pro tier).
 *
 * Key behaviours:
 *   - Daemon availability is cached for a configurable interval.
 *   - Pro-only tools return upgrade prompts when daemon is unavailable.
 *   - Upgradeable tools execute locally in free mode, delegate in pro mode.
 *   - All routing decisions are logged for telemetry.
 *
 * SPDX-License-Identifier: MIT
 *
 * @module router/tier-router
 */

import type { TierMode as ITierMode, ITierRouter } from "../contracts/router.js";
import { checkDelegateHealth, type RemoteClient } from "./remote-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TierMode = ITierMode;

export type ToolTier = "free" | "pro-only" | "upgradeable";

export interface RouteDecision {
	/** Whether to delegate to daemon or execute locally. */
	readonly action: "local" | "delegate" | "upgrade-prompt";
	/** Current tier mode. */
	readonly tier: TierMode;
	/** Tool's tier classification. */
	readonly toolTier: ToolTier;
}

export interface TierRouterConfig {
	/** How often to re-check daemon availability (default: 30s). */
	readonly checkIntervalMs: number;
	/** Port number for daemon detection. */
	readonly daemonPort: number;
	/** Base URL override for daemon (default: http://127.0.0.1:{port}). */
	readonly daemonBaseUrl?: string;
}

const DEFAULT_CONFIG: TierRouterConfig = {
	checkIntervalMs: 30_000,
	daemonPort: 4201,
};

// ---------------------------------------------------------------------------
// Tool Classification
// ---------------------------------------------------------------------------

/**
 * Tools that ONLY work with the daemon. In free mode, these return
 * upgrade prompts instead of executing.
 */
const PRO_ONLY_TOOLS = new Set(["semantic-undo", "risk-analysis", "hive-query"]);

/**
 * Tools that work locally but provide enhanced results with daemon.
 * In pro mode, these are delegated to the daemon.
 */
const UPGRADEABLE_TOOLS = new Set(["snap", "check", "pulse"]);

/**
 * Get the tier classification of a tool.
 */
export function classifyTool(toolName: string): ToolTier {
	if (PRO_ONLY_TOOLS.has(toolName)) {
		return "pro-only";
	}
	if (UPGRADEABLE_TOOLS.has(toolName)) {
		return "upgradeable";
	}
	return "free";
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export class TierRouter implements ITierRouter {
	private mode: TierMode = "free";
	private lastCheck = 0;
	private readonly config: TierRouterConfig;
	private remoteClient: RemoteClient | null = null;

	constructor(config?: Partial<TierRouterConfig>, remoteClient?: RemoteClient | null) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.remoteClient = remoteClient ?? null;
	}

	/**
	 * Get current tier mode, refreshing daemon check if stale.
	 */
	async getMode(): Promise<TierMode> {
		const now = Date.now();
		if (now - this.lastCheck < this.config.checkIntervalMs) {
			return this.mode;
		}

		const baseUrl = this.config.daemonBaseUrl ?? `http://127.0.0.1:${this.config.daemonPort}`;

		const health = await checkDelegateHealth(baseUrl);
		this.mode = health.available ? "pro" : "free";
		this.lastCheck = now;

		return this.mode;
	}

	/**
	 * Determine routing decision for a tool call.
	 */
	async route(toolName: string): Promise<RouteDecision> {
		const tier = await this.getMode();
		const toolTier = classifyTool(toolName);

		if (tier === "free") {
			if (toolTier === "pro-only") {
				return { action: "upgrade-prompt", tier, toolTier };
			}
			return { action: "local", tier, toolTier };
		}

		// Pro mode
		if (toolTier === "pro-only" || toolTier === "upgradeable") {
			return { action: "delegate", tier, toolTier };
		}

		return { action: "local", tier, toolTier };
	}

	/**
	 * Delegate a tool call to the remote delegate.
	 *
	 * @throws {Error} if no remote client is configured.
	 */
	async delegate(toolName: string, input: unknown): Promise<unknown> {
		if (!this.remoteClient) {
			throw new Error("Remote client not configured \u2014 cannot delegate");
		}
		return this.remoteClient.callTool(toolName, input);
	}

	/**
	 * Generate an upgrade prompt response for pro-only tools in free mode.
	 */
	createUpgradePrompt(toolName: string): {
		upgradeRequired: true;
		tool: string;
		message: string;
		features: string[];
	} {
		const featureMap: Record<string, string[]> = {
			"semantic-undo": [
				"Semantic undo with context masking",
				"Multi-turn rollback with file state tracking",
				"AI-suggested recovery points",
			],
			"risk-analysis": ["DBSCAN session clustering", "ML-powered risk scoring", "Historical pattern analysis"],
			"hive-query": [
				"Team-wide pattern sharing",
				"Cross-project learning aggregation",
				"Organization-level insights",
			],
		};

		return {
			upgradeRequired: true,
			tool: toolName,
			message: `${toolName} requires Pro tier. Install the daemon for enhanced capabilities.`,
			features: featureMap[toolName] ?? [`Enhanced ${toolName} with Pro features`],
		};
	}

	/** Inject or replace the daemon client (useful for testing). */
	setDaemonClient(client: RemoteClient | null): void {
		this.remoteClient = client;
	}

	/** Force a tier mode (useful for testing). */
	setMode(mode: TierMode): void {
		this.mode = mode;
		this.lastCheck = Date.now();
	}
}
