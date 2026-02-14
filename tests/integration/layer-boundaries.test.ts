/**
 * Layer Boundary Tests
 *
 * Static analysis tests that verify SOPR's strict 4-layer import rules
 * by reading source files and parsing their import statements.
 *
 * Import Rules:
 *   Layer 1 (protocol)  -> CAN import: registry, contracts
 *   Layer 2 (registry)  -> CAN import: contracts
 *   Layer 3 (tools)     -> CAN import: contracts, services (interfaces only), resilience
 *   Layer 4 (services)  -> CAN import: contracts, resilience
 *                       -> CANNOT import: other service implementations directly
 *
 * FORBIDDEN:
 *   - protocol  -> services, tools  (skip layer)
 *   - registry  -> services, tools  (skip layer)
 *   - tools     -> protocol, registry (reverse dependency)
 *   - services  -> tools, registry, protocol (reverse dependency)
 *
 * @module tests/integration/layer-boundaries
 */

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  collectTsFiles,
  parseImports,
  resolveLayerFromImport,
  getLayerForFile,
} from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SRC_ROOT = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "../../src",
);

const PROTOCOL_DIR = path.join(SRC_ROOT, "protocol");
const REGISTRY_DIR = path.join(SRC_ROOT, "registry");
const TOOLS_DIR = path.join(SRC_ROOT, "tools");
const SERVICES_DIR = path.join(SRC_ROOT, "services");

// ---------------------------------------------------------------------------
// Violation Detection Helper
// ---------------------------------------------------------------------------

interface LayerViolation {
  file: string;
  line: number;
  sourceLayer: string;
  targetLayer: string;
  importSpecifier: string;
  rawLine: string;
}

/**
 * Scan all TypeScript files in a layer directory and return any
 * imports that target forbidden layers.
 */
function detectForbiddenImports(
  layerDir: string,
  forbiddenTargets: readonly string[],
): LayerViolation[] {
  const violations: LayerViolation[] = [];
  const files = collectTsFiles(layerDir);

  for (const filePath of files) {
    const sourceLayer = getLayerForFile(filePath, SRC_ROOT);
    if (sourceLayer === null) continue;

    const imports = parseImports(filePath);
    for (const imp of imports) {
      const targetLayer = resolveLayerFromImport(imp.specifier, filePath, SRC_ROOT);
      if (targetLayer !== null && forbiddenTargets.includes(targetLayer)) {
        violations.push({
          file: path.relative(SRC_ROOT, filePath),
          line: imp.line,
          sourceLayer,
          targetLayer,
          importSpecifier: imp.specifier,
          rawLine: imp.raw,
        });
      }
    }
  }

  return violations;
}

/**
 * Format violations into a human-readable report string for assertion
 * failure messages.
 */
