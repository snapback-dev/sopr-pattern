/**
 * IntegrationServiceImpl unit tests.
 *
 * Validates:
 *   - Git context retrieval via injected command runner
 *   - Sentry context via injected fetcher
 *   - GitHub context via injected fetcher
 *   - Context enrichment aggregation
 *   - Risk score computation
 *   - Health checks for configured/unconfigured integrations
 *   - Configuration checking
 *   - Graceful error handling for all modes
 *
 * All external dependencies are mocked via constructor injection.
 *
 * @module tests/unit/integration-service
 */

import { describe, expect, it, vi } from "vitest";
import type { GitHubContext, SentryContext } from "../../src/contracts/services.js";
import type {
  GitCommandRunner,
  GitHubFetcher,
  SentryFetcher,
} from "../../src/services/integration-service.js";
import { IntegrationServiceImpl } from "../../src/services/integration-service.js";
import { createMockLogger } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGitRunner(responses: Record<string, string>): GitCommandRunner {
  return vi.fn(async (args: readonly string[], _cwd: string): Promise<string> => {
    const key = args.join(" ");

    // Match by first part of command
    for (const [pattern, output] of Object.entries(responses)) {
      if (key.includes(pattern)) {
        return output;
      }
    }

    return "";
  });
}

function createSentryFetcher(data: Partial<SentryContext> = {}): SentryFetcher {
  return vi.fn(async () => ({
    recentErrors: [],
    errorRate: 0,
    topIssues: [],
    ...data,
  }));
}

function createGitHubFetcher(data: Partial<GitHubContext> = {}): GitHubFetcher {
  return vi.fn(async () => ({
    openPRs: [],
    relevantIssues: [],
    checkStatus: "passing" as const,
    ...data,
  }));
}

