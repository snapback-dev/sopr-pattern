/**
 * snap.undo mode tests — context masking for LLM state management.
 *
 * Validates:
 *   - Undo mode generates agentInstruction with context mask
 *   - Affected files are included in the instruction
 *   - Snapshot is finalized as abandoned
 *   - Works gracefully when no active snapshot exists
 *
 * @module tests/unit/snap-undo
 */

import { describe, expect, it, vi } from "vitest";
import type { IIntegrationService, ILearningService, ISnapshotService } from "../../src/contracts/services.js";
import { createSnapHandlers } from "../../src/tools/snap.js";
import { createMockContext } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockSnapshotService(activeSnapshotId: string | null = "snap-123"): ISnapshotService {
	return {
		create: vi.fn().mockResolvedValue({ ok: true, data: {} }),
		getState: vi.fn().mockResolvedValue({
			ok: true,
			data: {
				activeSnapshotId,
				snapshotCount: 1,
				lastSnapshotAt: Date.now(),
			},
		}),
		finalize: vi.fn().mockResolvedValue({
			ok: true,
			data: { finalized: true, snapshotId: activeSnapshotId, duration: 50 },
		}),
	};
}

function createMockLearningService(): ILearningService {
	return {
		loadTiered: vi.fn().mockResolvedValue({ ok: true, data: { learnings: [], totalAvailable: 0 } }),
		save: vi.fn().mockResolvedValue({ ok: true, data: {} }),
		search: vi.fn().mockResolvedValue({ ok: true, data: { learnings: [], totalMatches: 0 } }),
		recordBatch: vi.fn().mockResolvedValue({ ok: true, data: { stored: 0, deduplicated: 0 } }),
	};
}

function createMockIntegrationService(): IIntegrationService {
	return {
		getGitContext: vi.fn().mockResolvedValue({ ok: true, data: {} }),
		getSentryContext: vi.fn().mockResolvedValue({ ok: true, data: {} }),
		getGitHubContext: vi.fn().mockResolvedValue({ ok: true, data: {} }),
		enrichContext: vi.fn().mockResolvedValue({ ok: true, data: {} }),
		checkHealth: vi.fn().mockResolvedValue([]),
		checkConfig: vi.fn().mockResolvedValue({ ok: true, data: {} }),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("snap.undo mode", () => {
	it("generates agentInstruction with STATE RESET marker", async () => {
		const handlers = createSnapHandlers({
			snapshotService: createMockSnapshotService("snap-abc"),
			learningService: createMockLearningService(),
			integrationService: createMockIntegrationService(),
		});

		const ctx = createMockContext({ signal: new AbortController().signal });
		const result = await handlers.undo({ mode: "undo" as never, files: ["src/foo.ts", "src/bar.ts"] }, ctx);

		expect(result.success).toBe(true);
		expect(result.agentInstruction).toContain("STATE RESET");
		expect(result.agentInstruction).toContain("snap-abc");
		expect(result.agentInstruction).toContain("src/foo.ts");
		expect(result.agentInstruction).toContain("src/bar.ts");
		expect(result.agentInstruction).toContain("DISREGARD");
		expect(result.agentInstruction).toContain("Re-read current file state");
	});

	it("finalizes snapshot as abandoned", async () => {
		const snapshotService = createMockSnapshotService("snap-xyz");
		const handlers = createSnapHandlers({
			snapshotService,
			learningService: createMockLearningService(),
			integrationService: createMockIntegrationService(),
		});

		const ctx = createMockContext({ signal: new AbortController().signal });
		await handlers.undo({ mode: "undo" as never, files: [] }, ctx);

		expect(snapshotService.finalize).toHaveBeenCalledWith(expect.objectContaining({ outcome: "abandoned" }));
	});

	it("works when no active snapshot exists", async () => {
		const handlers = createSnapHandlers({
			snapshotService: createMockSnapshotService(null),
			learningService: createMockLearningService(),
			integrationService: createMockIntegrationService(),
		});

		const ctx = createMockContext({ signal: new AbortController().signal });
		const result = await handlers.undo({ mode: "undo" as never, files: ["src/file.ts"] }, ctx);

		expect(result.success).toBe(true);
		expect(result.restoredSnapshot).toBeNull();
		expect(result.agentInstruction).toContain("baseline");
	});

	it("includes generic DISREGARD when no files specified", async () => {
		const handlers = createSnapHandlers({
			snapshotService: createMockSnapshotService("snap-001"),
			learningService: createMockLearningService(),
			integrationService: createMockIntegrationService(),
		});

		const ctx = createMockContext({ signal: new AbortController().signal });
		const result = await handlers.undo({ mode: "undo" as never }, ctx);

		expect(result.agentInstruction).toContain("DISREGARD all prior file context from this session");
	});
});
