/**
 * Cache Service Implementation
 *
 * Provides an in-memory LRU-style cache for error diagnostics and
 * pattern matches. Caches are workspace-scoped and support both
 * retrieval and forced refresh.
 *
 * Stateless: cache state is internal to the instance but contains no
 * external side effects. The service can be recreated cleanly.
 *
 * @module services/cache-service
 */

import type {
	CachedError,
	CachedPattern,
	ErrorCacheInput,
	ErrorCacheResult,
	ICacheService,
	PatternCacheInput,
	PatternCacheResult,
	ServiceResult,
} from "../contracts/services.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CacheServiceConfig {
	/** Maximum number of entries per cache namespace. */
	readonly maxEntries: number;
	/** Time-to-live in milliseconds before entries are considered stale. */
	readonly ttlMs: number;
}

const DEFAULT_CONFIG: CacheServiceConfig = {
	maxEntries: 500,
	ttlMs: 5 * 60 * 1000, // 5 minutes
};

// ---------------------------------------------------------------------------
// Internal LRU Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
	value: T;
	insertedAt: number;
	accessedAt: number;
}

class LRUCache<T> {
	private readonly entries = new Map<string, CacheEntry<T>>();

	constructor(
		private readonly maxSize: number,
		private readonly ttlMs: number,
	) {}

	get(key: string): CacheEntry<T> | undefined {
		const entry = this.entries.get(key);
		if (!entry) {
			return undefined;
		}

		// Update access time for LRU tracking
		entry.accessedAt = Date.now();
		return entry;
	}

	set(key: string, value: T): void {
		// Evict if at capacity
		if (this.entries.size >= this.maxSize && !this.entries.has(key)) {
			this.evictOldest();
		}

		this.entries.set(key, {
			value,
			insertedAt: Date.now(),
			accessedAt: Date.now(),
		});
	}

	delete(key: string): boolean {
		return this.entries.delete(key);
	}

	isStale(entry: CacheEntry<T>): boolean {
		return Date.now() - entry.insertedAt > this.ttlMs;
	}

	clear(): void {
		this.entries.clear();
	}

	clearByPrefix(prefix: string): void {
		for (const key of this.entries.keys()) {
			if (key.startsWith(prefix)) {
				this.entries.delete(key);
			}
		}
	}

	getAllByPrefix(prefix: string): Array<{ key: string; entry: CacheEntry<T> }> {
		const results: Array<{ key: string; entry: CacheEntry<T> }> = [];
		for (const [key, entry] of this.entries) {
			if (key.startsWith(prefix)) {
				results.push({ key, entry });
			}
		}
		return results;
	}

	get size(): number {
		return this.entries.size;
	}

	private evictOldest(): void {
		let oldestKey: string | null = null;
		let oldestAccess = Number.POSITIVE_INFINITY;

		for (const [key, entry] of this.entries) {
			if (entry.accessedAt < oldestAccess) {
				oldestAccess = entry.accessedAt;
				oldestKey = key;
			}
		}

		if (oldestKey) {
			this.entries.delete(oldestKey);
		}
	}
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class CacheServiceImpl implements ICacheService {
	private readonly config: CacheServiceConfig;
	private readonly errorCache: LRUCache<CachedError>;
	private readonly patternCache: LRUCache<CachedPattern>;

	constructor(
		config: Partial<CacheServiceConfig>,
		private readonly logger: Logger,
	) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.errorCache = new LRUCache<CachedError>(this.config.maxEntries, this.config.ttlMs);
		this.patternCache = new LRUCache<CachedPattern>(this.config.maxEntries, this.config.ttlMs);
	}

	async getErrors(input: ErrorCacheInput): Promise<ServiceResult<ErrorCacheResult>> {
		try {
			const prefix = `error:${input.workspacePath}:`;

			// If refresh requested, clear existing cache for this workspace
			if (input.refresh) {
				this.errorCache.clearByPrefix(prefix);
				this.logger.debug("Error cache cleared for refresh", {
					workspace: input.workspacePath,
				});
			}

			const entries = this.errorCache.getAllByPrefix(prefix);
			const limit = input.limit ?? this.config.maxEntries;

			// Determine staleness based on oldest entry
			let oldestInsert = Date.now();
			const errors: CachedError[] = [];

			for (const { entry } of entries) {
				if (entry.insertedAt < oldestInsert) {
					oldestInsert = entry.insertedAt;
				}
				errors.push(entry.value);
			}

			const cacheAge = errors.length > 0 ? Date.now() - oldestInsert : 0;
			const stale = errors.length > 0 && cacheAge > this.config.ttlMs;

			// Sort by occurrence count (most frequent first)
			errors.sort((a, b) => b.occurrences - a.occurrences);

			const limitedErrors = errors.slice(0, limit);

			this.logger.debug("Error cache retrieved", {
				workspace: input.workspacePath,
				total: errors.length,
				stale,
			});

			return {
				ok: true,
				data: {
					errors: limitedErrors,
					totalCached: errors.length,
					cacheAge,
					stale,
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error("Failed to get cached errors", { error: message });
			return { ok: false, error: message, code: "CACHE_ERROR_FAILED" };
		}
	}

	async getPatterns(input: PatternCacheInput): Promise<ServiceResult<PatternCacheResult>> {
		try {
			const prefix = `pattern:${input.workspacePath}:`;

			if (input.refresh) {
				this.patternCache.clearByPrefix(prefix);
				this.logger.debug("Pattern cache cleared for refresh", {
					workspace: input.workspacePath,
				});
			}

			const entries = this.patternCache.getAllByPrefix(prefix);

			let oldestInsert = Date.now();
			let patterns: CachedPattern[] = [];

			for (const { entry } of entries) {
				if (entry.insertedAt < oldestInsert) {
					oldestInsert = entry.insertedAt;
				}
				patterns.push(entry.value);
			}

			// Filter by pattern name if specified
			if (input.patternFilter) {
				const filterLower = input.patternFilter.toLowerCase();
				patterns = patterns.filter((p) => p.patternName.toLowerCase().includes(filterLower));
			}

			const cacheAge = patterns.length > 0 ? Date.now() - oldestInsert : 0;
			const stale = patterns.length > 0 && cacheAge > this.config.ttlMs;

			// Sort by match count (most matches first)
			patterns.sort((a, b) => b.matchCount - a.matchCount);

			this.logger.debug("Pattern cache retrieved", {
				workspace: input.workspacePath,
				total: patterns.length,
				stale,
			});

			return {
				ok: true,
				data: {
					patterns,
					totalCached: patterns.length,
					cacheAge,
					stale,
				},
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			this.logger.error("Failed to get cached patterns", { error: message });
			return { ok: false, error: message, code: "CACHE_PATTERN_FAILED" };
		}
	}

	async invalidate(workspacePath: string): Promise<void> {
		this.errorCache.clearByPrefix(`error:${workspacePath}:`);
		this.patternCache.clearByPrefix(`pattern:${workspacePath}:`);
		this.logger.info("Cache invalidated", { workspace: workspacePath });
	}
}
