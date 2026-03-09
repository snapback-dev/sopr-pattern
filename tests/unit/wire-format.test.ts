/**
 * Wire-format encoder/decoder unit tests.
 *
 * Validates:
 *   - Encoding of all WireType variants via typed helpers
 *   - Generic encode/decode round-trip fidelity
 *   - Decoding of well-formed wire strings
 *   - Error handling for malformed wire strings
 *   - Edge cases: empty strings, special characters, pipe escaping,
 *     null/undefined, booleans, numbers, arrays, objects
 *
 * @module tests/unit/wire-format
 */

import { describe, expect, it } from "vitest";
import {
	decode,
	encode,
	encodeCache,
	encodeCheck,
	encodeEnd,
	encodeGraph,
	encodeIntegrate,
	encodeLearning,
	encodePulse,
	encodeSnap,
	encodeViolation,
	WireFormatError,
	WireType,
} from "../../src/contracts/wire-format.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PREFIX = "\u{1F9E2}"; // Cap emoji

// ---------------------------------------------------------------------------
// Generic encode
// ---------------------------------------------------------------------------

describe("encode", () => {
	it("produces the correct wire format structure", () => {
		const wire = encode(WireType.Check, { passed: true, errorCount: 0 });
		expect(wire).toBe(`${PREFIX}|C|passed:true|errorCount:0`);
	});

	it("encodes string values", () => {
		const wire = encode(WireType.Learning, { id: "learn_abc123" });
		expect(wire).toBe(`${PREFIX}|L|id:learn_abc123`);
	});

	it("encodes numeric values", () => {
		const wire = encode(WireType.End, { saved: 42, ratio: 3.14 });
		expect(wire).toBe(`${PREFIX}|E|saved:42|ratio:3.14`);
	});

	it("encodes boolean values", () => {
		const wire = encode(WireType.Cache, { hit: true, stale: false });
		expect(wire).toBe(`${PREFIX}|X|hit:true|stale:false`);
	});

	it("encodes null and undefined as 'null'", () => {
		const wire = encode(WireType.Snap, { a: null, b: undefined });
		expect(wire).toBe(`${PREFIX}|S|a:null|b:null`);
	});

	it("encodes array values as JSON", () => {
		const wire = encode(WireType.Snap, { tags: ["a", "b"] });
		expect(wire).toContain("tags:");
		// The decoded result should reconstruct the array
		const decoded = decode(wire);
		expect(decoded.data.tags).toEqual(["a", "b"]);
	});

	it("encodes object values as JSON", () => {
		const wire = encode(WireType.Snap, { meta: { x: 1 } });
		const decoded = decode(wire);
		expect(decoded.data.meta).toEqual({ x: 1 });
	});

	it("escapes pipe characters in string values", () => {
		const wire = encode(WireType.Violation, { msg: "a|b|c" });
		// The raw wire should not split into extra fields
		const decoded = decode(wire);
		expect(decoded.data.msg).toBe("a|b|c");
	});

	it("handles empty data object", () => {
		const wire = encode(WireType.Pulse, {});
		expect(wire).toBe(`${PREFIX}|P`);
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Pulse);
		expect(decoded.data).toEqual({});
	});

	it("handles empty string values", () => {
		const wire = encode(WireType.Learning, { id: "" });
		expect(wire).toBe(`${PREFIX}|L|id:`);
		const decoded = decode(wire);
		// empty string deserializes back to empty string
		expect(decoded.data.id).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Generic decode
// ---------------------------------------------------------------------------

describe("decode", () => {
	it("decodes a well-formed wire string", () => {
		const wire = `${PREFIX}|C|passed:true|errorCount:0|warningCount:2`;
		const result = decode(wire);
		expect(result.type).toBe(WireType.Check);
		expect(result.data).toEqual({
			passed: true,
			errorCount: 0,
			warningCount: 2,
		});
	});

	it("decodes null values", () => {
		const wire = `${PREFIX}|S|value:null`;
		const result = decode(wire);
		expect(result.data.value).toBeNull();
	});

	it("decodes boolean true", () => {
		const wire = `${PREFIX}|C|passed:true`;
		expect(decode(wire).data.passed).toBe(true);
	});

	it("decodes boolean false", () => {
		const wire = `${PREFIX}|C|passed:false`;
		expect(decode(wire).data.passed).toBe(false);
	});

	it("decodes integer numbers", () => {
		const wire = `${PREFIX}|E|count:42`;
		expect(decode(wire).data.count).toBe(42);
	});

	it("decodes floating-point numbers", () => {
		const wire = `${PREFIX}|S|risk:0.75`;
		expect(decode(wire).data.risk).toBe(0.75);
	});

	it("decodes negative numbers", () => {
		const wire = `${PREFIX}|E|delta:-5`;
		expect(decode(wire).data.delta).toBe(-5);
	});

	it("decodes JSON arrays", () => {
		const wire = `${PREFIX}|S|items:["a","b"]`;
		const result = decode(wire);
		expect(result.data.items).toEqual(["a", "b"]);
	});

	it("decodes JSON objects", () => {
		const wire = `${PREFIX}|S|meta:{"key":"val"}`;
		const result = decode(wire);
		expect(result.data.meta).toEqual({ key: "val" });
	});

	it("decodes plain strings that are not numbers, booleans, or JSON", () => {
		const wire = `${PREFIX}|L|id:learn_xyz`;
		expect(decode(wire).data.id).toBe("learn_xyz");
	});

	it("decodes escaped pipe characters in field values", () => {
		const wire = `${PREFIX}|V|msg:hello\\|world`;
		const result = decode(wire);
		expect(result.data.msg).toBe("hello|world");
	});

	it("decodes a wire string with no data fields", () => {
		const wire = `${PREFIX}|P`;
		const result = decode(wire);
		expect(result.type).toBe(WireType.Pulse);
		expect(result.data).toEqual({});
	});

	it("recognizes all WireType codes", () => {
		for (const typeCode of Object.values(WireType)) {
			const wire = `${PREFIX}|${typeCode}`;
			const result = decode(wire);
			expect(result.type).toBe(typeCode);
		}
	});

	// -------------------------------------------------------------------------
	// Error cases
	// -------------------------------------------------------------------------

	it("throws WireFormatError for missing prefix", () => {
		expect(() => decode("C|passed:true")).toThrow(WireFormatError);
	});

	it("throws WireFormatError for wrong prefix", () => {
		expect(() => decode("WRONG|C|passed:true")).toThrow(WireFormatError);
	});

	it("throws WireFormatError for empty string", () => {
		expect(() => decode("")).toThrow(WireFormatError);
	});

	it("throws WireFormatError for unknown type code", () => {
		expect(() => decode(`${PREFIX}|Z|foo:bar`)).toThrow(WireFormatError);
		expect(() => decode(`${PREFIX}|Z|foo:bar`)).toThrow("Unknown wire type code");
	});

	it("throws WireFormatError for malformed field (no colon)", () => {
		expect(() => decode(`${PREFIX}|S|badfield`)).toThrow(WireFormatError);
		expect(() => decode(`${PREFIX}|S|badfield`)).toThrow("Malformed field");
	});

	it("throws WireFormatError for prefix-only string", () => {
		// Just the prefix, no type code
		expect(() => decode(PREFIX)).toThrow(WireFormatError);
	});

	it("WireFormatError has correct name property", () => {
		try {
			decode("");
		} catch (err) {
			expect(err).toBeInstanceOf(WireFormatError);
			expect((err as WireFormatError).name).toBe("WireFormatError");
		}
	});
});

// ---------------------------------------------------------------------------
// Round-trip fidelity
// ---------------------------------------------------------------------------

describe("round-trip encode -> decode", () => {
	it("preserves string, number, and boolean fields", () => {
		const original = { name: "task_abc", count: 7, active: true };
		const wire = encode(WireType.Snap, original);
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Snap);
		expect(decoded.data).toEqual(original);
	});

	it("preserves null values", () => {
		const original = { value: null };
		const wire = encode(WireType.End, original);
		expect(decode(wire).data.value).toBeNull();
	});

	it("preserves nested array values", () => {
		const original = { list: [1, 2, 3] };
		const wire = encode(WireType.Snap, original);
		expect(decode(wire).data.list).toEqual([1, 2, 3]);
	});

	it("preserves nested object values", () => {
		const original = { config: { a: 1, b: "two" } };
		const wire = encode(WireType.Snap, original);
		expect(decode(wire).data.config).toEqual({ a: 1, b: "two" });
	});

	it("preserves strings containing pipe characters", () => {
		const original = { path: "src|lib|index.ts" };
		const wire = encode(WireType.Learning, original);
		expect(decode(wire).data.path).toBe("src|lib|index.ts");
	});

	it("preserves strings containing colons", () => {
		const original = { time: "12:30:00" };
		const wire = encode(WireType.Snap, original);
		expect(decode(wire).data.time).toBe("12:30:00");
	});

	it("preserves zero and empty string distinctly", () => {
		const wire = encode(WireType.End, { num: 0, str: "" });
		const decoded = decode(wire);
		expect(decoded.data.num).toBe(0);
		expect(decoded.data.str).toBe("");
	});

	it("handles many fields without corruption", () => {
		const original: Record<string, unknown> = {};
		for (let i = 0; i < 20; i++) {
			original[`field${i}`] = i;
		}
		const wire = encode(WireType.Snap, original);
		const decoded = decode(wire);
		expect(decoded.data).toEqual(original);
	});
});

// ---------------------------------------------------------------------------
// Per-type encoder helpers
// ---------------------------------------------------------------------------

describe("encodeSnap", () => {
	it("encodes snap payload with correct type and fields", () => {
		const wire = encodeSnap({
			taskId: "task_001",
			patternCount: 3,
			violationCount: 2,
			riskScore: 0.6,
		});
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Snap);
		expect(decoded.data).toEqual({
			taskId: "task_001",
			patterns: 3,
			violations: 2,
			risk: 0.6,
		});
	});
});

describe("encodeCheck", () => {
	it("encodes check payload with correct type and fields", () => {
		const wire = encodeCheck({
			passed: true,
			errorCount: 0,
			warningCount: 5,
		});
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Check);
		expect(decoded.data).toEqual({
			passed: true,
			errorCount: 0,
			warningCount: 5,
		});
	});

	it("encodes failed check correctly", () => {
		const wire = encodeCheck({
			passed: false,
			errorCount: 3,
			warningCount: 1,
		});
		const decoded = decode(wire);
		expect(decoded.data.passed).toBe(false);
		expect(decoded.data.errorCount).toBe(3);
	});
});

