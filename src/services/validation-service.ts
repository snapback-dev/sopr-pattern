/**
 * Validation Service Implementation
 *
 * Runs code quality checks including quick lint/typecheck, comprehensive
 * validation, pattern compliance, build verification, coverage evaluation,
 * health scoring, and evolution trend analysis.
 *
 * Stateless: depends on injected command runners and service interfaces.
 * ValidationService is the only service with service-level dependencies
 * (IGraphService and ISecurityService), per the dependency graph contract.
 *
 * @module services/validation-service
 */

import type {
  IValidationService,
  ValidationInput,
  ValidationResult,
  PatternValidationInput,
  PatternValidationResult,
  BuildValidationInput,
  BuildValidationResult,
  CoverageInput,
  CoverageResult,
  HealthScoreInput,
  HealthScore,
  EvolutionInput,
  EvolutionResult,
  EvolutionSnapshot,
  Diagnostic,
  ServiceResult,
  IGraphService,
  ISecurityService,
} from "../contracts/services.js";
import type { StorageAdapter } from "./adapters.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ValidationServiceConfig {
  /** Default coverage threshold percentage (0-100). */
  readonly coverageThreshold: number;
  /** Maximum number of evolution snapshots to retain. */
  readonly maxEvolutionSnapshots: number;
}

const DEFAULT_CONFIG: ValidationServiceConfig = {
  coverageThreshold: 80,
  maxEvolutionSnapshots: 100,
};

// ---------------------------------------------------------------------------
// Command Runner (injected for testability)
// ---------------------------------------------------------------------------

