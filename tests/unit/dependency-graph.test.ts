/**
 * Dependency graph unit tests.
 *
 * Validates:
 *   - SERVICE_DEPENDENCY_GRAPH structure and completeness
 *   - SERVICE_ADJACENCY correctness relative to the graph
 *   - SERVICE_INIT_ORDER respects dependency ordering
 *   - hasCycle() detection for acyclic and cyclic graphs
 *   - topologicalSort() ordering and cycle rejection
 *   - Edge cases: empty graphs, self-loops, diamond dependencies,
 *     deeply nested chains
 *
 * @module tests/unit/dependency-graph
 */

import { describe, expect, it } from "vitest";
import {
	hasCycle,
	SERVICE_ADJACENCY,
	SERVICE_DEPENDENCY_GRAPH,
	SERVICE_INIT_ORDER,
	topologicalSort,
} from "../../src/contracts/dependency-graph.js";

// ---------------------------------------------------------------------------
// SERVICE_DEPENDENCY_GRAPH structural tests
// ---------------------------------------------------------------------------

describe("SERVICE_DEPENDENCY_GRAPH", () => {
	it("is a non-empty array", () => {
		expect(Array.isArray(SERVICE_DEPENDENCY_GRAPH)).toBe(true);
		expect(SERVICE_DEPENDENCY_GRAPH.length).toBeGreaterThan(0);
	});

	it("contains exactly 7 service entries", () => {
		expect(SERVICE_DEPENDENCY_GRAPH).toHaveLength(7);
	});

	it("every entry has layer 4", () => {
		for (const entry of SERVICE_DEPENDENCY_GRAPH) {
			expect(entry.layer).toBe(4);
		}
	});

	it("every entry has a non-empty service name", () => {
		for (const entry of SERVICE_DEPENDENCY_GRAPH) {
			expect(typeof entry.service).toBe("string");
			expect(entry.service.length).toBeGreaterThan(0);
		}
	});

	it("every entry has a dependsOn array", () => {
		for (const entry of SERVICE_DEPENDENCY_GRAPH) {
			expect(Array.isArray(entry.dependsOn)).toBe(true);
		}
	});

	it("every entry has a rationale object", () => {
		for (const entry of SERVICE_DEPENDENCY_GRAPH) {
			expect(typeof entry.rationale).toBe("object");
			expect(entry.rationale).not.toBeNull();
		}
	});

	it("has no duplicate service names", () => {
		const names = SERVICE_DEPENDENCY_GRAPH.map((e) => e.service);
		expect(new Set(names).size).toBe(names.length);
	});

	it("all dependsOn entries reference services that exist in the graph", () => {
		const knownServices = new Set(SERVICE_DEPENDENCY_GRAPH.map((e) => e.service));
		for (const entry of SERVICE_DEPENDENCY_GRAPH) {
			for (const dep of entry.dependsOn) {
				expect(knownServices.has(dep)).toBe(true);
			}
		}
	});

	it("rationale keys match dependsOn entries", () => {
		for (const entry of SERVICE_DEPENDENCY_GRAPH) {
			const rationaleKeys = Object.keys(entry.rationale);
			expect(rationaleKeys.sort()).toEqual([...entry.dependsOn].sort());
		}
	});

	it("leaf services have empty dependsOn and empty rationale", () => {
		const leaves = SERVICE_DEPENDENCY_GRAPH.filter((e) => e.dependsOn.length === 0);
		expect(leaves.length).toBeGreaterThan(0);
		for (const leaf of leaves) {
			expect(Object.keys(leaf.rationale)).toHaveLength(0);
		}
	});

	it("ValidationService depends on GraphService and SecurityService", () => {
		const validation = SERVICE_DEPENDENCY_GRAPH.find((e) => e.service === "ValidationService");
		expect(validation).toBeDefined();
		if (validation) {
			expect([...validation.dependsOn].sort()).toEqual(["GraphService", "SecurityService"].sort());
		}
	});
});

// ---------------------------------------------------------------------------
// SERVICE_ADJACENCY tests
// ---------------------------------------------------------------------------

