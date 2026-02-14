/**
 * Logger Interface for Services
 *
 * Minimal logging abstraction that services depend on. This keeps
 * services decoupled from any specific logging library. The console
 * implementation is the default; production can swap in structured
 * loggers (pino, winston, etc.) via constructor injection.
 *
 * @module services/logger
 */

// ---------------------------------------------------------------------------
// Logger Interface
// ---------------------------------------------------------------------------

/** Structured log context fields. */
export type LogContext = Readonly<Record<string, unknown>>;

/**
 * Minimal logger contract for service-layer use.
 *
 * All services accept this via constructor injection. The interface
 * is intentionally small to keep implementations simple.
 */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

// ---------------------------------------------------------------------------
// Console Logger Implementation
// ---------------------------------------------------------------------------

/**
 * Simple console-based logger.
 *
 * Prefixes messages with a timestamp and log level. Suitable for
 * development and testing. Production should use a structured logger.
 */
export class ConsoleLogger implements Logger {
  constructor(private readonly prefix: string = "") {}

  debug(message: string, context?: LogContext): void {
    this.log("DEBUG", message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log("INFO", message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log("WARN", message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log("ERROR", message, context);
  }

  private log(level: string, message: string, context?: LogContext): void {
    const ts = new Date().toISOString();
    const tag = this.prefix ? `[${this.prefix}]` : "";
    const ctx = context ? ` ${JSON.stringify(context)}` : "";
    // Using console methods mapped to level for proper stderr/stdout routing
    switch (level) {
      case "ERROR":
        console.error(`${ts} ${level} ${tag} ${message}${ctx}`);
        break;
      case "WARN":
        console.warn(`${ts} ${level} ${tag} ${message}${ctx}`);
        break;
      case "DEBUG":
        break;
      default:
    }
  }
}

// ---------------------------------------------------------------------------
// No-Op Logger (for testing)
// ---------------------------------------------------------------------------

/** Silent logger that discards all messages. Useful in tests. */
export class NoOpLogger implements Logger {
  debug(_message: string, _context?: LogContext): void {
    /* intentionally empty */
  }
  info(_message: string, _context?: LogContext): void {
    /* intentionally empty */
  }
  warn(_message: string, _context?: LogContext): void {
    /* intentionally empty */
  }
  error(_message: string, _context?: LogContext): void {
    /* intentionally empty */
  }
}
