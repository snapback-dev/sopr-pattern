/**
 * Integration Service Implementation
 *
 * Handles external service integrations: Git (via child_process.execFile),
 * Sentry (stubbed), and GitHub (stubbed). External calls accept injected
 * fetch functions for testability and circuit breaker wrapping.
 *
 * Stateless: no internal state. All context is derived from external
 * systems at call time.
 *
 * @module services/integration-service
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

import type {
  EnrichContextInput,
  EnrichmentContext,
  GitCommit,
  GitContext,
  GitContextInput,
  GitHubContext,
  GitHubContextInput,
  IIntegrationService,
  IntegrationConfigEntry,
  IntegrationConfigInput,
  IntegrationConfigResult,
  IntegrationHealth,
  IntegrationHealthInput,
  RiskScore,
  SentryContext,
  SentryContextInput,
  ServiceResult,
} from "../contracts/services.js";
import type { Logger } from "./logger.js";

const execFileAsync = promisify(execFileCb);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface IntegrationServiceConfig {
  /** Maximum number of recent commits to retrieve. */
  readonly commitLimit: number;
  /** Timeout in milliseconds for git commands. */
  readonly gitTimeoutMs: number;
}

const DEFAULT_CONFIG: IntegrationServiceConfig = {
  commitLimit: 10,
  gitTimeoutMs: 10_000,
};

// ---------------------------------------------------------------------------
// External Fetcher Types (injected for testability + circuit breakers)
// ---------------------------------------------------------------------------

/** Function to fetch Sentry context. Injected so callers can wrap with circuit breaker. */
export type SentryFetcher = (workspacePath: string, hoursBack: number) => Promise<SentryContext>;

/** Function to fetch GitHub context. Injected so callers can wrap with circuit breaker. */
export type GitHubFetcher = (workspacePath: string, prLimit: number) => Promise<GitHubContext>;

