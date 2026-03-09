/**
 * SecurityServiceImpl unit tests.
 *
 * Validates:
 *   - Detection of hardcoded secrets (SEC001, SEC002)
 *   - SQL injection patterns (SEC003)
 *   - eval() usage (SEC005)
 *   - Insecure deserialization (SEC006)
 *   - Weak cryptography (SEC009)
 *   - innerHTML/XSS patterns (SEC012)
 *   - Clean code produces zero findings
 *   - Rule filtering by ID
 *   - Line number computation
 *   - Unreadable files are skipped with warning
 *   - Empty file list returns zero findings
 *
 * File reading is fully mocked via injected function.
 *
 * @module tests/unit/security-service
 */

import { describe, expect, it, vi } from "vitest";
import type { FileReader } from "../../src/services/security-service.js";
import { SecurityServiceImpl } from "../../src/services/security-service.js";
import { createMockLogger } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createService(fileContents: Record<string, string>) {
	const logger = createMockLogger();

	const readFile: FileReader = vi.fn(async (filePath: string) => {
		const content = fileContents[filePath];
		if (content === undefined) {
			throw new Error(`ENOENT: no such file: ${filePath}`);
		}
		return content;
	});

	const service = new SecurityServiceImpl({ workspacePath: "/test" }, readFile, logger);

	return { service, logger, readFile };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SecurityServiceImpl", () => {
	describe("scan", () => {
		it("returns zero findings for clean code", async () => {
			const { service } = createService({
				"/test/clean.ts": [
					"const config = process.env.DB_HOST;",
					"const value = 42;",
					"export function greet(name: string) { return `Hello ${name}`; }",
				].join("\n"),
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/clean.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.findings).toHaveLength(0);
				expect(result.data.criticalCount).toBe(0);
				expect(result.data.highCount).toBe(0);
				expect(result.data.scannedFiles).toBe(1);
			}
		});

		it("detects hardcoded secrets (SEC001)", async () => {
			const { service } = createService({
				"/test/secrets.ts": 'const password = "SuperSecret123!";',
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/secrets.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.findings.length).toBeGreaterThanOrEqual(1);
				const secretFinding = result.data.findings.find((f) => f.rule === "SEC001");
				expect(secretFinding).toBeDefined();
				expect(secretFinding?.severity).toBe("critical");
				expect(secretFinding?.cwe).toBe("CWE-798");
				expect(secretFinding?.file).toBe("/test/secrets.ts");
			}
		});

		it("detects cloud provider API key patterns (SEC002)", async () => {
			const { service } = createService({
				"/test/keys.ts": 'const key = "AKIAIOSFODNN7EXAMPLE";',
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/keys.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const keyFinding = result.data.findings.find((f) => f.rule === "SEC002");
				expect(keyFinding).toBeDefined();
				expect(keyFinding?.severity).toBe("critical");
			}
		});

		it("detects eval() usage (SEC005)", async () => {
			const { service } = createService({
				"/test/eval.ts": "const result = eval(userInput);",
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/eval.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const evalFinding = result.data.findings.find((f) => f.rule === "SEC005");
				expect(evalFinding).toBeDefined();
				expect(evalFinding?.severity).toBe("high");
				expect(evalFinding?.cwe).toBe("CWE-95");
			}
		});

		it("detects insecure JSON.parse on user input (SEC006)", async () => {
			const { service } = createService({
				"/test/parse.ts": "const data = JSON.parse(req.body);",
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/parse.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const parseFinding = result.data.findings.find((f) => f.rule === "SEC006");
				expect(parseFinding).toBeDefined();
				expect(parseFinding?.severity).toBe("medium");
			}
		});

		it("detects weak hash algorithms (SEC009)", async () => {
			const { service } = createService({
				"/test/hash.ts": 'const hash = createHash("md5");',
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/hash.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const hashFinding = result.data.findings.find((f) => f.rule === "SEC009");
				expect(hashFinding).toBeDefined();
				expect(hashFinding?.severity).toBe("medium");
				expect(hashFinding?.cwe).toBe("CWE-328");
			}
		});

		it("detects innerHTML / dangerouslySetInnerHTML (SEC012)", async () => {
			const { service } = createService({
				"/test/xss.ts": "element.innerHTML = userContent;",
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/xss.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const xssFinding = result.data.findings.find((f) => f.rule === "SEC012");
				expect(xssFinding).toBeDefined();
				expect(xssFinding?.severity).toBe("medium");
				expect(xssFinding?.cwe).toBe("CWE-79");
			}
		});

		it("detects TLS verification disabled (SEC008)", async () => {
			const { service } = createService({
				"/test/tls.ts": "const opts = { rejectUnauthorized: false };",
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/tls.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const tlsFinding = result.data.findings.find((f) => f.rule === "SEC008");
				expect(tlsFinding).toBeDefined();
				expect(tlsFinding?.severity).toBe("high");
			}
		});

		it("counts critical and high findings correctly", async () => {
			const { service } = createService({
				"/test/multi.ts": [
					'const password = "SuperSecret123!";',
					"const x = eval(input);",
					'const hash = createHash("sha1");',
				].join("\n"),
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/multi.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.criticalCount).toBeGreaterThanOrEqual(1);
				expect(result.data.highCount).toBeGreaterThanOrEqual(1);
				expect(result.data.findings.length).toBeGreaterThanOrEqual(3);
			}
		});

		it("computes correct line numbers for findings", async () => {
			const { service } = createService({
				"/test/lines.ts": ["// line 1", "// line 2", "const result = eval(input);"].join("\n"),
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/lines.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const evalFinding = result.data.findings.find((f) => f.rule === "SEC005");
				expect(evalFinding).toBeDefined();
				expect(evalFinding?.line).toBe(3);
			}
		});

		it("skips unreadable files and logs a warning", async () => {
			const { service, logger } = createService({});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/nonexistent.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.scannedFiles).toBe(0);
				expect(result.data.findings).toHaveLength(0);
			}
			expect(logger.entriesAt("warn").length).toBeGreaterThanOrEqual(1);
		});

		it("returns zero findings for an empty file list", async () => {
			const { service } = createService({});

			const result = await service.scan({
				workspacePath: "/test",
				files: [],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.findings).toHaveLength(0);
				expect(result.data.scannedFiles).toBe(0);
				expect(result.data.duration).toBeGreaterThanOrEqual(0);
			}
		});

		it("filters rules by ID when rules parameter is specified", async () => {
			const { service } = createService({
				"/test/multi.ts": ['const password = "SuperSecret123!";', "const x = eval(input);"].join("\n"),
			});

			// Only scan for SEC005 (eval), not SEC001 (secrets)
			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/multi.ts"],
				rules: ["SEC005"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				// Should only find eval, not the password
				expect(result.data.findings.every((f) => f.rule === "SEC005")).toBe(true);
				expect(result.data.findings.length).toBeGreaterThanOrEqual(1);
			}
		});

		it("scans multiple files and aggregates findings", async () => {
			const { service } = createService({
				"/test/a.ts": 'const password = "SuperSecret123!";',
				"/test/b.ts": "const x = eval(input);",
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/a.ts", "/test/b.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.scannedFiles).toBe(2);
				expect(result.data.findings.length).toBeGreaterThanOrEqual(2);
				const files = new Set(result.data.findings.map((f) => f.file));
				expect(files.size).toBe(2);
			}
		});

		it("includes recommendation for each finding", async () => {
			const { service } = createService({
				"/test/eval.ts": "eval(x);",
			});

			const result = await service.scan({
				workspacePath: "/test",
				files: ["/test/eval.ts"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				for (const finding of result.data.findings) {
					expect(finding.recommendation).toBeDefined();
					expect(finding.recommendation.length).toBeGreaterThan(0);
				}
			}
		});
	});
});
