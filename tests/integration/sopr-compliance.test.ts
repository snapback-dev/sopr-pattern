/**
 * SOPR Compliance Report Tests
 *
 * Validates that the SOPR pattern's structural invariants hold:
 *   - Tool count within budget
 *   - Tool descriptions within token budget
 *   - ToolContext has exactly 5 fields
 *   - All declared tool modes have corresponding handler names
 *   - No `any` types leak into the contracts layer
 *
 * @module tests/integration/sopr-compliance
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  TOOL_MAP,
  TOOL_COUNT,
  TOTAL_MODE_COUNT,
} from "../../src/contracts/tool-map.js";
import type { ToolContext } from "../../src/contracts/context.js";
import { collectTsFiles } from "../helpers/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SRC_ROOT = path.resolve(
  import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
  "../../src",
);

const CONTRACTS_DIR = path.join(SRC_ROOT, "contracts");

/** Maximum number of tools allowed in the SOPR pattern. */
const MAX_TOOL_COUNT = 9;

/** Maximum token count (whitespace-split) for tool descriptions. */
const MAX_DESCRIPTION_TOKENS = 60;

/** Expected number of fields on ToolContext. */
const EXPECTED_CONTEXT_FIELD_COUNT = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count "tokens" in a string by splitting on whitespace.
 * This is the simple token approximation specified in the SOPR pattern
 * for tool discovery overhead estimation.
 */
function countTokens(text: string): number {
  return text.split(/\s+/).filter((t) => t.length > 0).length;
}

/**
 * Extract the field names of the ToolContext interface by inspecting its
 * TypeScript type at the type level.
 *
 * We use a compile-time approach: create an object that satisfies
 * ToolContext and count its keys. This ensures the test stays in sync
 * with the actual type definition.
 */
