/**
 * Zod-to-JSON-Schema converter for MCP tool discovery.
 *
 * The MCP `tools/list` response requires each tool's `inputSchema` to be
 * expressed as a JSON Schema object (`{ type: "object", properties: ... }`).
 *
 * This module provides a focused converter that handles the Zod schema
 * subset used by SOPR tool input definitions. It avoids a dependency on
 * `zod-to-json-schema` (which is only a transitive dependency via the
 * MCP SDK and not directly importable under pnpm strict mode).
 *
 * Supported Zod types:
 *   ZodObject, ZodString, ZodNumber, ZodBoolean, ZodEnum, ZodLiteral,
 *   ZodArray, ZodOptional, ZodDefault, ZodUnknown, ZodUnion
 *
 * @module registry/schema-converter
 */

import type { ZodType } from "zod";

// ---------------------------------------------------------------------------
// JSON Schema types (subset relevant for MCP tool definitions)
// ---------------------------------------------------------------------------

/** A JSON Schema property descriptor. */
interface JsonSchemaProperty {
  type?: string;
  enum?: readonly unknown[];
  const?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
  description?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  anyOf?: JsonSchemaProperty[];
  [key: string]: unknown;
}

/** Top-level JSON Schema object matching MCP's `inputSchema` shape. */
export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the Zod type name from its internal `_def.typeName` property.
 * This is a stable API across Zod v3.x.
 */
function getTypeName(schema: ZodType): string {
  // biome-ignore lint/suspicious/noExplicitAny: Zod internal _def access requires any
  return (schema as Record<string, any>)._def?.typeName ?? "ZodUnknown";
}

/**
 * Access the internal `_def` object of a Zod schema.
 */
// biome-ignore lint/suspicious/noExplicitAny: Zod internal _def access requires any
function getDef(schema: ZodType): Record<string, any> {
  // biome-ignore lint/suspicious/noExplicitAny: Zod internal _def access requires any
  return (schema as Record<string, any>)._def;
}

/**
 * Convert a single Zod schema node to a JSON Schema property descriptor.
 */
function convertNode(schema: ZodType): JsonSchemaProperty {
  const typeName = getTypeName(schema);
  const def = getDef(schema);

  switch (typeName) {
    case "ZodString": {
      const result: JsonSchemaProperty = { type: "string" };
      if (def.checks) {
        for (const check of def.checks as Array<{ kind: string; value?: number }>) {
          if (check.kind === "min" && check.value !== undefined) {
            result.minLength = check.value;
          }
        }
      }
      return result;
    }

    case "ZodNumber": {
      const result: JsonSchemaProperty = { type: "number" };
      if (def.checks) {
        for (const check of def.checks as Array<{
          kind: string;
          value?: number;
          inclusive?: boolean;
        }>) {
          if (check.kind === "int") {
            result.type = "integer";
          }
          if (check.kind === "min" && check.value !== undefined) {
            result.minimum = check.value;
          }
          if (check.kind === "max" && check.value !== undefined) {
            result.maximum = check.value;
          }
        }
      }
      return result;
    }

    case "ZodBoolean":
      return { type: "boolean" };

    case "ZodLiteral":
      return { const: def.value };

    case "ZodEnum":
      return { type: "string", enum: def.values as readonly string[] };

    case "ZodArray": {
      const itemSchema = def.type as ZodType;
      return { type: "array", items: convertNode(itemSchema) };
    }

    case "ZodObject": {
      const shape = def.shape() as Record<string, ZodType>;
      const properties: Record<string, JsonSchemaProperty> = {};
      const required: string[] = [];

      for (const [key, fieldSchema] of Object.entries(shape)) {
        properties[key] = convertNode(fieldSchema);
        const fieldTypeName = getTypeName(fieldSchema);
        if (fieldTypeName !== "ZodOptional" && fieldTypeName !== "ZodDefault") {
          required.push(key);
        }
      }

      const result: JsonSchemaProperty = { type: "object", properties };
      if (required.length > 0) {
        result.required = required;
      }
      return result;
    }

    case "ZodOptional": {
      const innerSchema = def.innerType as ZodType;
      return convertNode(innerSchema);
    }

    case "ZodDefault": {
      const innerSchema = def.innerType as ZodType;
      const converted = convertNode(innerSchema);
      converted.default = def.defaultValue();
      return converted;
    }

    case "ZodUnion": {
      const options = def.options as ZodType[];
      return { anyOf: options.map(convertNode) };
    }

    case "ZodUnknown":
      return {};

    default:
      // Fallback for unsupported types: return empty schema (accepts anything).
      return {};
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a Zod object schema to a JSON Schema object descriptor.
 *
 * The returned shape matches what the MCP protocol expects in the
 * `inputSchema` field of a tool definition:
 *
 * ```json
 * { "type": "object", "properties": { ... }, "required": [ ... ] }
 * ```
 *
 * @param schema - A Zod schema (must be a ZodObject at the top level).
 * @returns A JSON Schema object suitable for MCP `tools/list`.
 *
 * @throws {Error} If the provided schema is not a ZodObject at the root.
 */
export function zodSchemaToJsonSchema(schema: ZodType): JsonSchemaObject {
  const typeName = getTypeName(schema);

  if (typeName !== "ZodObject") {
    throw new Error(`Expected a ZodObject schema at the top level, got ${typeName}`);
  }

  const converted = convertNode(schema);
  return {
    type: "object",
    properties: converted.properties as Record<string, JsonSchemaProperty> | undefined,
    required: converted.required,
  };
}
