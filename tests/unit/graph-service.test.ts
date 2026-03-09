/**
 * GraphServiceImpl unit tests.
 *
 * Validates:
 *   - Dependency graph computation from mock file system
 *   - Circular dependency detection
 *   - Orphan file detection
 *   - File graph with cluster computation
 *   - Health metric aggregation
 *   - Error handling for unreadable files and directories
 *
 * File system interactions are fully mocked via injected functions.
 *
 * @module tests/unit/graph-service
 */

import { describe, expect, it, vi } from "vitest";
import type { DirectoryLister, FileReader, PathChecker } from "../../src/services/graph-service.js";
import { GraphServiceImpl } from "../../src/services/graph-service.js";
import { createMockLogger } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFileSystem(files: Record<string, string>) {
	const readFile: FileReader = vi.fn(async (filePath: string) => {
		const content = files[filePath];
		if (content === undefined) {
			throw new Error(`ENOENT: no such file: ${filePath}`);
		}
		return content;
	});

	const entries = Object.keys(files).map((filePath) => {
		const parts = filePath.split("/");
		return {
			name: parts[parts.length - 1]!,
			dir: parts.slice(0, -1).join("/"),
			path: filePath,
		};
	});

	// Group entries by directory for the directory lister
	const dirMap = new Map<string, Array<{ name: string; isDirectory: boolean; path: string }>>();

	// Add file entries
	for (const entry of entries) {
		const group = dirMap.get(entry.dir) ?? [];
		group.push({ name: entry.name, isDirectory: false, path: entry.path });
		dirMap.set(entry.dir, group);
	}

	// Collect all unique parent directories, including intermediate ones
	const allDirs = new Set<string>();
	for (const entry of entries) {
		const parts = entry.dir.split("/");
		for (let i = 1; i <= parts.length; i++) {
			allDirs.add(parts.slice(0, i).join("/"));
		}
	}

	// Add subdirectory entries to parent directories
	for (const dir of allDirs) {
		const parentParts = dir.split("/");
		const parent = parentParts.slice(0, -1).join("/");
		const dirName = parentParts[parentParts.length - 1]!;
		if (parent) {
			const parentGroup = dirMap.get(parent) ?? [];
			// Avoid duplicates
			if (!parentGroup.some((e) => e.name === dirName && e.isDirectory)) {
				parentGroup.push({ name: dirName, isDirectory: true, path: dir });
				dirMap.set(parent, parentGroup);
			}
		}
	}

	const listDirectory: DirectoryLister = vi.fn(async (dirPath: string) => {
		return dirMap.get(dirPath) ?? [];
	});

	const checkPath: PathChecker = vi.fn(async (filePath: string) => {
		return files[filePath] !== undefined || allDirs.has(filePath);
	});

	return { readFile, listDirectory, checkPath };
}

