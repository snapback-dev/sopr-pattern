/**
 * Remote Client — HTTP client for communicating with a Pro tier delegate.
 *
 * The delegate runs as a separate process on a configurable port
 * and exposes enhanced tool execution via HTTP. This client handles:
 *   - Health checks with fast timeout for detection
 *   - Tool delegation via POST requests
 *   - Version compatibility validation
 *
 * SPDX-License-Identifier: MIT
 *
 * @module router/remote-client
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelegateHealth {
	readonly available: boolean;
	readonly version?: string;
	readonly uptime?: number;
}

export interface RemoteClientConfig {
	/** Base URL of the delegate HTTP server. */
	readonly baseUrl: string;
	/** Workspace root path sent in request headers. */
	readonly workspaceRoot: string;
	/** Timeout for health checks in milliseconds (default: 500ms). */
	readonly healthTimeoutMs: number;
	/** Timeout for tool calls in milliseconds (default: 30s). */
	readonly callTimeoutMs: number;
}

/** Maximum response body size (10 MB). */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

const DEFAULT_CONFIG: Omit<RemoteClientConfig, "workspaceRoot"> = {
	baseUrl: "http://127.0.0.1:4201",
	healthTimeoutMs: 500,
	callTimeoutMs: 30_000,
};

// ---------------------------------------------------------------------------
// Health Check (standalone function)
// ---------------------------------------------------------------------------

/**
 * Check if the delegate is running on the specified port.
 *
 * Uses a fast timeout (500ms) to avoid blocking the MCP server
 * when the delegate is not present.
 */
export async function checkDelegateHealth(
	baseUrl = DEFAULT_CONFIG.baseUrl,
	timeoutMs = DEFAULT_CONFIG.healthTimeoutMs,
): Promise<DelegateHealth> {
	try {
		const response = await fetch(`${baseUrl}/health`, {
			signal: AbortSignal.timeout(timeoutMs),
		});

		if (!response.ok) {
			return { available: false };
		}

		const text = await response.text();
		if (text.length > MAX_RESPONSE_BYTES) {
			return { available: false };
		}

		const body = JSON.parse(text) as Record<string, unknown>;

		return {
			available: true,
			version: typeof body.version === "string" ? body.version : undefined,
			uptime: typeof body.uptime === "number" ? body.uptime : undefined,
		};
	} catch {
		return { available: false };
	}
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class RemoteClient {
	private readonly config: RemoteClientConfig;

	constructor(config: Partial<RemoteClientConfig> & { workspaceRoot: string }) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Check delegate availability.
	 */
	async isAvailable(): Promise<boolean> {
		const health = await checkDelegateHealth(this.config.baseUrl, this.config.healthTimeoutMs);
		return health.available;
	}

	/**
	 * Delegate a tool call to the remote process.
	 *
	 * @param toolName - Tool to execute (e.g. "snap", "check").
	 * @param input    - Validated input payload.
	 * @returns The delegate's response payload.
	 * @throws {Error} If the delegate returns a non-OK status.
	 */
	async callTool(toolName: string, input: unknown): Promise<unknown> {
		const response = await fetch(`${this.config.baseUrl}/tools/${encodeURIComponent(toolName)}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Workspace-Root": this.config.workspaceRoot,
			},
			body: JSON.stringify(input),
			signal: AbortSignal.timeout(this.config.callTimeoutMs),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "unknown error");
			throw new Error(`Delegate returned ${response.status} for ${toolName}: ${text}`);
		}

		// SECURITY: Enforce response size limit to prevent memory exhaustion
		// from a compromised or malicious delegate.
		const text = await response.text();
		if (text.length > MAX_RESPONSE_BYTES) {
			throw new Error(
				`Delegate response for ${toolName} exceeds ${MAX_RESPONSE_BYTES} bytes (got ${text.length})`,
			);
		}

		try {
			return JSON.parse(text);
		} catch {
			throw new Error(`Delegate returned invalid JSON for ${toolName}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Backward compatibility aliases
// ---------------------------------------------------------------------------

/** @deprecated Use DelegateHealth instead */
export type DaemonHealth = DelegateHealth;

/** @deprecated Use RemoteClientConfig instead */
export type DaemonClientConfig = RemoteClientConfig;

/** @deprecated Use checkDelegateHealth instead */
export const checkDaemonHealth = checkDelegateHealth;

/** @deprecated Use RemoteClient instead */
export const DaemonClient = RemoteClient;
