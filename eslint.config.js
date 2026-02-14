/**
 * ESLint Flat Configuration for SOPR Pattern
 *
 * Enforces:
 *   - TypeScript strict rules (no-explicit-any, no-unused-vars, consistent-type-imports)
 *   - Layer-specific import restrictions via no-restricted-imports
 *   - General code quality rules
 *
 * @see https://eslint.org/docs/latest/use/configure/configuration-files
 */

import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// ---------------------------------------------------------------------------
// Shared settings
// ---------------------------------------------------------------------------

const TYPESCRIPT_FILES = ["**/*.ts"];

/** Base TypeScript configuration shared across all source files. */
const baseTypeScriptConfig = {
  files: TYPESCRIPT_FILES,
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      projectService: true,
    },
  },
  plugins: {
    "@typescript-eslint": tsPlugin,
  },
  rules: {
    // ----- TypeScript strict rules -----

    // Forbid explicit `any` -- use `unknown` or specific types instead.
    "@typescript-eslint/no-explicit-any": "error",

    // Catch unused variables (allow underscore-prefixed intentional ignores).
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      },
    ],

    // Enforce `import type` for type-only imports to reduce runtime bundle.
    "@typescript-eslint/consistent-type-imports": [
      "error",
      {
        prefer: "type-imports",
        fixStyle: "separate-type-imports",
        disallowTypeAnnotations: true,
      },
    ],

    // Ensure consistent type exports.
    "@typescript-eslint/consistent-type-exports": "off",

    // Prefer nullish coalescing over logical OR for nullable checks.
    "@typescript-eslint/prefer-nullish-coalescing": "off",

    // Prefer optional chaining for cleaner nullable access.
    "@typescript-eslint/prefer-optional-chain": "warn",

    // Disallow non-null assertions (use proper narrowing instead).
    "@typescript-eslint/no-non-null-assertion": "warn",

    // Require explicit return types on exported functions for API clarity.
    "@typescript-eslint/explicit-function-return-type": "off",

    // Require explicit accessibility modifiers on class members.
    "@typescript-eslint/explicit-member-accessibility": "off",

    // ----- General quality rules -----

    // No debugger statements in committed code.
    "no-debugger": "error",

    // No console.log (use structured logging via Logger interface).
    "no-console": ["warn", { allow: ["warn", "error"] }],

    // Require strict equality checks.
    eqeqeq: ["error", "always"],

    // No variable shadowing (reduces confusion).
    "no-shadow": "off",
    "@typescript-eslint/no-shadow": "error",

    // Prefer const for variables that are never reassigned.
    "prefer-const": "error",

    // No var declarations.
    "no-var": "error",
  },
};

// ---------------------------------------------------------------------------
// Layer-specific import restriction helpers
// ---------------------------------------------------------------------------

/**
 * Build a no-restricted-imports rule for a specific SOPR layer.
 *
 * @param layerName - The layer being configured (for error messages).
 * @param forbiddenPatterns - Glob-like path patterns to forbid.
 * @param messages - Map of pattern to human-readable reason.
 */
