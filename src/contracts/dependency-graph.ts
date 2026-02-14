/**
 * Service Dependency Graph
 *
 * Documents which services depend on which other service interfaces.
 * This graph MUST be a directed acyclic graph (DAG) — circular
 * dependencies between services are a structural violation.
 *
 * Dependencies are on interfaces (e.g. `IGraphService`), never on
 * concrete implementations. The composition root (ServiceContainer factory)
 * resolves interfaces to implementations at startup.
 *
 * This file serves two purposes:
 *   1. Human-readable documentation of the dependency topology.
 *   2. Machine-readable const used by tests and the composition root
 *      to validate the graph is acyclic and complete.
 *
 * @module contracts/dependency-graph
 */

import type { ServiceName } from "./tool-map.js";

// ---------------------------------------------------------------------------
// Dependency Entry
// ---------------------------------------------------------------------------

/** Describes one service's injectable dependencies. */
export interface ServiceDependency {
  /**
   * The service being described.
   * Maps to an interface in `services.ts` (e.g. "ValidationService" -> IValidationService).
   */
  readonly service: ServiceName;

  /**
   * Interfaces this service requires at construction time.
   * Empty array means the service is a leaf node with no service dependencies
   * (it may still depend on infrastructure like filesystem, config, or logger).
   */
  readonly dependsOn: readonly ServiceName[];

  /** The SOPR layer this service belongs to. Always 4 for services. */
  readonly layer: 4;