/**
 * Function that executes a shell command and returns stdout.
 * Injected to keep the service free of direct process spawning.
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

// ---------------------------------------------------------------------------
// Pattern Rules
// ---------------------------------------------------------------------------

interface PatternRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly message: string;
  readonly suggestion: string;
}

const PATTERN_RULES: readonly PatternRule[] = [
  {
    name: "no-console-log",
    pattern: /\bconsole\.log\s*\(/g,
    message: "console.log() detected — use structured logger instead",
    suggestion: "Replace console.log with injected logger.info() or logger.debug()",
  },
  {
    name: "no-any-type",
    pattern: /:\s*any\b/g,
    message: "Explicit 'any' type detected",
    suggestion: "Use a specific type, 'unknown', or a generic type parameter",
  },
  {
    name: "no-silent-catch",
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    message: "Empty catch block — error is silently swallowed",
    suggestion: "Log the error or re-throw. Never silently swallow exceptions.",
  },
  {
    name: "no-todo-in-code",
    pattern: /\/\/\s*TODO(?:\s|:)/gi,
    message: "TODO comment detected in production code",
    suggestion: "Resolve TODOs before merging or convert to tracked issue",
  },
  {
    name: "no-magic-numbers",
    pattern: /(?<![.\d])\b(?!(?:0|1|2|-1)\b)\d{2,}\b(?![.\d])/g,
    message: "Magic number detected — extract to named constant",
    suggestion: "Define a named constant for readability and maintainability",
  },
  {
    name: "prefer-const",
    pattern: /\blet\s+(\w+)\s*=/g,
    message: "'let' used where 'const' may be appropriate",
    suggestion: "Use 'const' for variables that are never reassigned",
  },
  {
    name: "no-nested-ternary",
    pattern: /\?[^:]*\?/g,
    message: "Nested ternary expression detected",
    suggestion: "Refactor to if/else or extract to a helper function for clarity",
  },
];

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

function evolutionKey(workspacePath: string): string {
  return `evolution:${workspacePath}`;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ValidationServiceImpl implements IValidationService {
  private readonly config: ValidationServiceConfig;

  constructor(
    config: Partial<ValidationServiceConfig>,
    private readonly runCommand: CommandRunner,
    private readonly storage: StorageAdapter,
    private readonly graphService: IGraphService,
    private readonly securityService: ISecurityService,
    private readonly logger: Logger,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async quickCheck(
    input: ValidationInput,
  ): Promise<ServiceResult<ValidationResult>> {
    const startTime = Date.now();

    try {
      const diagnostics: Diagnostic[] = [];

      // Run TypeScript type checking
      const tsResult = await this.safeRunCommand(
        "npx",
        ["tsc", "--noEmit", "--pretty", "false"],
        input.workspacePath,
      );

      if (tsResult.exitCode !== 0) {
        diagnostics.push(
          ...this.parseTypeScriptErrors(tsResult.stdout + tsResult.stderr),
        );
      }

      // Run linter (ESLint)
      const lintArgs = ["eslint", "--format", "json"];
      if (input.files && input.files.length > 0) {
        lintArgs.push(...input.files);
      } else {
        lintArgs.push("src/");
      }
      if (input.fix) {
        lintArgs.push("--fix");
      }

      const lintResult = await this.safeRunCommand(
        "npx",
        lintArgs,
        input.workspacePath,
      );

      if (lintResult.exitCode !== 0) {
        diagnostics.push(
          ...this.parseLintErrors(lintResult.stdout),
        );
      }

      const errorCount = diagnostics.filter(
        (d) => d.severity === "error",
      ).length;
      const warningCount = diagnostics.filter(
        (d) => d.severity === "warning",
      ).length;
      const duration = Date.now() - startTime;

      this.logger.info("Quick check completed", {
        passed: errorCount === 0,
        errors: errorCount,
        warnings: warningCount,
        durationMs: duration,
      });

      return {
        ok: true,
        data: {
          passed: errorCount === 0,
          diagnostics,
          errorCount,
          warningCount,
          duration,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Quick check failed", { error: message });
      return { ok: false, error: message, code: "QUICK_CHECK_FAILED" };
    }
  }

  async fullCheck(
    input: ValidationInput,
  ): Promise<ServiceResult<ValidationResult>> {
    const startTime = Date.now();

    try {
      // Run quick check first
      const quickResult = await this.quickCheck(input);
      const diagnostics: Diagnostic[] = [];

      if (quickResult.ok) {
        diagnostics.push(...quickResult.data.diagnostics);
      }

      // Run security scan via injected service
      const securityResult = await this.securityService.scan({
        workspacePath: input.workspacePath,
        files: input.files,
      });

      if (securityResult.ok) {
        for (const finding of securityResult.data.findings) {
          diagnostics.push({
            severity:
              finding.severity === "critical" || finding.severity === "high"
                ? "error"
                : "warning",
            code: finding.rule,
            message: `[Security] ${finding.message}`,
            file: finding.file,
            line: finding.line,
          });
        }
      }

      // Run circular dependency check via injected service
      const circularResult = await this.graphService.detectCircularDeps({
        workspacePath: input.workspacePath,
      });

      if (circularResult.ok && circularResult.data.cycles.length > 0) {
        for (const cycle of circularResult.data.cycles) {
          diagnostics.push({
            severity: cycle.severity,
            code: "CIRCULAR_DEP",
            message: `Circular dependency: ${cycle.chain.join(" -> ")}`,
          });
        }
      }

      const errorCount = diagnostics.filter(
        (d) => d.severity === "error",
      ).length;
      const warningCount = diagnostics.filter(
        (d) => d.severity === "warning",
      ).length;
      const duration = Date.now() - startTime;

      // Store evolution snapshot
      await this.recordEvolutionSnapshot(input.workspacePath, {
        timestamp: startTime,
        score: this.computeScoreFromDiagnostics(diagnostics),
        errorCount,
        warningCount,
      });

      this.logger.info("Full check completed", {
        passed: errorCount === 0,
        errors: errorCount,
        warnings: warningCount,
        durationMs: duration,
      });

      return {
        ok: true,
        data: {
          passed: errorCount === 0,
          diagnostics,
          errorCount,
          warningCount,
          duration,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Full check failed", { error: message });
      return { ok: false, error: message, code: "FULL_CHECK_FAILED" };
    }
  }

  async checkPatterns(
    input: PatternValidationInput,
  ): Promise<ServiceResult<PatternValidationResult>> {
    try {
      const violations: Diagnostic[] = [];
      const suggestions: string[] = [];

      for (const rule of PATTERN_RULES) {
        const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
        let match: RegExpExecArray | null;

        while ((match = regex.exec(input.code)) !== null) {
          const lineNumber = this.getLineNumber(input.code, match.index);

          violations.push({
            severity: "warning",
            code: rule.name,
            message: rule.message,
            file: input.filePath,
            line: lineNumber,
          });

          if (!suggestions.includes(rule.suggestion)) {
            suggestions.push(rule.suggestion);
          }

          // Prevent infinite loops on zero-length matches
          if (match[0].length === 0) {
            regex.lastIndex++;
          }
        }
      }

      this.logger.debug("Pattern check completed", {
        file: input.filePath,
        violations: violations.length,
      });

      return {
        ok: true,
        data: {
          compliant: violations.length === 0,
          violations,
          suggestions,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Pattern check failed", { error: message });
      return { ok: false, error: message, code: "PATTERN_CHECK_FAILED" };
    }
  }

  async checkBuild(
    input: BuildValidationInput,
  ): Promise<ServiceResult<BuildValidationResult>> {
    const startTime = Date.now();

    try {
      const result = await this.safeRunCommand(
        "npx",
        ["tsc", "-b"],
        input.workspacePath,
      );

      const diagnostics: Diagnostic[] = [];

      if (result.exitCode !== 0) {
        diagnostics.push(
          ...this.parseTypeScriptErrors(result.stdout + result.stderr),
        );
      }

      const duration = Date.now() - startTime;

      this.logger.info("Build check completed", {
        success: result.exitCode === 0,
        diagnostics: diagnostics.length,
        durationMs: duration,
      });

      return {
        ok: true,
        data: {
          success: result.exitCode === 0,
          diagnostics,
          duration,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Build check failed", { error: message });
      return { ok: false, error: message, code: "BUILD_CHECK_FAILED" };
    }
  }

  async checkCoverage(
    input: CoverageInput,
  ): Promise<ServiceResult<CoverageResult>> {
    try {
      const threshold =
        input.threshold ?? this.config.coverageThreshold;

      const result = await this.safeRunCommand(
        "npx",
        ["vitest", "run", "--coverage", "--reporter=json"],
        input.workspacePath,
      );

      // Parse coverage from output (basic parsing)
      const coverageData = this.parseCoverageOutput(result.stdout);

      const belowThreshold: string[] = [];
      for (const [file, pct] of Object.entries(coverageData.files)) {
        if (pct < threshold) {
          belowThreshold.push(file);
        }
      }

      this.logger.info("Coverage check completed", {
        total: coverageData.total,
        threshold,
        passed: coverageData.total >= threshold,
      });

      return {
        ok: true,
        data: {
          totalPercent: coverageData.total,
          filesCovered: coverageData.covered,
          filesTotal: coverageData.filesTotal,
          belowThreshold,
          passed: coverageData.total >= threshold,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Coverage check failed", { error: message });
      return { ok: false, error: message, code: "COVERAGE_CHECK_FAILED" };
    }
  }

  async computeHealthScore(
    input: HealthScoreInput,
  ): Promise<ServiceResult<HealthScore>> {
    try {
      // Run multiple checks to compute composite health
      const [quickResult, graphHealth] = await Promise.all([
        this.quickCheck({
          workspacePath: input.workspacePath,
        }),
        this.graphService.computeHealth({
          workspacePath: input.workspacePath,
        }),
      ]);

      const dimensions: Record<string, number> = {};

      // Code quality dimension (from quick check)
      if (quickResult.ok) {
        const totalIssues =
          quickResult.data.errorCount + quickResult.data.warningCount;
        dimensions["codeQuality"] = Math.max(0, 100 - totalIssues * 5);
      } else {
        dimensions["codeQuality"] = 0;
      }

      // Architecture dimension (from graph health)
      if (graphHealth.ok) {
        const gh = graphHealth.data;
        let archScore = 100;
        archScore -= gh.circularCount * 15;
        archScore -= gh.orphanCount * 5;
        archScore -= Math.max(0, gh.maxFanOut - 10) * 3;
        dimensions["architecture"] = Math.max(0, archScore);
      } else {
        dimensions["architecture"] = 50; // Unknown, assume moderate
      }

      // Compute overall score as weighted average
      const weights: Record<string, number> = {
        codeQuality: 0.5,
        architecture: 0.5,
      };

      let overall = 0;
      for (const [dim, score] of Object.entries(dimensions)) {
        overall += score * (weights[dim] ?? 0.25);
      }
      overall = Math.round(Math.max(0, Math.min(100, overall)));

      // Determine trend from evolution history
      const trend = await this.computeTrend(input.workspacePath, overall);

      this.logger.info("Health score computed", {
        overall,
        dimensions,
        trend,
      });

      return {
        ok: true,
        data: {
          overall,
          dimensions,
          trend,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Health score computation failed", { error: message });
      return { ok: false, error: message, code: "HEALTH_SCORE_FAILED" };
    }
  }

  async analyzeEvolution(
    input: EvolutionInput,
  ): Promise<ServiceResult<EvolutionResult>> {
    try {
      const snapshots = await this.loadEvolutionSnapshots(
        input.workspacePath,
      );

      let filtered = snapshots;
      if (input.since) {
        filtered = snapshots.filter((s) => s.timestamp >= input.since!);
      }

      // Determine trend
      let trend: "improving" | "stable" | "declining" = "stable";
      if (filtered.length >= 2) {
        const firstHalf = filtered.slice(0, Math.floor(filtered.length / 2));
        const secondHalf = filtered.slice(Math.floor(filtered.length / 2));

        const avgFirst =
          firstHalf.reduce((sum, s) => sum + s.score, 0) / firstHalf.length;
        const avgSecond =
          secondHalf.reduce((sum, s) => sum + s.score, 0) / secondHalf.length;

        if (avgSecond > avgFirst + 5) {
          trend = "improving";
        } else if (avgSecond < avgFirst - 5) {
          trend = "declining";
        }
      }

      this.logger.info("Evolution analysis completed", {
        snapshots: filtered.length,
        trend,
      });

      return {
        ok: true,
        data: {
          snapshots: filtered,
          trend,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Evolution analysis failed", { error: message });
      return { ok: false, error: message, code: "EVOLUTION_ANALYSIS_FAILED" };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async safeRunCommand(
    command: string,
    args: readonly string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      return await this.runCommand(command, args, cwd);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { stdout: "", stderr: message, exitCode: 1 };
    }
  }

  private parseTypeScriptErrors(output: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    // TypeScript error format: file(line,col): error TSxxxx: message
    const errorRegex =
      /([^(\s]+)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.*)/g;
    let match: RegExpExecArray | null;

    while ((match = errorRegex.exec(output)) !== null) {
      diagnostics.push({
        severity: (match[4] as "error" | "warning") ?? "error",
        code: match[5] ?? "TS0000",
        message: match[6] ?? "Unknown error",
        file: match[1],
        line: parseInt(match[2] ?? "0", 10),
        column: parseInt(match[3] ?? "0", 10),
      });
    }

    // If no structured errors were parsed but there was output, add a generic one
    if (diagnostics.length === 0 && output.trim().length > 0) {
      diagnostics.push({
        severity: "error",
        code: "TS_GENERAL",
        message: output.trim().slice(0, 200),
      });
    }

    return diagnostics;
  }

  private parseLintErrors(output: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    try {
      // ESLint JSON format output
      const results = JSON.parse(output) as Array<{
        filePath: string;
        messages: Array<{
          line: number;
          column: number;
          severity: number;
          message: string;
          ruleId: string | null;
        }>;
      }>;

      for (const result of results) {
        for (const msg of result.messages) {
          diagnostics.push({
            severity: msg.severity === 2 ? "error" : "warning",
            code: msg.ruleId ?? "eslint",
            message: msg.message,
            file: result.filePath,
            line: msg.line,
            column: msg.column,
          });
        }
      }
    } catch {
      // If JSON parse fails, output may not be JSON
      if (output.trim().length > 0) {
        diagnostics.push({
          severity: "warning",
          code: "LINT_PARSE",
          message: `Could not parse lint output: ${output.trim().slice(0, 200)}`,
        });
      }
    }

    return diagnostics;
  }

  private parseCoverageOutput(output: string): {
    total: number;
    covered: number;
    filesTotal: number;
    files: Record<string, number>;
  } {
    // Basic parsing: attempt to find coverage summary in JSON output
    try {
      const data = JSON.parse(output) as {
        total?: { lines?: { pct?: number }; branches?: { pct?: number } };
      };
      const pct = data.total?.lines?.pct ?? 0;
      return { total: pct, covered: 0, filesTotal: 0, files: {} };
    } catch {
      // Fallback: return zero coverage if we cannot parse
      return { total: 0, covered: 0, filesTotal: 0, files: {} };
    }
  }

  private getLineNumber(content: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === "\n") line++;
    }
    return line;
  }

  private computeScoreFromDiagnostics(diagnostics: readonly Diagnostic[]): number {
    const errorCount = diagnostics.filter((d) => d.severity === "error").length;
    const warningCount = diagnostics.filter(
      (d) => d.severity === "warning",
    ).length;
    return Math.max(0, 100 - errorCount * 10 - warningCount * 2);
  }

  private async recordEvolutionSnapshot(
    workspacePath: string,
    snapshot: EvolutionSnapshot,
  ): Promise<void> {
    try {
      const snapshots = await this.loadEvolutionSnapshots(workspacePath);
      snapshots.push(snapshot);

      // Keep only the most recent N snapshots
      if (snapshots.length > this.config.maxEvolutionSnapshots) {
        snapshots.splice(
          0,
          snapshots.length - this.config.maxEvolutionSnapshots,
        );
      }

      await this.storage.write(
        evolutionKey(workspacePath),
        JSON.stringify(snapshots),
      );
    } catch (err) {
      this.logger.warn("Failed to record evolution snapshot", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async loadEvolutionSnapshots(
    workspacePath: string,
  ): Promise<EvolutionSnapshot[]> {
    const data = await this.storage.read(evolutionKey(workspacePath));
    if (!data) return [];
    return JSON.parse(data) as EvolutionSnapshot[];
  }

  private async computeTrend(
    workspacePath: string,
    currentScore: number,
  ): Promise<"improving" | "stable" | "declining"> {
    const snapshots = await this.loadEvolutionSnapshots(workspacePath);

    if (snapshots.length < 3) return "stable";

    const recentScores = snapshots.slice(-5).map((s) => s.score);
    recentScores.push(currentScore);

    const firstHalf = recentScores.slice(0, Math.floor(recentScores.length / 2));
    const secondHalf = recentScores.slice(Math.floor(recentScores.length / 2));

    const avgFirst =
      firstHalf.reduce((sum, s) => sum + s, 0) / firstHalf.length;
    const avgSecond =
      secondHalf.reduce((sum, s) => sum + s, 0) / secondHalf.length;

    if (avgSecond > avgFirst + 5) return "improving";
    if (avgSecond < avgFirst - 5) return "declining";
    return "stable";
  }
}
