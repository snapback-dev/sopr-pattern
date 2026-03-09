/**
 * Router module — Free/Pro tier detection and daemon delegation.
 *
 * SPDX-License-Identifier: MIT
 *
 * @module router
 */

export type { DaemonClientConfig, DaemonHealth, DelegateHealth, RemoteClientConfig } from "./remote-client.js";
export { checkDaemonHealth, checkDelegateHealth, DaemonClient, RemoteClient } from "./remote-client.js";
export type {
	RouteDecision,
	TierMode,
	TierRouterConfig,
	ToolTier,
} from "./tier-router.js";
export { classifyTool, TierRouter } from "./tier-router.js";
