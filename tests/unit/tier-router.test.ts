/**
 * TierRouter unit tests.
 *
 * Validates:
 *   - Free/Pro mode detection based on daemon availability
 *   - Tool classification (free, pro-only, upgradeable)
 *   - Routing decisions for each tier × tool-class combination
 *   - Upgrade prompts for pro-only tools in free mode
 *   - Graceful degradation when daemon delegation fails
 *   - Cached mode (re-uses last check within interval)
 *
 * @module tests/unit/tier-router
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyTool, TierRouter } from "../../src/router/tier-router.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock the remote-client module
vi.mock("../../src/router/remote-client.js", () => ({
	checkDelegateHealth: vi.fn(),
	RemoteClient: vi.fn(),
	// backward compat aliases
	checkDaemonHealth: vi.fn(),
	DaemonClient: vi.fn(),
}));

import { checkDelegateHealth } from "../../src/router/remote-client.js";

const mockCheckHealth = checkDelegateHealth as ReturnType<typeof vi.fn>;

function mockDaemonClient(available = true) {
	return {
		isAvailable: vi.fn().mockResolvedValue(available),
		callTool: vi.fn().mockResolvedValue({ result: "daemon-response" }),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("classifyTool", () => {
	it("classifies pro-only tools", () => {
		expect(classifyTool("semantic-undo")).toBe("pro-only");
		expect(classifyTool("risk-analysis")).toBe("pro-only");
		expect(classifyTool("hive-query")).toBe("pro-only");
	});

	it("classifies upgradeable tools", () => {
		expect(classifyTool("snap")).toBe("upgradeable");
		expect(classifyTool("check")).toBe("upgradeable");
		expect(classifyTool("pulse")).toBe("upgradeable");
	});

	it("classifies free tools", () => {
		expect(classifyTool("learn")).toBe("free");
		expect(classifyTool("integrate")).toBe("free");
		expect(classifyTool("graph")).toBe("free");
		expect(classifyTool("cache")).toBe("free");
	});
});

describe("TierRouter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("getMode()", () => {
		it("returns 'free' when daemon is not available", async () => {
			mockCheckHealth.mockResolvedValue({ available: false });
			const router = new TierRouter({ checkIntervalMs: 0 });

			const mode = await router.getMode();
			expect(mode).toBe("free");
		});

		it("returns 'pro' when daemon is available", async () => {
			mockCheckHealth.mockResolvedValue({ available: true, version: "1.0.0" });
			const router = new TierRouter({ checkIntervalMs: 0 });

			const mode = await router.getMode();
			expect(mode).toBe("pro");
		});

		it("caches mode within check interval", async () => {
			mockCheckHealth.mockResolvedValue({ available: true });
			const router = new TierRouter({ checkIntervalMs: 60_000 });

			await router.getMode();
			await router.getMode();
			await router.getMode();

			expect(mockCheckHealth).toHaveBeenCalledTimes(1);
		});
	});

	describe("route()", () => {
		it("routes free tools locally in free mode", async () => {
			mockCheckHealth.mockResolvedValue({ available: false });
			const router = new TierRouter({ checkIntervalMs: 0 });

			const decision = await router.route("learn");
			expect(decision).toEqual({
				action: "local",
				tier: "free",
				toolTier: "free",
			});
		});

		it("routes upgradeable tools locally in free mode", async () => {
			mockCheckHealth.mockResolvedValue({ available: false });
			const router = new TierRouter({ checkIntervalMs: 0 });

			const decision = await router.route("snap");
			expect(decision).toEqual({
				action: "local",
				tier: "free",
				toolTier: "upgradeable",
			});
		});

		it("returns upgrade-prompt for pro-only tools in free mode", async () => {
			mockCheckHealth.mockResolvedValue({ available: false });
			const router = new TierRouter({ checkIntervalMs: 0 });

			const decision = await router.route("semantic-undo");
			expect(decision).toEqual({
				action: "upgrade-prompt",
				tier: "free",
				toolTier: "pro-only",
			});
		});

		it("delegates upgradeable tools in pro mode", async () => {
			mockCheckHealth.mockResolvedValue({ available: true });
			const router = new TierRouter({ checkIntervalMs: 0 });

			const decision = await router.route("snap");
			expect(decision).toEqual({
				action: "delegate",
				tier: "pro",
				toolTier: "upgradeable",
			});
		});

		it("delegates pro-only tools in pro mode", async () => {
			mockCheckHealth.mockResolvedValue({ available: true });
			const router = new TierRouter({ checkIntervalMs: 0 });

			const decision = await router.route("semantic-undo");
			expect(decision).toEqual({
				action: "delegate",
				tier: "pro",
				toolTier: "pro-only",
			});
		});

		it("routes free tools locally even in pro mode", async () => {
			mockCheckHealth.mockResolvedValue({ available: true });
			const router = new TierRouter({ checkIntervalMs: 0 });

			const decision = await router.route("learn");
			expect(decision).toEqual({
				action: "local",
				tier: "pro",
				toolTier: "free",
			});
		});
	});

	describe("delegate()", () => {
		it("delegates to daemon client", async () => {
			const client = mockDaemonClient();
			const router = new TierRouter({ checkIntervalMs: 0 }, client as never);

			const result = await router.delegate("snap", { mode: "start" });
			expect(result).toEqual({ result: "daemon-response" });
			expect(client.callTool).toHaveBeenCalledWith("snap", { mode: "start" });
		});

		it("throws when no daemon client configured", async () => {
			const router = new TierRouter({ checkIntervalMs: 0 });

			await expect(router.delegate("snap", {})).rejects.toThrow("Remote client not configured");
		});
	});

	describe("createUpgradePrompt()", () => {
		it("generates upgrade prompt with feature list", () => {
			const router = new TierRouter();
			const prompt = router.createUpgradePrompt("semantic-undo");

			expect(prompt.upgradeRequired).toBe(true);
			expect(prompt.tool).toBe("semantic-undo");
			expect(prompt.message).toContain("Pro tier");
			expect(prompt.features.length).toBeGreaterThan(0);
		});

		it("provides generic features for unknown tools", () => {
			const router = new TierRouter();
			const prompt = router.createUpgradePrompt("unknown-tool");

			expect(prompt.features.length).toBe(1);
			expect(prompt.features[0]).toContain("Enhanced");
		});
	});

	describe("setMode() (testing helper)", () => {
		it("forces a specific tier mode", async () => {
			const router = new TierRouter();
			router.setMode("pro");

			const mode = await router.getMode();
			expect(mode).toBe("pro");
			expect(mockCheckHealth).not.toHaveBeenCalled();
		});
	});
});