describe("encodeEnd", () => {
	it("encodes end payload with correct type and fields", () => {
		const wire = encodeEnd({
			tokensSaved: 1250,
			mistakesPrevented: 2,
			learningsStored: 3,
		});
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.End);
		expect(decoded.data).toEqual({
			tokensSaved: 1250,
			mistakesPrevented: 2,
			learningsStored: 3,
		});
	});
});

describe("encodeViolation", () => {
	it("encodes violation payload with correct type and fields", () => {
		const wire = encodeViolation({
			count: 2,
			promotionStatus: "tracking",
		});
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Violation);
		expect(decoded.data).toEqual({
			count: 2,
			status: "tracking",
		});
	});
});

describe("encodeLearning", () => {
	it("encodes learning payload with correct type and fields", () => {
		const wire = encodeLearning({ learningId: "learn_xyz789" });
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Learning);
		expect(decoded.data).toEqual({ id: "learn_xyz789" });
	});
});

describe("encodePulse", () => {
	it("encodes pulse payload with correct type and fields", () => {
		const wire = encodePulse({
			status: "healthy",
			serviceCount: 7,
			uptime: 86400,
		});
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Pulse);
		expect(decoded.data).toEqual({
			status: "healthy",
			services: 7,
			uptime: 86400,
		});
	});
});

