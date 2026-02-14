/**
 * Registry layer public API (Layer 2).
 *
 * @module registry
 */

export type { JsonSchemaObject } from "./schema-converter.js";
export { zodSchemaToJsonSchema } from "./schema-converter.js";
export { ToolRegistry } from "./tool-registry.js";
export type {
  ModeHandler,
  ToolDefinition,
  ToolRegistryConfig,
} from "./types.js";
export { DEFAULT_REGISTRY_CONFIG } from "./types.js";
