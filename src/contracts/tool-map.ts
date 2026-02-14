/**
 * Tool Consolidation Map
 *
 * The single source of truth for how 26 capabilities are consolidated into
 * 7 mode-based tools. Each entry describes the tool name, its human-readable
 * description (kept under 60 tokens for efficient tool discovery), every mode
 * the tool supports, and the services + execution strategy each mode requires.
 *
 * This map is consumed by:
 *   - Layer 2 (Tool Registry) to generate Zod schemas and dispatch tables.
 *   - Layer 3 (Mode-Based Tools) to know which services to compose.
 *   - Tests to validate wiring without touching real services.
 *
 * @module contracts/tool-map
 */

// ---------------------------------------------------------------------------
// Execution Strategy
// ---------------------------------------------------------------------------

/**
 * How a mode handler should invoke its service dependencies.
 *
 * - `"single"`     — one service, one call.
 * - `"parallel"`   — multiple services called via `Promise.all`.
 * - `"sequential"` — multiple services called in order; later calls may
 *                     depend on earlier results.
 */
export type ExecutionStrategy = "single" | "parallel" | "sequential";

// ---------------------------------------------------------------------------
// Service Names (string-literal union for compile-time safety)
// ---------------------------------------------------------------------------

/**
 * Every injectable service in the SOPR system. Service names map 1-to-1
 * to interfaces defined in `./services.ts`.
 */
export type ServiceName =
  | "SnapshotService"
  | "ValidationService"
  | "LearningService"
  | "IntegrationService"
  | "SecurityService"
  | "GraphService"
  | "CacheService";

// ---------------------------------------------------------------------------
// Mode Definition
// ---------------------------------------------------------------------------

/** Describes a single mode within a tool. */
export interface ModeDefinition {
  /** Human-readable explanation of what this mode does. */
  readonly description: string;

  /**
   * The handler function name that the tool layer will delegate to.
   * Convention: `handle<ToolPascal><ModePascal>`, e.g. `handleSnapStart`.
   */
  readonly handler: string;

  /** Which services this mode requires (order matters for sequential). */
  readonly services: readonly ServiceName[];

  /** How the services are invoked. */
  readonly execution: ExecutionStrategy;
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

/** Top-level descriptor for a mode-based tool. */
export interface ToolMapEntry {
  /** Tool name exposed via the MCP protocol (short, lowercase). */
  readonly name: string;

  /**
   * Human-readable description shown during tool discovery.
   * Must fit within ~60 tokens to keep discovery overhead low.
   */
  readonly description: string;

