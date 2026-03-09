/**
 * ValidationServiceImpl unit tests.
 *
 * Validates:
 *   - Quick check (TypeScript + lint) delegation
 *   - Full check (quick + security + circular deps) composition
 *   - Pattern validation via built-in rules
 *   - Build verification delegation
 *   - Coverage check delegation
 *   - Health score computation from dimensions
 *   - Evolution analysis with trend detection
 *   - Error handling for command failures
 *
 * External commands, storage, and dependent services are all mocked.
 *
 * @module tests/unit/validation-service
 */

import { describe, expect, it, vi } from "vitest";
import type { IGraphService, ISecurityService } from "../../src/contracts/services.js";
import { InMemoryStorage } from "../../src/services/adapters.js";
import type { CommandRunner } from "../../src/services/validation-service.js";
import { ValidationServiceImpl } from "../../src/services/validation-service.js";
import { createMockLogger } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createCommandRunner(
	responses: Record<string, { stdout: string; stderr: string; exitCode: number }> = {},
): CommandRunner {
	return vi.fn(
		async (
			command: string,
			args: readonly string[],
			_cwd: string,
		): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
			const key = `${command} ${args.join(" ")}`;

			// Match by partial key
			for (const [pattern, response] of Object.entries(responses)) {
				if (key.includes(pattern)) {
					return response;
				}
			}

			// Default: success with empty output
			return { stdout: "", stderr: "", exitCode: 0 };
		},
	);
}

function createMockGraphService(): IGraphService {
	return {
		computeDependencyGraph: vi.fn().mockResolvedValue({
			ok: true,
			data: { nodes: [], edges: [], totalModules: 0, maxDepth: 0 },
		}),
		detectCircularDeps: vi.fn().mockResolvedValue({
			ok: true,
			data: { cycles: [], affectedFiles: [] },
		}),
		detectOrphans: vi.fn().mockResolvedValue({
			ok: true,
			data: { orphanedFiles: [], deadExports: [], totalFiles: 0 },
		}),
		computeFileGraph: vi.fn().mockResolvedValue({
			ok: true,
			data: { nodes: [], edges: [], clusters: [] },
		}),
		computeHealth: vi.fn().mockResolvedValue({
			ok: true,
			data: {
				circularCount: 0,
				orphanCount: 0,
				maxFanOut: 3,
				avgFanOut: 1.5,
				modularity: 0.8,
			},
		}),
	};
}

function createMockSecurityService(): ISecurityService {
	return {
		scan: vi.fn().mockResolvedValue({
			ok: true,
			data: {
				findings: [],
				criticalCount: 0,
				highCount: 0,
				scannedFiles: 0,
				duration: 5,
			},
		}),
	};
}

