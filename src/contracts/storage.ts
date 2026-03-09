/**
 * IStorage — Port interface for key-value persistence.
 *
 * Services and adapters depend on this interface rather than concrete
 * storage mechanisms. Swap backends (memory, disk, SQLite, Redis)
 * without changing consumer logic.
 *
 * @module contracts/storage
 */

// ---------------------------------------------------------------------------
// IStorage Interface
// ---------------------------------------------------------------------------

/**
 * Generic key-value storage abstraction.
 *
 * All layers that need persistence depend on this interface.
 * Implementations provide the actual storage backend.
 *
 * @example
 * ```ts
 * // In-memory implementation (ships with OSS core)
 * class InMemoryStorage implements IStorage {
 *   private store = new Map<string, string>();
 *   async get(key: string) { return this.store.get(key) ?? null; }
 *   async set(key: string, value: string) { this.store.set(key, value); }
 *   async delete(key: string) { this.store.delete(key); }
 *   async list(prefix?: string) {
 *     return [...this.store.keys()].filter(k => !prefix || k.startsWith(prefix));
 *   }
 * }
 * ```
 */
export interface IStorage {
	/** Read a value by key. Returns null if the key does not exist. */
	get(key: string): Promise<string | null>;

	/** Write a value for a key. Overwrites any existing value. */
	set(key: string, value: string): Promise<void>;

	/** Delete a key. */
	delete(key: string): Promise<void>;

	/** List all keys, optionally filtered by prefix. */
	list(prefix?: string): Promise<string[]>;
}
