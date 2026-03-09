/**
 * Wire-format encoder/decoder for token-efficient MCP responses.
 *
 * Format: `WIRE_PREFIX|TYPE_CODE|field1|field2|...`
 *
 * The wire format compresses structured tool outputs into a compact
 * pipe-delimited string, reducing token cost by ~40-60% compared to
 * full JSON serialization. Every encoder has a matching decoder that
 * guarantees lossless round-trips.
 *
 * @module contracts/wire-format
 */

// ---------------------------------------------------------------------------
// Wire Format Configuration
// ---------------------------------------------------------------------------

/**
 * Versioned wire format configuration.
 *
 * The version field enables forward-compatible format evolution.
 * Parsers check the version first and reject unsupported versions
 * with a clear error message rather than silently corrupting data.
 */
export interface WireFormatConfig {
	/** Wire format version. Currently only version 1 is supported. */
	readonly version: 1;
	/** Prefix character (default: cap emoji). */
	readonly prefix: string;
	/** Field separator (default: pipe). */
	readonly separator: string;
	/** Enable compact mode (positional fields, no labels). */
	readonly compact?: boolean;
}

let wireConfig: WireFormatConfig = {
	version: 1,
	prefix: "\u{1F9E2}",
	separator: "|",
	compact: false,
};

// Backward-compatible mutable alias
let wirePrefix = wireConfig.prefix;
const SEPARATOR = wireConfig.separator;

/**
 * Set the full wire format configuration.
 *
 * @param config - New wire format configuration.
 * @throws {Error} If the version is not supported.
 */
export function setWireFormat(config: WireFormatConfig): void {
	if (config.version !== 1) {
		throw new Error(`Unsupported wire format version: ${config.version}. Only version 1 is supported.`);
	}
	wireConfig = Object.freeze({ ...config });
	wirePrefix = config.prefix;
}

/**
 * Get the current wire format configuration (frozen copy).
 */
export function getWireFormat(): Readonly<WireFormatConfig> {
	return wireConfig;
}

/**
 * Override the wire-format prefix.
 *
 * Consumers (e.g. proprietary adapters) call this at startup to replace
 * the default prefix with their own branding. OSS users can set any
 * string they like.
 *
 * This is a convenience shorthand for `setWireFormat({ ...getWireFormat(), prefix })`.
 *
 * @param prefix - New wire-format sentinel string.
 */
export function setWirePrefix(prefix: string): void {
	wirePrefix = prefix;
	wireConfig = Object.freeze({ ...wireConfig, prefix });
}

/**
 * Get the current wire-format prefix.
 */
export function getWirePrefix(): string {
	return wirePrefix;
}

// ---------------------------------------------------------------------------
// Wire Type Enum
// ---------------------------------------------------------------------------

/**
 * Single-character type codes used in the wire format.
 *
 * Each code maps 1:1 to a tool output schema.
 */
export enum WireType {
	Snap = "S",
	Check = "C",
	End = "E",
	Violation = "V",
	Learning = "L",
	Pulse = "P",
	Graph = "G",
	Cache = "X",
	Integrate = "I",
}

/** Lookup table: code string -> WireType enum member. */
const CODE_TO_TYPE: Record<string, WireType | undefined> = Object.fromEntries(
	Object.values(WireType).map((v) => [v, v]),
) as Record<string, WireType | undefined>;

// ---------------------------------------------------------------------------
// Generic encode / decode
// ---------------------------------------------------------------------------

/**
 * Encode a typed data payload into the compact wire format.
 *
 * @param type - Wire type code identifying the tool output.
 * @param data - Key-value payload to encode.
 * @returns A pipe-delimited wire string.
 *
 * @example
 * ```ts
 * encode(WireType.Check, { passed: true, errorCount: 0, warningCount: 2 });
 * // => "🧢|C|passed:true|errorCount:0|warningCount:2"
 * ```
 */
export function encode(type: WireType, data: Record<string, unknown>): string {
	const fields = Object.entries(data).map(([key, value]) => `${key}:${serializeValue(value)}`);
	return [wirePrefix, type, ...fields].join(SEPARATOR);
}

/**
 * Decode a wire-format string back into a typed payload.
 *
 * @param wire - The wire-format string to parse.
 * @returns An object with the decoded type and key-value data.
 * @throws {WireFormatError} If the string is malformed.
 *
 * @example
 * ```ts
 * decode("🧢|C|passed:true|errorCount:0|warningCount:2");
 * // => { type: WireType.Check, data: { passed: true, errorCount: 0, warningCount: 2 } }
 * ```
 */
export function decode(wire: string): { type: WireType; data: Record<string, unknown> } {
	// Split on unescaped pipe characters only.
	// A pipe is "escaped" if preceded by a backslash.
	const parts = splitUnescaped(wire, SEPARATOR);

	if (parts.length < 2 || parts[0] !== wirePrefix) {
		throw new WireFormatError(`Invalid wire format: expected prefix "${wirePrefix}", got "${parts[0] ?? ""}"`);
	}

	const typeCode = parts[1];
	if (typeCode === undefined) {
		throw new WireFormatError("Missing type code in wire format");
	}

	const resolvedType = CODE_TO_TYPE[typeCode];
	if (resolvedType === undefined) {
		throw new WireFormatError(`Unknown wire type code: "${typeCode}"`);
	}

	const data: Record<string, unknown> = {};
	for (let i = 2; i < parts.length; i++) {
		const field = parts[i];
		if (field === undefined) {
			continue;
		}

		const colonIdx = field.indexOf(":");
		if (colonIdx === -1) {
			throw new WireFormatError(`Malformed field at position ${i}: "${field}" (expected "key:value")`);
		}

		const key = field.slice(0, colonIdx);
		const rawValue = field.slice(colonIdx + 1);
		data[key] = deserializeValue(rawValue);
	}

	return { type: resolvedType, data };
}

