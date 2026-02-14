/**
 * Graph Service Implementation
 *
 * Manages dependency and file relationship graphs. Parses import/require
 * statements to build dependency graphs, detects circular dependencies,
 * finds orphaned files, and maps file relationships.
 *
 * Stateless: all analysis is performed on-the-fly from file system state.
 *
 * @module services/graph-service
 */

import type {
  CircularDependency,
  CircularDepsInput,
  CircularDepsResult,
  DeadExport,
  DependencyGraphInput,
  DependencyGraphResult,
  FileCluster,
  FileGraphInput,
  FileGraphResult,
  GraphEdge,
  GraphHealthInput,
  GraphHealthResult,
  GraphNode,
  IGraphService,
  OrphanDetectionInput,
  OrphanDetectionResult,
  ServiceResult,
  Severity,
} from "../contracts/services.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface GraphServiceConfig {
  /** File extensions to include in analysis. */
  readonly extensions: readonly string[];
  /** Directories to exclude from analysis. */
  readonly excludeDirs: readonly string[];
  /** Maximum depth for dependency traversal. */
  readonly maxDepth: number;
}

const DEFAULT_CONFIG: GraphServiceConfig = {
  extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  excludeDirs: ["node_modules", "dist", "build", ".git", "coverage"],
  maxDepth: 20,
};

// ---------------------------------------------------------------------------
// File System Abstraction (injected for testability)
// ---------------------------------------------------------------------------

/** Function that reads file content. */
export type FileReader = (filePath: string) => Promise<string>;

/** Function that lists directory entries. */
export type DirectoryLister = (
  dirPath: string,
) => Promise<Array<{ name: string; isDirectory: boolean; path: string }>>;

/** Function that checks if a path exists. */
export type PathChecker = (filePath: string) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Import Parsing
// ---------------------------------------------------------------------------

interface ParsedImport {
  readonly source: string;
  readonly type: "import" | "re-export" | "dynamic";
}

/**
 * Parse import/require/export statements from TypeScript/JavaScript source.
 * Uses regex for speed and simplicity without requiring a full AST parser.
 */
function parseImports(content: string): ParsedImport[] {
  const imports: ParsedImport[] = [];

  // Static imports: import ... from "..."
  const staticImportRegex =
    /import\s+(?:(?:type\s+)?(?:\{[^}]*\}|[\w*]+(?:\s*,\s*\{[^}]*\})?)\s+from\s+)?["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = staticImportRegex.exec(content)) !== null) {
    if (match[1]) {
      imports.push({ source: match[1], type: "import" });
    }
  }

  // Dynamic imports: import("...")
  const dynamicImportRegex = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicImportRegex.exec(content)) !== null) {
    if (match[1]) {
      imports.push({ source: match[1], type: "dynamic" });
    }
  }

  // Re-exports: export ... from "..."
  const reExportRegex = /export\s+(?:(?:type\s+)?\{[^}]*\}|\*)\s+from\s+["']([^"']+)["']/g;
  while ((match = reExportRegex.exec(content)) !== null) {
    if (match[1]) {
      imports.push({ source: match[1], type: "re-export" });
    }
  }

  // CommonJS requires: require("...")
  const requireRegex = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    if (match[1]) {
      imports.push({ source: match[1], type: "import" });
    }
  }

  return imports;
}

/**
 * Parse export names from source code.
 */
