/**
 * In-Memory Storage — Default implementation backed by a Map.
 *
 * Suitable for development, testing, and single-process deployments.
 * Data is lost on process restart. Replace with SQLite, Redis, or
 * filesystem adapters for production persistence.
 *
 * @module adapters/in-memory-storage
 */

import type { IStorage } from "../contracts/storage.js";

/**
 * In-memory key-value storage backed by a Map.
 *
 * Thread-safe within a single Node.js event loop (no concurrent writes).
 *
 * @example
 * ```ts
 * import { InMemoryStorage } from "@snapback-oss/sopr-mcp";
 *
 * const storage = new InMemoryStorage();
 * await storage.set("key", "value");
 * const value = await storage.get("key"); // "value"
 * ```
 */
export class InMemoryStorage implements IStorage {
	private readonly store = new Map<string, string>();

	async get(key: string): Promise<string | null> {
		return this.store.get(key) ?? null;
	}

	async set(key: string, value: string): Promise<void> {
		this.store.set(key, value);
	}

	async delete(key: string): Promise<void> {
		this.store.delete(key);
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
