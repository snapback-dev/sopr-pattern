/**
 * Storage Adapter Interface and In-Memory Implementation
 *
 * Provides a pluggable storage abstraction that services use for
 * persistence. The in-memory implementation is suitable for development
 * and testing; swap to disk or database adapters for production.
 *
 * @module services/adapters
 */

// ---------------------------------------------------------------------------
// Storage Adapter Interface
// ---------------------------------------------------------------------------

/**
 * Generic key-value storage abstraction.
 *
 * All services that need persistence depend on this interface rather than
 * concrete storage mechanisms. This allows swapping backends (memory, disk,
 * SQLite, Redis) without changing service logic.
 */
export interface StorageAdapter {
  /** Read a value by key. Returns null if the key does not exist. */
  read(key: string): Promise<string | null>;

  /** Write a value for a key. Overwrites any existing value. */
  write(key: string, data: string): Promise<void>;

  /** Delete a key. Returns true if the key existed, false otherwise. */
  delete(key: string): Promise<boolean>;

  /** List all keys, optionally filtered by prefix. */
  list(prefix?: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// In-Memory Storage Implementation
// ---------------------------------------------------------------------------

/**
 * In-memory storage backed by a Map.
 *
 * Suitable for development, testing, and single-process deployments.
 * Data is lost on process restart. Thread-safe within a single
 * Node.js event loop (no concurrent writes to worry about).
 */
export class InMemoryStorage implements StorageAdapter {
  private readonly store = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async write(key: string, data: string): Promise<void> {
    this.store.set(key, data);
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = [];
    for (const key of this.store.keys()) {
      if (prefix === undefined || key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }

  /** Returns the current number of stored entries. For testing/diagnostics. */
  get size(): number {
    return this.store.size;
  }

  /** Clear all entries. For testing. */
  clear(): void {
    this.store.clear();
  }
}
