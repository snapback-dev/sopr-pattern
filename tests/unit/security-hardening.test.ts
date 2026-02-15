/**
 * Security hardening unit tests.
 *
 * Validates:
 *   - SafePathSchema rejects path traversal, absolute paths, null bytes
 *   - SafePathSchema accepts valid relative paths
 *   - WorkspaceBoundary enforces containment
 *   - WorkspaceBoundary rejects null bytes and dash-prefixed paths
 *   - validateWorkspacePath rejects system directories
 *   - SecurityService caps findings and skips oversized files
 *   - Integration-service sanitizes git output
 *
 * @module tests/unit/security-hardening
 */

import { describe, expect, it, vi } from "vitest";
import { SafePathSchema } from "../../src/contracts/schemas/tool-inputs.js";
import { SecurityServiceImpl } from "../../src/services/security-service.js";
import { validateWorkspacePath, WorkspaceBoundary } from "../../src/services/workspace-boundary.js";
import { createMockLogger } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// SafePathSchema
// ---------------------------------------------------------------------------

describe("SafePathSchema", () => {
  describe("accepts valid paths", () => {
    const valid = [
      "src/index.ts",
      "package.json",
      "src/services/auth.ts",
      "deeply/nested/path/to/file.ts",
      "file-with-dashes.ts",
      "file_with_underscores.ts",
      "file.test.ts",
      ".hidden-file",
    ];

    for (const p of valid) {
      it(`accepts "${p}"`, () => {
        expect(SafePathSchema.safeParse(p).success).toBe(true);
      });
    }
  });

  describe("rejects path traversal", () => {
    const traversal = [
      "../etc/passwd",
      "src/../../etc/passwd",
      "src/../../../etc/shadow",
      "..\\windows\\system32",
      "src\\..\\..\\secret",
      "foo/../bar/../../../etc/passwd",
    ];

    for (const p of traversal) {
      it(`rejects "${p}"`, () => {
        const result = SafePathSchema.safeParse(p);
        expect(result.success).toBe(false);
      });
    }
  });

  describe("rejects absolute paths", () => {
    const absolute = [
      "/etc/passwd",
      "/root/.ssh/id_rsa",
      "\\\\network\\share",
      "/usr/local/bin/node",
    ];

    for (const p of absolute) {
      it(`rejects "${p}"`, () => {
        const result = SafePathSchema.safeParse(p);
        expect(result.success).toBe(false);
      });
    }
  });

  describe("rejects null bytes", () => {
    it("rejects path with null byte", () => {
      const result = SafePathSchema.safeParse("file.ts\x00.jpg");
      expect(result.success).toBe(false);
    });

    it("rejects null byte at start", () => {
      const result = SafePathSchema.safeParse("\x00file.ts");
      expect(result.success).toBe(false);
    });
  });

  describe("rejects oversized paths", () => {
    it("rejects path exceeding 500 chars", () => {
      const result = SafePathSchema.safeParse("a".repeat(501));
      expect(result.success).toBe(false);
    });
  });

  describe("rejects empty paths", () => {
    it("rejects empty string", () => {
      const result = SafePathSchema.safeParse("");
      expect(result.success).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("allows single dot (current dir)", () => {
      expect(SafePathSchema.safeParse(".").success).toBe(true);
    });

    it("rejects bare double dot", () => {
      expect(SafePathSchema.safeParse("..").success).toBe(false);
    });

    it("allows ...triple dots (not traversal)", () => {
      expect(SafePathSchema.safeParse("...").success).toBe(true);
    });

    it("allows ..foo (not traversal)", () => {
      expect(SafePathSchema.safeParse("..foo").success).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// WorkspaceBoundary
// ---------------------------------------------------------------------------

describe("WorkspaceBoundary", () => {
  const boundary = new WorkspaceBoundary("/test/workspace");

  describe("resolve", () => {
    it("resolves relative path within workspace", () => {
      const resolved = boundary.resolve("src/index.ts");
      expect(resolved).toBe("/test/workspace/src/index.ts");
    });

    it("throws on path traversal escaping workspace", () => {
      expect(() => boundary.resolve("../../etc/passwd")).toThrow("Path escapes workspace boundary");
    });

    it("throws on null bytes", () => {
      expect(() => boundary.resolve("file\x00.ts")).toThrow("Path must not contain null bytes");
    });

    it("throws on dash-prefixed paths (argument injection)", () => {
      expect(() => boundary.resolve("-rf")).toThrow("Path must not start with a dash");
    });
  });

  describe("contains", () => {
    it("returns true for path inside workspace", () => {
      expect(boundary.contains("/test/workspace/src/file.ts")).toBe(true);
    });

    it("returns true for workspace root itself", () => {
      expect(boundary.contains("/test/workspace")).toBe(true);
    });

    it("returns false for path outside workspace", () => {
      expect(boundary.contains("/etc/passwd")).toBe(false);
    });

    it("returns false for prefix attack (workspaceFoo)", () => {
      expect(boundary.contains("/test/workspaceFoo/file.ts")).toBe(false);
    });

    it("returns false for null byte paths", () => {
      expect(boundary.contains("/test/workspace/\x00file")).toBe(false);
    });
  });

  describe("resolveMany", () => {
    it("resolves multiple valid paths", () => {
      const resolved = boundary.resolveMany(["a.ts", "b.ts"]);
      expect(resolved).toEqual(["/test/workspace/a.ts", "/test/workspace/b.ts"]);
    });

    it("throws if any path is invalid", () => {
      expect(() => boundary.resolveMany(["a.ts", "../../etc/passwd"])).toThrow();
    });
  });

  describe("isValidRelative", () => {
    it("returns true for safe relative path", () => {
      expect(boundary.isValidRelative("src/index.ts")).toBe(true);
    });

    it("returns false for escaping path", () => {
      expect(boundary.isValidRelative("../../etc/passwd")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// validateWorkspacePath
// ---------------------------------------------------------------------------

describe("validateWorkspacePath", () => {
  it("accepts a valid absolute path", () => {
    expect(validateWorkspacePath("/home/user/project")).toBe("/home/user/project");
  });

  const forbidden = ["/", "/etc", "/root", "/var", "/usr", "/bin", "/sbin"];
  for (const dir of forbidden) {
    it(`rejects system directory: ${dir}`, () => {
      expect(() => validateWorkspacePath(dir)).toThrow("must not be a system directory");
    });
  }
});

// ---------------------------------------------------------------------------
// SecurityService — DoS prevention
// ---------------------------------------------------------------------------

describe("SecurityService DoS prevention", () => {
  it("skips files larger than 1MB", async () => {
    const logger = createMockLogger();
    const largeContent = "x".repeat(1_000_001);
    const readFile = vi.fn(async () => largeContent);

    const service = new SecurityServiceImpl({ workspacePath: "/test" }, readFile, logger);

    const result = await service.scan({
      files: ["big-file.ts"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.scannedFiles).toBe(0);
    }
  });

  it("caps findings at 500", async () => {
    const logger = createMockLogger();
    // Content that triggers SEC005 (eval) many times
    const content = Array.from({ length: 600 }, () => "eval(x)").join("\n");
    const readFile = vi.fn(async () => content);

    const service = new SecurityServiceImpl({ workspacePath: "/test" }, readFile, logger);

    const result = await service.scan({
      files: ["evil.ts"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.findings.length).toBeLessThanOrEqual(500);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration-service — git output sanitization
// ---------------------------------------------------------------------------

describe("Integration-service git output sanitization", () => {
  it("parses git log with null-byte separators correctly", async () => {
    // This is tested in integration-service.test.ts but we verify the
    // sanitization specifically here via the public API
    const { IntegrationServiceImpl } = await import("../../src/services/integration-service.js");

    const NUL = String.fromCharCode(0);
    const logger = createMockLogger();
    const gitRunner = vi.fn(async (args: readonly string[]) => {
      const key = args.join(" ");
      if (key.includes("rev-parse --abbrev-ref")) return "main\n";
      if (key.includes("status --porcelain")) return "";
      if (key.includes("log")) return `abc123${NUL}test commit${NUL}author${NUL}1700000000\n`;
      return "";
    });

    const service = new IntegrationServiceImpl({}, logger, gitRunner);
    const result = await service.getGitContext({ workspacePath: "/test" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.recentCommits[0]?.hash).toBe("abc123");
      expect(result.data.recentCommits[0]?.message).toBe("test commit");
      expect(result.data.recentCommits[0]?.author).toBe("author");
    }
  });

  it("strips control characters from git output", async () => {
    const { IntegrationServiceImpl } = await import("../../src/services/integration-service.js");

    const NUL = String.fromCharCode(0);
    const logger = createMockLogger();
    const maliciousMessage = `inject\x07\x08\x1bcommand`;
    const gitRunner = vi.fn(async (args: readonly string[]) => {
      const key = args.join(" ");
      if (key.includes("rev-parse --abbrev-ref")) return "main\n";
      if (key.includes("status --porcelain")) return "";
      if (key.includes("log"))
        return `abc123${NUL}${maliciousMessage}${NUL}author${NUL}1700000000\n`;
      return "";
    });

    const service = new IntegrationServiceImpl({}, logger, gitRunner);
    const result = await service.getGitContext({ workspacePath: "/test" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Control chars should be stripped
      expect(result.data.recentCommits[0]?.message).toBe("injectcommand");
    }
  });
});