describe("SERVICE_ADJACENCY", () => {
	it("has the same service keys as the dependency graph", () => {
		const graphServices = SERVICE_DEPENDENCY_GRAPH.map((e) => e.service).sort();
		const adjacencyKeys = Object.keys(SERVICE_ADJACENCY).sort();
		expect(adjacencyKeys).toEqual(graphServices);
	});

	it("adjacency values match dependsOn from the graph", () => {
		for (const entry of SERVICE_DEPENDENCY_GRAPH) {
			const adjacencyDeps = [...SERVICE_ADJACENCY[entry.service]].sort();
			const graphDeps = [...entry.dependsOn].sort();
			expect(adjacencyDeps).toEqual(graphDeps);
		}
	});

	it("leaf services have empty adjacency lists", () => {
		const leaves = [
			"SnapshotService",
			"LearningService",
			"SecurityService",
			"GraphService",
			"CacheService",
			"IntegrationService",
		] as const;
		for (const leaf of leaves) {
			expect(SERVICE_ADJACENCY[leaf]).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// SERVICE_INIT_ORDER tests
// ---------------------------------------------------------------------------

describe("SERVICE_INIT_ORDER", () => {
	it("contains exactly the same services as the dependency graph", () => {
		const graphServices = SERVICE_DEPENDENCY_GRAPH.map((e) => e.service).sort();
		const initOrder = [...SERVICE_INIT_ORDER].sort();
		expect(initOrder).toEqual(graphServices);
	});

	it("has no duplicates", () => {
		expect(new Set(SERVICE_INIT_ORDER).size).toBe(SERVICE_INIT_ORDER.length);
	});

	it("every service appears after all its dependencies", () => {
		for (const entry of SERVICE_DEPENDENCY_GRAPH) {
			const serviceIdx = SERVICE_INIT_ORDER.indexOf(entry.service);
			for (const dep of entry.dependsOn) {
				const depIdx = SERVICE_INIT_ORDER.indexOf(dep);
				expect(depIdx).toBeLessThan(serviceIdx);
			}
		}
	});

	it("ValidationService appears last (only service with dependencies)", () => {
		const lastService = SERVICE_INIT_ORDER[SERVICE_INIT_ORDER.length - 1];
		expect(lastService).toBe("ValidationService");
	});
});

// ---------------------------------------------------------------------------
// hasCycle
// ---------------------------------------------------------------------------

describe("hasCycle", () => {
	it("returns false for the production SERVICE_ADJACENCY", () => {
		expect(hasCycle(SERVICE_ADJACENCY)).toBe(false);
	});

	it("returns false for an empty graph", () => {
		expect(hasCycle({})).toBe(false);
	});

	it("returns false for a single node with no edges", () => {
		expect(hasCycle({ A: [] })).toBe(false);
	});

	it("returns false for a linear chain A -> B -> C", () => {
		expect(hasCycle({ A: ["B"], B: ["C"], C: [] })).toBe(false);
	});

	it("returns false for a diamond graph (A -> B, A -> C, B -> D, C -> D)", () => {
		expect(
			hasCycle({
				A: ["B", "C"],
				B: ["D"],
				C: ["D"],
				D: [],
			}),
		).toBe(false);
	});

	it("detects a direct self-loop (A -> A)", () => {
		expect(hasCycle({ A: ["A"] })).toBe(true);
	});

	it("detects a two-node cycle (A -> B -> A)", () => {
		expect(hasCycle({ A: ["B"], B: ["A"] })).toBe(true);
	});

	it("detects a three-node cycle (A -> B -> C -> A)", () => {
		expect(hasCycle({ A: ["B"], B: ["C"], C: ["A"] })).toBe(true);
	});

	it("detects a cycle in a larger graph with non-cyclic branches", () => {
		expect(
			hasCycle({
				A: ["B"],
				B: ["C"],
				C: ["D"],
				D: ["B"], // cycle: B -> C -> D -> B
				E: [], // isolated node
				F: ["E"], // non-cyclic branch
			}),
		).toBe(true);
	});

	it("returns false for multiple disconnected acyclic components", () => {
		expect(
			hasCycle({
				A: ["B"],
				B: [],
				C: ["D"],
				D: [],
			}),
		).toBe(false);
	});

	it("handles a graph where some adjacency targets are not keys", () => {
		// B is referenced but not a key in the adjacency map
		expect(hasCycle({ A: ["B"] })).toBe(false);
	});

	it("detects a cycle only among a subset of nodes", () => {
		expect(
			hasCycle({
				A: [],
				B: ["C"],
				C: ["D"],
				D: ["B"],
			}),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe("topologicalSort", () => {
	it("returns a valid ordering for the production SERVICE_ADJACENCY", () => {
		const order = topologicalSort(SERVICE_ADJACENCY);
		expect(order).not.toBeNull();
		expect(order).toHaveLength(Object.keys(SERVICE_ADJACENCY).length);
	});

	it("places dependencies before dependents in the production graph", () => {
		const order = topologicalSort(SERVICE_ADJACENCY);
		expect(order).not.toBeNull();

		if (order) {
			const indexOf = (name: string) => order.indexOf(name);
			// ValidationService depends on GraphService and SecurityService
			expect(indexOf("GraphService")).toBeLessThan(indexOf("ValidationService"));
			expect(indexOf("SecurityService")).toBeLessThan(indexOf("ValidationService"));
		}
	});

	it("returns an array for an empty graph", () => {
		const order = topologicalSort({});
		expect(order).not.toBeNull();
		expect(order).toEqual([]);
	});

	it("returns a single-element array for one node", () => {
		const order = topologicalSort({ A: [] });
		expect(order).toEqual(["A"]);
	});

	it("orders a linear chain correctly", () => {
		// A depends on B, B depends on C => C, B, A
		const order = topologicalSort({ A: ["B"], B: ["C"], C: [] });
		expect(order).not.toBeNull();

		if (order) {
			const indexOf = (name: string) => order.indexOf(name);
			expect(indexOf("C")).toBeLessThan(indexOf("B"));
			expect(indexOf("B")).toBeLessThan(indexOf("A"));
		}
	});

	it("handles a diamond graph", () => {
		const order = topologicalSort({
			A: ["B", "C"],
			B: ["D"],
			C: ["D"],
			D: [],
		});
		expect(order).not.toBeNull();
		expect(order).toHaveLength(4);

		if (order) {
			const indexOf = (name: string) => order.indexOf(name);
			expect(indexOf("D")).toBeLessThan(indexOf("B"));
			expect(indexOf("D")).toBeLessThan(indexOf("C"));
			expect(indexOf("B")).toBeLessThan(indexOf("A"));
			expect(indexOf("C")).toBeLessThan(indexOf("A"));
		}
	});

	it("returns null for a graph with a cycle", () => {
		const order = topologicalSort({
			A: ["B"],
			B: ["C"],
			C: ["A"],
		});
		expect(order).toBeNull();
	});

	it("returns null for a self-loop", () => {
		const order = topologicalSort({ A: ["A"] });
		expect(order).toBeNull();
	});

	it("returns null for a two-node cycle", () => {
		const order = topologicalSort({ A: ["B"], B: ["A"] });
		expect(order).toBeNull();
	});

	it("handles multiple disconnected components", () => {
		const order = topologicalSort({
			A: ["B"],
			B: [],
			C: ["D"],
			D: [],
		});
		expect(order).not.toBeNull();
		expect(order).toHaveLength(4);

		if (order) {
			const indexOf = (name: string) => order.indexOf(name);
			expect(indexOf("B")).toBeLessThan(indexOf("A"));
			expect(indexOf("D")).toBeLessThan(indexOf("C"));
		}
	});

	it("includes all nodes in the result", () => {
		const adjacency = {
			X: [],
			Y: ["X"],
			Z: ["X", "Y"],
		};
		const order = topologicalSort(adjacency);
		expect(order).not.toBeNull();
		expect(order).toHaveLength(3);
		expect(new Set(order!)).toEqual(new Set(["X", "Y", "Z"]));
	});

	it("returns null when cycle exists among a subset", () => {
		const order = topologicalSort({
			A: [],
			B: ["C"],
			C: ["D"],
			D: ["B"],
		});
		expect(order).toBeNull();
	});
});
