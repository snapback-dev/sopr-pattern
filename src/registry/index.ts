/**
 * Registry layer public API (Layer 2).
 *
 * @module registry
 */

export { ToolRegistry } from "./tool-registry.js";
export type {
  ToolDefinition,
  ModeHandler,
  ToolRegistryConfig,
} from "./types.js";
export { DEFAULT_REGISTRY_CONFIG } from "./types.js";
export { zodSchemaToJsonSchema } from "./schema-converter.js";
export type { JsonSchemaObject } from "./schema-converter.js";
