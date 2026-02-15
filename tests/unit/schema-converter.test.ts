/**
 * Unit tests for the Zod-to-JSON-Schema converter.
 *
 * Validates:
 *   - Primitive type conversion (string, number, boolean)
 *   - String constraints (minLength from Zod .min())
 *   - Number constraints (int, min, max checks)
 *   - Enum and literal conversion
 *   - Array conversion with item schemas
 *   - Optional and default field handling
 *   - Union (anyOf) conversion
 *   - ZodUnknown produces empty schema
 *   - Nested object conversion
 *   - Required vs optional field detection
 *   - Error when non-ZodObject passed as root
 *
 * @module tests/unit/schema-converter
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodSchemaToJsonSchema } from "../../src/registry/schema-converter.js";

// ---------------------------------------------------------------------------
// Primitive Types
// ---------------------------------------------------------------------------

describe("zodSchemaToJsonSchema", () => {
  describe("primitive types", () => {
    it("converts ZodString to { type: 'string' }", () => {
      const schema = z.object({ name: z.string() });
      const result = zodSchemaToJsonSchema(schema);

      expect(result).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
      });
    });

    it("converts ZodString with minLength constraint", () => {
      const schema = z.object({ name: z.string().min(3) });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.name).toEqual({
        type: "string",
        minLength: 3,
      });
    });

    it("converts ZodNumber to { type: 'number' }", () => {
      const schema = z.object({ count: z.number() });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.count).toEqual({ type: "number" });
      expect(result.required).toContain("count");
    });

    it("converts ZodNumber with .int() to { type: 'integer' }", () => {
      const schema = z.object({ count: z.number().int() });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.count).toEqual({ type: "integer" });
    });

    it("converts ZodNumber with min and max constraints", () => {
      const schema = z.object({ score: z.number().min(0).max(100) });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.score).toEqual({
        type: "number",
        minimum: 0,
        maximum: 100,
      });
    });

    it("converts ZodNumber with int + min + max combined", () => {
      const schema = z.object({ age: z.number().int().min(0).max(150) });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.age).toEqual({
        type: "integer",
        minimum: 0,
        maximum: 150,
      });
    });

    it("converts ZodBoolean to { type: 'boolean' }", () => {
      const schema = z.object({ active: z.boolean() });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.active).toEqual({ type: "boolean" });
      expect(result.required).toContain("active");
    });
  });

  // ---------------------------------------------------------------------------
  // Enum and Literal
  // ---------------------------------------------------------------------------

  describe("enum and literal types", () => {
    it("converts ZodEnum to { type: 'string', enum: [...] }", () => {
      const schema = z.object({
        mode: z.enum(["start", "stop", "pause"]),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.mode).toEqual({
        type: "string",
        enum: ["start", "stop", "pause"],
      });
      expect(result.required).toContain("mode");
    });

    it("converts ZodLiteral to { const: value }", () => {
      const schema = z.object({ type: z.literal("snapshot") });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.type).toEqual({ const: "snapshot" });
    });

    it("converts ZodLiteral with numeric value", () => {
      const schema = z.object({ version: z.literal(42) });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.version).toEqual({ const: 42 });
    });

    it("converts ZodLiteral with boolean value", () => {
      const schema = z.object({ enabled: z.literal(true) });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.enabled).toEqual({ const: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Arrays
  // ---------------------------------------------------------------------------

  describe("array types", () => {
    it("converts ZodArray of strings", () => {
      const schema = z.object({ tags: z.array(z.string()) });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.tags).toEqual({
        type: "array",
        items: { type: "string" },
      });
      expect(result.required).toContain("tags");
    });

    it("converts ZodArray of numbers", () => {
      const schema = z.object({ scores: z.array(z.number()) });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.scores).toEqual({
        type: "array",
        items: { type: "number" },
      });
    });

    it("converts ZodArray of objects", () => {
      const schema = z.object({
        items: z.array(z.object({ id: z.string(), value: z.number() })),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.items).toEqual({
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            value: { type: "number" },
          },
          required: ["id", "value"],
        },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Optional and Default
  // ---------------------------------------------------------------------------

  describe("optional and default fields", () => {
    it("excludes ZodOptional fields from required array", () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().optional(),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.required).toEqual(["name"]);
      expect(result.properties?.nickname).toEqual({ type: "string" });
    });

    it("excludes ZodDefault fields from required array", () => {
      const schema = z.object({
        name: z.string(),
        verbose: z.boolean().default(false),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.required).toEqual(["name"]);
      expect(result.properties?.verbose).toEqual({
        type: "boolean",
        default: false,
      });
    });

    it("preserves default value in converted schema", () => {
      const schema = z.object({
        limit: z.number().default(10),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.limit).toEqual({
        type: "number",
        default: 10,
      });
      expect(result.required).toBeUndefined();
    });

    it("preserves string default value", () => {
      const schema = z.object({
        format: z.string().default("json"),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.format).toEqual({
        type: "string",
        default: "json",
      });
    });

    it("handles all-optional objects without required array", () => {
      const schema = z.object({
        a: z.string().optional(),
        b: z.number().optional(),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.required).toBeUndefined();
      expect(result.type).toBe("object");
      expect(result.properties?.a).toEqual({ type: "string" });
      expect(result.properties?.b).toEqual({ type: "number" });
    });
  });

  // ---------------------------------------------------------------------------
  // Union
  // ---------------------------------------------------------------------------

  describe("union types", () => {
    it("converts ZodUnion to { anyOf: [...] }", () => {
      const schema = z.object({
        value: z.union([z.string(), z.number()]),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.value).toEqual({
        anyOf: [{ type: "string" }, { type: "number" }],
      });
      expect(result.required).toContain("value");
    });

    it("converts ZodUnion with three members", () => {
      const schema = z.object({
        data: z.union([z.string(), z.number(), z.boolean()]),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.data).toEqual({
        anyOf: [{ type: "string" }, { type: "number" }, { type: "boolean" }],
      });
    });
  });

  // ---------------------------------------------------------------------------
  // ZodUnknown
  // ---------------------------------------------------------------------------

  describe("unknown type", () => {
    it("converts ZodUnknown to empty schema", () => {
      const schema = z.object({ data: z.unknown() });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.data).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // Nested Objects
  // ---------------------------------------------------------------------------

  describe("nested objects", () => {
    it("converts nested ZodObject to nested JSON Schema", () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          age: z.number(),
        }),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties?.user).toEqual({
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        required: ["name", "age"],
      });
      expect(result.required).toContain("user");
    });

    it("handles deeply nested objects", () => {
      const schema = z.object({
        config: z.object({
          database: z.object({
            host: z.string(),
            port: z.number().int(),
          }),
        }),
      });
      const result = zodSchemaToJsonSchema(schema);

      const dbSchema = (result.properties?.config as Record<string, unknown>)?.properties as Record<
        string,
        unknown
      >;
      const dbProps = (dbSchema?.database as Record<string, unknown>)?.properties as Record<
        string,
        unknown
      >;

      expect(dbProps?.host).toEqual({ type: "string" });
      expect(dbProps?.port).toEqual({ type: "integer" });
    });

    it("handles nested optional fields correctly", () => {
      const schema = z.object({
        config: z.object({
          required_field: z.string(),
          optional_field: z.number().optional(),
        }),
      });
      const result = zodSchemaToJsonSchema(schema);

      const configSchema = result.properties?.config as Record<string, unknown>;
      expect(configSchema?.required).toEqual(["required_field"]);
    });
  });

  // ---------------------------------------------------------------------------
  // Required vs Optional Detection
  // ---------------------------------------------------------------------------

  describe("required vs optional field detection", () => {
    it("marks all required fields when none are optional", () => {
      const schema = z.object({
        a: z.string(),
        b: z.number(),
        c: z.boolean(),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.required).toEqual(["a", "b", "c"]);
    });

    it("correctly separates required and optional fields", () => {
      const schema = z.object({
        mode: z.enum(["start", "stop"]),
        target: z.string(),
        verbose: z.boolean().optional(),
        timeout: z.number().default(30000),
      });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.required).toEqual(["mode", "target"]);
      expect(result.required).not.toContain("verbose");
      expect(result.required).not.toContain("timeout");
    });

    it("omits required array when empty object schema", () => {
      const schema = z.object({});
      const result = zodSchemaToJsonSchema(schema);

      expect(result.type).toBe("object");
      expect(result.required).toBeUndefined();
      expect(result.properties).toEqual({});
    });
  });

  // ---------------------------------------------------------------------------
  // Top-level Shape
  // ---------------------------------------------------------------------------

  describe("top-level output shape", () => {
    it("always returns type: 'object' at the top level", () => {
      const schema = z.object({ x: z.string() });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.type).toBe("object");
    });

    it("includes properties object", () => {
      const schema = z.object({ x: z.string() });
      const result = zodSchemaToJsonSchema(schema);

      expect(result.properties).toBeDefined();
      expect(typeof result.properties).toBe("object");
    });
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    it("throws when a non-ZodObject is passed as root", () => {
      const stringSchema = z.string();
      expect(() => zodSchemaToJsonSchema(stringSchema)).toThrow(
        "Expected a ZodObject schema at the top level, got ZodString",
      );
    });

    it("throws for ZodNumber as root", () => {
      const numberSchema = z.number();
      expect(() => zodSchemaToJsonSchema(numberSchema)).toThrow(
        "Expected a ZodObject schema at the top level, got ZodNumber",
      );
    });

    it("throws for ZodArray as root", () => {
      const arraySchema = z.array(z.string());
      expect(() => zodSchemaToJsonSchema(arraySchema)).toThrow(
        "Expected a ZodObject schema at the top level, got ZodArray",
      );
    });

    it("throws for ZodEnum as root", () => {
      const enumSchema = z.enum(["a", "b"]);
      expect(() => zodSchemaToJsonSchema(enumSchema)).toThrow(
        "Expected a ZodObject schema at the top level, got ZodEnum",
      );
    });

    it("throws for ZodBoolean as root", () => {
      const boolSchema = z.boolean();
      expect(() => zodSchemaToJsonSchema(boolSchema)).toThrow(
        "Expected a ZodObject schema at the top level, got ZodBoolean",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Realistic Tool Schema (Integration-Style)
  // ---------------------------------------------------------------------------

  describe("realistic tool input schema", () => {
    it("converts a full SOPR-style tool input schema", () => {
      const snapInputSchema = z.object({
        mode: z.enum(["start", "check", "context"]),
        task: z.string().min(1).optional(),
        files: z.array(z.string()).optional(),
        keywords: z.array(z.string()).optional(),
        intent: z.enum(["implement", "debug", "refactor", "review", "explore"]).optional(),
        verbose: z.boolean().default(false),
      });

      const result = zodSchemaToJsonSchema(snapInputSchema);

      expect(result.type).toBe("object");
      expect(result.required).toEqual(["mode"]);

      expect(result.properties?.mode).toEqual({
        type: "string",
        enum: ["start", "check", "context"],
      });

      expect(result.properties?.task).toEqual({
        type: "string",
        minLength: 1,
      });

      expect(result.properties?.files).toEqual({
        type: "array",
        items: { type: "string" },
      });

      expect(result.properties?.verbose).toEqual({
        type: "boolean",
        default: false,
      });

      expect(result.properties?.intent).toEqual({
        type: "string",
        enum: ["implement", "debug", "refactor", "review", "explore"],
      });
    });
  });
});