function getToolContextFieldNames(): string[] {
  // Build a ToolContext-shaped object to extract keys.
  // The values don't matter -- we just need the property names.
  const sample: ToolContext = {
    workspacePath: "",
    sessionId: "",
    capabilities: [],
    timestamp: 0,
    requestId: "",
  };

  return Object.keys(sample);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SOPR Compliance Report", () => {
  // -------------------------------------------------------------------------
  // Tool count budget
  // -------------------------------------------------------------------------

  describe("Tool Count Budget", () => {
    it(`total tool count (${TOOL_COUNT}) does not exceed ${MAX_TOOL_COUNT}`, () => {
      expect(
        TOOL_COUNT,
        `SOPR pattern limits tools to ${MAX_TOOL_COUNT}. Current count: ${TOOL_COUNT}. ` +
          `Consolidate related tools into modes instead of adding new tools.`,
      ).toBeLessThanOrEqual(MAX_TOOL_COUNT);
    });

    it("TOOL_COUNT matches actual keys in TOOL_MAP", () => {
      const actualCount = Object.keys(TOOL_MAP).length;
      expect(TOOL_COUNT).toBe(actualCount);
    });

    it("total mode count matches sum of modes across tools", () => {
      let computedModeCount = 0;
      for (const tool of Object.values(TOOL_MAP)) {
        computedModeCount += Object.keys(tool.modes).length;
      }
      expect(TOTAL_MODE_COUNT).toBe(computedModeCount);
    });
  });

  // -------------------------------------------------------------------------
  // Tool description token budget
  // -------------------------------------------------------------------------

  describe("Tool Description Token Budget", () => {
    const toolEntries = Object.entries(TOOL_MAP);

    for (const [toolName, toolDef] of toolEntries) {
      it(`"${toolName}" description is under ${MAX_DESCRIPTION_TOKENS} tokens`, () => {
        const tokenCount = countTokens(toolDef.description);
        expect(
          tokenCount,
          `Tool "${toolName}" description has ${tokenCount} tokens (max: ${MAX_DESCRIPTION_TOKENS}).\n` +
            `Description: "${toolDef.description}"\n` +
            `Compress the description to reduce tool-discovery overhead.`,
        ).toBeLessThanOrEqual(MAX_DESCRIPTION_TOKENS);
      });
    }
  });

  // -------------------------------------------------------------------------
  // ToolContext field count
  // -------------------------------------------------------------------------

  describe("ToolContext Structure", () => {
    it(`ToolContext has exactly ${EXPECTED_CONTEXT_FIELD_COUNT} fields`, () => {
      const fields = getToolContextFieldNames();
      expect(
        fields.length,
        `ToolContext has ${fields.length} fields: [${fields.join(", ")}]. ` +
          `Expected exactly ${EXPECTED_CONTEXT_FIELD_COUNT}. ` +
          `Adding fields increases per-request token cost.`,
      ).toBe(EXPECTED_CONTEXT_FIELD_COUNT);
    });

    it("ToolContext contains the required fields", () => {
      const fields = getToolContextFieldNames();
      const required = [
        "workspacePath",
        "sessionId",
        "capabilities",
        "timestamp",
        "requestId",
      ];

      for (const field of required) {
        expect(
          fields,
          `ToolContext is missing required field "${field}"`,
        ).toContain(field);
      }
    });
  });

  // -------------------------------------------------------------------------
  // All tool modes have handler names
  // -------------------------------------------------------------------------

  describe("Mode Handler Completeness", () => {
    for (const [toolName, toolDef] of Object.entries(TOOL_MAP)) {
      for (const [modeName, modeDef] of Object.entries(toolDef.modes)) {
        it(`${toolName}.${modeName} has a non-empty handler name`, () => {
          expect(
            modeDef.handler,
            `Mode "${toolName}.${modeName}" has no handler name defined`,
          ).toBeTruthy();
          expect(typeof modeDef.handler).toBe("string");
          expect(modeDef.handler.length).toBeGreaterThan(0);
        });

        it(`${toolName}.${modeName} handler follows naming convention`, () => {
          // Convention: handle<ToolPascal><ModePascal>
          const expectedPrefix = "handle";
          expect(
            modeDef.handler.startsWith(expectedPrefix),
            `Handler "${modeDef.handler}" for ${toolName}.${modeName} should start with "handle"`,
          ).toBe(true);
        });

        it(`${toolName}.${modeName} has a valid execution strategy`, () => {
          const validStrategies = ["single", "parallel", "sequential"];
          expect(
            validStrategies,
            `Execution strategy "${modeDef.execution}" for ${toolName}.${modeName} is not valid`,
          ).toContain(modeDef.execution);
        });

        it(`${toolName}.${modeName} has at least one service dependency`, () => {
          expect(
            modeDef.services.length,
            `Mode "${toolName}.${modeName}" has no service dependencies. ` +
              `Every mode should delegate to at least one service.`,
          ).toBeGreaterThanOrEqual(1);
        });
      }
    }
  });

  // -------------------------------------------------------------------------
  // No `any` types in contracts
  // -------------------------------------------------------------------------

  describe("Type Safety in Contracts", () => {
    it("no explicit `any` type annotations in contracts/", () => {
      const files = collectTsFiles(CONTRACTS_DIR);
      const violations: Array<{ file: string; line: number; rawLine: string }> = [];

      // Patterns that indicate explicit `any` usage:
      //   : any
      //   as any
      //   <any>
      //   any[]
      //   any,
      //   any;
      //   any)
      //
      // We must be careful not to flag words like "many", "company", etc.
      // The regex requires `any` to appear in a type-annotation context.
      const anyPattern = /\b(?::\s*any\b|as\s+any\b|<any>|any\[\]|Record<[^,]+,\s*any>|:\s*any\s*[;,)\]}])/;

      // Exception: z.unknown() is fine -- only z.any() is forbidden
      const zodAnyPattern = /z\.any\(\)/;

      for (const filePath of files) {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const trimmed = line.trimStart();

          // Skip comments
          if (
            trimmed.startsWith("//") ||
            trimmed.startsWith("*") ||
            trimmed.startsWith("/*")
          ) {
            continue;
          }

          if (anyPattern.test(line) || zodAnyPattern.test(line)) {
            violations.push({
              file: path.relative(SRC_ROOT, filePath),
              line: i + 1,
              rawLine: line.trimEnd(),
            });
          }
        }
      }

      const report = violations
        .map((v) => `  ${v.file}:${v.line}\n    ${v.rawLine}`)
        .join("\n\n");

      expect(
        violations,
        `Explicit \`any\` types found in contracts/ (use \`unknown\`, specific types, or Zod schemas instead):\n${report}`,
      ).toHaveLength(0);
    });

    it("all tool input schemas use Zod for validation", () => {
      // Verify that the tool-inputs module imports from zod
      const toolInputsPath = path.join(CONTRACTS_DIR, "schemas", "tool-inputs.ts");

      if (!fs.existsSync(toolInputsPath)) {
        return; // File doesn't exist yet
      }

      const content = fs.readFileSync(toolInputsPath, "utf-8");
      expect(
        content.includes("from \"zod\"") || content.includes("from 'zod'"),
        "tool-inputs.ts should import from zod for runtime validation",
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Handler uniqueness
  // -------------------------------------------------------------------------

  describe("Handler Uniqueness", () => {
    it("all handler names are unique across the entire tool map", () => {
      const handlerNames = new Map<string, string>();
      const duplicates: Array<{ handler: string; locations: string[] }> = [];

      for (const [toolName, toolDef] of Object.entries(TOOL_MAP)) {
        for (const [modeName, modeDef] of Object.entries(toolDef.modes)) {
          const location = `${toolName}.${modeName}`;
          const existing = handlerNames.get(modeDef.handler);

          if (existing) {
            const existingDup = duplicates.find(
              (d) => d.handler === modeDef.handler,
            );
            if (existingDup) {
              existingDup.locations.push(location);
            } else {
              duplicates.push({
                handler: modeDef.handler,
                locations: [existing, location],
              });
            }
          } else {
            handlerNames.set(modeDef.handler, location);
          }
        }
      }

      const report = duplicates
        .map(
          (d) =>
            `  Handler "${d.handler}" used by: ${d.locations.join(", ")}`,
        )
        .join("\n");

      expect(
        duplicates,
        `Duplicate handler names found:\n${report}`,
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Tool name conventions
  // -------------------------------------------------------------------------

  describe("Tool Name Conventions", () => {
    for (const [toolName, toolDef] of Object.entries(TOOL_MAP)) {
      it(`"${toolName}" key matches its name property`, () => {
        expect(
          toolName,
          `Tool map key "${toolName}" does not match name property "${toolDef.name}"`,
        ).toBe(toolDef.name);
      });

      it(`"${toolName}" uses lowercase naming`, () => {
        expect(
          toolName,
          `Tool name "${toolName}" should be lowercase`,
        ).toBe(toolName.toLowerCase());
      });
    }
  });
});