describe("encodeGraph", () => {
	it("encodes graph payload with correct type and fields", () => {
		const wire = encodeGraph({ nodeCount: 12, edgeCount: 18 });
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Graph);
		expect(decoded.data).toEqual({ nodes: 12, edges: 18 });
	});
});

describe("encodeCache", () => {
	it("encodes cache hit payload correctly", () => {
		const wire = encodeCache({ hit: true, key: "pattern_abc" });
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Cache);
		expect(decoded.data).toEqual({ hit: true, key: "pattern_abc" });
	});

	it("encodes cache miss payload correctly", () => {
		const wire = encodeCache({ hit: false, key: "missing_key" });
		const decoded = decode(wire);
		expect(decoded.data.hit).toBe(false);
	});
});

describe("encodeIntegrate", () => {
	it("encodes integrate payload with correct type and fields", () => {
		const wire = encodeIntegrate({ provider: "github", enriched: true });
		const decoded = decode(wire);
		expect(decoded.type).toBe(WireType.Integrate);
		expect(decoded.data).toEqual({ provider: "github", enriched: true });
	});
});

// ---------------------------------------------------------------------------
// WireType enum coverage
// ---------------------------------------------------------------------------

describe("WireType enum", () => {
	it("contains expected type codes", () => {
		expect(WireType.Snap).toBe("S");
		expect(WireType.Check).toBe("C");
		expect(WireType.End).toBe("E");
		expect(WireType.Violation).toBe("V");
		expect(WireType.Learning).toBe("L");
		expect(WireType.Pulse).toBe("P");
		expect(WireType.Graph).toBe("G");
		expect(WireType.Cache).toBe("X");
		expect(WireType.Integrate).toBe("I");
	});

	it("has exactly 9 members", () => {
		expect(Object.values(WireType)).toHaveLength(9);
	});
});
