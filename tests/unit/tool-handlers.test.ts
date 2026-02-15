/**
 * Tool handler unit tests.
 *
 * Validates that each tool's factory function creates mode handlers
 * which correctly delegate to injected service dependencies and shape
 * responses appropriately. Services are fully mocked -- no business
 * logic is tested through these handlers.
 *
 * Covers:
 *   - snap (start, check, context, end)
 *   - check (quick, full, patterns, build, circular, security)
 *   - graph (deps, files)
 *   - cache (errors, patterns)
 *   - pulse (health)
 *   - integrate (git, sentry, github)
 *   - learn (load, save, search)
 *
 * @module tests/unit/tool-handlers
 */

import { describe, expect, it, vi } from "vitest";
import type {
  ICacheService,
  IGraphService,
  IIntegrationService,
  ILearningService,
  ISecurityService,
  ISnapshotService,
  IValidationService,
} from "../../src/contracts/services.js";
import { createCacheHandlers } from "../../src/tools/cache.js";
import { createCheckHandlers } from "../../src/tools/check.js";
import { createGraphHandlers } from "../../src/tools/graph.js";
import { createIntegrateHandlers } from "../../src/tools/integrate.js";
import { createLearnHandlers } from "../../src/tools/learn.js";
import { createPulseHandlers } from "../../src/tools/pulse.js";
import { createSnapHandlers } from "../../src/tools/snap.js";
import { createMockContext } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Reusable mock factories
// ---------------------------------------------------------------------------

function createMockSnapshotService(activeSnapshotId: string | null = "snap-123"): ISnapshotService {
  return {
    create: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        id: "snap-new",
        hash: "abc",
        files: [],
        createdAt: Date.now(),
        reused: false,
        metadata: {},
      },
    }),
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
    loadTiered: vi.fn().mockResolvedValue({
      ok: true,
      data: { learnings: [], totalAvailable: 0 },
    }),
    save: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        id: "learn-1",
        trigger: "t",
        action: "a",
        type: "pattern",
        createdAt: Date.now(),
        accessCount: 0,
      },
    }),
    search: vi.fn().mockResolvedValue({
      ok: true,
      data: { learnings: [], totalMatches: 0 },
    }),
    recordBatch: vi.fn().mockResolvedValue({
      ok: true,
      data: { stored: 0, deduplicated: 0 },
    }),
  };
}

function createMockIntegrationService(): IIntegrationService {
  return {
    getGitContext: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        branch: "main",
        status: "clean",
        uncommittedFiles: [],
        recentCommits: [],
      },
    }),
    getSentryContext: vi.fn().mockResolvedValue({
      ok: true,
      data: { recentErrors: [], errorRate: 0, topIssues: [] },
    }),
    getGitHubContext: vi.fn().mockResolvedValue({
      ok: true,
      data: { openPRs: [], relevantIssues: [], checkStatus: "passing" },
    }),
    enrichContext: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        riskScore: 0.1,
        activeIntegrations: ["git"],
        git: null,
        sentry: null,
        github: null,
      },
    }),
    checkHealth: vi.fn().mockResolvedValue([]),
    checkConfig: vi.fn().mockResolvedValue({
      ok: true,
      data: { valid: true, integrations: [] },
    }),
  };
}

function createMockValidationService(): IValidationService {
  return {
    quickCheck: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        passed: true,
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        duration: 10,
      },
    }),
    fullCheck: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        passed: true,
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        duration: 50,
      },
    }),
    checkPatterns: vi.fn().mockResolvedValue({
      ok: true,
      data: { compliant: true, violations: [], suggestions: [] },
    }),
    checkBuild: vi.fn().mockResolvedValue({
      ok: true,
      data: { success: true, diagnostics: [], duration: 30 },
    }),
    checkCoverage: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        totalPercent: 85,
        filesCovered: 10,
        filesTotal: 12,
        belowThreshold: [],
        passed: true,
      },
    }),
    computeHealthScore: vi.fn().mockResolvedValue({
      ok: true,
      data: {
        overall: 90,
        dimensions: { codeQuality: 95, architecture: 85 },
        trend: "stable" as const,
      },
    }),
    analyzeEvolution: vi.fn().mockResolvedValue({
      ok: true,
      data: { snapshots: [], trend: "stable" as const },
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
        scannedFiles: 1,
        duration: 5,
      },
    }),
  };
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
      data: { orphanedFiles: [], deadExports: [], totalFiles: 5 },
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

