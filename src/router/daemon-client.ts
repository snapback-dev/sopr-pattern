/**
 * Daemon Client — HTTP client for communicating with the SnapBack Pro daemon.
 *
 * The daemon runs as a separate process on a configurable port (default: 4200)
 * and exposes enhanced tool execution via HTTP. This client handles:
 *   - Health checks with fast timeout for detection
 *   - Tool delegation via POST requests
 *   - Version compatibility validation
 *
 * SPDX-License-Identifier: MIT
 *
 * @module router/daemon-client
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DaemonHealth {
  readonly available: boolean;
  readonly version?: string;
  readonly uptime?: number;
}

export interface DaemonClientConfig {
  /** Base URL of the daemon HTTP server. */
  readonly baseUrl: string;
  /** Workspace root path sent in request headers. */
  readonly workspaceRoot: string;
  /** Timeout for health checks in milliseconds (default: 500ms). */
  readonly healthTimeoutMs: number;
  /** Timeout for tool calls in milliseconds (default: 30s). */
  readonly callTimeoutMs: number;
}

/** Maximum response body size from daemon (10 MB). */
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

const DEFAULT_CONFIG: Omit<DaemonClientConfig, "workspaceRoot"> = {
  baseUrl: "http://127.0.0.1:4200",
  healthTimeoutMs: 500,
  callTimeoutMs: 30_000,
};

// ---------------------------------------------------------------------------
// Health Check (standalone function)
// ---------------------------------------------------------------------------

/**
 * Check if the daemon is running on the specified port.
 *
 * Uses a fast timeout (500ms) to avoid blocking the MCP server
 * when the daemon is not present.
 */
export async function checkDaemonHealth(
  baseUrl = DEFAULT_CONFIG.baseUrl,
  timeoutMs = DEFAULT_CONFIG.healthTimeoutMs,
): Promise<DaemonHealth> {
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

export class DaemonClient {
  private readonly config: DaemonClientConfig;

  constructor(config: Partial<DaemonClientConfig> & { workspaceRoot: string }) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check daemon availability.
   */
  async isAvailable(): Promise<boolean> {
    const health = await checkDaemonHealth(this.config.baseUrl, this.config.healthTimeoutMs);
    return health.available;
  }

  /**
   * Delegate a tool call to the daemon.
   *
   * @param toolName - Tool to execute (e.g. "snap", "check").
   * @param input    - Validated input payload.
   * @returns The daemon's response payload.
   * @throws {Error} If the daemon returns a non-OK status.
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
      throw new Error(`Daemon returned ${response.status} for ${toolName}: ${text}`);
    }

    // SECURITY: Enforce response size limit to prevent memory exhaustion
    // from a compromised or malicious daemon.
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(
        `Daemon response for ${toolName} exceeds ${MAX_RESPONSE_BYTES} bytes (got ${text.length})`,
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Daemon returned invalid JSON for ${toolName}`);
    }
  }
}
