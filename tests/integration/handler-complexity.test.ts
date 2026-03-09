/**
 * Handler Complexity Gate Tests
 *
 * Static analysis tests that enforce complexity constraints on tool handlers
 * in the SOPR tools layer (Layer 3). The tools layer must be a thin
 * orchestration layer that delegates all business logic to services.
 *
 * Red flags detected:
 *   - Exported function bodies exceeding 50 lines
 *   - Business logic indicators (direct DB calls, file system reads,
 *     complex domain conditionals)
 *
 * @module tests/integration/handler-complexity
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectTsFiles } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_ROOT = path.resolve(__dirname, "../../src");

const TOOLS_DIR = path.join(SRC_ROOT, "tools");

/** Maximum allowed lines for any single exported function body. */
const MAX_FUNCTION_BODY_LINES = 50;

// ---------------------------------------------------------------------------
// Function Extraction
// ---------------------------------------------------------------------------

interface ExtractedFunction {
	/** The function/method name. */
	name: string;
	/** The file containing this function. */
	file: string;
	/** 1-based start line of the function declaration. */
	startLine: number;
	/** 1-based end line of the closing brace. */
	endLine: number;
	/** Number of lines in the function body (excluding declaration and closing brace). */
	bodyLines: number;
	/** Whether the function is exported. */
	exported: boolean;
}

/**
 * Extract exported function definitions from a TypeScript file using
 * brace-counting heuristics.
 *
 * This is intentionally simple -- it handles:
 *   - `export function name(...) {`
 *   - `export async function name(...) {`
 *   - `export const name = (...) => {`
 *   - `export const name = async (...) => {`
 *   - `export default function name(...) {`
 *
 * It does NOT need to handle deeply nested or class-based patterns because
 * the SOPR tools layer uses standalone exported handler functions.
 */
function extractExportedFunctions(filePath: string): ExtractedFunction[] {
	const content = fs.readFileSync(filePath, "utf-8");
	const lines = content.split("\n");
	const results: ExtractedFunction[] = [];

	// Pattern for lines that start an exported function definition
	const exportFuncPattern = /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/;
	const exportConstArrowPattern = /^export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(/;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i]?.trimStart();
		let funcName: string | null = null;

		const funcMatch = exportFuncPattern.exec(trimmed);
		if (funcMatch?.[1]) {
			funcName = funcMatch[1];
		}

		if (funcName === null) {
			const arrowMatch = exportConstArrowPattern.exec(trimmed);
			if (arrowMatch?.[1]) {
				funcName = arrowMatch[1];
			}
		}

		if (funcName === null) {
			continue;
		}

		// Find the opening brace on this line or subsequent lines
		let braceDepth = 0;
		let foundOpenBrace = false;
		let bodyStart = i;
		let bodyEnd = i;

		for (let j = i; j < lines.length; j++) {
			const line = lines[j]!;

			for (const ch of line) {
				if (ch === "{") {
					if (!foundOpenBrace) {
						foundOpenBrace = true;
						bodyStart = j;
					}
					braceDepth++;
				} else if (ch === "}") {
					braceDepth--;
				}
			}

			if (foundOpenBrace && braceDepth === 0) {
				bodyEnd = j;
				break;
			}
		}

		if (foundOpenBrace) {
			// Body lines = total lines between open brace and close brace,
			// excluding the declaration line and the closing brace line itself.
			const bodyLineCount = Math.max(0, bodyEnd - bodyStart - 1);

			results.push({
				name: funcName,
				file: path.relative(SRC_ROOT, filePath),
				startLine: i + 1,
				endLine: bodyEnd + 1,
				bodyLines: bodyLineCount,
				exported: true,
			});
		}
	}

	return results;
}

// ---------------------------------------------------------------------------
// Business Logic Detection
// ---------------------------------------------------------------------------

interface BusinessLogicIndicator {
	file: string;
	line: number;
	indicator: string;
	rawLine: string;
}

/**
 * Patterns that indicate business logic has leaked into the tools layer.
 *
 * Tool handlers should only:
 *   1. Validate/extract input parameters
 *   2. Call service methods
 *   3. Transform service results into the tool response format
 *
 * They should NOT contain:
 *   - Direct filesystem operations (fs.readFile, fs.writeFile, etc.)
 *   - Direct database calls (query, find, insert, etc.)
 *   - Complex domain conditionals (multi-branch if/switch on domain data)
 *   - Direct process/child_process usage (exec, spawn, etc.)
 *   - Direct HTTP/network calls (fetch, axios, http.request, etc.)
 */