function createMockCacheService(): ICacheService {
  return {
    getErrors: vi.fn().mockResolvedValue({
      ok: true,
      data: { errors: [], totalCached: 0, cacheAge: 0, stale: false },
    }),
    getPatterns: vi.fn().mockResolvedValue({
      ok: true,
      data: { patterns: [], totalCached: 0, cacheAge: 0, stale: false },
    }),
    invalidate: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// snap handlers
// ---------------------------------------------------------------------------

describe("createSnapHandlers", () => {
  const defaultDeps = () => ({
    snapshotService: createMockSnapshotService(),
    learningService: createMockLearningService(),
    integrationService: createMockIntegrationService(),
  });

  describe("start", () => {
    it("calls all three services in parallel and returns assembled result", async () => {
      const deps = defaultDeps();
      const handlers = createSnapHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.start(
        { mode: "start", task: "add feature", files: ["src/a.ts"], intent: "implement" },
        ctx,
      );

      expect(deps.snapshotService.create).toHaveBeenCalledOnce();
      expect(deps.learningService.loadTiered).toHaveBeenCalledOnce();
      expect(deps.integrationService.enrichContext).toHaveBeenCalledOnce();
      expect(result.snapshot).toBeDefined();
      expect(result.learnings).toBeDefined();
      expect(result.enrichment).toBeDefined();
    });

    it("returns nulls when signal is already aborted", async () => {
      const deps = defaultDeps();
      const handlers = createSnapHandlers(deps);
      const abortController = new AbortController();
      abortController.abort();
      const ctx = createMockContext({ signal: abortController.signal });

      const result = await handlers.start({ mode: "start", task: "test", files: [] }, ctx);

      expect(result.snapshot).toBeNull();
      expect(result.learnings).toBeNull();
      expect(result.enrichment).toBeNull();
    });

    it("handles service errors gracefully via unwrapResult", async () => {
      const deps = defaultDeps();
      (deps.snapshotService.create as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        error: "disk full",
        code: "STORAGE_ERROR",
      });
      const handlers = createSnapHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.start({ mode: "start", task: "test", files: [] }, ctx);

      expect(result.snapshot).toBeNull();
      expect(result.learnings).toBeDefined();
    });
  });

  describe("check", () => {
    it("delegates to snapshotService.getState", async () => {
      const deps = defaultDeps();
      const handlers = createSnapHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.check({ mode: "check" }, ctx);

      expect(deps.snapshotService.getState).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        sessionId: ctx.sessionId,
      });
      expect(result).toBeDefined();
      expect(result?.activeSnapshotId).toBe("snap-123");
    });
  });

  describe("context", () => {
    it("returns both state and learnings", async () => {
      const deps = defaultDeps();
      const handlers = createSnapHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.context(
        { mode: "context", intent: "debug", files: ["src/x.ts"] },
        ctx,
      );

      expect(deps.snapshotService.getState).toHaveBeenCalledOnce();
      expect(deps.learningService.loadTiered).toHaveBeenCalledOnce();
      expect(result).toHaveProperty("state");
      expect(result).toHaveProperty("learnings");
    });
  });

  describe("end", () => {
    it("finalizes snapshot and records learnings", async () => {
      const deps = defaultDeps();
      const handlers = createSnapHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.end({ mode: "end", keywords: ["cooldown fix"] }, ctx);

      expect(deps.snapshotService.getState).toHaveBeenCalledOnce();
      expect(deps.snapshotService.finalize).toHaveBeenCalledOnce();
      expect(deps.learningService.recordBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          workspacePath: ctx.workspacePath,
          learnings: ["cooldown fix"],
          sessionId: ctx.sessionId,
        }),
      );
      expect(result.finalized).toBeDefined();
      expect(result.recorded).toBeDefined();
    });

    it("skips finalization when no active snapshot exists", async () => {
      const deps = defaultDeps();
      (deps.snapshotService.getState as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        data: { activeSnapshotId: null, snapshotCount: 0, lastSnapshotAt: null },
      });
      const handlers = createSnapHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.end({ mode: "end" }, ctx);

      expect(deps.snapshotService.finalize).not.toHaveBeenCalled();
      expect(result.finalized).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// check handlers
// ---------------------------------------------------------------------------

describe("createCheckHandlers", () => {
  const defaultDeps = () => ({
    validationService: createMockValidationService(),
    securityService: createMockSecurityService(),
    graphService: createMockGraphService(),
    integrationService: createMockIntegrationService(),
  });

  describe("quick", () => {
    it("delegates to validationService.quickCheck", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.quick({ mode: "quick", file: "src/a.ts" }, ctx);

      expect(deps.validationService.quickCheck).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        files: ["src/a.ts"],
      });
      expect(result).toBeDefined();
      expect(result?.passed).toBe(true);
    });

    it("passes undefined files when no file is specified", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      await handlers.quick({ mode: "quick" }, ctx);

      expect(deps.validationService.quickCheck).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        files: undefined,
      });
    });
  });

  describe("full", () => {
    it("runs validation, security, and graph health in parallel", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.full({ mode: "full" }, ctx);

      expect(deps.validationService.fullCheck).toHaveBeenCalledOnce();
      expect(deps.securityService.scan).toHaveBeenCalledOnce();
      expect(deps.graphService.computeHealth).toHaveBeenCalledOnce();
      expect(result).toHaveProperty("validation");
      expect(result).toHaveProperty("security");
      expect(result).toHaveProperty("graphHealth");
    });

    it("returns nulls when signal is already aborted", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const abortController = new AbortController();
      abortController.abort();
      const ctx = createMockContext({ signal: abortController.signal });

      const result = await handlers.full({ mode: "full" }, ctx);

      expect(result.validation).toBeNull();
      expect(result.security).toBeNull();
      expect(result.graphHealth).toBeNull();
    });
  });

  describe("patterns", () => {
    it("delegates to validationService.checkPatterns with code and filePath", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.patterns(
        { mode: "patterns", code: "let x = 1;", file: "src/a.ts" },
        ctx,
      );

      expect(deps.validationService.checkPatterns).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        code: "let x = 1;",
        filePath: "src/a.ts",
      });
      expect(result).toBeDefined();
      expect(result?.compliant).toBe(true);
    });

    it("defaults code and filePath to empty string when omitted", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      await handlers.patterns({ mode: "patterns" }, ctx);

      expect(deps.validationService.checkPatterns).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        code: "",
        filePath: "",
      });
    });
  });

  describe("build", () => {
    it("delegates to validationService.checkBuild", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.build({ mode: "build" }, ctx);

      expect(deps.validationService.checkBuild).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
      expect(result?.success).toBe(true);
    });
  });

  describe("circular", () => {
    it("delegates to graphService.detectCircularDeps", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.circular({ mode: "circular" }, ctx);

      expect(deps.graphService.detectCircularDeps).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
    });
  });

  describe("security", () => {
    it("delegates to securityService.scan", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.security({ mode: "security", file: "src/auth.ts" }, ctx);

      expect(deps.securityService.scan).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        files: ["src/auth.ts"],
      });
      expect(result).toBeDefined();
    });
  });

  describe("health", () => {
    it("aggregates validation and graph health in parallel", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.health({ mode: "health" }, ctx);

      expect(deps.validationService.computeHealthScore).toHaveBeenCalledOnce();
      expect(deps.graphService.computeHealth).toHaveBeenCalledOnce();
      expect(result).toHaveProperty("validationHealth");
      expect(result).toHaveProperty("graphHealth");
    });
  });

  describe("coverage", () => {
    it("delegates to validationService.checkCoverage", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.coverage({ mode: "coverage" }, ctx);

      expect(deps.validationService.checkCoverage).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
    });
  });

  describe("orphans", () => {
    it("delegates to graphService.detectOrphans", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.orphans({ mode: "orphans" }, ctx);

      expect(deps.graphService.detectOrphans).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
    });
  });

  describe("evolution", () => {
    it("delegates to validationService.analyzeEvolution", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.evolution({ mode: "evolution" }, ctx);

      expect(deps.validationService.analyzeEvolution).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
    });
  });

  describe("integrations", () => {
    it("delegates to integrationService.checkConfig", async () => {
      const deps = defaultDeps();
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.integrations({ mode: "integrations" }, ctx);

      expect(deps.integrationService.checkConfig).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
    });
  });

  describe("unwrapResult error path", () => {
    it("returns null and logs when service returns error result", async () => {
      const deps = defaultDeps();
      (deps.validationService.quickCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        error: "lint crashed",
        code: "LINT_FAIL",
      });
      const handlers = createCheckHandlers(deps);
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.quick({ mode: "quick" }, ctx);

      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// graph handlers
// ---------------------------------------------------------------------------

describe("createGraphHandlers", () => {
  describe("deps", () => {
    it("delegates to graphService.computeDependencyGraph with params", async () => {
      const graphService = createMockGraphService();
      const handlers = createGraphHandlers({ graphService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.deps(
        { mode: "deps", entryPoint: "src/index.ts", depth: 5 },
        ctx,
      );

      expect(graphService.computeDependencyGraph).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        entryPoints: ["src/index.ts"],
        depth: 5,
      });
      expect(result).toBeDefined();
    });

    it("passes undefined entryPoints when no entryPoint given", async () => {
      const graphService = createMockGraphService();
      const handlers = createGraphHandlers({ graphService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      await handlers.deps({ mode: "deps", depth: 3 }, ctx);

      expect(graphService.computeDependencyGraph).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        entryPoints: undefined,
        depth: 3,
      });
    });
  });

  describe("files", () => {
    it("delegates to graphService.computeFileGraph with params", async () => {
      const graphService = createMockGraphService();
      const handlers = createGraphHandlers({ graphService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.files(
        { mode: "files", entryPoint: "src/main.ts", depth: 2 },
        ctx,
      );

      expect(graphService.computeFileGraph).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        rootFile: "src/main.ts",
        depth: 2,
      });
      expect(result).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// cache handlers
// ---------------------------------------------------------------------------

describe("createCacheHandlers", () => {
  describe("errors", () => {
    it("delegates to cacheService.getErrors with refresh flag", async () => {
      const cacheService = createMockCacheService();
      const handlers = createCacheHandlers({ cacheService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.errors({ mode: "errors", value: "force" }, ctx);

      expect(cacheService.getErrors).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        refresh: true,
        limit: undefined,
      });
      expect(result).toBeDefined();
    });

    it("sets refresh to false when value is undefined", async () => {
      const cacheService = createMockCacheService();
      const handlers = createCacheHandlers({ cacheService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      await handlers.errors({ mode: "errors" }, ctx);

      expect(cacheService.getErrors).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        refresh: false,
        limit: undefined,
      });
    });
  });

  describe("patterns", () => {
    it("delegates to cacheService.getPatterns with key filter", async () => {
      const cacheService = createMockCacheService();
      const handlers = createCacheHandlers({ cacheService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.patterns(
        { mode: "patterns", key: "no-console", value: "refresh" },
        ctx,
      );

      expect(cacheService.getPatterns).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        refresh: true,
        patternFilter: "no-console",
      });
      expect(result).toBeDefined();
    });

    it("passes undefined patternFilter when key is omitted", async () => {
      const cacheService = createMockCacheService();
      const handlers = createCacheHandlers({ cacheService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      await handlers.patterns({ mode: "patterns" }, ctx);

      expect(cacheService.getPatterns).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        refresh: false,
        patternFilter: undefined,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// pulse handlers
// ---------------------------------------------------------------------------

describe("createPulseHandlers", () => {
  describe("health", () => {
    it("aggregates validation, integration, and graph health", async () => {
      const validationService = createMockValidationService();
      const integrationService = createMockIntegrationService();
      const graphService = createMockGraphService();
      const handlers = createPulseHandlers({
        validationService,
        integrationService,
        graphService,
      });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.health({ mode: "health" }, ctx);

      expect(validationService.computeHealthScore).toHaveBeenCalledOnce();
      expect(integrationService.checkHealth).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        capabilities: ctx.capabilities,
      });
      expect(graphService.computeHealth).toHaveBeenCalledOnce();
      expect(result).toHaveProperty("validationHealth");
      expect(result).toHaveProperty("integrationHealth");
      expect(result).toHaveProperty("graphHealth");
    });

    it("returns raw integration health result (not unwrapped)", async () => {
      const integrationService = createMockIntegrationService();
      (integrationService.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue([
        { name: "git", status: "healthy", latencyMs: 5, lastChecked: Date.now() },
      ]);
      const handlers = createPulseHandlers({
        validationService: createMockValidationService(),
        integrationService,
        graphService: createMockGraphService(),
      });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.health({ mode: "health" }, ctx);

      // integrationHealth is passed through directly, not unwrapped
      expect(Array.isArray(result.integrationHealth)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// integrate handlers
// ---------------------------------------------------------------------------

describe("createIntegrateHandlers", () => {
  describe("git", () => {
    it("delegates to integrationService.getGitContext", async () => {
      const integrationService = createMockIntegrationService();
      const handlers = createIntegrateHandlers({ integrationService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.git({ mode: "git" }, ctx);

      expect(integrationService.getGitContext).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
      expect(result?.branch).toBe("main");
    });
  });

  describe("sentry", () => {
    it("delegates to integrationService.getSentryContext", async () => {
      const integrationService = createMockIntegrationService();
      const handlers = createIntegrateHandlers({ integrationService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.sentry({ mode: "sentry" }, ctx);

      expect(integrationService.getSentryContext).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
    });
  });

  describe("github", () => {
    it("delegates to integrationService.getGitHubContext", async () => {
      const integrationService = createMockIntegrationService();
      const handlers = createIntegrateHandlers({ integrationService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.github({ mode: "github" }, ctx);

      expect(integrationService.getGitHubContext).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
      });
      expect(result).toBeDefined();
    });

    it("returns null when service returns error", async () => {
      const integrationService = createMockIntegrationService();
      (integrationService.getGitHubContext as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        error: "not configured",
        code: "GITHUB_NOT_CONFIGURED",
      });
      const handlers = createIntegrateHandlers({ integrationService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.github({ mode: "github" }, ctx);

      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// learn handlers
// ---------------------------------------------------------------------------

describe("createLearnHandlers", () => {
  describe("load", () => {
    it("delegates to learningService.loadTiered with intent and filePaths", async () => {
      const learningService = createMockLearningService();
      const handlers = createLearnHandlers({ learningService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.load(
        { mode: "load", intent: "debug", filePaths: ["src/a.ts"] },
        ctx,
      );

      expect(learningService.loadTiered).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        intent: "debug",
        filePaths: ["src/a.ts"],
      });
      expect(result).toBeDefined();
    });
  });

  describe("save", () => {
    it("delegates to learningService.save with mapped type", async () => {
      const learningService = createMockLearningService();
      const handlers = createLearnHandlers({ learningService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.save(
        {
          mode: "save",
          trigger: "when editing auth",
          action: "check token expiry",
          type: "pit",
        },
        ctx,
      );

      expect(learningService.save).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        trigger: "when editing auth",
        action: "check token expiry",
        type: "pitfall",
      });
      expect(result).toBeDefined();
    });

    it("defaults to pattern type when type is omitted", async () => {
      const learningService = createMockLearningService();
      const handlers = createLearnHandlers({ learningService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      await handlers.save({ mode: "save", trigger: "t", action: "a" }, ctx);

      expect(learningService.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: "pattern" }),
      );
    });

    it("defaults trigger and action to empty string when omitted", async () => {
      const learningService = createMockLearningService();
      const handlers = createLearnHandlers({ learningService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      await handlers.save({ mode: "save" }, ctx);

      expect(learningService.save).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: "", action: "" }),
      );
    });

    it("maps all short type codes correctly", async () => {
      const learningService = createMockLearningService();
      const handlers = createLearnHandlers({ learningService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const mappings: Array<[string, string]> = [
        ["pat", "pattern"],
        ["pit", "pitfall"],
        ["eff", "efficiency"],
        ["disc", "discovery"],
        ["wf", "workflow"],
      ];

      for (const [shortCode, expectedType] of mappings) {
        await handlers.save(
          { mode: "save", trigger: "t", action: "a", type: shortCode as "pat" },
          ctx,
        );

        expect(learningService.save).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: expectedType }),
        );
      }
    });
  });

  describe("search", () => {
    it("delegates to learningService.search with query and type", async () => {
      const learningService = createMockLearningService();
      const handlers = createLearnHandlers({ learningService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      const result = await handlers.search(
        { mode: "search", query: "auth pattern", type: "pat" },
        ctx,
      );

      expect(learningService.search).toHaveBeenCalledWith({
        workspacePath: ctx.workspacePath,
        query: "auth pattern",
        type: "pattern",
      });
      expect(result).toBeDefined();
    });

    it("defaults query to empty string when omitted", async () => {
      const learningService = createMockLearningService();
      const handlers = createLearnHandlers({ learningService });
      const ctx = createMockContext({ signal: new AbortController().signal });

      await handlers.search({ mode: "search" }, ctx);

      expect(learningService.search).toHaveBeenCalledWith(expect.objectContaining({ query: "" }));
    });
  });
});