function buildLayerImportRestrictions(layerName, forbiddenPatterns) {
  return {
    "no-restricted-imports": [
      "error",
      {
        patterns: forbiddenPatterns.map((entry) => ({
          group: entry.patterns,
          message: entry.message,
        })),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Layer 1: Protocol Server
// ---------------------------------------------------------------------------

const protocolLayerConfig = {
  files: ["src/protocol/**/*.ts"],
  rules: buildLayerImportRestrictions("protocol", [
    {
      patterns: ["**/services/*", "**/services/**", "../services/*", "../services/**"],
      message:
        "Protocol layer (L1) must not import services (L4) directly. Route through registry and tools.",
    },
    {
      patterns: ["**/tools/*", "**/tools/**", "../tools/*", "../tools/**"],
      message:
        "Protocol layer (L1) must not import tools (L3) directly. Use the registry for dispatch.",
    },
  ]),
};

// ---------------------------------------------------------------------------
// Layer 2: Tool Registry
// ---------------------------------------------------------------------------

const registryLayerConfig = {
  files: ["src/registry/**/*.ts"],
  rules: buildLayerImportRestrictions("registry", [
    {
      patterns: ["**/services/*", "**/services/**", "../services/*", "../services/**"],
      message:
        "Registry layer (L2) must not import services (L4). Only contracts are allowed.",
    },
    {
      patterns: ["**/tools/*", "**/tools/**", "../tools/*", "../tools/**"],
      message:
        "Registry layer (L2) must not import tools (L3). Registry dispatches to tools, not the reverse.",
    },
    {
      patterns: ["**/protocol/*", "**/protocol/**", "../protocol/*", "../protocol/**"],
      message:
        "Registry layer (L2) must not import protocol (L1). This is a reverse dependency.",
    },
  ]),
};

// ---------------------------------------------------------------------------
// Layer 3: Mode-Based Tools
// ---------------------------------------------------------------------------

const toolsLayerConfig = {
  files: ["src/tools/**/*.ts"],
  rules: buildLayerImportRestrictions("tools", [
    {
      patterns: ["**/protocol/*", "**/protocol/**", "../protocol/*", "../protocol/**"],
      message:
        "Tools layer (L3) must not import protocol (L1). This is a reverse dependency.",
    },
    {
      patterns: ["**/registry/*", "**/registry/**", "../registry/*", "../registry/**"],
      message:
        "Tools layer (L3) must not import registry (L2). This is a reverse dependency.",
    },
  ]),
};

// ---------------------------------------------------------------------------
// Layer 4: Pure Services
// ---------------------------------------------------------------------------

const servicesLayerConfig = {
  files: ["src/services/**/*.ts"],
  rules: buildLayerImportRestrictions("services", [
    {
      patterns: ["**/protocol/*", "**/protocol/**", "../protocol/*", "../protocol/**"],
      message:
        "Services layer (L4) must not import protocol (L1). This is a reverse dependency.",
    },
    {
      patterns: ["**/registry/*", "**/registry/**", "../registry/*", "../registry/**"],
      message:
        "Services layer (L4) must not import registry (L2). This is a reverse dependency.",
    },
    {
      patterns: ["**/tools/*", "**/tools/**", "../tools/*", "../tools/**"],
      message:
        "Services layer (L4) must not import tools (L3). This is a reverse dependency.",
    },
  ]),
};

// ---------------------------------------------------------------------------
// Contracts layer (must be pure -- no SOPR layer imports)
// ---------------------------------------------------------------------------

const contractsLayerConfig = {
  files: ["src/contracts/**/*.ts"],
  rules: buildLayerImportRestrictions("contracts", [
    {
      patterns: ["**/protocol/*", "**/protocol/**"],
      message: "Contracts must be pure type definitions with no layer imports.",
    },
    {
      patterns: ["**/registry/*", "**/registry/**"],
      message: "Contracts must be pure type definitions with no layer imports.",
    },
    {
      patterns: ["**/tools/*", "**/tools/**"],
      message: "Contracts must be pure type definitions with no layer imports.",
    },
    {
      patterns: ["**/services/*", "**/services/**"],
      message: "Contracts must be pure type definitions with no layer imports.",
    },
    {
      patterns: ["**/resilience/*", "**/resilience/**"],
      message: "Contracts must be pure type definitions with no layer imports.",
    },
  ]),
};

// ---------------------------------------------------------------------------
// Ignores
// ---------------------------------------------------------------------------

const ignoreConfig = {
  ignores: [
    "dist/**",
    "node_modules/**",
    "coverage/**",
    "**/*.js",
    "**/*.d.ts",
    "eslint.config.js",
    "vitest.config.ts",
  ],
};

// ---------------------------------------------------------------------------
// Export flat config array
// ---------------------------------------------------------------------------

export default [
  ignoreConfig,
  baseTypeScriptConfig,
  protocolLayerConfig,
  registryLayerConfig,
  toolsLayerConfig,
  servicesLayerConfig,
  contractsLayerConfig,
];