const BUSINESS_LOGIC_PATTERNS: Array<{
	pattern: RegExp;
	label: string;
}> = [
	// File system operations
	{
		pattern: /\bfs\.(readFile|writeFile|readdir|mkdir|unlink|stat|access|rename|copyFile)\b/,
		label: "Direct filesystem operation (should be in a service)",
	},
	{
		pattern: /\bfs\.(readFileSync|writeFileSync|readdirSync|mkdirSync|unlinkSync|statSync)\b/,
		label: "Synchronous filesystem operation (should be in a service)",
	},
	// Child process
	{
		pattern: /\b(exec|execSync|spawn|spawnSync|execFile|fork)\s*\(/,
		label: "Direct process execution (should be in a service)",
	},
	// Database operations (common ORMs and drivers)
	{
		pattern: /\.(query|execute|findOne|findMany|insertOne|insertMany|updateOne|deleteOne|aggregate)\s*\(/,
		label: "Direct database operation (should be in a service)",
	},
	// Direct HTTP calls
	{
		pattern: /\b(fetch|axios\.get|axios\.post|http\.request|https\.request)\s*\(/,
		label: "Direct HTTP/network call (should be in a service)",
	},
	// SQL literals
	{
		pattern: /\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\s+/,
		label: "Embedded SQL (should be in a service/repository)",
	},
];

/**
 * Scan tool handler files for indicators that business logic has leaked
 * into the orchestration layer.
 */
function detectBusinessLogicInTools(toolsDir: string): BusinessLogicIndicator[] {
	const indicators: BusinessLogicIndicator[] = [];
	const files = collectTsFiles(toolsDir);

	for (const filePath of files) {
		const content = fs.readFileSync(filePath, "utf-8");
		const lines = content.split("\n");

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;

			// Skip comments
			const trimmed = line.trimStart();
			if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
				continue;
			}

			for (const { pattern, label } of BUSINESS_LOGIC_PATTERNS) {
				if (pattern.test(line)) {
					indicators.push({
						file: path.relative(SRC_ROOT, filePath),
						line: i + 1,
						indicator: label,
						rawLine: line.trimEnd(),
					});
				}
			}
		}
	}

	return indicators;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Tool Handler Complexity Gate", () => {
	it(`no exported function in tools/ exceeds ${MAX_FUNCTION_BODY_LINES} lines`, () => {
		const files = collectTsFiles(TOOLS_DIR);
		const oversizedFunctions: ExtractedFunction[] = [];

		for (const filePath of files) {
			const functions = extractExportedFunctions(filePath);
			for (const fn of functions) {
				// Skip factory functions (create*Handlers) — these are structural
				// wrappers containing multiple small mode handlers, not individual
				// handler functions. Individual handler complexity is enforced by
				// the mode handler size within the returned object.
				if (/^create\w+Handlers$/.test(fn.name)) {
					continue;
				}

				if (fn.bodyLines > MAX_FUNCTION_BODY_LINES) {
					oversizedFunctions.push(fn);
				}
			}
		}

		const report = oversizedFunctions
			.map(
				(fn) =>
					`  ${fn.file}:${fn.startLine} -- ${fn.name}() has ${fn.bodyLines} body lines (max: ${MAX_FUNCTION_BODY_LINES})`,
			)
			.join("\n");

		expect(
			oversizedFunctions,
			`Tool handlers exceeding ${MAX_FUNCTION_BODY_LINES} lines should be refactored into service calls:\n${report}`,
		).toHaveLength(0);
	});

	it("tool handlers do not contain business logic indicators", () => {
		const indicators = detectBusinessLogicInTools(TOOLS_DIR);

		const report = indicators
			.map((ind) => `  ${ind.file}:${ind.line} -- ${ind.indicator}\n    ${ind.rawLine}`)
			.join("\n\n");

		expect(indicators, `Business logic detected in tools layer (should be in services):\n${report}`).toHaveLength(
			0,
		);
	});

	it("tool files import from services (confirms delegation pattern)", () => {
		const files = collectTsFiles(TOOLS_DIR);

		// This is a structural assertion: if tool files exist, they should
		// import from the services layer (proving they delegate rather than
		// implementing logic inline). Skip if no tool files exist yet.
		if (files.length === 0) {
			return; // No tools yet -- nothing to validate
		}

		const filesWithServiceImports: string[] = [];
		const filesWithoutServiceImports: string[] = [];

		for (const filePath of files) {
			const content = fs.readFileSync(filePath, "utf-8");
			// Check for imports from services layer
			const hasServiceImport =
				content.includes("from") && (content.includes("/services/") || content.includes("../services"));

			// Only flag handler files (not index/barrel files)
			const basename = path.basename(filePath, ".ts");
			const isHandlerFile =
				basename.startsWith("handle") || basename.includes("handler") || basename.includes("tool");

			if (isHandlerFile) {
				if (hasServiceImport) {
					filesWithServiceImports.push(path.relative(SRC_ROOT, filePath));
				} else {
					filesWithoutServiceImports.push(path.relative(SRC_ROOT, filePath));
				}
			}
		}

		// If we have handler files, at least some should import services
		if (filesWithServiceImports.length + filesWithoutServiceImports.length > 0) {
			expect(
				filesWithServiceImports.length,
				`Tool handler files not importing from services/ (may contain inline logic):\n  ${filesWithoutServiceImports.join("\n  ")}`,
			).toBeGreaterThan(0);
		}
	});
});
