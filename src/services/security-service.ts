/**
 * Security Service Implementation
 *
 * Runs static security scans against source code using pattern matching.
 * Detects common vulnerabilities like hardcoded secrets, SQL injection
 * patterns, and known insecure coding practices.
 *
 * Stateless: receives file contents as input, returns findings.
 *
 * @module services/security-service
 */

import type {
  ISecurityService,
  SecuritySeverity,
  SecurityFinding,
  SecurityScanInput,
  SecurityScanResult,
  ServiceResult,
} from "../contracts/services.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SecurityServiceConfig {
  /** Workspace path for resolving relative file paths. */
  readonly workspacePath: string;
}

// ---------------------------------------------------------------------------
// Security Rules
// ---------------------------------------------------------------------------

interface SecurityRule {
  readonly id: string;
  readonly pattern: RegExp;
  readonly severity: SecuritySeverity;
  readonly message: string;
  readonly cwe?: string;
  readonly recommendation: string;
}

/**
 * Built-in security rules for static pattern matching.
 * Each rule has a compiled regex, severity, and remediation guidance.
 */
const BUILT_IN_RULES: readonly SecurityRule[] = [
  // Hardcoded secrets and credentials
  {
    id: "SEC001",
    pattern:
      /(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/gi,
    severity: "critical",
    message: "Potential hardcoded secret or credential detected",
    cwe: "CWE-798",
    recommendation:
      "Move secrets to environment variables or a secrets manager. Never commit credentials to source control.",
  },
  {
    id: "SEC002",
    pattern:
      /(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z\\-_]{35}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9\\-_]{20,})/g,
    severity: "critical",
    message: "Cloud provider API key or token pattern detected",
    cwe: "CWE-798",
    recommendation:
      "Rotate the detected key immediately and store credentials using a secrets management solution.",
  },

  // SQL Injection patterns
  {
    id: "SEC003",
    pattern:
      /(?:query|execute|exec)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+\s*(?:req|params|body|query|input|user))/gi,
    severity: "high",
    message: "Potential SQL injection via string concatenation or template literal",
    cwe: "CWE-89",
    recommendation:
      "Use parameterized queries or prepared statements instead of string concatenation.",
  },

  // Command injection
  {
    id: "SEC004",
    pattern:
      /(?:exec|execSync|spawn|spawnSync|execFile)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+)/gi,
    severity: "high",
    message: "Potential command injection via string concatenation in process execution",
    cwe: "CWE-78",
    recommendation:
      "Use execFile with argument arrays instead of exec with concatenated strings.",
  },

  // Insecure eval usage
  {
    id: "SEC005",
    pattern: /\beval\s*\(/g,
    severity: "high",
    message: "Use of eval() detected",
    cwe: "CWE-95",
    recommendation:
      "Avoid eval(). Use JSON.parse() for data, or Function constructor with strict input validation if code evaluation is necessary.",
  },

  // Insecure deserialization
  {
    id: "SEC006",
    pattern:
      /JSON\.parse\s*\(\s*(?:req|request|body|params|query|input|user)/gi,
    severity: "medium",
    message: "JSON.parse called on unvalidated user input",
    cwe: "CWE-502",
    recommendation:
      "Validate and sanitize input before parsing. Use a schema validation library like zod.",
  },

  // Path traversal
  {
    id: "SEC007",
    pattern:
      /(?:readFile|readFileSync|createReadStream|access|stat)\s*\(\s*(?:req|params|body|query|input|user)/gi,
    severity: "high",
    message: "File system operation with unvalidated user input — potential path traversal",
    cwe: "CWE-22",
    recommendation:
      "Validate and sanitize file paths. Use path.resolve() and verify the resolved path is within allowed directories.",
  },

  // Disabled security features
  {
    id: "SEC008",
    pattern:
      /(?:rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']0["']|verify\s*:\s*false)/g,
    severity: "high",
    message: "TLS/SSL certificate verification disabled",
    cwe: "CWE-295",
    recommendation:
      "Never disable certificate verification in production. Use proper certificate management.",
  },

  // Weak cryptography
  {
    id: "SEC009",
    pattern:
      /createHash\s*\(\s*["'](?:md5|sha1)["']\)/gi,
    severity: "medium",
    message: "Use of weak hash algorithm (MD5 or SHA-1)",
    cwe: "CWE-328",
    recommendation:
      "Use SHA-256 or stronger hash algorithms. For passwords, use bcrypt, scrypt, or Argon2.",
  },

  // Exposed debug/stack trace
  {
    id: "SEC010",
    pattern:
      /(?:stack|stackTrace|err\.stack)\s*(?:\)|,|\})/g,
    severity: "low",
    message: "Error stack trace may be exposed to users",
    cwe: "CWE-209",
    recommendation:
      "Log full stack traces server-side but return only sanitized error messages to clients.",
  },

  // Hardcoded IP addresses (non-localhost)
  {
    id: "SEC011",
    pattern:
      /["']\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?["']/g,
    severity: "info",
    message: "Hardcoded IP address detected",
    recommendation:
      "Use configuration or environment variables for network addresses instead of hardcoding.",
  },

  // innerHTML / dangerouslySetInnerHTML
  {
    id: "SEC012",
    pattern:
      /(?:\.innerHTML\s*=|dangerouslySetInnerHTML)/g,
    severity: "medium",
    message: "Direct HTML injection pattern detected — potential XSS vulnerability",
    cwe: "CWE-79",
    recommendation:
      "Sanitize HTML content before injection. Use DOMPurify or framework-provided sanitization.",
  },
];

// ---------------------------------------------------------------------------
// File Content Reader (injected function type)
// ---------------------------------------------------------------------------

/** Function that reads file content given an absolute path. */
export type FileReader = (filePath: string) => Promise<string>;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class SecurityServiceImpl implements ISecurityService {
  constructor(
    private readonly config: SecurityServiceConfig,
    private readonly readFile: FileReader,
    private readonly logger: Logger,
  ) {}

  async scan(
    input: SecurityScanInput,
  ): Promise<ServiceResult<SecurityScanResult>> {
    const startTime = Date.now();

    try {
      const filesToScan = input.files ?? [];
      const activeRules = this.selectRules(input.rules);
      const findings: SecurityFinding[] = [];

      let scannedCount = 0;

      for (const filePath of filesToScan) {
        try {
          const content = await this.readFile(filePath);
          const fileFindings = this.scanContent(content, filePath, activeRules);
          findings.push(...fileFindings);
          scannedCount++;
        } catch (readErr) {
          this.logger.warn("Could not read file for security scan", {
            file: filePath,
            error:
              readErr instanceof Error ? readErr.message : String(readErr),
          });
        }
      }

      // Count by severity
      let criticalCount = 0;
      let highCount = 0;
      for (const finding of findings) {
        if (finding.severity === "critical") criticalCount++;
        if (finding.severity === "high") highCount++;
      }

      const duration = Date.now() - startTime;

      this.logger.info("Security scan completed", {
        files: scannedCount,
        findings: findings.length,
        critical: criticalCount,
        high: highCount,
        durationMs: duration,
      });

      return {
        ok: true,
        data: {
          findings,
          criticalCount,
          highCount,
          scannedFiles: scannedCount,
          duration,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error("Security scan failed", { error: message });
      return { ok: false, error: message, code: "SECURITY_SCAN_FAILED" };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private selectRules(
    ruleFilter?: readonly string[],
  ): readonly SecurityRule[] {
    if (!ruleFilter || ruleFilter.length === 0) {
      return BUILT_IN_RULES;
    }

    const filterSet = new Set(ruleFilter);
    return BUILT_IN_RULES.filter((rule) => filterSet.has(rule.id));
  }

  private scanContent(
    content: string,
    filePath: string,
    rules: readonly SecurityRule[],
  ): SecurityFinding[] {
    const findings: SecurityFinding[] = [];

    for (const rule of rules) {
      // Reset the regex for each file (global flag requires reset)
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(content)) !== null) {
        // Compute line number from match index
        const lineNumber = this.getLineNumber(content, match.index);

        findings.push({
          severity: rule.severity,
          rule: rule.id,
          message: rule.message,
          file: filePath,
          line: lineNumber,
          cwe: rule.cwe,
          recommendation: rule.recommendation,
        });

        // Safety: prevent infinite loops on zero-length matches
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }
    }

    return findings;
  }

  private getLineNumber(content: string, index: number): number {
    let line = 1;
    for (let i = 0; i < index && i < content.length; i++) {
      if (content[i] === "\n") line++;
    }
    return line;
  }
}