function createService(
  opts: {
    gitRunner?: GitCommandRunner;
    sentryFetcher?: SentryFetcher;
    githubFetcher?: GitHubFetcher;
  } = {},
) {
  const logger = createMockLogger();

  const gitRunner =
    opts.gitRunner ??
    createGitRunner({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "status --porcelain": "",
      log: `abc123${String.fromCharCode(0)}initial commit${String.fromCharCode(0)}author${String.fromCharCode(0)}1700000000\n`,
      "rev-parse --git-dir": ".git\n",
    });

  const service = new IntegrationServiceImpl(
    {},
    logger,
    gitRunner,
    opts.sentryFetcher,
    opts.githubFetcher,
  );

  return { service, logger, gitRunner };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("IntegrationServiceImpl", () => {
  describe("getGitContext", () => {
    it("parses branch, status, and commits from git output", async () => {
      const { service } = createService();

      const result = await service.getGitContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.branch).toBe("main");
        expect(result.data.status).toBe("clean");
        expect(result.data.uncommittedFiles).toHaveLength(0);
        expect(result.data.recentCommits.length).toBeGreaterThanOrEqual(1);
        expect(result.data.recentCommits[0]?.hash).toBe("abc123");
        expect(result.data.recentCommits[0]?.message).toBe("initial commit");
      }
    });

    it("detects dirty status from uncommitted files", async () => {
      const gitRunner = createGitRunner({
        "rev-parse --abbrev-ref HEAD": "feature/auth\n",
        "status --porcelain": " M src/a.ts\n?? src/new.ts\n",
        log: "",
        "rev-parse --git-dir": ".git\n",
      });
      const { service } = createService({ gitRunner });

      const result = await service.getGitContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.branch).toBe("feature/auth");
        expect(result.data.status).toBe("dirty");
        expect(result.data.uncommittedFiles.length).toBe(2);
      }
    });

    it("returns error result when git command fails", async () => {
      const gitRunner = vi.fn().mockRejectedValue(new Error("git not found"));
      const { service } = createService({ gitRunner });

      const result = await service.getGitContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("GIT_CONTEXT_FAILED");
      }
    });
  });

  describe("getSentryContext", () => {
    it("returns sentry data when fetcher is configured", async () => {
      const sentryFetcher = createSentryFetcher({
        errorRate: 0.05,
        topIssues: ["NPE in auth"],
      });
      const { service } = createService({ sentryFetcher });

      const result = await service.getSentryContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.errorRate).toBe(0.05);
        expect(result.data.topIssues).toContain("NPE in auth");
      }
    });

    it("returns error when fetcher is not configured", async () => {
      const { service } = createService();

      const result = await service.getSentryContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("SENTRY_NOT_CONFIGURED");
      }
    });

    it("returns error when fetcher throws", async () => {
      const sentryFetcher = vi.fn().mockRejectedValue(new Error("network error"));
      const { service } = createService({
        sentryFetcher: sentryFetcher as SentryFetcher,
      });

      const result = await service.getSentryContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("SENTRY_FETCH_FAILED");
      }
    });
  });

  describe("getGitHubContext", () => {
    it("returns github data when fetcher is configured", async () => {
      const githubFetcher = createGitHubFetcher({
        checkStatus: "failing",
        openPRs: [{ number: 1, title: "fix: auth", state: "open", author: "dev" }],
      });
      const { service } = createService({ githubFetcher });

      const result = await service.getGitHubContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.checkStatus).toBe("failing");
        expect(result.data.openPRs).toHaveLength(1);
      }
    });

    it("returns error when fetcher is not configured", async () => {
      const { service } = createService();

      const result = await service.getGitHubContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("GITHUB_NOT_CONFIGURED");
      }
    });

    it("returns error when fetcher throws", async () => {
      const githubFetcher = vi.fn().mockRejectedValue(new Error("rate limited"));
      const { service } = createService({
        githubFetcher: githubFetcher as GitHubFetcher,
      });

      const result = await service.getGitHubContext({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("GITHUB_FETCH_FAILED");
      }
    });
  });

  describe("enrichContext", () => {
    it("gathers git context when git capability is present", async () => {
      const { service } = createService();

      const result = await service.enrichContext({
        workspacePath: "/project",
        files: ["src/a.ts"],
        capabilities: ["git"],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.activeIntegrations).toContain("git");
        expect(result.data.git).not.toBeNull();
        expect(result.data.sentry).toBeNull();
        expect(result.data.github).toBeNull();
      }
    });

    it("gathers all contexts when all capabilities present", async () => {
      const sentryFetcher = createSentryFetcher();
      const githubFetcher = createGitHubFetcher();
      const { service } = createService({ sentryFetcher, githubFetcher });

      const result = await service.enrichContext({
        workspacePath: "/project",
        files: [],
        capabilities: ["git", "sentry", "github"],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.activeIntegrations).toContain("git");
        expect(result.data.activeIntegrations).toContain("sentry");
        expect(result.data.activeIntegrations).toContain("github");
      }
    });

    it("returns empty integrations when no capabilities match", async () => {
      const { service } = createService();

      const result = await service.enrichContext({
        workspacePath: "/project",
        files: [],
        capabilities: [],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.activeIntegrations).toHaveLength(0);
        expect(result.data.riskScore).toBe(0);
      }
    });

    it("computes risk based on file count", async () => {
      const { service } = createService();

      const manyFiles = Array.from({ length: 12 }, (_, i) => `file${i}.ts`);
      const result = await service.enrichContext({
        workspacePath: "/project",
        files: manyFiles,
        capabilities: [],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.riskScore).toBeGreaterThan(0);
      }
    });

    it("increases risk for core files (auth, security, payment)", async () => {
      const { service } = createService();

      const result = await service.enrichContext({
        workspacePath: "/project",
        files: ["src/auth.ts", "src/security.ts", "src/payment.ts"],
        capabilities: [],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.riskScore).toBeGreaterThan(0);
      }
    });

    it("risk score does not exceed 1.0", async () => {
      const sentryFetcher = createSentryFetcher({
        errorRate: 0.5,
        recentErrors: [
          { id: "1", title: "fatal", count: 10, lastSeen: Date.now(), level: "fatal" },
        ],
      });
      const gitRunner = createGitRunner({
        "rev-parse --abbrev-ref HEAD": "main\n",
        "status --porcelain": Array.from({ length: 30 }, (_, i) => ` M file${i}.ts`).join("\n"),
        log: "",
        "rev-parse --git-dir": ".git\n",
      });
      const { service } = createService({ gitRunner, sentryFetcher });

      const coreFiles = [
        "auth.ts",
        "security.ts",
        "payment.ts",
        "config.ts",
        "database.ts",
        "migration.ts",
      ];
      const manyFiles = Array.from({ length: 15 }, (_, i) => `file${i}.ts`);

      const result = await service.enrichContext({
        workspacePath: "/project",
        files: [...coreFiles, ...manyFiles],
        capabilities: ["git", "sentry"],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.riskScore).toBeLessThanOrEqual(1);
        expect(result.data.riskScore).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe("checkHealth", () => {
    it("reports git as healthy when git command succeeds", async () => {
      const { service } = createService();

      const result = await service.checkHealth({
        workspacePath: "/project",
        capabilities: ["git"],
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe("git");
      expect(result[0]?.status).toBe("healthy");
      expect(result[0]?.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("reports git as unavailable when git command fails", async () => {
      const gitRunner = vi.fn().mockRejectedValue(new Error("no git"));
      const { service } = createService({ gitRunner });

      const result = await service.checkHealth({
        workspacePath: "/project",
        capabilities: ["git"],
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe("git");
      expect(result[0]?.status).toBe("unavailable");
    });

    it("reports sentry status based on fetcher availability", async () => {
      const sentryFetcher = createSentryFetcher();
      const { service } = createService({ sentryFetcher });

      const result = await service.checkHealth({
        workspacePath: "/project",
        capabilities: ["sentry"],
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe("sentry");
      expect(result[0]?.status).toBe("healthy");
    });

    it("reports sentry as unavailable when fetcher not configured", async () => {
      const { service } = createService();

      const result = await service.checkHealth({
        workspacePath: "/project",
        capabilities: ["sentry"],
      });

      expect(result.length).toBe(1);
      expect(result[0]?.name).toBe("sentry");
      expect(result[0]?.status).toBe("unavailable");
    });

    it("returns empty array when no matching capabilities", async () => {
      const { service } = createService();

      const result = await service.checkHealth({
        workspacePath: "/project",
        capabilities: [],
      });

      expect(result).toHaveLength(0);
    });

    it("checks all three integrations when all capabilities present", async () => {
      const sentryFetcher = createSentryFetcher();
      const githubFetcher = createGitHubFetcher();
      const { service } = createService({ sentryFetcher, githubFetcher });

      const result = await service.checkHealth({
        workspacePath: "/project",
        capabilities: ["git", "sentry", "github"],
      });

      expect(result.length).toBe(3);
      const names = result.map((r) => r.name);
      expect(names).toContain("git");
      expect(names).toContain("sentry");
      expect(names).toContain("github");
    });
  });

  describe("checkConfig", () => {
    it("reports git as configured when git works", async () => {
      const { service } = createService();

      const result = await service.checkConfig({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const gitConfig = result.data.integrations.find((i) => i.name === "git");
        expect(gitConfig).toBeDefined();
        expect(gitConfig?.configured).toBe(true);
        expect(gitConfig?.issues).toHaveLength(0);
      }
    });

    it("reports git as unconfigured when git fails", async () => {
      const gitRunner = vi.fn().mockRejectedValue(new Error("not a repo"));
      const { service } = createService({ gitRunner });

      const result = await service.checkConfig({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const gitConfig = result.data.integrations.find((i) => i.name === "git");
        expect(gitConfig?.configured).toBe(false);
        expect(gitConfig?.issues.length).toBeGreaterThan(0);
      }
    });

    it("reports sentry and github as not configured when fetchers absent", async () => {
      const { service } = createService();

      const result = await service.checkConfig({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const sentryConfig = result.data.integrations.find((i) => i.name === "sentry");
        const githubConfig = result.data.integrations.find((i) => i.name === "github");
        expect(sentryConfig?.configured).toBe(false);
        expect(githubConfig?.configured).toBe(false);
      }
    });

    it("reports sentry and github as configured when fetchers provided", async () => {
      const sentryFetcher = createSentryFetcher();
      const githubFetcher = createGitHubFetcher();
      const { service } = createService({ sentryFetcher, githubFetcher });

      const result = await service.checkConfig({
        workspacePath: "/project",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const sentryConfig = result.data.integrations.find((i) => i.name === "sentry");
        const githubConfig = result.data.integrations.find((i) => i.name === "github");
        expect(sentryConfig?.configured).toBe(true);
        expect(githubConfig?.configured).toBe(true);
      }
    });
  });
});