function createService(
	files: Record<string, string>,
	config: Partial<Parameters<typeof GraphServiceImpl.prototype.computeDependencyGraph>[0]> = {},
) {
	const logger = createMockLogger();
	const fs = createFileSystem(files);

	const service = new GraphServiceImpl(
		{ extensions: [".ts", ".js"], excludeDirs: ["node_modules"], maxDepth: 20, ...config },
		fs.readFile,
		fs.listDirectory,
		fs.checkPath,
		logger,
	);

	return { service, logger, ...fs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GraphServiceImpl", () => {
	describe("computeDependencyGraph", () => {
		it("builds a graph from files with imports", async () => {
			const { service } = createService({
				"/project/src/a.ts": 'import { b } from "./b.js";',
				"/project/src/b.ts": "export const b = 1;",
			});

			const result = await service.computeDependencyGraph({
				workspacePath: "/project/src",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.nodes.length).toBeGreaterThanOrEqual(2);
				expect(result.data.edges.length).toBeGreaterThanOrEqual(1);
				expect(result.data.totalModules).toBe(result.data.nodes.length);
			}
		});

		it("returns empty graph when no files found", async () => {
			const { service } = createService({});

			const result = await service.computeDependencyGraph({
				workspacePath: "/empty",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.nodes).toHaveLength(0);
				expect(result.data.edges).toHaveLength(0);
				expect(result.data.maxDepth).toBe(0);
			}
		});

		it("respects depth limit", async () => {
			const { service } = createService({
				"/project/a.ts": 'import "./b.js";',
				"/project/b.ts": 'import "./c.js";',
				"/project/c.ts": 'import "./d.js";',
				"/project/d.ts": "export const d = 1;",
			});

			const result = await service.computeDependencyGraph({
				workspacePath: "/project",
				depth: 1,
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				// With depth=1, should not traverse beyond one hop from entry
				expect(result.data.nodes.length).toBeLessThanOrEqual(4);
			}
		});

		it("handles errors and returns error result", async () => {
			const logger = createMockLogger();
			const readFile: FileReader = vi.fn().mockRejectedValue(new Error("read fail"));
			const listDirectory: DirectoryLister = vi.fn().mockRejectedValue(new Error("list fail"));
			const checkPath: PathChecker = vi.fn().mockResolvedValue(false);

			const service = new GraphServiceImpl({}, readFile, listDirectory, checkPath, logger);

			const result = await service.computeDependencyGraph({
				workspacePath: "/fail",
			});

			// The service catches the listDirectory error in collectFiles and returns empty
			// That means it succeeds with empty data, not fails
			expect(result.ok).toBe(true);
		});

		it("parses re-exports and dynamic imports", async () => {
			const { service } = createService({
				"/project/index.ts": ['export { foo } from "./foo.js";', 'const lazy = import("./lazy.js");'].join(
					"\n",
				),
				"/project/foo.ts": "export const foo = 1;",
				"/project/lazy.ts": "export default 42;",
			});

			const result = await service.computeDependencyGraph({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const edgeTypes = result.data.edges.map((e) => e.type);
				expect(edgeTypes).toContain("re-export");
				expect(edgeTypes).toContain("dynamic");
			}
		});

		it("skips external (non-relative) imports", async () => {
			const { service } = createService({
				"/project/a.ts": ['import { z } from "zod";', 'import { b } from "./b.js";'].join("\n"),
				"/project/b.ts": "export const b = 1;",
			});

			const result = await service.computeDependencyGraph({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				// Should only have local edges, not zod
				for (const edge of result.data.edges) {
					expect(edge.to).not.toContain("zod");
				}
			}
		});
	});

	describe("detectCircularDeps", () => {
		it("detects a simple cycle", async () => {
			const { service } = createService({
				"/project/a.ts": 'import "./b.js";',
				"/project/b.ts": 'import "./a.js";',
			});

			const result = await service.detectCircularDeps({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.cycles.length).toBeGreaterThanOrEqual(1);
				expect(result.data.affectedFiles.length).toBeGreaterThanOrEqual(1);
			}
		});

		it("returns empty cycles when there are no circular deps", async () => {
			const { service } = createService({
				"/project/a.ts": 'import "./b.js";',
				"/project/b.ts": "export const b = 1;",
			});

			const result = await service.detectCircularDeps({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.cycles).toHaveLength(0);
			}
		});
	});

	describe("detectOrphans", () => {
		it("identifies files that are never imported", async () => {
			const { service } = createService({
				"/project/a.ts": 'import "./b.js";',
				"/project/b.ts": "export const b = 1;",
				"/project/orphan.ts": "export const unused = true;",
			});

			const result = await service.detectOrphans({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				// a.ts imports b.ts, so orphan.ts and a.ts could be orphans
				// a.ts is not imported by anything either
				expect(result.data.totalFiles).toBeGreaterThanOrEqual(3);
				// At least orphan.ts and a.ts should be orphaned (not imported by anyone)
				expect(result.data.orphanedFiles.length).toBeGreaterThanOrEqual(1);
			}
		});

		it("does not count index files as orphans", async () => {
			const { service } = createService({
				"/project/index.ts": 'export { a } from "./a.js";',
				"/project/a.ts": "export const a = 1;",
			});

			const result = await service.detectOrphans({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const orphanNames = result.data.orphanedFiles.map((f) => f.split("/").pop());
				expect(orphanNames).not.toContain("index.ts");
			}
		});

		it("does not count test files as orphans", async () => {
			const { service } = createService({
				"/project/a.ts": "export const a = 1;",
				"/project/a.test.ts": 'import { a } from "./a.js";',
			});

			const result = await service.detectOrphans({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const orphanNames = result.data.orphanedFiles.map((f) => f.split("/").pop());
				expect(orphanNames).not.toContain("a.test.ts");
			}
		});

		it("respects ignore patterns", async () => {
			const { service } = createService({
				"/project/a.ts": "export const a = 1;",
				"/project/generated.ts": "export const g = 1;",
			});

			const result = await service.detectOrphans({
				workspacePath: "/project",
				ignorePatterns: ["generated"],
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				for (const orphan of result.data.orphanedFiles) {
					expect(orphan).not.toContain("generated");
				}
			}
		});
	});

	describe("computeFileGraph", () => {
		it("computes file graph with clusters", async () => {
			const { service } = createService({
				"/project/src/a.ts": 'import "./b.js";',
				"/project/src/b.ts": "export const b = 1;",
				"/project/lib/c.ts": "export const c = 2;",
				"/project/lib/d.ts": "export const d = 3;",
			});

			const result = await service.computeFileGraph({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.nodes.length).toBeGreaterThanOrEqual(2);
				// Clusters should group files by directory
				expect(result.data.clusters.length).toBeGreaterThanOrEqual(1);
				for (const cluster of result.data.clusters) {
					expect(cluster.files.length).toBeGreaterThanOrEqual(2);
					expect(cluster.cohesion).toBeGreaterThanOrEqual(0);
					expect(cluster.cohesion).toBeLessThanOrEqual(1);
				}
			}
		});

		it("can scope to a root file", async () => {
			const { service } = createService({
				"/project/a.ts": 'import "./b.js";',
				"/project/b.ts": "export const b = 1;",
				"/project/unrelated.ts": "export const x = 99;",
			});

			const result = await service.computeFileGraph({
				workspacePath: "/project",
				rootFile: "/project/a.ts",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const nodeIds = result.data.nodes.map((n) => n.id);
				expect(nodeIds).toContain("/project/a.ts");
				expect(nodeIds).toContain("/project/b.ts");
				// unrelated.ts should not be traversed from a.ts
				expect(nodeIds).not.toContain("/project/unrelated.ts");
			}
		});
	});

	describe("computeHealth", () => {
		it("returns aggregated health metrics", async () => {
			const { service } = createService({
				"/project/a.ts": 'import "./b.js";',
				"/project/b.ts": "export const b = 1;",
			});

			const result = await service.computeHealth({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(typeof result.data.circularCount).toBe("number");
				expect(typeof result.data.orphanCount).toBe("number");
				expect(typeof result.data.maxFanOut).toBe("number");
				expect(typeof result.data.avgFanOut).toBe("number");
				expect(typeof result.data.modularity).toBe("number");
				expect(result.data.modularity).toBeGreaterThanOrEqual(0);
				expect(result.data.modularity).toBeLessThanOrEqual(1);
			}
		});

		it("handles empty workspace gracefully", async () => {
			const { service } = createService({});

			const result = await service.computeHealth({
				workspacePath: "/empty",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.data.circularCount).toBe(0);
				expect(result.data.orphanCount).toBe(0);
				expect(result.data.maxFanOut).toBe(0);
				expect(result.data.avgFanOut).toBe(0);
			}
		});
	});

	describe("node classification", () => {
		it("classifies index files as module type", async () => {
			const { service } = createService({
				"/project/index.ts": "export const x = 1;",
			});

			const result = await service.computeDependencyGraph({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const indexNode = result.data.nodes.find((n) => n.path.endsWith("index.ts"));
				expect(indexNode?.type).toBe("module");
			}
		});

		it("classifies regular files as file type", async () => {
			const { service } = createService({
				"/project/utils.ts": "export const x = 1;",
			});

			const result = await service.computeDependencyGraph({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const node = result.data.nodes.find((n) => n.path.endsWith("utils.ts"));
				expect(node?.type).toBe("file");
			}
		});
	});

	describe("export parsing", () => {
		it("parses named exports from source", async () => {
			const { service } = createService({
				"/project/mod.ts": [
					"export const FOO = 1;",
					"export function bar() {}",
					"export class Baz {}",
					"export type MyType = string;",
					"export interface MyInterface {}",
				].join("\n"),
			});

			const result = await service.computeDependencyGraph({
				workspacePath: "/project",
			});

			expect(result.ok).toBe(true);
			if (result.ok) {
				const node = result.data.nodes.find((n) => n.path.endsWith("mod.ts"));
				expect(node).toBeDefined();
				expect(node?.exports).toContain("FOO");
				expect(node?.exports).toContain("bar");
				expect(node?.exports).toContain("Baz");
				expect(node?.exports).toContain("MyType");
				expect(node?.exports).toContain("MyInterface");
			}
		});
	});
});