function formatViolations(violations: LayerViolation[]): string {
  if (violations.length === 0) return "No violations found.";

  return violations
    .map(
      (v) =>
        `  ${v.file}:${v.line} -- ${v.sourceLayer} -> ${v.targetLayer} via "${v.importSpecifier}"\n    ${v.rawLine}`,
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SOPR Layer Boundaries", () => {
  it("protocol layer does not import services or tools", () => {
    const forbidden = ["services", "tools"] as const;
    const violations = detectForbiddenImports(PROTOCOL_DIR, forbidden);

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("registry layer does not import services or tools", () => {
    const forbidden = ["services", "tools"] as const;
    const violations = detectForbiddenImports(REGISTRY_DIR, forbidden);

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("tools layer does not import protocol or registry", () => {
    const forbidden = ["protocol", "registry"] as const;
    const violations = detectForbiddenImports(TOOLS_DIR, forbidden);

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("services layer does not import tools, registry, or protocol", () => {
    const forbidden = ["tools", "registry", "protocol"] as const;
    const violations = detectForbiddenImports(SERVICES_DIR, forbidden);

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it("services do not import other service implementations directly", () => {
    const violations: LayerViolation[] = [];
    const files = collectTsFiles(SERVICES_DIR);

    for (const filePath of files) {
      const imports = parseImports(filePath);
      for (const imp of imports) {
        // Only check relative imports within the services layer
        if (!imp.specifier.startsWith(".")) continue;

        const targetLayer = resolveLayerFromImport(
          imp.specifier,
          filePath,
          SRC_ROOT,
        );

        // Skip imports that leave the services layer (handled by other tests)
        if (targetLayer !== "services") continue;

        // Resolve the actual target path to check if it's a concrete implementation
        const importingDir = path.dirname(filePath);
        const resolvedPath = path.resolve(importingDir, imp.specifier);
        const relativeToServices = path.relative(SERVICES_DIR, resolvedPath);

        // Allowed patterns:
        //  - Importing from an interfaces/types file (e.g. "./interfaces.ts")
        //  - Importing from an index barrel that re-exports interfaces
        //  - Importing from a types directory
        //
        // Forbidden:
        //  - Importing a concrete service class file from another service subdirectory
        //  - e.g. SnapshotService importing ../../ValidationService/validator.ts
        const isInterfaceImport =
          relativeToServices.includes("interface") ||
          relativeToServices.includes("types") ||
          relativeToServices.includes("index") ||
          relativeToServices.endsWith(".d.ts");

        // Check if the import crosses service subdirectory boundaries
        // e.g. from services/snapshot/ importing services/validation/impl.ts
        const sourceRelative = path.relative(SERVICES_DIR, filePath);
        const sourceTopDir = sourceRelative.split(path.sep)[0];
        const targetTopDir = relativeToServices.split(path.sep)[0];

        // If both are in the same service subdirectory, this is fine
        if (sourceTopDir === targetTopDir) continue;

        // Cross-service import that isn't an interface -- violation
        if (!isInterfaceImport) {
          violations.push({
            file: path.relative(SRC_ROOT, filePath),
            line: imp.line,
            sourceLayer: `services/${sourceTopDir}`,
            targetLayer: `services/${targetTopDir}`,
            importSpecifier: imp.specifier,
            rawLine: imp.raw,
          });
        }
      }
    }

    expect(
      violations,
      `Service-to-service implementation imports detected:\n${formatViolations(violations)}`,
    ).toHaveLength(0);
  });

  it("no layer imports from utils (not a recognized SOPR layer)", () => {
    // utils/ is not part of the SOPR 4-layer model. If it exists, layers
    // should not depend on it -- shared utilities belong in resilience/ or
    // contracts/.
    const layers = [PROTOCOL_DIR, REGISTRY_DIR, TOOLS_DIR, SERVICES_DIR];
    const violations: LayerViolation[] = [];

    for (const layerDir of layers) {
      const found = detectForbiddenImports(layerDir, ["utils"]);
      violations.push(...found);
    }

    expect(
      violations,
      `Imports from utils/ detected (use contracts/ or resilience/ instead):\n${formatViolations(violations)}`,
    ).toHaveLength(0);
  });

  it("contracts layer has no imports from any SOPR layer", () => {
    const contractsDir = path.join(SRC_ROOT, "contracts");
    const forbidden = [
      "protocol",
      "registry",
      "tools",
      "services",
      "resilience",
    ] as const;
    const violations = detectForbiddenImports(contractsDir, forbidden);

    expect(
      violations,
      `Contracts must be pure type definitions with no layer imports:\n${formatViolations(violations)}`,
    ).toHaveLength(0);
  });

  it("resilience layer has no imports from SOPR business layers", () => {
    const resilienceDir = path.join(SRC_ROOT, "resilience");
    const forbidden = [
      "protocol",
      "registry",
      "tools",
      "services",
    ] as const;
    const violations = detectForbiddenImports(resilienceDir, forbidden);

    expect(
      violations,
      `Resilience must be a utility layer with no business layer imports:\n${formatViolations(violations)}`,
    ).toHaveLength(0);
  });
});
