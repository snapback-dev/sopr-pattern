/**
 * DaemonClient unit tests.
 *
 * Validates:
 *   - Health check returns correct availability state
 *   - Tool delegation sends correct HTTP requests
 *   - Timeout handling for unresponsive daemon
 *   - Error handling for daemon failures
 *
 * @module tests/unit/daemon-client
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkDaemonHealth, DaemonClient } from "../../src/router/daemon-client.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkDaemonHealth", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns available=true when daemon responds OK", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.2.0", uptime: 3600 }),
    });

    const health = await checkDaemonHealth("http://127.0.0.1:4200", 1000);

    expect(health.available).toBe(true);
    expect(health.version).toBe("1.2.0");
    expect(health.uptime).toBe(3600);
  });

  it("returns available=false when daemon returns non-OK status", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
    });

    const health = await checkDaemonHealth();
    expect(health.available).toBe(false);
  });

  it("returns available=false when fetch throws (daemon not running)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));

    const health = await checkDaemonHealth();
    expect(health.available).toBe(false);
  });

  it("returns available=false on timeout", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException("The operation was aborted", "AbortError"),
    );

    const health = await checkDaemonHealth("http://127.0.0.1:4200", 1);
    expect(health.available).toBe(false);
  });

  it("handles missing version/uptime in response body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const health = await checkDaemonHealth();
    expect(health.available).toBe(true);
    expect(health.version).toBeUndefined();
    expect(health.uptime).toBeUndefined();
  });
});

describe("DaemonClient", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends correct HTTP request for tool delegation", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: "success" }),
    });

    const client = new DaemonClient({ workspaceRoot: "/projects/my-app" });
    const result = await client.callTool("snap", { mode: "start", task: "test" });

    expect(result).toEqual({ result: "success" });

    const [url, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4200/tools/snap");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["X-Workspace-Root"]).toBe("/projects/my-app");

    const body = JSON.parse(options.body as string);
    expect(body).toEqual({ mode: "start", task: "test" });
  });

  it("throws on non-OK daemon response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const client = new DaemonClient({ workspaceRoot: "/test" });

    await expect(client.callTool("snap", {})).rejects.toThrow("Daemon returned 500 for snap");
  });

  it("encodes tool name in URL", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const client = new DaemonClient({ workspaceRoot: "/test" });
    await client.callTool("risk-analysis", {});

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://127.0.0.1:4200/tools/risk-analysis");
  });

  it("checks availability via health endpoint", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ version: "1.0.0" }),
    });

    const client = new DaemonClient({ workspaceRoot: "/test" });
    const available = await client.isAvailable();

    expect(available).toBe(true);
  });
});