  /** Every mode this tool supports, keyed by mode string. */
  readonly modes: Readonly<Record<string, ModeDefinition>>;
}

// ---------------------------------------------------------------------------
// The Map
// ---------------------------------------------------------------------------

/**
 * Complete tool consolidation map.
 *
 * 7 tools, 27 modes, backed by 7 injectable services.
 *
 * Frozen at the type level via `as const` so the registry can derive
 * literal types for mode names, service lists, etc.
 */
export const TOOL_MAP = {
  // -------------------------------------------------------------------
  // snap — Snapshot lifecycle management
  // -------------------------------------------------------------------
  snap: {
    name: "snap",
    description:
      "Snapshot lifecycle. Modes: start (begin task), check (validate), context (get context), end (complete), undo (revert + mask).",
    modes: {
      start: {
        description: "Begin a new task: create snapshot, load learnings, enrich context.",
        handler: "handleSnapStart",
        services: ["SnapshotService", "LearningService", "IntegrationService"],
        execution: "parallel",
      },
      check: {
        description: "Quick validation of current snapshot state.",
        handler: "handleSnapCheck",
        services: ["ValidationService"],
        execution: "single",
      },
      context: {
        description: "Retrieve current task context with snapshot and learnings.",
        handler: "handleSnapContext",
        services: ["SnapshotService", "LearningService"],
        execution: "parallel",
      },
      end: {
        description: "Complete a task: finalize snapshot, persist learnings.",
        handler: "handleSnapEnd",
        services: ["SnapshotService", "LearningService"],
        execution: "sequential",
      },
      undo: {
        description: "Revert to snapshot and generate context masking instruction for LLM.",
        handler: "handleSnapUndo",
        services: ["SnapshotService"],
        execution: "sequential",
      },
    },
  },

  // -------------------------------------------------------------------
  // check — Multi-dimensional code validation
  // -------------------------------------------------------------------
  check: {
    name: "check",
    description:
      "Code validation. Modes: quick, full, patterns, build, circular, security, coverage, orphans, health, evolution, integrations.",
    modes: {
      quick: {
        description: "Fast lint + typecheck pass.",
        handler: "handleCheckQuick",
        services: ["ValidationService"],
        execution: "single",
      },
      full: {
        description: "Comprehensive 7-layer validation: types, lint, patterns, security, deps.",
        handler: "handleCheckFull",
        services: ["ValidationService", "SecurityService", "GraphService"],
        execution: "parallel",
      },
      patterns: {
        description: "Validate code against project-specific patterns.",
        handler: "handleCheckPatterns",
        services: ["ValidationService"],
        execution: "single",
      },
      build: {
        description: "Verify the project builds without errors.",
        handler: "handleCheckBuild",
        services: ["ValidationService"],
        execution: "single",
      },
      circular: {
        description: "Detect circular dependency chains.",
        handler: "handleCheckCircular",
        services: ["GraphService"],
        execution: "single",
      },
      security: {
        description: "Run security vulnerability scans.",
        handler: "handleCheckSecurity",
        services: ["SecurityService"],
        execution: "single",
      },
      coverage: {
        description: "Evaluate test coverage metrics.",
        handler: "handleCheckCoverage",
        services: ["ValidationService"],
        execution: "single",
      },
      orphans: {
        description: "Find unreferenced files and dead exports.",
        handler: "handleCheckOrphans",
        services: ["GraphService"],
        execution: "single",
      },
      health: {
        description: "Combined codebase health assessment.",
        handler: "handleCheckHealth",
        services: ["ValidationService", "GraphService"],
        execution: "parallel",
      },
      evolution: {
        description: "Track code quality trends over time.",
        handler: "handleCheckEvolution",
        services: ["ValidationService"],
        execution: "single",
      },
      integrations: {
        description: "Validate external integration configurations.",
        handler: "handleCheckIntegrations",
        services: ["IntegrationService"],
        execution: "single",
      },
    },
  },

  // -------------------------------------------------------------------
  // learn — Learning persistence and retrieval
  // -------------------------------------------------------------------
  learn: {
    name: "learn",
    description:
      "Learning system. Modes: load (retrieve learnings), save (persist insight), search (query learnings).",
    modes: {
      load: {
        description: "Load tiered learnings for current context.",
        handler: "handleLearnLoad",
        services: ["LearningService"],
        execution: "single",
      },
      save: {
        description: "Persist a new learning or pattern.",
        handler: "handleLearnSave",
        services: ["LearningService"],
        execution: "single",
      },
      search: {
        description: "Query learnings by keywords or semantic similarity.",
        handler: "handleLearnSearch",
        services: ["LearningService"],
        execution: "single",
      },
    },
  },

  // -------------------------------------------------------------------
  // integrate — External service integrations
  // -------------------------------------------------------------------
  integrate: {
    name: "integrate",
    description:
      "External integrations. Modes: git (repository context), sentry (error tracking), github (PR/issue data).",
    modes: {
      git: {
        description: "Gather git repository context (branch, status, recent commits).",
        handler: "handleIntegrateGit",
        services: ["IntegrationService"],
        execution: "single",
      },
      sentry: {
        description: "Fetch recent Sentry errors and error context.",
        handler: "handleIntegrateSentry",
        services: ["IntegrationService"],
        execution: "single",
      },
      github: {
        description: "Retrieve GitHub PR details, comments, and check status.",
        handler: "handleIntegrateGithub",
        services: ["IntegrationService"],
        execution: "single",
      },
    },
  },

  // -------------------------------------------------------------------
  // pulse — System health monitoring
  // -------------------------------------------------------------------
  pulse: {
    name: "pulse",
    description: "System health. Modes: health (aggregate service and codebase status).",
    modes: {
      health: {
        description:
          "Aggregate health check across validation, integrations, and dependency graph.",
        handler: "handlePulseHealth",
        services: ["ValidationService", "IntegrationService", "GraphService"],
        execution: "parallel",
      },
    },
  },

  // -------------------------------------------------------------------
  // graph — Dependency and file graph analysis
  // -------------------------------------------------------------------
  graph: {
    name: "graph",
    description:
      "Dependency analysis. Modes: deps (module dependency graph), files (file relationship map).",
    modes: {
      deps: {
        description: "Compute module-level dependency graph.",
        handler: "handleGraphDeps",
        services: ["GraphService"],
        execution: "single",
      },
      files: {
        description: "Map file relationships and import chains.",
        handler: "handleGraphFiles",
        services: ["GraphService"],
        execution: "single",
      },
    },
  },

  // -------------------------------------------------------------------
  // cache — Error and pattern caching
  // -------------------------------------------------------------------
  cache: {
    name: "cache",
    description:
      "Cache operations. Modes: errors (cached error data), patterns (cached pattern data).",
    modes: {
      errors: {
        description: "Retrieve or refresh cached error diagnostics.",
        handler: "handleCacheErrors",
        services: ["CacheService"],
        execution: "single",
      },
      patterns: {
        description: "Retrieve or refresh cached pattern matches.",
        handler: "handleCachePatterns",
        services: ["CacheService"],
        execution: "single",
      },
    },
  },
} as const satisfies Record<string, ToolMapEntry>;

// ---------------------------------------------------------------------------
// Derived Types
// ---------------------------------------------------------------------------

/** Union of all tool names. */
export type ToolName = keyof typeof TOOL_MAP;

/** Union of all mode names for a given tool. */
export type ModeName<T extends ToolName> = keyof (typeof TOOL_MAP)[T]["modes"];

/** Extract the mode definition for a specific tool + mode pair. */
export type ModeDefinitionFor<
  T extends ToolName,
  M extends ModeName<T>,
> = (typeof TOOL_MAP)[T]["modes"][M];

// ---------------------------------------------------------------------------
// Validation helpers (used at build time / in tests)
// ---------------------------------------------------------------------------

/** Total number of modes across all tools. */
export const TOTAL_MODE_COUNT = Object.values(TOOL_MAP).reduce(
  (sum, tool) => sum + Object.keys(tool.modes).length,
  0,
);

/** Total number of tools. */
export const TOOL_COUNT = Object.keys(TOOL_MAP).length;
