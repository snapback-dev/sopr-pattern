/**
 * Router module — Free/Pro tier detection and daemon delegation.
 *
 * SPDX-License-Identifier: MIT
 *
 * @module router
 */

export type { DaemonClientConfig, DaemonHealth } from "./daemon-client.js";
export { checkDaemonHealth, DaemonClient } from "./daemon-client.js";
export type {
  RouteDecision,
  TierMode,
  TierRouterConfig,
  ToolTier,
} from "./tier-router.js";
export { classifyTool, TierRouter } from "./tier-router.js";