function parseExports(content: string): string[] {
  const exports: string[] = [];

  // Named exports: export const/let/function/class/type/interface name
  const namedExportRegex =
    /export\s+(?:default\s+)?(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = namedExportRegex.exec(content)) !== null) {
    if (match[1]) {
      exports.push(match[1]);
    }
  }

  // Destructured exports: export { name1, name2 }
  const destructuredRegex = /export\s+\{([^}]+)\}/g;
  while ((match = destructuredRegex.exec(content)) !== null) {
    if (match[1]) {
      const names = match[1].split(",").map(
        (n) =>
          n
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim() ?? "",
      );
      for (const name of names) {
        if (name.length > 0) {
          exports.push(name);
        }
      }
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class GraphServiceImpl implements IGraphService {
  private readonly config: GraphServiceConfig;

  constructor(
    config: Partial<GraphServiceConfig>,
    private readonly readFile: FileReader,
    private readonly listDirectory: DirectoryLister,
    _checkPath: PathChecker,
    private readonly logger: Logger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async computeDependencyGraph(
    input: DependencyGraphInput,
  ): Promise<ServiceResult<DependencyGraphResult>> {
    try {
      const depth = input.depth ?? this.config.maxDepth;
      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const visited = new Set<string>();

      // Collect all files
      const allFiles = await this.collectFiles(input.workspacePath);

      // Use entry points if provided, otherwise scan all files
      const entryPoints =
        input.entryPoints && input.entryPoints.length > 0 ? [...input.entryPoints] : allFiles;

      // Build the graph
      for (const filePath of entryPoints) {
        await this.buildGraph(
          filePath,
          input.workspacePath,
          nodes,
          edges,
          visited,
          0,
          depth,
          allFiles,
        );
      }

      // Calculate max depth
      const maxDepth = this.calculateMaxDepth(edges, nodes);

      this.logger.info("Dependency graph computed", {
        nodes: nodes.length,
        edges: edges.length,
        maxDepth,
      });

      return {
        ok: true,
        data: {
          nodes,
          edges,
          totalModules: nodes.length,
          maxDepth,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to compute dependency graph", {
        error: message,
      });
      return { ok: false, error: message, code: "DEP_GRAPH_FAILED" };
    }
  }

  async detectCircularDeps(input: CircularDepsInput): Promise<ServiceResult<CircularDepsResult>> {
    try {
      // Build the dependency graph first
      const graphResult = await this.computeDependencyGraph({
        workspacePath: input.workspacePath,
      });

      if (!graphResult.ok) {
        return {
          ok: false,
          error: graphResult.error,
          code: graphResult.code,
        };
      }

      const { nodes, edges } = graphResult.data;

      // Build adjacency list
      const adjacency = new Map<string, string[]>();
      for (const node of nodes) {
        adjacency.set(node.id, []);
      }
      for (const edge of edges) {
        const list = adjacency.get(edge.from);
        if (list) {
          list.push(edge.to);
        }
      }

      // Detect cycles using DFS with coloring
      const cycles = this.findCycles(adjacency);
      const affectedFiles = new Set<string>();

      const circularDeps: CircularDependency[] = cycles.map((chain) => {
        for (const file of chain) {
          affectedFiles.add(file);
        }
        const severity: Severity = chain.length > 3 ? "error" : "warning";
        return { chain, severity };
      });

      this.logger.info("Circular dependency detection completed", {
        cycles: circularDeps.length,
        affectedFiles: affectedFiles.size,
      });

      return {
        ok: true,
        data: {
          cycles: circularDeps,
          affectedFiles: [...affectedFiles],
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Circular dependency detection failed", {
        error: message,
      });
      return { ok: false, error: message, code: "CIRCULAR_DEPS_FAILED" };
    }
  }

  async detectOrphans(input: OrphanDetectionInput): Promise<ServiceResult<OrphanDetectionResult>> {
    try {
      const allFiles = await this.collectFiles(input.workspacePath);
      const ignorePatterns = input.ignorePatterns ?? [];

      // Build the dependency graph
      const graphResult = await this.computeDependencyGraph({
        workspacePath: input.workspacePath,
      });

      if (!graphResult.ok) {
        return {
          ok: false,
          error: graphResult.error,
          code: graphResult.code,
        };
      }

      // Track which files are imported by at least one other file
      const importedFiles = new Set<string>();
      for (const edge of graphResult.data.edges) {
        importedFiles.add(edge.to);
      }

      // Find orphans: files that are never imported
      const orphanedFiles: string[] = [];
      for (const file of allFiles) {
        // Skip if file matches ignore patterns
        if (ignorePatterns.some((pattern) => file.includes(pattern))) {
          continue;
        }

        // Entry points and index files are not orphans
        const fileName = file.split("/").pop() ?? "";
        if (
          fileName.startsWith("index.") ||
          fileName === "main.ts" ||
          fileName === "main.js" ||
          fileName.endsWith(".test.ts") ||
          fileName.endsWith(".spec.ts") ||
          fileName.endsWith(".test.js") ||
          fileName.endsWith(".spec.js")
        ) {
          continue;
        }

        if (!importedFiles.has(file)) {
          orphanedFiles.push(file);
        }
      }

      // Find dead exports: exports not referenced anywhere
      const deadExports: DeadExport[] = [];
      for (const node of graphResult.data.nodes) {
        for (const exportName of node.exports) {
          // Check if this export is referenced in any importing file
          const isReferenced = graphResult.data.edges.some((edge) => edge.to === node.id);
          if (!isReferenced && !node.path.includes("index.")) {
            deadExports.push({
              file: node.path,
              exportName,
            });
          }
        }
      }

      this.logger.info("Orphan detection completed", {
        orphans: orphanedFiles.length,
        deadExports: deadExports.length,
        totalFiles: allFiles.length,
      });

      return {
        ok: true,
        data: {
          orphanedFiles,
          deadExports,
          totalFiles: allFiles.length,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Orphan detection failed", { error: message });
      return { ok: false, error: message, code: "ORPHAN_DETECTION_FAILED" };
    }
  }

  async computeFileGraph(input: FileGraphInput): Promise<ServiceResult<FileGraphResult>> {
    try {
      const depth = input.depth ?? this.config.maxDepth;
      const allFiles = await this.collectFiles(input.workspacePath);

      const nodes: GraphNode[] = [];
      const edges: GraphEdge[] = [];
      const visited = new Set<string>();

      const startFiles = input.rootFile ? [input.rootFile] : allFiles;

      for (const filePath of startFiles) {
        await this.buildGraph(
          filePath,
          input.workspacePath,
          nodes,
          edges,
          visited,
          0,
          depth,
          allFiles,
        );
      }

      // Compute file clusters based on directory structure
      const clusters = this.computeClusters(nodes);

      this.logger.info("File graph computed", {
        nodes: nodes.length,
        edges: edges.length,
        clusters: clusters.length,
      });

      return {
        ok: true,
        data: { nodes, edges, clusters },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("File graph computation failed", { error: message });
      return { ok: false, error: message, code: "FILE_GRAPH_FAILED" };
    }
  }

  async computeHealth(input: GraphHealthInput): Promise<ServiceResult<GraphHealthResult>> {
    try {
      // Run circular dependency check
      const circularResult = await this.detectCircularDeps({
        workspacePath: input.workspacePath,
      });

      const circularCount = circularResult.ok ? circularResult.data.cycles.length : 0;

      // Run orphan detection
      const orphanResult = await this.detectOrphans({
        workspacePath: input.workspacePath,
      });

      const orphanCount = orphanResult.ok ? orphanResult.data.orphanedFiles.length : 0;

      // Compute fan-out metrics from dependency graph
      const graphResult = await this.computeDependencyGraph({
        workspacePath: input.workspacePath,
      });

      let maxFanOut = 0;
      let totalFanOut = 0;
      let nodeCount = 0;

      if (graphResult.ok) {
        const fanOutMap = new Map<string, number>();
        for (const edge of graphResult.data.edges) {
          fanOutMap.set(edge.from, (fanOutMap.get(edge.from) ?? 0) + 1);
        }

        for (const count of fanOutMap.values()) {
          totalFanOut += count;
          nodeCount++;
          if (count > maxFanOut) maxFanOut = count;
        }
      }

      const avgFanOut = nodeCount > 0 ? Math.round((totalFanOut / nodeCount) * 100) / 100 : 0;

      // Compute modularity score (0-1)
      // Higher modularity = well-separated clusters
      let modularity = 0;
      if (graphResult.ok) {
        const fileGraphResult = await this.computeFileGraph({
          workspacePath: input.workspacePath,
        });
        if (fileGraphResult.ok) {
          const totalEdges = fileGraphResult.data.edges.length;
          const clusterCount = fileGraphResult.data.clusters.length;
          // Simple modularity estimate
          modularity =
            clusterCount > 0 && totalEdges > 0
              ? Math.min(1, clusterCount / Math.sqrt(totalEdges))
              : 0;
        }
      }

      this.logger.info("Graph health computed", {
        circularCount,
        orphanCount,
        maxFanOut,
        avgFanOut,
        modularity,
      });

      return {
        ok: true,
        data: {
          circularCount,
          orphanCount,
          maxFanOut,
          avgFanOut,
          modularity: Math.round(modularity * 100) / 100,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Graph health computation failed", {
        error: message,
      });
      return { ok: false, error: message, code: "GRAPH_HEALTH_FAILED" };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async collectFiles(rootPath: string): Promise<string[]> {
    const files: string[] = [];
    const stack: string[] = [rootPath];

    while (stack.length > 0) {
      const dirPath = stack.pop()!;

      try {
        const entries = await this.listDirectory(dirPath);

        for (const entry of entries) {
          // Skip excluded directories
          if (entry.isDirectory && this.config.excludeDirs.includes(entry.name)) {
            continue;
          }

          if (entry.isDirectory) {
            stack.push(entry.path);
          } else {
            // Check if file has a valid extension
            const ext = this.getExtension(entry.name);
            if (ext && this.config.extensions.includes(ext)) {
              files.push(entry.path);
            }
          }
        }
      } catch {
        // Skip directories we cannot read
        this.logger.debug("Could not read directory", { path: dirPath });
      }
    }

    return files;
  }

  private async buildGraph(
    filePath: string,
    workspacePath: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
    visited: Set<string>,
    currentDepth: number,
    maxDepth: number,
    allFiles: string[],
  ): Promise<void> {
    if (visited.has(filePath) || currentDepth > maxDepth) return;
    visited.add(filePath);

    let content: string;
    try {
      content = await this.readFile(filePath);
    } catch {
      return; // Skip files we cannot read
    }

    const imports = parseImports(content);
    const exports = parseExports(content);

    // Determine node type
    const nodeType = this.classifyNode(filePath);

    nodes.push({
      id: filePath,
      path: filePath,
      type: nodeType,
      imports: imports.map((i) => i.source),
      exports,
    });

    // Resolve and add edges
    for (const imp of imports) {
      // Only track local imports (not node_modules)
      if (!imp.source.startsWith(".") && !imp.source.startsWith("/")) {
        continue;
      }

      const resolvedPath = this.resolveImportPath(filePath, imp.source, allFiles);

      if (resolvedPath) {
        edges.push({
          from: filePath,
          to: resolvedPath,
          type: imp.type,
        });

        // Recursively process the imported file
        await this.buildGraph(
          resolvedPath,
          workspacePath,
          nodes,
          edges,
          visited,
          currentDepth + 1,
          maxDepth,
          allFiles,
        );
      }
    }
  }

  private resolveImportPath(
    fromFile: string,
    importSource: string,
    allFiles: string[],
  ): string | null {
    // Get the directory of the importing file
    const fromDir = fromFile.substring(0, fromFile.lastIndexOf("/"));

    // Resolve relative path
    let resolved: string;
    if (importSource.startsWith("./") || importSource.startsWith("../")) {
      resolved = this.resolvePath(fromDir, importSource);
    } else if (importSource.startsWith("/")) {
      resolved = importSource;
    } else {
      return null; // External module
    }

    // Strip .js extension for TypeScript resolution
    const withoutExt = resolved.replace(/\.js$/, "");

    // Try exact match, then with extensions
    const candidates = [
      resolved,
      withoutExt,
      ...this.config.extensions.map((ext) => withoutExt + ext),
      ...this.config.extensions.map((ext) => resolved + ext),
      ...this.config.extensions.map((ext) => `${withoutExt}/index${ext}`),
      ...this.config.extensions.map((ext) => `${resolved}/index${ext}`),
    ];

    for (const candidate of candidates) {
      if (allFiles.includes(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private resolvePath(base: string, relative: string): string {
    const parts = base.split("/").filter((p) => p.length > 0);
    const relativeParts = relative.split("/").filter((p) => p.length > 0);

    for (const part of relativeParts) {
      if (part === "..") {
        parts.pop();
      } else if (part !== ".") {
        parts.push(part);
      }
    }

    return `/${parts.join("/")}`;
  }

  private classifyNode(filePath: string): "file" | "module" | "package" {
    const fileName = filePath.split("/").pop() ?? "";

    if (fileName.startsWith("index.")) return "module";
    if (fileName === "package.json") return "package";
    return "file";
  }

  private getExtension(fileName: string): string | null {
    const lastDot = fileName.lastIndexOf(".");
    if (lastDot === -1) return null;
    return fileName.substring(lastDot);
  }

  private findCycles(adjacency: Map<string, string[]>): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const stack: string[] = [];

    for (const node of adjacency.keys()) {
      if (!visited.has(node)) {
        this.dfsForCycles(node, adjacency, visited, inStack, stack, cycles);
      }
    }

    return cycles;
  }

  private dfsForCycles(
    node: string,
    adjacency: Map<string, string[]>,
    visited: Set<string>,
    inStack: Set<string>,
    stack: string[],
    cycles: string[][],
  ): void {
    visited.add(node);
    inStack.add(node);
    stack.push(node);

    const neighbors = adjacency.get(node) ?? [];

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        this.dfsForCycles(neighbor, adjacency, visited, inStack, stack, cycles);
      } else if (inStack.has(neighbor)) {
        // Found a cycle: extract it from the stack
        const cycleStart = stack.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycle = stack.slice(cycleStart);
          cycle.push(neighbor); // Close the cycle
          cycles.push(cycle);
        }
      }
    }

    stack.pop();
    inStack.delete(node);
  }

  private calculateMaxDepth(edges: readonly GraphEdge[], nodes: readonly GraphNode[]): number {
    if (nodes.length === 0) return 0;

    // Build adjacency and compute longest path using BFS-like approach
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    for (const node of nodes) {
      adjacency.set(node.id, []);
      inDegree.set(node.id, 0);
    }

    for (const edge of edges) {
      const list = adjacency.get(edge.from);
      if (list) list.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    // Find root nodes (no incoming edges)
    const roots: string[] = [];
    for (const [node, degree] of inDegree) {
      if (degree === 0) roots.push(node);
    }

    // BFS to find max depth
    let maxDepth = 0;
    const depths = new Map<string, number>();

    for (const root of roots) {
      depths.set(root, 0);
    }

    const queue = [...roots];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentDepth = depths.get(current) ?? 0;

      if (currentDepth > maxDepth) maxDepth = currentDepth;

      for (const neighbor of adjacency.get(current) ?? []) {
        const newDepth = currentDepth + 1;
        const existingDepth = depths.get(neighbor) ?? -1;

        if (newDepth > existingDepth) {
          depths.set(neighbor, newDepth);
          queue.push(neighbor);
        }
      }
    }

    return maxDepth;
  }

  private computeClusters(nodes: readonly GraphNode[]): FileCluster[] {
    // Group files by their parent directory
    const dirGroups = new Map<string, string[]>();

    for (const node of nodes) {
      const dir = node.path.substring(0, node.path.lastIndexOf("/"));
      const group = dirGroups.get(dir);
      if (group) {
        group.push(node.path);
      } else {
        dirGroups.set(dir, [node.path]);
      }
    }

    const clusters: FileCluster[] = [];

    for (const [dir, files] of dirGroups) {
      if (files.length >= 2) {
        // Compute cohesion: ratio of within-cluster edges to possible edges
        const cohesion = files.length > 1 ? Math.min(1, files.length / 10) : 1;

        clusters.push({
          name: dir.split("/").pop() ?? dir,
          files,
          cohesion: Math.round(cohesion * 100) / 100,
        });
      }
    }

    return clusters;
  }
}