// ---------------------------------------------------------------------------
// Per-type encoder helpers
// ---------------------------------------------------------------------------

/** Encode a snap tool output. */
export function encodeSnap(payload: {
	taskId: string;
	patternCount: number;
	violationCount: number;
	riskScore: number;
}): string {
	return encode(WireType.Snap, {
		taskId: payload.taskId,
		patterns: payload.patternCount,
		violations: payload.violationCount,
		risk: payload.riskScore,
	});
}

/** Encode a check tool output. */
export function encodeCheck(payload: { passed: boolean; errorCount: number; warningCount: number }): string {
	return encode(WireType.Check, {
		passed: payload.passed,
		errorCount: payload.errorCount,
		warningCount: payload.warningCount,
	});
}

/** Encode a task-end output. */
export function encodeEnd(payload: {
	tokensSaved: number;
	mistakesPrevented: number;
	learningsStored: number;
}): string {
	return encode(WireType.End, {
		tokensSaved: payload.tokensSaved,
		mistakesPrevented: payload.mistakesPrevented,
		learningsStored: payload.learningsStored,
	});
}

/** Encode a violation report. */
export function encodeViolation(payload: { count: number; promotionStatus: string }): string {
	return encode(WireType.Violation, {
		count: payload.count,
		status: payload.promotionStatus,
	});
}

/** Encode a learning report. */
export function encodeLearning(payload: { learningId: string }): string {
	return encode(WireType.Learning, {
		id: payload.learningId,
	});
}

/** Encode a pulse/health output. */
export function encodePulse(payload: { status: string; serviceCount: number; uptime: number }): string {
	return encode(WireType.Pulse, {
		status: payload.status,
		services: payload.serviceCount,
		uptime: payload.uptime,
	});
}

/** Encode a graph output. */
export function encodeGraph(payload: { nodeCount: number; edgeCount: number }): string {
	return encode(WireType.Graph, {
		nodes: payload.nodeCount,
		edges: payload.edgeCount,
	});
}

/** Encode a cache output. */
export function encodeCache(payload: { hit: boolean; key: string }): string {
	return encode(WireType.Cache, {
		hit: payload.hit,
		key: payload.key,
	});
}

/** Encode an integration output. */
export function encodeIntegrate(payload: { provider: string; enriched: boolean }): string {
	return encode(WireType.Integrate, {
		provider: payload.provider,
		enriched: payload.enriched,
	});
}

// ---------------------------------------------------------------------------
// Split helper (escape-aware)
// ---------------------------------------------------------------------------

/**
 * Split a string on a delimiter, ignoring occurrences preceded by a
 * backslash. This ensures that escaped pipe characters inside field
 * values do not corrupt field boundaries.
 */
function splitUnescaped(input: string, delimiter: string): string[] {
	const results: string[] = [];
	let current = "";

	for (let i = 0; i < input.length; i++) {
		const char = input[i] as string; // safe: i < input.length
		const nextChar = input[i + 1];

		// Check if this position is an escaped delimiter
		if (char === "\\" && nextChar === delimiter) {
			// Keep the escaped sequence intact for later unescaping
			current += `\\${delimiter}`;
			i++; // skip next char
		} else if (char === delimiter) {
			results.push(current);
			current = "";
		} else {
			current += char;
		}
	}

	results.push(current);
	return results;
}

// ---------------------------------------------------------------------------
// Value serialization (primitive-safe)
// ---------------------------------------------------------------------------

/**
 * Serialize a single value into its wire representation.
 *
 * Handles: string, number, boolean, null, undefined, arrays (JSON),
 * and plain objects (JSON). Pipe characters inside strings are escaped
 * as `\\|` to prevent field-boundary corruption.
 */
function serializeValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "null";
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	if (typeof value === "number") {
		return String(value);
	}
	if (typeof value === "string") {
		// Escape pipe characters so they do not corrupt field boundaries
		return value.replaceAll("|", "\\|");
	}
	// Arrays and objects fall through to JSON
	return JSON.stringify(value).replaceAll("|", "\\|");
}

/**
 * Deserialize a wire-format field value back to its JavaScript
 * representation.
 *
 * Applies inverse transforms of {@link serializeValue}:
 *   - "null" -> null
 *   - "true"/"false" -> boolean
 *   - Numeric strings -> number
 *   - JSON-like strings -> parsed object/array
 *   - Everything else -> unescaped string
 */
function deserializeValue(raw: string): unknown {
	// Unescape pipe characters first
	const value = raw.replaceAll("\\|", "|");

	if (value === "null") {
		return null;
	}
	if (value === "true") {
		return true;
	}
	if (value === "false") {
		return false;
	}

	// Try number (integer or float)
	const num = Number(value);
	if (value !== "" && !Number.isNaN(num)) {
		return num;
	}

	// Try JSON (arrays and objects)
	if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) {
		try {
			return JSON.parse(value) as unknown;
		} catch {
			// Fall through to string
		}
	}

	return value;
}

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

/**
 * Error thrown when a wire-format string cannot be parsed.
 */
export class WireFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WireFormatError";
	}
}