/** Function to run git commands. Injected for testability. */
export type GitCommandRunner = (args: readonly string[], cwd: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Default Git Command Runner
// ---------------------------------------------------------------------------

function defaultGitRunner(timeoutMs: number): GitCommandRunner {
  return async (args: readonly string[], cwd: string): Promise<string> => {
    const { stdout } = await execFileAsync("git", [...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB
    });
    return stdout;
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Security: Output Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize git output to prevent prompt injection via malicious
 * commit messages or author names embedded in tool responses.
 * Strips control characters (keeping \n, \r, \t) and truncates.
 */
function sanitizeGitOutput(value: string, maxLength = 500): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char stripping for security
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").slice(0, maxLength);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class IntegrationServiceImpl implements IIntegrationService {
  private readonly config: IntegrationServiceConfig;
  private readonly gitRunner: GitCommandRunner;
  private readonly sentryFetcher: SentryFetcher | null;
  private readonly githubFetcher: GitHubFetcher | null;

  constructor(
    config: Partial<IntegrationServiceConfig>,
    private readonly logger: Logger,
    gitRunner?: GitCommandRunner,
    sentryFetcher?: SentryFetcher,
    githubFetcher?: GitHubFetcher,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.gitRunner = gitRunner ?? defaultGitRunner(this.config.gitTimeoutMs);
    this.sentryFetcher = sentryFetcher ?? null;
    this.githubFetcher = githubFetcher ?? null;
  }

  async getGitContext(input: GitContextInput): Promise<ServiceResult<GitContext>> {
    try {
      const commitLimit = input.commitLimit ?? this.config.commitLimit;

      // Get current branch
      const branch = await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"], input.workspacePath);

      // Get working tree status
      const statusOutput = await this.runGit(["status", "--porcelain"], input.workspacePath);

      const uncommittedFiles = statusOutput
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => sanitizeGitOutput(line.slice(3).trim(), 300));

      const status: "clean" | "dirty" = uncommittedFiles.length === 0 ? "clean" : "dirty";

      // Get recent commits
      // SECURITY: Use %x00 (null byte) as separator instead of | to prevent
      // parsing errors from pipe characters in commit messages.
      const logOutput = await this.runGit(
        ["log", `--max-count=${commitLimit}`, "--format=%H%x00%s%x00%an%x00%at"],
        input.workspacePath,
      );

      const recentCommits: GitCommit[] = logOutput
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
          const parts = line.split("\0");
          return {
            hash: parts[0] ?? "",
            message: sanitizeGitOutput(parts[1] ?? ""),
            author: sanitizeGitOutput(parts[2] ?? ""),
            timestamp: parseInt(parts[3] ?? "0", 10) * 1000, // Convert to ms
          };
        });

      this.logger.info("Git context retrieved", {
        branch: branch.trim(),
        status,
        uncommitted: uncommittedFiles.length,
        commits: recentCommits.length,
      });

      return {
        ok: true,
        data: {
          branch: branch.trim(),
          status,
          uncommittedFiles,
          recentCommits,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to get git context", { error: message });
      return { ok: false, error: message, code: "GIT_CONTEXT_FAILED" };
    }
  }

  async getSentryContext(input: SentryContextInput): Promise<ServiceResult<SentryContext>> {
    if (!this.sentryFetcher) {
      return {
        ok: false,
        error: "Sentry integration not configured",
        code: "SENTRY_NOT_CONFIGURED",
      };
    }

    try {
      const hoursBack = input.hoursBack ?? 24;
      const context = await this.sentryFetcher(input.workspacePath, hoursBack);

      this.logger.info("Sentry context retrieved", {
        errors: context.recentErrors.length,
        errorRate: context.errorRate,
      });

      return { ok: true, data: context };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to get Sentry context", { error: message });
      return { ok: false, error: message, code: "SENTRY_FETCH_FAILED" };
    }
  }

  async getGitHubContext(input: GitHubContextInput): Promise<ServiceResult<GitHubContext>> {
    if (!this.githubFetcher) {
      return {
        ok: false,
        error: "GitHub integration not configured",
        code: "GITHUB_NOT_CONFIGURED",
      };
    }

    try {
      const prLimit = input.prLimit ?? 10;
      const context = await this.githubFetcher(input.workspacePath, prLimit);

      this.logger.info("GitHub context retrieved", {
        openPRs: context.openPRs.length,
        issues: context.relevantIssues.length,
        checkStatus: context.checkStatus,
      });

      return { ok: true, data: context };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Failed to get GitHub context", { error: message });
      return { ok: false, error: message, code: "GITHUB_FETCH_FAILED" };
    }
  }

  async enrichContext(input: EnrichContextInput): Promise<ServiceResult<EnrichmentContext>> {
    try {
      const activeIntegrations: string[] = [];
      let git: GitContext | null = null;
      let sentry: SentryContext | null = null;
      let github: GitHubContext | null = null;

      // Gather git context if capability is available
      if (input.capabilities.includes("git")) {
        const gitResult = await this.getGitContext({
          workspacePath: input.workspacePath,
        });
        if (gitResult.ok) {
          git = gitResult.data;
          activeIntegrations.push("git");
        }
      }

      // Gather sentry context if capability is available
      if (input.capabilities.includes("sentry") && this.sentryFetcher) {
        const sentryResult = await this.getSentryContext({
          workspacePath: input.workspacePath,
        });
        if (sentryResult.ok) {
          sentry = sentryResult.data;
          activeIntegrations.push("sentry");
        }
      }

      // Gather GitHub context if capability is available
      if (input.capabilities.includes("github") && this.githubFetcher) {
        const githubResult = await this.getGitHubContext({
          workspacePath: input.workspacePath,
        });
        if (githubResult.ok) {
          github = githubResult.data;
          activeIntegrations.push("github");
        }
      }

      // Compute risk score based on available context
      const riskScore = this.computeRiskScore(git, sentry, input.files);

      this.logger.info("Context enriched", {
        activeIntegrations,
        riskScore,
        files: input.files.length,
      });

      return {
        ok: true,
        data: {
          riskScore,
          activeIntegrations,
          git,
          sentry,
          github,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Context enrichment failed", { error: message });
      return { ok: false, error: message, code: "ENRICH_CONTEXT_FAILED" };
    }
  }

  async checkHealth(input: IntegrationHealthInput): Promise<readonly IntegrationHealth[]> {
    const healthResults: IntegrationHealth[] = [];
    const now = Date.now();

    // Check git health
    if (input.capabilities.includes("git")) {
      const start = Date.now();
      try {
        await this.runGit(["rev-parse", "--git-dir"], input.workspacePath);
        healthResults.push({
          name: "git",
          status: "healthy",
          latencyMs: Date.now() - start,
          lastChecked: now,
        });
      } catch {
        healthResults.push({
          name: "git",
          status: "unavailable",
          latencyMs: Date.now() - start,
          lastChecked: now,
        });
      }
    }

    // Check sentry health
    if (input.capabilities.includes("sentry")) {
      healthResults.push({
        name: "sentry",
        status: this.sentryFetcher ? "healthy" : "unavailable",
        latencyMs: null,
        lastChecked: now,
      });
    }

    // Check github health
    if (input.capabilities.includes("github")) {
      healthResults.push({
        name: "github",
        status: this.githubFetcher ? "healthy" : "unavailable",
        latencyMs: null,
        lastChecked: now,
      });
    }

    return healthResults;
  }

  async checkConfig(
    input: IntegrationConfigInput,
  ): Promise<ServiceResult<IntegrationConfigResult>> {
    try {
      const integrations: IntegrationConfigEntry[] = [];

      // Check git configuration
      const gitIssues: string[] = [];
      try {
        await this.runGit(["rev-parse", "--git-dir"], input.workspacePath);
      } catch {
        gitIssues.push("Not a git repository or git not installed");
      }

      integrations.push({
        name: "git",
        configured: gitIssues.length === 0,
        issues: gitIssues,
      });

      // Sentry configuration
      integrations.push({
        name: "sentry",
        configured: this.sentryFetcher !== null,
        issues: this.sentryFetcher ? [] : ["Sentry fetcher not provided — integration disabled"],
      });

      // GitHub configuration
      integrations.push({
        name: "github",
        configured: this.githubFetcher !== null,
        issues: this.githubFetcher ? [] : ["GitHub fetcher not provided — integration disabled"],
      });

      const valid = integrations.every((i) => i.configured || i.issues.length === 0);

      return {
        ok: true,
        data: { valid, integrations },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Integration config check failed", {
        error: message,
      });
      return { ok: false, error: message, code: "CONFIG_CHECK_FAILED" };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async runGit(args: readonly string[], cwd: string): Promise<string> {
    return this.gitRunner(args, cwd);
  }

  private computeRiskScore(
    git: GitContext | null,
    sentry: SentryContext | null,
    files: readonly string[],
  ): RiskScore {
    let risk = 0;

    // More files affected = higher risk
    if (files.length > 10) risk += 0.2;
    else if (files.length > 5) risk += 0.1;

    // Dirty git state adds risk
    if (git && git.status === "dirty") {
      risk += 0.1;
      if (git.uncommittedFiles.length > 20) risk += 0.1;
    }

    // Recent sentry errors add risk
    if (sentry) {
      if (sentry.errorRate > 0.1) risk += 0.2;
      if (sentry.recentErrors.some((e) => e.level === "fatal")) {
        risk += 0.2;
      }
    }

    // Core files add risk
    const corePatterns = [/auth/i, /security/i, /payment/i, /config/i, /database/i, /migration/i];
    for (const file of files) {
      if (corePatterns.some((p) => p.test(file))) {
        risk += 0.05;
      }
    }

    return Math.min(1, Math.max(0, risk));
  }
}
