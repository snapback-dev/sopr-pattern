/**
 * Shared test utilities for SOPR integration and unit tests.
 *
 * Provides factory helpers for ToolContext and Logger mocks, plus
 * file-system utilities used by the static analysis boundary tests.
 *
 * @module tests/helpers
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolContext } from "../../src/contracts/context.js";
import { noOpLogger, noOpProgress } from "../../src/contracts/context.js";

// ---------------------------------------------------------------------------
// Mock ToolContext
// ---------------------------------------------------------------------------

/** Default values used by `createMockContext`. */
const MOCK_CONTEXT_DEFAULTS: ToolContext = Object.freeze({
	workspacePath: "/tmp/sopr-test-workspace",
	sessionId: "test-session-001",
	capabilities: Object.freeze(["git", "sentry"]),
	timestamp: 1_700_000_000_000,
	requestId: "req-test-001",
	signal: AbortSignal.abort(), // Pre-aborted for safety in tests
	logger: noOpLogger,
	progress: noOpProgress,
});

/**
 * Create a deeply-frozen mock {@link ToolContext} suitable for test assertions.
 *
 * Accepts partial overrides -- any field not provided falls back to
 * deterministic defaults so tests remain stable across runs.
 *
 * The returned object is frozen via `Object.freeze`, matching the production
 * behaviour of `createToolContext`.
 */
export function createMockContext(overrides: Partial<ToolContext> = {}): ToolContext {
	const capabilities =
		overrides.capabilities !== undefined
			? Object.freeze([...overrides.capabilities])
			: MOCK_CONTEXT_DEFAULTS.capabilities;

	const ctx: ToolContext = {
		workspacePath: overrides.workspacePath ?? MOCK_CONTEXT_DEFAULTS.workspacePath,
		sessionId: overrides.sessionId ?? MOCK_CONTEXT_DEFAULTS.sessionId,
		capabilities,
		timestamp: overrides.timestamp ?? MOCK_CONTEXT_DEFAULTS.timestamp,
		requestId: overrides.requestId ?? MOCK_CONTEXT_DEFAULTS.requestId,
		signal: overrides.signal ?? new AbortController().signal,
		logger: overrides.logger ?? noOpLogger,
		progress: overrides.progress ?? noOpProgress,
	};

	return Object.freeze(ctx);
}

// ---------------------------------------------------------------------------
// Mock Logger
// ---------------------------------------------------------------------------

/** A single captured log entry. */
export interface LogEntry {
	level: "debug" | "info" | "warn" | "error";
	message: string;
	meta?: unknown;
}

/** A logger that records every call for later assertion. */
export interface MockLogger {
	debug(message: string, meta?: unknown): void;
	info(message: string, meta?: unknown): void;
	warn(message: string, meta?: unknown): void;
	error(message: string, meta?: unknown): void;

	/** All log entries captured since creation (ordered by call sequence). */
	readonly entries: readonly LogEntry[];

	/** Convenience: entries filtered to a specific level. */
	entriesAt(level: LogEntry["level"]): readonly LogEntry[];

	/** Reset captured entries. */
	clear(): void;
}

/**
 * Create a mock logger that captures every call into an inspectable array.
 *
 * Usage:
 * ```ts
 * const logger = createMockLogger();
 * someService.doWork(logger);
 * expect(logger.entries).toHaveLength(2);
 * expect(logger.entriesAt("error")).toHaveLength(0);
 * ```
 */
export function createMockLogger(): MockLogger {
	const entries: LogEntry[] = [];

	function record(level: LogEntry["level"]) {
		return (message: string, meta?: unknown) => {
			entries.push({ level, message, meta });
		};
	}

	return {
		debug: record("debug"),
		info: record("info"),
		warn: record("warn"),
		error: record("error"),

		get entries(): readonly LogEntry[] {
			return entries;
		},

		entriesAt(level: LogEntry["level"]): readonly LogEntry[] {
			return entries.filter((e) => e.level === level);
		},

		clear() {
			entries.length = 0;
		},
	};
}

