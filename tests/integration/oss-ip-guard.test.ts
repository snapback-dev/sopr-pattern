/**
 * OSS IP Leakage Guard Tests
 *
 * Ensures @sopr/mcp-server contains NO proprietary references.
 * Prevents IP leakage by construction: these tests fail if any proprietary
 * references — under the current Vreko name or the earlier SnapBack name — leak
 * into the OSS codebase.
 *
 * @see SOPR OSS Decoupling Plan — Phase 3: CI Guards
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// From tests/integration/ → package root
const PKG_ROOT = join(__dirname, "../..");
const SRC_DIR = join(PKG_ROOT, "src");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all TypeScript source files. */
function getTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getTypeScriptFiles(fullPath));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

/** Read file content as lowercase string for case-insensitive matching. */
function readLower(filePath: string): string {
  return readFileSync(filePath, "utf-8").toLowerCase();
}

// ---------------------------------------------------------------------------
// IP Leakage Patterns
// ---------------------------------------------------------------------------

/**
 * Patterns that MUST NOT appear in OSS source code.
 * Each entry has a pattern string and a human-readable reason.
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: string; reason: string }> = [
  { pattern: "posthog", reason: "PostHog is a proprietary analytics provider" },
  { pattern: "snapback.dev", reason: "SnapBack domain is proprietary" },
  { pattern: "port 4200", reason: "Daemon port is proprietary infrastructure" },
  { pattern: ":4200", reason: "Daemon port reference" },
  { pattern: "snapback_api_key", reason: "SnapBack API key env var is proprietary" },
  { pattern: "snapback_daemon", reason: "SnapBack daemon reference is proprietary" },
  { pattern: "vreko.dev", reason: "Vreko domain is proprietary" },
  { pattern: "vreko_api_key", reason: "Vreko API key env var is proprietary" },
  { pattern: "vreko_daemon", reason: "Vreko daemon reference is proprietary" },
  { pattern: "vrekod", reason: "Vreko daemon binary is proprietary" },
  { pattern: "linear.app", reason: "Linear integration is proprietary" },
  { pattern: "anthropic", reason: "Anthropic client is proprietary" },
  { pattern: "better-sqlite3", reason: "SQLite memory store is proprietary" },
];

/**
 * Import patterns that MUST NOT appear.
 * OSS must not import from any proprietary scope (@snapback/*, @vreko/*).
 */
const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["']@snapback\//, // @snapback/* (former proprietary scope)
  /import\s+.*["']@snapback\//,
  /require\s*\(\s*["']@snapback\//,
  /from\s+["']@vreko\//, // @vreko/* (current proprietary scope)
  /import\s+.*["']@vreko\//,
  /require\s*\(\s*["']@vreko\//,
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("OSS IP Leakage Guard — @sopr/mcp-server", () => {
  const sourceFiles = getTypeScriptFiles(SRC_DIR);

  it("should have source files to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  describe("should NOT import from a proprietary scope", () => {
    for (const filePath of sourceFiles) {
      const rel = relative(PKG_ROOT, filePath);
      it(`${rel} has no proprietary-scope imports`, () => {
        const content = readFileSync(filePath, "utf-8");
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
          const match = content.match(pattern);
          expect(match, `Found proprietary import in ${rel}: ${match?.[0]}`).toBeNull();
        }
      });
    }
  });

  describe("should NOT contain proprietary references", () => {
    for (const filePath of sourceFiles) {
      const rel = relative(PKG_ROOT, filePath);
      it(`${rel} has no proprietary patterns`, () => {
        const content = readLower(filePath);
        for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
          expect(
            content.includes(pattern.toLowerCase()),
            `Found "${pattern}" in ${rel} — ${reason}`,
          ).toBe(false);
        }
      });
    }
  });

  describe("package.json validation", () => {
    const pkgJsonPath = join(PKG_ROOT, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));

    it("should have MIT license", () => {
      expect(pkgJson.license).toBe("MIT");
    });

    // The package name must not carry a proprietary product brand. The OSS
    // decoupling moved this package to the neutral @sopr scope; the earlier
    // @snapback-oss name is no longer required and must not come back.
    it("should be published under a brand-neutral scope", () => {
      expect(pkgJson.name).toMatch(/^@sopr\//);
      expect(pkgJson.name).not.toMatch(/snapback|vreko/i);
    });

    it("should NOT have proprietary dependencies", () => {
      const allDeps = {
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
      };

      for (const dep of Object.keys(allDeps)) {
        // Allow @snapback-oss/* but forbid @snapback/*
        if (dep.startsWith("@snapback/")) {
          expect.fail(
            `Found proprietary dependency "${dep}" in package.json. OSS packages must not depend on @snapback/* packages.`,
          );
        }
      }
    });

    it("should NOT reference proprietary URLs in repository field", () => {
      const repoUrl =
        typeof pkgJson.repository === "string"
          ? pkgJson.repository
          : (pkgJson.repository?.url ?? "");
      // The OSS repo should not point to private repos
      expect(repoUrl).not.toContain("private");
    });
  });

  describe("structural guards", () => {
    it("should NOT have a router/ directory with concrete implementations", () => {
      // Concrete router implementations (daemon-backed) are proprietary.
      // The OSS core should only have the ITierRouter interface in contracts/.
      const routerDir = join(SRC_DIR, "router");
      if (existsSync(routerDir)) {
        const files = readdirSync(routerDir);
        // tier-router.ts is allowed as a reference/example but should use interfaces only
        for (const file of files) {
          if (file.includes("daemon") || file.includes("snapback")) {
            expect.fail(
              `Found proprietary file "${file}" in router/ directory. Daemon-backed routers belong in the proprietary layer.`,
            );
          }
        }
      }
    });

    it("should NOT have a telemetry/ directory with PostHog references", () => {
      const telemetryDir = join(SRC_DIR, "telemetry");
      if (existsSync(telemetryDir)) {
        const files = getTypeScriptFiles(telemetryDir);
        for (const file of files) {
          const content = readLower(file);
          expect(
            content.includes("posthog"),
            `Found PostHog reference in ${relative(PKG_ROOT, file)}`,
          ).toBe(false);
        }
      }
    });

    it("adapters/ should only contain default implementations", () => {
      const adaptersDir = join(SRC_DIR, "adapters");
      if (existsSync(adaptersDir)) {
        const files = getTypeScriptFiles(adaptersDir);
        for (const file of files) {
          const content = readLower(file);
          for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
            expect(
              content.includes(pattern.toLowerCase()),
              `Found "${pattern}" in adapter ${relative(PKG_ROOT, file)} — ${reason}`,
            ).toBe(false);
          }
        }
      }
    });
  });
});