  /**
   * Brief rationale for each dependency.
   * Keyed by the dependency's ServiceName.
   */
  readonly rationale: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// The Graph
// ---------------------------------------------------------------------------

/**
 * Complete service dependency graph.
 *
 * Topology (read left-to-right as "depends on"):
 *
 * ```
 *   ValidationService ──> GraphService        (orphan/circular checks in full validation)
 *   ValidationService ──> SecurityService      (security layer in full validation)
 *   IntegrationService ─> (none)               (leaf: talks to external APIs only)
 *   SnapshotService ───> (none)                (leaf: filesystem + storage only)
 *   LearningService ──> (none)                 (leaf: learning store only)
 *   SecurityService ──> (none)                 (leaf: static analysis only)
 *   GraphService ──────> (none)                (leaf: AST/import parsing only)
 *   CacheService ──────> (none)                (leaf: in-memory/disk cache only)
 * ```
 *
 * Only ValidationService has service-level dependencies, and they point
 * to leaf nodes, so the graph is guaranteed acyclic.
 */
export const SERVICE_DEPENDENCY_GRAPH: readonly ServiceDependency[] = [
  {
    service: "SnapshotService",
    dependsOn: [],
    layer: 4,
    rationale: {},
  },
  {
    service: "LearningService",
    dependsOn: [],
    layer: 4,
    rationale: {},
  },
  {
    service: "SecurityService",
    dependsOn: [],
    layer: 4,
    rationale: {},
  },
  {
    service: "GraphService",
    dependsOn: [],
    layer: 4,
    rationale: {},
  },
  {
    service: "CacheService",
    dependsOn: [],
    layer: 4,
    rationale: {},
  },
  {
    service: "IntegrationService",
    dependsOn: [],
    layer: 4,
    rationale: {},
  },
  {
    service: "ValidationService",
    dependsOn: ["GraphService", "SecurityService"],
    layer: 4,
    rationale: {
      GraphService:
        "Full validation delegates to GraphService for circular dependency and orphan detection.",
      SecurityService:
        "Full validation delegates to SecurityService for vulnerability scanning.",
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Initialization Order
// ---------------------------------------------------------------------------

/**
 * Services listed in valid construction order.
 *
 * Services with no dependencies come first; services that depend on others
 * come after all their dependencies. This order is safe for synchronous,
 * sequential construction in the composition root.
 */
export const SERVICE_INIT_ORDER: readonly ServiceName[] = [
  // Leaf services (no service dependencies) — can be constructed in any order
  "SnapshotService",
  "LearningService",
  "SecurityService",
  "GraphService",
  "CacheService",
  "IntegrationService",
  // Dependent services — must come after their dependencies
  "ValidationService",
] as const;

// ---------------------------------------------------------------------------
// Adjacency Map (for programmatic traversal)
// ---------------------------------------------------------------------------

/**
 * Adjacency-list representation of the dependency graph.
 *
 * Key = service, Value = set of services it depends on.
 * Useful for topological sort, cycle detection, and test wiring.
 */
export const SERVICE_ADJACENCY: Readonly<Record<ServiceName, readonly ServiceName[]>> = {
  SnapshotService: [],
  LearningService: [],
  SecurityService: [],
  GraphService: [],
  CacheService: [],
  IntegrationService: [],
  ValidationService: ["GraphService", "SecurityService"],
} as const;

// ---------------------------------------------------------------------------
// Validation Utilities
// ---------------------------------------------------------------------------

/**
 * Returns true if the adjacency map contains a cycle.
 *
 * Uses iterative depth-first search with a coloring scheme:
 *   - white (unvisited), gray (in current path), black (fully explored).
 *
 * This function is designed to be called in tests and at startup
 * to enforce the DAG invariant.
 */
export function hasCycle(
  adjacency: Readonly<Record<string, readonly string[]>>,
): boolean {
  const white = new Set(Object.keys(adjacency));
  const gray = new Set<string>();
  const black = new Set<string>();

  for (const node of Object.keys(adjacency)) {
    if (!white.has(node)) continue;

    const stack: string[] = [node];

    while (stack.length > 0) {
      const current = stack[stack.length - 1]!;

      if (white.has(current)) {
        white.delete(current);
        gray.add(current);

        const deps = adjacency[current] ?? [];
        for (const dep of deps) {
          if (gray.has(dep)) return true; // back edge = cycle
          if (white.has(dep)) stack.push(dep);
        }
      } else {
        stack.pop();
        gray.delete(current);
        black.add(current);
      }
    }
  }

  return false;
}

/**
 * Compute a valid topological ordering of services.
 *
 * Returns null if the graph contains a cycle.
 * Uses Kahn's algorithm (BFS-based).
 */
export function topologicalSort(
  adjacency: Readonly<Record<string, readonly string[]>>,
): readonly string[] | null {
  const inDegree = new Map<string, number>();
  const nodes = Object.keys(adjacency);

  // Initialize in-degrees
  for (const node of nodes) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
    for (const dep of adjacency[node] ?? []) {
      inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
    }
  }

  // Note: For a dependency graph, we need the reverse direction.
  // "A dependsOn B" means B must come before A.
  // So we invert: edges go from dependency to dependent.
  const reverseDegree = new Map<string, number>();
  const reverseAdj = new Map<string, string[]>();

  for (const node of nodes) {
    if (!reverseDegree.has(node)) reverseDegree.set(node, 0);
    if (!reverseAdj.has(node)) reverseAdj.set(node, []);
  }

  for (const node of nodes) {
    for (const dep of adjacency[node] ?? []) {
      // dep -> node (dep must come before node)
      if (!reverseAdj.has(dep)) reverseAdj.set(dep, []);
      reverseAdj.get(dep)!.push(node);
      reverseDegree.set(node, (reverseDegree.get(node) ?? 0) + 1);
    }
  }

  // Reset in-degrees for reverse graph
  for (const node of nodes) {
    if (!reverseDegree.has(node)) reverseDegree.set(node, 0);
  }

  const queue: string[] = [];
  for (const [node, degree] of reverseDegree) {
    if (degree === 0) queue.push(node);
  }

  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const dependent of reverseAdj.get(current) ?? []) {
      const newDegree = (reverseDegree.get(dependent) ?? 1) - 1;
      reverseDegree.set(dependent, newDegree);
      if (newDegree === 0) queue.push(dependent);
    }
  }

  // If we didn't visit all nodes, there is a cycle
  if (result.length !== nodes.length) return null;

  return result;
}