// ---------------------------------------------------------------------------
// File-System Utilities for Static Analysis Tests
// ---------------------------------------------------------------------------

/**
 * Recursively collect all `.ts` files under `dir`, excluding `.d.ts` files.
 *
 * Returns absolute paths sorted lexicographically for deterministic output.
 */
export function collectTsFiles(dir: string): string[] {
	const results: string[] = [];

	if (!fs.existsSync(dir)) {
		return results;
	}

	function walk(current: string): void {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const fullPath = path.join(current, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath);
			} else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
				results.push(fullPath);
			}
		}
	}

	walk(dir);
	return results.sort();
}

/** Represents a single import found in a source file. */
export interface ParsedImport {
	/** The full import specifier string (e.g. "../services/foo.js"). */
	specifier: string;
	/** 1-based line number where the import appears. */
	line: number;
	/** The raw source line text. */
	raw: string;
}

/**
 * Parse static import and re-export statements from a TypeScript source file.
 *
 * Captures:
 *   - `import ... from "specifier"`
 *   - `import "specifier"` (side-effect imports)
 *   - `export ... from "specifier"` (re-exports)
 *   - `import type ... from "specifier"`
 *   - `export type ... from "specifier"`
 *
 * Dynamic `import()` expressions are intentionally excluded because they
 * are not used in this codebase and would require AST parsing.
 */
export function parseImports(filePath: string): ParsedImport[] {
	const content = fs.readFileSync(filePath, "utf-8");
	const lines = content.split("\n");
	const results: ParsedImport[] = [];

	// Matches:
	//   import ... from "specifier"
	//   import "specifier"
	//   export ... from "specifier"
	// Handles both single and double quotes.
	const importPattern = /(?:^|\s)(?:import|export)\s+(?:type\s+)?(?:.*?\s+from\s+)?['"]([^'"]+)['"]/;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const match = importPattern.exec(line);
		if (match?.[1] !== undefined) {
			results.push({
				specifier: match[1],
				line: i + 1,
				raw: line.trimEnd(),
			});
		}
	}

	return results;
}

/**
 * Resolve which SOPR layer a relative import specifier targets.
 *
 * Given a file in `src/protocol/server.ts` importing `../services/foo.js`,
 * this returns `"services"`.
 *
 * Returns `null` for non-relative imports (npm packages) or imports that
 * don't resolve to a known SOPR layer.
 */
export function resolveLayerFromImport(importSpecifier: string, importingFile: string, srcRoot: string): string | null {
	// Only analyze relative imports
	if (!importSpecifier.startsWith(".")) {
		return null;
	}

	const importingDir = path.dirname(importingFile);
	const resolvedAbsolute = path.resolve(importingDir, importSpecifier);

	// Normalize to be relative to srcRoot
	const relativeToSrc = path.relative(srcRoot, resolvedAbsolute);

	// Guard against paths escaping src/
	if (relativeToSrc.startsWith("..")) {
		return null;
	}

	// Extract the first path segment (the layer directory name)
	const firstSegment = relativeToSrc.split(path.sep)[0];
	return firstSegment ?? null;
}

/**
 * Determine which SOPR layer a source file belongs to based on its path.
 *
 * Returns the layer directory name (e.g. "protocol", "registry", "tools",
 * "services", "contracts", "resilience") or `null` if the file is not
 * inside a recognized layer directory.
 */
export function getLayerForFile(filePath: string, srcRoot: string): string | null {
	const relativeToSrc = path.relative(srcRoot, filePath);
	if (relativeToSrc.startsWith("..")) {
		return null;
	}
	const firstSegment = relativeToSrc.split(path.sep)[0];
	return firstSegment ?? null;
}

/** SOPR layer directories in dependency order (1 = highest, 4 = lowest). */
export const SOPR_LAYERS = ["protocol", "registry", "tools", "services"] as const;

/** Directories that any layer may import from. */
export const SHARED_LAYERS = ["contracts", "resilience", "router", "telemetry"] as const;
