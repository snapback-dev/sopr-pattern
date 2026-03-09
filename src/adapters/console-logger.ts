/**
 * Console Logger — Default implementation that logs to stderr.
 *
 * Provides a simple console-based logging implementation for standalone
 * use. In MCP mode, replace with a logger that sends logs via the protocol.
 *
 * @module adapters/console-logger
 */

import type { ContextLogger, LogContext } from "../contracts/context.js";

/**
 * Console-based logger implementation.
 *
 * Logs warnings and errors to stderr. Debug and info are suppressed
 * by default to keep output clean.
 *
 * @example
 * ```ts
 * import { ConsoleLoggerAdapter } from "@snapback-oss/sopr-mcp";
 *
 * const logger = new ConsoleLoggerAdapter("my-server");
 * logger.warn("Connection retrying", { attempt: 3 });
 * // stderr: [my-server] WARN: Connection retrying { attempt: 3 }
 * ```
 */
export class ConsoleLoggerAdapter implements ContextLogger {
	private readonly prefix: string;

	constructor(prefix = "") {
		this.prefix = prefix ? `[${prefix}] ` : "";
	}

	debug(_message: string, _context?: LogContext): void {
		// Suppressed by default for production use
	}

	info(_message: string, _context?: LogContext): void {
		// Suppressed by default for production use
	}

	warn(message: string, context?: LogContext): void {
		console.warn(`${this.prefix}WARN: ${message}`, context ?? "");
	}

	error(message: string, context?: LogContext): void {
		console.error(`${this.prefix}ERROR: ${message}`, context ?? "");
	}
}
