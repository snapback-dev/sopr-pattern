/**
 * Risk Service — Open-source stub for risk analysis.
 *
 * In the free tier, this provides basic heuristic risk scoring based on
 * file count and change patterns. The full implementation (DBSCAN clustering,
 * ML-powered scoring, historical analysis) lives in the proprietary daemon.
 *
 * SPDX-License-Identifier: MIT
 * Part of the Open Core — Free tier functionality.
 * Full implementation requires the Pro daemon.
 *
 * @module services/risk-service
 */

import type { ServiceResult } from "../contracts/services.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskAnalysisInput {
	readonly workspacePath: string;
	readonly files: readonly string[];
	readonly intent?: string;
}

export interface RiskAnalysisResult {
	/** Normalized risk score between 0 (safe) and 100 (critical). */
	readonly score: number;
	/** Human-readable risk level. */
	readonly level: "low" | "medium" | "high" | "unknown";
	/** Explanation of the risk assessment. */
	readonly message: string;
	/** Whether enhanced analysis is available via daemon. */
	readonly upgradeAvailable: boolean;
	/** Features available with daemon upgrade. */
	readonly proFeatures?: readonly string[];
}

export interface IRiskService {
	analyze(input: RiskAnalysisInput): Promise<ServiceResult<RiskAnalysisResult>>;
}

// ---------------------------------------------------------------------------
// Implementation (Free Tier Stub)
// ---------------------------------------------------------------------------

export class RiskServiceImpl implements IRiskService {
	constructor(private readonly logger: Logger) {}

	async analyze(input: RiskAnalysisInput): Promise<ServiceResult<RiskAnalysisResult>> {
		const fileCount = input.files.length;

		// Basic heuristic: more files = higher risk
		let score: number;
		let level: RiskAnalysisResult["level"];

		if (fileCount === 0) {
			score = 0;
			level = "low";
		} else if (fileCount <= 3) {
			score = 20;
			level = "low";
		} else if (fileCount <= 10) {
			score = 45;
			level = "medium";
		} else {
			score = 65;
			level = "high";
		}

		this.logger.info("Risk analysis (free tier)", {
			fileCount,
			score,
			level,
		});

		return {
			ok: true,
			data: {
				score,
				level,
				message: `Basic heuristic: ${fileCount} file(s) → ${level} risk. Pro tier offers DBSCAN clustering and ML scoring.`,
				upgradeAvailable: true,
				proFeatures: [
					"DBSCAN session clustering",
					"ML-powered risk scoring",
					"Historical pattern analysis",
					"Cross-project risk correlation",
				],
			},
		};
	}
}