function createService(
	opts: {
		commandRunner?: CommandRunner;
		graphService?: IGraphService;
		securityService?: ISecurityService;
		storage?: InMemoryStorage;
	} = {},
) {
	const logger = createMockLogger();
	const storage = opts.storage ?? new InMemoryStorage();
	const graphService = opts.graphService ?? createMockGraphService();
	const securityService = opts.securityService ?? createMockSecurityService();
	const commandRunner = opts.commandRunner ?? createCommandRunner();

	const service = new ValidationServiceImpl({}, commandRunner, storage, graphService, securityService, logger);

	return { service, logger, storage, commandRunner, graphService, securityService };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ValidationServiceImpl", () => {
	describe("quickCheck", () => {
		it("returns passed when both tsc and eslint exit 0", async () => {
			const { service } = createService();

			const result = await service.quickCheck({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.passed).toBe(true);
				expect(result.data.errorCount).toBe(0);
				expect(result.data.warningCount).toBe(0);
				expect(result.data.duration).toBeGreaterThanOrEqual(0);
			}
		});

		it("reports errors when tsc outputs TypeScript errors", async () => {
			const commandRunner = createCommandRunner({
				tsc: {
					stdout: "src/a.ts(10,5): error TS2304: Cannot find name 'foo'.\n",
					stderr: "",
					exitCode: 1,
				},
			});
			const { service } = createService({ commandRunner });

			const result = await service.quickCheck({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.passed).toBe(false);
				expect(result.data.errorCount).toBeGreaterThanOrEqual(1);
				const tsError = result.data.diagnostics.find((d) => d.code === "TS2304");
				expect(tsError).toBeDefined();
				expect(tsError?.line).toBe(10);
			}
		});

		it("reports warnings from eslint JSON output", async () => {
			const eslintOutput = JSON.stringify([
				{
					filePath: "src/a.ts",
					messages: [{ line: 5, column: 1, severity: 1, message: "Unexpected var", ruleId: "no-var" }],
				},
			]);
			const commandRunner = createCommandRunner({
				eslint: { stdout: eslintOutput, stderr: "", exitCode: 1 },
			});
			const { service } = createService({ commandRunner });

			const result = await service.quickCheck({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const lintWarning = result.data.diagnostics.find((d) => d.code === "no-var");
				expect(lintWarning).toBeDefined();
				expect(lintWarning?.severity).toBe("warning");
			}
		});

		it("handles command runner throwing an error gracefully", async () => {
			const commandRunner = vi.fn().mockRejectedValue(new Error("spawn failed"));
			const { service } = createService({
				commandRunner: commandRunner as unknown as CommandRunner,
			});

			const result = await service.quickCheck({
				workspacePath: "/project",
			});

			// safeRunCommand catches the error and returns exitCode 1
			// The general try/catch should still produce ok: true with diagnostics
			expect(result.ok).toBe(true);
		});

		it("passes specific files to eslint when provided", async () => {
			const commandRunner = createCommandRunner();
			const { service } = createService({ commandRunner });

			await service.quickCheck({
				workspacePath: "/project",
				files: ["src/a.ts", "src/b.ts"],
			});

			// Verify eslint was called with the specific files
			expect(commandRunner).toHaveBeenCalledWith(
				"npx",
				expect.arrayContaining(["eslint", "src/a.ts", "src/b.ts"]),
				"/project",
			);
		});
	});

	describe("fullCheck", () => {
		it("runs quick check, security scan, and circular dep check", async () => {
			const graphService = createMockGraphService();
			const securityService = createMockSecurityService();
			const { service } = createService({ graphService, securityService });

			const result = await service.fullCheck({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			expect(securityService.scan).toHaveBeenCalledOnce();
			expect(graphService.detectCircularDeps).toHaveBeenCalledOnce();
		});

		it("maps security findings to diagnostics", async () => {
			const securityService = createMockSecurityService();
			(securityService.scan as ReturnType<typeof vi.fn>).mockResolvedValue({
				ok: true,
				data: {
					findings: [
						{
							severity: "critical",
							rule: "SEC001",
							message: "hardcoded secret",
							file: "src/a.ts",
							line: 10,
							recommendation: "use env vars",
						},
					],
					criticalCount: 1,
					highCount: 0,
					scannedFiles: 1,
					duration: 5,
				},
			});
			const { service } = createService({ securityService });

			const result = await service.fullCheck({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const secDiag = result.data.diagnostics.find((d) => d.code === "SEC001");
				expect(secDiag).toBeDefined();
				expect(secDiag?.severity).toBe("error");
				expect(secDiag?.message).toContain("[Security]");
			}
		});

		it("maps circular dependencies to diagnostics", async () => {
			const graphService = createMockGraphService();
			(graphService.detectCircularDeps as ReturnType<typeof vi.fn>).mockResolvedValue({
				ok: true,
				data: {
					cycles: [{ chain: ["a.ts", "b.ts", "a.ts"], severity: "warning" }],
					affectedFiles: ["a.ts", "b.ts"],
				},
			});
			const { service } = createService({ graphService });

			const result = await service.fullCheck({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const circDiag = result.data.diagnostics.find((d) => d.code === "CIRCULAR_DEP");
				expect(circDiag).toBeDefined();
				expect(circDiag?.message).toContain("a.ts -> b.ts");
			}
		});

		it("records an evolution snapshot after full check", async () => {
			const storage = new InMemoryStorage();
			const { service } = createService({ storage });

			await service.fullCheck({ workspacePath: "/project" });

			const keys = await storage.list("evolution:");
			expect(keys.length).toBeGreaterThanOrEqual(1);

			const data = await storage.read(keys[0]!);
			expect(data).not.toBeNull();
			const snapshots = JSON.parse(data!);
			expect(snapshots.length).toBeGreaterThanOrEqual(1);
		});
	});

	describe("checkPatterns", () => {
		it("detects console.log usage", async () => {
			const { service } = createService();

			const result = await service.checkPatterns({
				workspacePath: "/project",
				code: 'console.log("hello");',
				filePath: "src/a.ts",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.compliant).toBe(false);
				const violation = result.data.violations.find((v) => v.code === "no-console-log");
				expect(violation).toBeDefined();
			}
		});

		it("detects explicit any type", async () => {
			const { service } = createService();

			const result = await service.checkPatterns({
				workspacePath: "/project",
				code: "function foo(x: any) { return x; }",
				filePath: "src/a.ts",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const anyViolation = result.data.violations.find((v) => v.code === "no-any-type");
				expect(anyViolation).toBeDefined();
			}
		});

		it("detects empty catch blocks", async () => {
			const { service } = createService();

			const result = await service.checkPatterns({
				workspacePath: "/project",
				code: "try { x(); } catch(e) {}",
				filePath: "src/a.ts",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const catchViolation = result.data.violations.find((v) => v.code === "no-silent-catch");
				expect(catchViolation).toBeDefined();
			}
		});

		it("detects TODO comments", async () => {
			const { service } = createService();

			const result = await service.checkPatterns({
				workspacePath: "/project",
				code: "// TODO: implement this",
				filePath: "src/a.ts",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const todoViolation = result.data.violations.find((v) => v.code === "no-todo-in-code");
				expect(todoViolation).toBeDefined();
			}
		});

		it("returns compliant for clean code", async () => {
			const { service } = createService();

			const result = await service.checkPatterns({
				workspacePath: "/project",
				code: "export const x = 1;",
				filePath: "src/a.ts",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.compliant).toBe(true);
				expect(result.data.violations).toHaveLength(0);
			}
		});

		it("provides suggestions for detected violations", async () => {
			const { service } = createService();

			const result = await service.checkPatterns({
				workspacePath: "/project",
				code: 'console.log("test");',
				filePath: "src/a.ts",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.suggestions.length).toBeGreaterThan(0);
			}
		});

		it("computes correct line numbers for violations", async () => {
			const { service } = createService();

			const result = await service.checkPatterns({
				workspacePath: "/project",
				code: "const x = 1;\nconst y = 2;\nconsole.log(x);",
				filePath: "src/a.ts",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const violation = result.data.violations.find((v) => v.code === "no-console-log");
				expect(violation).toBeDefined();
				expect(violation?.line).toBe(3);
			}
		});
	});

	describe("checkBuild", () => {
		it("returns success when tsc -b exits 0", async () => {
			const { service } = createService();

			const result = await service.checkBuild({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.success).toBe(true);
				expect(result.data.diagnostics).toHaveLength(0);
			}
		});

		it("returns failure with diagnostics when tsc -b fails", async () => {
			const commandRunner = createCommandRunner({
				"tsc -b": {
					stdout: "src/index.ts(1,1): error TS1005: ';' expected.\n",
					stderr: "",
					exitCode: 1,
				},
			});
			const { service } = createService({ commandRunner });

			const result = await service.checkBuild({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.success).toBe(false);
				expect(result.data.diagnostics.length).toBeGreaterThan(0);
			}
		});
	});

	describe("checkCoverage", () => {
		it("parses coverage from JSON output", async () => {
			const coverageJson = JSON.stringify({
				total: { lines: { pct: 85.5 }, branches: { pct: 80 } },
			});
			const commandRunner = createCommandRunner({
				vitest: { stdout: coverageJson, stderr: "", exitCode: 0 },
			});
			const { service } = createService({ commandRunner });

			const result = await service.checkCoverage({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.totalPercent).toBe(85.5);
				expect(result.data.passed).toBe(true);
			}
		});

		it("returns 0 coverage on unparseable output", async () => {
			const commandRunner = createCommandRunner({
				vitest: { stdout: "not json", stderr: "", exitCode: 0 },
			});
			const { service } = createService({ commandRunner });

			const result = await service.checkCoverage({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.totalPercent).toBe(0);
				expect(result.data.passed).toBe(false);
			}
		});

		it("uses custom threshold when provided", async () => {
			const coverageJson = JSON.stringify({
				total: { lines: { pct: 50 } },
			});
			const commandRunner = createCommandRunner({
				vitest: { stdout: coverageJson, stderr: "", exitCode: 0 },
			});
			const { service } = createService({ commandRunner });

			const result = await service.checkCoverage({
				workspacePath: "/project",
				threshold: 40,
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.passed).toBe(true);
			}
		});
	});

	describe("computeHealthScore", () => {
		it("returns composite health score from code quality and architecture", async () => {
			const { service } = createService();

			const result = await service.computeHealthScore({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.overall).toBeGreaterThanOrEqual(0);
				expect(result.data.overall).toBeLessThanOrEqual(100);
				expect(result.data.dimensions).toHaveProperty("codeQuality");
				expect(result.data.dimensions).toHaveProperty("architecture");
				expect(["improving", "stable", "declining"]).toContain(result.data.trend);
			}
		});

		it("decreases code quality dimension when errors are present", async () => {
			const commandRunner = createCommandRunner({
				tsc: {
					stdout: "a.ts(1,1): error TS0000: err\n",
					stderr: "",
					exitCode: 1,
				},
			});
			const { service } = createService({ commandRunner });

			const result = await service.computeHealthScore({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.dimensions.codeQuality).toBeLessThan(100);
			}
		});

		it("decreases architecture dimension when circular deps exist", async () => {
			const graphService = createMockGraphService();
			(graphService.computeHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
				ok: true,
				data: {
					circularCount: 5,
					orphanCount: 10,
					maxFanOut: 15,
					avgFanOut: 5,
					modularity: 0.3,
				},
			});
			const { service } = createService({ graphService });

			const result = await service.computeHealthScore({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.dimensions.architecture).toBeLessThan(100);
			}
		});
	});

	describe("analyzeEvolution", () => {
		it("returns stable trend with no snapshots", async () => {
			const { service } = createService();

			const result = await service.analyzeEvolution({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.snapshots).toHaveLength(0);
				expect(result.data.trend).toBe("stable");
			}
		});

		it("detects improving trend when scores increase", async () => {
			const storage = new InMemoryStorage();
			const snapshots = [
				{ timestamp: 1000, score: 50, errorCount: 10, warningCount: 5 },
				{ timestamp: 2000, score: 55, errorCount: 8, warningCount: 4 },
				{ timestamp: 3000, score: 70, errorCount: 3, warningCount: 2 },
				{ timestamp: 4000, score: 80, errorCount: 1, warningCount: 1 },
			];
			await storage.write("evolution:/project", JSON.stringify(snapshots));

			const { service } = createService({ storage });

			const result = await service.analyzeEvolution({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.snapshots).toHaveLength(4);
				expect(result.data.trend).toBe("improving");
			}
		});

		it("detects declining trend when scores decrease", async () => {
			const storage = new InMemoryStorage();
			const snapshots = [
				{ timestamp: 1000, score: 90, errorCount: 0, warningCount: 0 },
				{ timestamp: 2000, score: 85, errorCount: 1, warningCount: 1 },
				{ timestamp: 3000, score: 60, errorCount: 5, warningCount: 3 },
				{ timestamp: 4000, score: 50, errorCount: 10, warningCount: 5 },
			];
			await storage.write("evolution:/project", JSON.stringify(snapshots));

			const { service } = createService({ storage });

			const result = await service.analyzeEvolution({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.trend).toBe("declining");
			}
		});

		it("filters snapshots by since parameter", async () => {
			const storage = new InMemoryStorage();
			const snapshots = [
				{ timestamp: 1000, score: 50, errorCount: 10, warningCount: 5 },
				{ timestamp: 2000, score: 60, errorCount: 5, warningCount: 3 },
				{ timestamp: 3000, score: 70, errorCount: 3, warningCount: 2 },
			];
			await storage.write("evolution:/project", JSON.stringify(snapshots));

			const { service } = createService({ storage });

			const result = await service.analyzeEvolution({
				workspacePath: "/project",
				since: 2000,
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.snapshots).toHaveLength(2);
				expect(result.data.snapshots[0]?.timestamp).toBe(2000);
			}
		});
	});
});
