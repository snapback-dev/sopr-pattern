/**
 * Graceful Degradation
 *
 * Wraps external calls so that failures return a fallback value instead of
 * propagating exceptions. This keeps non-critical paths from taking down
 * the request when an upstream dependency is unavailable.
 *
 * Also defines the shared {@link Logger} interface that all resilience
 * utilities (and consuming services) may depend on, plus a lightweight
 * {@link ConsoleLogger} implementation for development and testing.
 *
 * Design constraints:
 *   - Pure wrapper function (no module-level state).
 *   - Default fallback is `null`, making the return type `TOutput | null`.
 *   - Errors are always logged when a logger is provided.
 *
 * @module resilience/graceful
 */

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Minimal structured logging interface.
 *
 * Services depend on this abstraction rather than a concrete logger so that
 * the resilience layer is decoupled from any particular logging library.
 */
export interface Logger {
	debug(message: string, meta?: Record<string, unknown>): void;
	info(message: string, meta?: Record<string, unknown>): void;
	warn(message: string, meta?: Record<string, unknown>): void;
	error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Console-based {@link Logger} implementation.
 *
 * Suitable for development, tests, and simple deployments. Production
 * systems should substitute a structured JSON logger (e.g. pino, winston).
 */
export class ConsoleLogger implements Logger {
	private readonly prefix: string;

	/**
	 * @param prefix - An optional string prepended to every log line
	 *                 (e.g. the service or module name).
	 */
	constructor(prefix = "") {
		this.prefix = prefix ? `[${prefix}] ` : "";
	}

	debug(_message: string, _meta?: Record<string, unknown>): void {}

	info(_message: string, _meta?: Record<string, unknown>): void {}

	warn(message: string, meta?: Record<string, unknown>): void {
		console.warn(`${this.prefix}${message}`, meta ?? "");
	}

	error(message: string, meta?: Record<string, unknown>): void {
		console.error(`${this.prefix}${message}`, meta ?? "");
	}
}

// ---------------------------------------------------------------------------
// Graceful degradation options
// ---------------------------------------------------------------------------

/** Options for {@link withGracefulDegradation}. */
export interface GracefulDegradationOptions<TOutput> {
	/** Logger to receive error reports when the wrapped function fails. */
	logger?: Logger;
	/**
	 * A static fallback value to return on failure instead of `null`.
	 * When provided the return type narrows from `TOutput | null` to `TOutput`.
	 */
	fallback?: TOutput;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Wrap an async function so that it returns a fallback value on failure
 * rather than throwing.
 *
 * This is the simplest resilience pattern: it converts hard failures into
 * soft degradation. Combine it with circuit breakers and retries (via
 * {@link withResilience}) for a layered defence.
 *
 * @param fn      - The async function to protect.
 * @param options - Optional logger and/or fallback value.
 * @returns A new function with the same signature that never throws.
 *
 * @example
 * ```ts
 * const safeFetch = withGracefulDegradation(
 *   async (url: string) => fetch(url).then(r => r.json()),
 *   { logger: new ConsoleLogger("http"), fallback: [] },
 * );
 *
 * const data = await safeFetch("https://api.example.com/items");
 * // `data` is the JSON array on success, or `[]` on any failure.
 * ```
 */
export function withGracefulDegradation<TInput, TOutput>(
	fn: (input: TInput) => Promise<TOutput>,
	options?: GracefulDegradationOptions<TOutput>,
): (input: TInput) => Promise<TOutput | null> {
	const logger = options?.logger;
	const fallbackValue = options?.fallback ?? null;

	return async (input: TInput): Promise<TOutput | null> => {
		try {
			return await fn(input);
		} catch (error: unknown) {
			if (logger) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Graceful degradation: returning fallback", {
					error: message,
					fallback: fallbackValue === null ? "null" : typeof fallbackValue,
				});
			}
			return fallbackValue;
		}
	};
}
