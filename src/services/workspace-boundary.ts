/**
 * Workspace Boundary Enforcement
 *
 * Validates that file paths stay within the workspace root directory.
 * All checks are synchronous and do not resolve symlinks — this is a
 * pure path-string boundary guard suitable for use everywhere without
 * async overhead.
 *
 * @module services/workspace-boundary
 */

import { resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** System directories that must never be used as a workspace root. */
const FORBIDDEN_ROOTS: readonly string[] = ["/", "/etc", "/root", "/var", "/usr", "/bin", "/sbin"];

// ---------------------------------------------------------------------------
// Standalone helper
// ---------------------------------------------------------------------------

/**
 * Validate a candidate workspace root path.
 *
 * The path must be absolute and must not point at a sensitive system
 * directory. Returns the resolved (normalised) path on success.
 *
 * @param candidate - The workspace root path to validate.
 * @returns The resolved absolute path.
 * @throws {Error} If the path is not absolute or targets a system directory.
 */
export function validateWorkspacePath(candidate: string): string {
  const resolved = resolve(candidate);

  if (resolved !== candidate && !candidate.startsWith("/") && !candidate.startsWith("\\")) {
    throw new Error(`Workspace path must be absolute: ${candidate}`);
  }

  if (FORBIDDEN_ROOTS.includes(resolved)) {
    throw new Error(`Workspace path must not be a system directory: ${resolved}`);
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// WorkspaceBoundary
// ---------------------------------------------------------------------------

/**
 * Enforces that resolved file paths remain within a workspace root.
 *
 * Performs null-byte rejection, argument-injection prevention (paths
 * starting with `-`), and prefix-based containment checks using
 * platform-aware separators.
 */
export class WorkspaceBoundary {
  /** Resolved absolute workspace root (always ends without a trailing separator). */
  private readonly root: string;

  /**
   * @param workspacePath - Absolute path to the workspace root directory.
   */
  constructor(workspacePath: string) {
    this.root = resolve(workspacePath);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Resolve a relative path against the workspace root and verify containment.
   *
   * @param relativePath - Path relative to the workspace root.
   * @returns The resolved absolute path.
   * @throws {Error} If the path escapes the workspace or is otherwise invalid.
   */
  resolve(relativePath: string): string {
    this.assertSafe(relativePath);

    const resolved = resolve(this.root, relativePath);

    if (!this.isWithin(resolved)) {
      throw new Error(`Path escapes workspace boundary: ${relativePath}`);
    }

    return resolved;
  }

  /**
   * Resolve an array of relative paths, validating each one.
   *
   * @param paths - Relative paths to resolve.
   * @returns Array of resolved absolute paths.
   * @throws {Error} If any path escapes the workspace or is invalid.
   */
  resolveMany(paths: readonly string[]): string[] {
    return paths.map((p) => this.resolve(p));
  }

  /**
   * Check whether an absolute path falls within the workspace root.
   *
   * @param absolutePath - The absolute path to test.
   * @returns `true` if the path is inside (or equal to) the workspace root.
   */
  contains(absolutePath: string): boolean {
    try {
      this.assertSafe(absolutePath);
    } catch {
      return false;
    }

    const normalised = resolve(absolutePath);
    return this.isWithin(normalised);
  }

  /**
   * Non-throwing check for a relative path.
   *
   * @param path - A relative path to validate.
   * @returns `true` if `resolve(path)` would succeed without throwing.
   */
  isValidRelative(path: string): boolean {
    try {
      this.resolve(path);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Reject obviously malicious path inputs before any resolution takes place.
   *
   * @param candidate - Raw path string to validate.
   * @throws {Error} On null bytes or leading dashes.
   */
  private assertSafe(candidate: string): void {
    if (candidate.includes("\0")) {
      throw new Error("Path must not contain null bytes");
    }

    if (candidate.startsWith("-")) {
      throw new Error("Path must not start with a dash (argument injection prevention)");
    }
  }

  /**
   * Check whether a normalised absolute path is within the workspace root.
   * A path is "within" if it equals the root or starts with root + separator.
   */
  private isWithin(normalised: string): boolean {
    return normalised === this.root || normalised.startsWith(this.root + sep);
  }
}
