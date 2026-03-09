/**
 * Resilience layer unit tests.
 *
 * Validates the four core resilience primitives:
 *   - withRetry        -- exponential-backoff retry
 *   - BreakerRegistry  -- circuit breaker (wraps opossum)
 *   - ConcurrencyLimiter -- semaphore-based concurrency control
 *   - withResilience    -- composition of all strategies
 *
 * @module tests/unit/resilience
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type BreakerRegistry, createBreakerRegistry } from "../../src/resilience/circuit-breaker.js";
import { withResilience } from "../../src/resilience/compose.js";
import { ConcurrencyLimiter } from "../../src/resilience/concurrency-limiter.js";
import { withRetry } from "../../src/resilience/retry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates an async function that fails `n` times then succeeds. */
function failNTimes(n: number, result = "ok") {
	let calls = 0;
	return vi.fn(async () => {
		calls++;
		if (calls <= n) {
			throw new Error(`transient failure #${calls}`);
		}
		return result;
	});
}

/** Creates a deferred promise that can be resolved/rejected externally. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** A short delay helper for tests that need to yield the event loop. */
const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Prevent an unhandled rejection warning on a promise that is expected to
 * reject. The rejection is still observable via the returned reference.
 */
function muteUnhandled<T>(p: Promise<T>): Promise<T> {
	p.catch(() => {});
	return p;
}

// ===========================================================================
// 1. withRetry
// ===========================================================================

describe("withRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// -------------------------------------------------------------------------
	// Happy path
	// -------------------------------------------------------------------------

	it("returns the value on first successful execution", async () => {
		const fn = vi.fn(async () => 42);

		const result = await withRetry(fn, {
			maxRetries: 3,
			baseDelayMs: 100,
			maxDelayMs: 1000,
			jitter: false,
		});

		expect(result).toBe(42);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	// -------------------------------------------------------------------------
	// Retry on transient failure
	// -------------------------------------------------------------------------

	it("retries and succeeds after transient failures", async () => {
		const fn = failNTimes(2, "recovered");

		const promise = withRetry(fn, {
			maxRetries: 3,
			baseDelayMs: 100,
			maxDelayMs: 10000,
			jitter: false,
		});

		// First call fails immediately, then we need to advance through the delays.
		// Attempt 0 fails -> delay = 100ms (100 * 2^0)
		await vi.advanceTimersByTimeAsync(100);
		// Attempt 1 fails -> delay = 200ms (100 * 2^1)
		await vi.advanceTimersByTimeAsync(200);
		// Attempt 2 succeeds

		const result = await promise;
		expect(result).toBe("recovered");
		expect(fn).toHaveBeenCalledTimes(3);
	});

	// -------------------------------------------------------------------------
	// Max retries exhausted
	// -------------------------------------------------------------------------

	it("throws the last error when all retries are exhausted", async () => {
		const fn = failNTimes(10, "never");

		// Attach a no-op catch immediately to avoid unhandled rejection warnings;
		// the rejection is still asserted below via `rejects.toThrow`.
		const promise = muteUnhandled(
			withRetry(fn, {
				maxRetries: 2,
				baseDelayMs: 50,
				maxDelayMs: 5000,
				jitter: false,
			}),
		);

		// Attempt 0 fails -> delay 50ms
		await vi.advanceTimersByTimeAsync(50);
		// Attempt 1 fails -> delay 100ms
		await vi.advanceTimersByTimeAsync(100);
		// Attempt 2 fails -> no more retries, throws

		await expect(promise).rejects.toThrow("transient failure #3");
		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	// -------------------------------------------------------------------------
	// Exponential backoff timing
	// -------------------------------------------------------------------------

	it("applies exponential backoff delays between retries", async () => {
		const fn = failNTimes(3, "done");
		const timeouts: number[] = [];

		// Spy on setTimeout to capture the delay values.
		const origSetTimeout = globalThis.setTimeout;
		const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
			// @ts-expect-error -- simplified mock for capturing delay args
			(callback: () => void, ms?: number) => {
				if (ms !== undefined && ms > 0) {
					timeouts.push(ms);
				}
				return origSetTimeout(callback, ms);
			},
		);

		const promise = withRetry(fn, {
			maxRetries: 3,
			baseDelayMs: 100,
			maxDelayMs: 10000,
			jitter: false,
		});

		// Advance through each backoff period.
		// attempt 0 fails -> delay = 100 * 2^0 = 100
		await vi.advanceTimersByTimeAsync(100);
		// attempt 1 fails -> delay = 100 * 2^1 = 200
		await vi.advanceTimersByTimeAsync(200);
		// attempt 2 fails -> delay = 100 * 2^2 = 400
		await vi.advanceTimersByTimeAsync(400);
		// attempt 3 succeeds

		await promise;

		// Filter to only the retry-related delays (>= 100).
		const retryDelays = timeouts.filter((t) => t >= 100);
		expect(retryDelays).toEqual([100, 200, 400]);

		spy.mockRestore();
	});

	// -------------------------------------------------------------------------
	// maxDelayMs cap
	// -------------------------------------------------------------------------

	it("caps the delay at maxDelayMs", async () => {
		const fn = failNTimes(4, "done");
		const timeouts: number[] = [];

		const origSetTimeout = globalThis.setTimeout;
		const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
			// @ts-expect-error -- simplified mock for capturing delay args
			(callback: () => void, ms?: number) => {
				if (ms !== undefined && ms > 0) {
					timeouts.push(ms);
				}
				return origSetTimeout(callback, ms);
			},
		);

		const promise = withRetry(fn, {
			maxRetries: 4,
			baseDelayMs: 100,
			maxDelayMs: 300,
			jitter: false,
		});

		// attempt 0 fails -> delay = min(100, 300) = 100
		await vi.advanceTimersByTimeAsync(100);
		// attempt 1 fails -> delay = min(200, 300) = 200
		await vi.advanceTimersByTimeAsync(200);
		// attempt 2 fails -> delay = min(400, 300) = 300
		await vi.advanceTimersByTimeAsync(300);
		// attempt 3 fails -> delay = min(800, 300) = 300
		await vi.advanceTimersByTimeAsync(300);
		// attempt 4 succeeds

		await promise;

		const retryDelays = timeouts.filter((t) => t >= 100);
		expect(retryDelays).toEqual([100, 200, 300, 300]);

		spy.mockRestore();
	});

	// -------------------------------------------------------------------------
	// retryOn predicate
	// -------------------------------------------------------------------------

	it("stops retrying when retryOn predicate returns false", async () => {
		let callCount = 0;
		const fn = vi.fn(async () => {
			callCount++;
			if (callCount === 1) {
				throw new Error("retryable");
			}
			throw new Error("fatal");
		});

		// Mute the unhandled rejection that fires before the assertion catches it.
		const promise = muteUnhandled(
			withRetry(fn, {
				maxRetries: 5,
				baseDelayMs: 50,
				maxDelayMs: 1000,
				jitter: false,
				retryOn: (err) => err instanceof Error && err.message === "retryable",
			}),
		);

		// attempt 0 fails with "retryable" -> retryOn returns true -> delay 50ms
		await vi.advanceTimersByTimeAsync(50);
		// attempt 1 fails with "fatal" -> retryOn returns false -> immediate throw

		await expect(promise).rejects.toThrow("fatal");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	// -------------------------------------------------------------------------
	// Jitter adds randomness
	// -------------------------------------------------------------------------

	it("applies jitter when enabled (delay >= base, < 2*base)", async () => {
		// Seed Math.random to a known value.
		vi.spyOn(Math, "random").mockReturnValue(0.5);

		const fn = failNTimes(1, "ok");
		const timeouts: number[] = [];

		const origSetTimeout = globalThis.setTimeout;
		const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(
			// @ts-expect-error -- simplified mock for capturing delay args
			(callback: () => void, ms?: number) => {
				if (ms !== undefined && ms > 0) {
					timeouts.push(ms);
				}
				return origSetTimeout(callback, ms);
			},
		);

		const promise = withRetry(fn, {
			maxRetries: 1,
			baseDelayMs: 100,
			maxDelayMs: 10000,
			jitter: true,
		});

		// With random=0.5: capped=100, jitter = 100 + floor(0.5*100) = 150
		await vi.advanceTimersByTimeAsync(150);

		await promise;

		const retryDelays = timeouts.filter((t) => t >= 100);
		expect(retryDelays[0]).toBe(150);

		spy.mockRestore();
	});

	// -------------------------------------------------------------------------
	// Default config
	// -------------------------------------------------------------------------

	it("uses safe defaults when no config is provided", async () => {
		const fn = failNTimes(1, "default-ok");

		const promise = withRetry(fn);

		// Default: baseDelayMs=1000, jitter=true, maxRetries=3
		// Need to advance enough time for the first retry delay.
		// With jitter, delay is in [1000, 2000). Advance 2000 to be safe.
		await vi.advanceTimersByTimeAsync(2000);

		const result = await promise;
		expect(result).toBe("default-ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	// -------------------------------------------------------------------------
	// Zero retries
	// -------------------------------------------------------------------------

	it("throws immediately with maxRetries: 0", async () => {
		const fn = vi.fn(async () => {
			throw new Error("fail");
		});

		await expect(
			withRetry(fn, {
				maxRetries: 0,
				baseDelayMs: 100,
				maxDelayMs: 1000,
				jitter: false,
			}),
		).rejects.toThrow("fail");

		expect(fn).toHaveBeenCalledTimes(1);
	});
});

// ===========================================================================
// 2. Circuit Breaker (BreakerRegistry)
// ===========================================================================

describe("BreakerRegistry", () => {
	let registry: BreakerRegistry;

	beforeEach(() => {
		registry = createBreakerRegistry();
	});

	// -------------------------------------------------------------------------
	// Closed state (normal operation)
	// -------------------------------------------------------------------------

	it("passes through calls in closed state", async () => {
		const fn = vi.fn(async (input: string) => `hello ${input}`);
		const wrapped = registry.withCircuitBreaker("test-svc", fn);

		const result = await wrapped("world");

		expect(result).toBe("hello world");
		expect(fn).toHaveBeenCalledWith("world");
		expect(registry.getCircuitState("test-svc")).toBe("closed");
	});

	it("starts in closed state", () => {
		const fn = vi.fn(async (_input: string) => "ok");
		registry.createCircuitBreaker("svc", fn);

		expect(registry.getCircuitState("svc")).toBe("closed");
	});

	// -------------------------------------------------------------------------
	// Open state after failures exceed threshold
	// -------------------------------------------------------------------------

	it("trips open after failures exceed the volume and error thresholds", async () => {
		let callCount = 0;
		const fn = async (_input: string): Promise<string> => {
			callCount++;
			throw new Error(`fail-${callCount}`);
		};

		const wrapped = registry.withCircuitBreaker("failing-svc", fn, {
			errorThresholdPercentage: 50,
			volumeThreshold: 3,
			timeoutMs: 5000,
			resetTimeoutMs: 30000,
		});

		// Fire enough failures to exceed the volume threshold.
		const errors: Error[] = [];
		for (let i = 0; i < 5; i++) {
			try {
				await wrapped("x");
			} catch (e) {
				errors.push(e as Error);
			}
		}

		// At least 3 errors should have been thrown to trip the breaker.
		expect(errors.length).toBe(5);

		// The breaker should now be open.
		const state = registry.getCircuitState("failing-svc");
		expect(state).toBe("open");

		// Subsequent calls should be rejected immediately by the breaker
		// (opossum throws its own error type for open circuit).
		await expect(wrapped("y")).rejects.toThrow();
	});

	// -------------------------------------------------------------------------
	// Caching: same name returns same breaker
	// -------------------------------------------------------------------------

	it("returns the same breaker for the same name", () => {
		const fn1 = vi.fn(async (_input: string) => "a");
		const fn2 = vi.fn(async (_input: string) => "b");

		const breaker1 = registry.createCircuitBreaker("shared", fn1);
		const breaker2 = registry.createCircuitBreaker("shared", fn2);

		// Second call should return the cached breaker, fn2 is ignored.
		expect(breaker1).toBe(breaker2);
	});

	// -------------------------------------------------------------------------
	// getAllCircuitStates
	// -------------------------------------------------------------------------

	it("returns all registered breaker states", () => {
		const fn = vi.fn(async (_input: string) => "ok");
		registry.createCircuitBreaker("svc-a", fn);
		registry.createCircuitBreaker("svc-b", fn);

		const states = registry.getAllCircuitStates();
		expect(states).toHaveLength(2);
		expect(states.map((s) => s.name).sort()).toEqual(["svc-a", "svc-b"]);
		expect(states.every((s) => s.state === "closed")).toBe(true);
	});

	// -------------------------------------------------------------------------
	// getCircuitState for unknown name
	// -------------------------------------------------------------------------

	it("returns undefined for an unregistered name", () => {
		expect(registry.getCircuitState("unknown")).toBeUndefined();
	});

	// -------------------------------------------------------------------------
	// resetCircuitBreaker
	// -------------------------------------------------------------------------

	it("resets an open breaker back to closed", async () => {
		const fn = async (_input: string): Promise<string> => {
			throw new Error("always-fail");
		};

		const wrapped = registry.withCircuitBreaker("reset-svc", fn, {
			errorThresholdPercentage: 50,
			volumeThreshold: 2,
			timeoutMs: 5000,
			resetTimeoutMs: 60000,
		});

		// Trip the breaker open.
		for (let i = 0; i < 5; i++) {
			try {
				await wrapped("x");
			} catch {
				// expected
			}
		}

		expect(registry.getCircuitState("reset-svc")).toBe("open");

		// Reset it.
		registry.resetCircuitBreaker("reset-svc");
		expect(registry.getCircuitState("reset-svc")).toBe("closed");
	});

	it("resetCircuitBreaker is a no-op for unknown names", () => {
		// Should not throw.
		registry.resetCircuitBreaker("nonexistent");
	});

	// -------------------------------------------------------------------------
	// Fallback execution via opossum
	// -------------------------------------------------------------------------

	it("supports opossum fallback via the raw breaker", async () => {
		const fn = async (_input: string): Promise<string> => {
			throw new Error("primary-fail");
		};

		const breaker = registry.createCircuitBreaker("fallback-svc", fn, {
			errorThresholdPercentage: 50,
			volumeThreshold: 1,
			timeoutMs: 5000,
			resetTimeoutMs: 30000,
		});

		// Register a fallback on the raw opossum breaker.
		breaker.fallback((_input: string) => "fallback-value");

		const result = await breaker.fire("test");
		expect(result).toBe("fallback-value");
	});

	// -------------------------------------------------------------------------
	// Half-open state and recovery
	// -------------------------------------------------------------------------

	it("transitions to half-open after resetTimeout and recovers on success", async () => {
		let shouldFail = true;
		const fn = async (_input: string): Promise<string> => {
			if (shouldFail) {
				throw new Error("down");
			}
			return "recovered";
		};

		const breaker = registry.createCircuitBreaker("halfopen-svc", fn, {
			errorThresholdPercentage: 50,
			volumeThreshold: 2,
			timeoutMs: 5000,
			resetTimeoutMs: 500, // Short reset timeout for testing.
		});

		// Trip the breaker open.
		for (let i = 0; i < 4; i++) {
			try {
				await breaker.fire("x");
			} catch {
				// expected
			}
		}

		expect(registry.getCircuitState("halfopen-svc")).toBe("open");

		// Now allow the function to succeed.
		shouldFail = false;

		// Wait for the resetTimeout to elapse so the breaker enters half-open.
		await new Promise<void>((resolve) => setTimeout(resolve, 700));

		// The next call should probe in half-open state. On success, the
		// breaker should transition back to closed.
		const result = await breaker.fire("probe");
		expect(result).toBe("recovered");

		// After successful probe, breaker should return to closed.
		expect(registry.getCircuitState("halfopen-svc")).toBe("closed");
	});

	// -------------------------------------------------------------------------
	// Registry isolation
	// -------------------------------------------------------------------------

	it("separate registries are isolated from each other", async () => {
		const registry2 = createBreakerRegistry();
		const fn = vi.fn(async (_input: string) => "ok");

		registry.createCircuitBreaker("shared-name", fn);
		registry2.createCircuitBreaker("shared-name", fn);

		expect(registry.getCircuitState("shared-name")).toBe("closed");
		expect(registry2.getCircuitState("shared-name")).toBe("closed");

		// They are different instances -- verifying via getAllCircuitStates.
		expect(registry.getAllCircuitStates()).toHaveLength(1);
		expect(registry2.getAllCircuitStates()).toHaveLength(1);
	});
});

// ===========================================================================
// 3. ConcurrencyLimiter
// ===========================================================================

describe("ConcurrencyLimiter", () => {
	// -------------------------------------------------------------------------
	// Respects concurrency limit
	// -------------------------------------------------------------------------

	it("executes up to maxConcurrent operations simultaneously", async () => {
		const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
		const deferreds = [deferred<string>(), deferred<string>(), deferred<string>()];

		// Launch 3 operations; only 2 should start immediately.
		const promises = deferreds.map((d) => {
			return limiter.execute(async () => {
				return d.promise;
			});
		});

		// Wait a tick so the acquire promises settle.
		await tick();

		expect(limiter.running).toBe(2);
		expect(limiter.pending).toBe(1);

		// Complete the first operation to unblock the third.
		deferreds[0]?.resolve("first");
		await tick();

		expect(limiter.running).toBe(2);
		expect(limiter.pending).toBe(0);

		// Complete remaining.
		deferreds[1]?.resolve("second");
		deferreds[2]?.resolve("third");

		const results = await Promise.all(promises);
		expect(results).toEqual(["first", "second", "third"]);
	});

	// -------------------------------------------------------------------------
	// Queuing behavior
	// -------------------------------------------------------------------------

	it("queues operations when the limit is reached and drains in FIFO order", async () => {
		const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
		const order: number[] = [];

		const d1 = deferred<void>();
		const d2 = deferred<void>();
		const d3 = deferred<void>();

		const p1 = limiter.execute(async () => {
			await d1.promise;
			order.push(1);
		});
		const p2 = limiter.execute(async () => {
			await d2.promise;
			order.push(2);
		});
		const p3 = limiter.execute(async () => {
			await d3.promise;
			order.push(3);
		});

		await tick();
		expect(limiter.running).toBe(1);
		expect(limiter.pending).toBe(2);

		// Release in order: 1, then 2, then 3.
		d1.resolve();
		await tick();
		expect(limiter.running).toBe(1); // op 2 now running
		expect(limiter.pending).toBe(1);

		d2.resolve();
		await tick();
		expect(limiter.running).toBe(1); // op 3 now running
		expect(limiter.pending).toBe(0);

		d3.resolve();
		await Promise.all([p1, p2, p3]);

		expect(order).toEqual([1, 2, 3]);
	});

	// -------------------------------------------------------------------------
	// Release on completion (success path)
	// -------------------------------------------------------------------------

	it("releases a slot when an operation completes successfully", async () => {
		const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });

		await limiter.execute(async () => "done");

		expect(limiter.running).toBe(0);
		expect(limiter.pending).toBe(0);

		// A new operation should acquire immediately.
		const result = await limiter.execute(async () => "second");
		expect(result).toBe("second");
	});

	// -------------------------------------------------------------------------
	// Release on error
	// -------------------------------------------------------------------------

	it("releases a slot when an operation throws", async () => {
		const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });

		await expect(
			limiter.execute(async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		// Slot should be released.
		expect(limiter.running).toBe(0);

		// A subsequent operation should run fine.
		const result = await limiter.execute(async () => "ok");
		expect(result).toBe("ok");
	});

	// -------------------------------------------------------------------------
	// Queue timeout
	// -------------------------------------------------------------------------

	it("rejects queued operations that exceed queueTimeout", async () => {
		vi.useFakeTimers();

		const limiter = new ConcurrencyLimiter({
			maxConcurrent: 1,
			queueTimeout: 100,
		});

		const blocker = deferred<void>();

		// First operation holds the slot.
		const p1 = limiter.execute(async () => blocker.promise);

		// Second operation enters the queue. Mute the rejection that fires
		// when the timer expires before the assertion catches it.
		const p2 = muteUnhandled(limiter.execute(async () => "queued"));

		await vi.advanceTimersByTimeAsync(100);

		await expect(p2).rejects.toThrow("queue timeout after 100ms");

		// The queue should be empty now (the timed-out entry was removed).
		expect(limiter.pending).toBe(0);

		// Clean up: release the blocker.
		blocker.resolve();
		await p1;

		vi.useRealTimers();
	});

	// -------------------------------------------------------------------------
	// Default config
	// -------------------------------------------------------------------------

	it("defaults to maxConcurrent: 10", async () => {
		const limiter = new ConcurrencyLimiter();
		const deferreds = Array.from({ length: 12 }, () => deferred<string>());

		const promises = deferreds.map((d) => limiter.execute(async () => d.promise));

		await tick();

		// 10 should be running, 2 queued.
		expect(limiter.running).toBe(10);
		expect(limiter.pending).toBe(2);

		// Resolve all.
		for (const d of deferreds) {
			d.resolve("ok");
		}
		await Promise.all(promises);
	});

	// -------------------------------------------------------------------------
	// Multiple concurrent completions
	// -------------------------------------------------------------------------

	it("handles multiple rapid completions without losing queued work", async () => {
		const limiter = new ConcurrencyLimiter({ maxConcurrent: 2 });
		const results: string[] = [];

		const tasks = Array.from({ length: 5 }, (_, i) =>
			limiter.execute(async () => {
				results.push(`task-${i}`);
				return `result-${i}`;
			}),
		);

		const allResults = await Promise.all(tasks);

		expect(allResults).toEqual(["result-0", "result-1", "result-2", "result-3", "result-4"]);
		expect(results).toHaveLength(5);
	});

	// -------------------------------------------------------------------------
	// Slot handoff (no decrement on queue drain)
	// -------------------------------------------------------------------------

	it("hands slots directly to queued waiters without decrementing running count", async () => {
		const limiter = new ConcurrencyLimiter({ maxConcurrent: 1 });
		const d1 = deferred<string>();
		const d2 = deferred<string>();

		const p1 = limiter.execute(async () => d1.promise);
		const p2 = limiter.execute(async () => d2.promise);

		await tick();
		expect(limiter.running).toBe(1);
		expect(limiter.pending).toBe(1);

		// Complete first task -- slot passes directly to second.
		d1.resolve("a");
		await tick();

		// Running should still be 1 (not briefly drop to 0).
		expect(limiter.running).toBe(1);
		expect(limiter.pending).toBe(0);

		d2.resolve("b");
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toBe("a");
		expect(r2).toBe("b");

		expect(limiter.running).toBe(0);
	});
});

// ===========================================================================
// 4. withResilience (compose)
// ===========================================================================

describe("withResilience", () => {
	// -------------------------------------------------------------------------
	// Composing retry + circuit breaker + concurrency
	// -------------------------------------------------------------------------

	it("composes all layers and returns the result on success", async () => {
		const fn = vi.fn(async (input: string) => `processed-${input}`);

		const resilientFn = withResilience("compose-test", fn, {
			retry: { maxRetries: 1, baseDelayMs: 10, maxDelayMs: 100, jitter: false },
			concurrency: { maxConcurrent: 5 },
			circuitBreaker: {
				timeoutMs: 5000,
				volumeThreshold: 10,
				resetTimeoutMs: 30000,
				errorThresholdPercentage: 50,
			},
			graceful: false,
		});

		const result = await resilientFn("hello");
		expect(result).toBe("processed-hello");
		expect(fn).toHaveBeenCalledWith("hello");
	});

	// -------------------------------------------------------------------------
	// Retry operates inside the composition
	// -------------------------------------------------------------------------

	it("retries transient failures within the composed wrapper", async () => {
		let callCount = 0;
		const fn = async (_input: string): Promise<string> => {
			callCount++;
			if (callCount <= 2) {
				throw new Error("transient");
			}
			return "success";
		};

		const resilientFn = withResilience("retry-compose", fn, {
			retry: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, jitter: false },
			concurrency: false,
			circuitBreaker: false,
			graceful: false,
		});

		const result = await resilientFn("test");
		expect(result).toBe("success");
		expect(callCount).toBe(3);
	});

	// -------------------------------------------------------------------------
	// Graceful degradation returns null on failure
	// -------------------------------------------------------------------------

	it("returns null (graceful degradation) when all layers fail", async () => {
		const fn = async (_input: string): Promise<string> => {
			throw new Error("permanent failure");
		};

		const resilientFn = withResilience("graceful-compose", fn, {
			retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, jitter: false },
			concurrency: false,
			circuitBreaker: false,
			graceful: true,
		});

		const result = await resilientFn("test");
		expect(result).toBeNull();
	});

	// -------------------------------------------------------------------------
	// Graceful disabled re-throws errors
	// -------------------------------------------------------------------------

	it("throws errors when graceful is disabled", async () => {
		const fn = async (_input: string): Promise<string> => {
			throw new Error("hard-fail");
		};

		const resilientFn = withResilience("no-graceful", fn, {
			retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, jitter: false },
			concurrency: false,
			circuitBreaker: false,
			graceful: false,
		});

		await expect(resilientFn("test")).rejects.toThrow("hard-fail");
	});

	// -------------------------------------------------------------------------
	// Disabling individual layers
	// -------------------------------------------------------------------------

	it("works with all optional layers disabled", async () => {
		const fn = vi.fn(async (input: string) => `bare-${input}`);

		const resilientFn = withResilience("bare", fn, {
			retry: false,
			concurrency: false,
			circuitBreaker: false,
			graceful: false,
		});

		const result = await resilientFn("input");
		expect(result).toBe("bare-input");
	});

	// -------------------------------------------------------------------------
	// Concurrency limiting within composed wrapper
	// -------------------------------------------------------------------------

	it("respects concurrency limits within the composed wrapper", async () => {
		let peakConcurrent = 0;
		let currentConcurrent = 0;

		const fn = async (_input: number): Promise<number> => {
			currentConcurrent++;
			peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
			// Simulate async work.
			await new Promise<void>((r) => setTimeout(r, 50));
			currentConcurrent--;
			return _input * 2;
		};

		const resilientFn = withResilience("conc-compose", fn, {
			retry: false,
			concurrency: { maxConcurrent: 2 },
			circuitBreaker: false,
			graceful: false,
		});

		const results = await Promise.all([resilientFn(1), resilientFn(2), resilientFn(3), resilientFn(4)]);

		expect(results).toEqual([2, 4, 6, 8]);
		expect(peakConcurrent).toBeLessThanOrEqual(2);
	});

	// -------------------------------------------------------------------------
	// Composition order: retry is innermost
	// -------------------------------------------------------------------------

	it("retries inside the circuit breaker (retry is innermost)", async () => {
		const callLog: string[] = [];
		let callCount = 0;

		const fn = async (_input: string): Promise<string> => {
			callCount++;
			callLog.push(`call-${callCount}`);
			if (callCount <= 1) {
				throw new Error("transient");
			}
			return "ok";
		};

		// Set up the registry to inspect breaker state.
		const registry = createBreakerRegistry();

		const resilientFn = withResilience("order-test", fn, {
			retry: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, jitter: false },
			concurrency: false,
			circuitBreaker: {
				volumeThreshold: 5,
				errorThresholdPercentage: 50,
				timeoutMs: 5000,
				resetTimeoutMs: 30000,
			},
			graceful: false,
			registry,
		});

		const result = await resilientFn("test");

		// The retry should have recovered within one breaker "fire".
		expect(result).toBe("ok");
		expect(callCount).toBe(2);

		// The circuit breaker should still be closed because the overall call
		// succeeded (retry handled the transient failure internally).
		expect(registry.getCircuitState("order-test")).toBe("closed");
	});

	// -------------------------------------------------------------------------
	// Logger receives error messages via graceful degradation
	// -------------------------------------------------------------------------

	it("logs errors via the provided logger when graceful mode is active", async () => {
		const loggedErrors: string[] = [];
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn((msg: string) => loggedErrors.push(msg)),
		};

		const fn = async (_input: string): Promise<string> => {
			throw new Error("logged-failure");
		};

		const resilientFn = withResilience("logger-test", fn, {
			retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, jitter: false },
			concurrency: false,
			circuitBreaker: false,
			graceful: true,
			logger,
		});

		const result = await resilientFn("test");
		expect(result).toBeNull();
		expect(logger.error).toHaveBeenCalled();
		expect(loggedErrors.length).toBeGreaterThan(0);
	});

	// -------------------------------------------------------------------------
	// Shared registry across multiple resilient functions
	// -------------------------------------------------------------------------

	it("shares breaker state when using a shared registry", async () => {
		const registry = createBreakerRegistry();

		const fn1 = vi.fn(async (_input: string) => "fn1-ok");
		const fn2 = vi.fn(async (_input: string) => "fn2-ok");

		// Both use the same name -- second registration shares the first's breaker.
		withResilience("shared", fn1, {
			retry: false,
			concurrency: false,
			circuitBreaker: { volumeThreshold: 5 },
			graceful: false,
			registry,
		});

		withResilience("shared", fn2, {
			retry: false,
			concurrency: false,
			circuitBreaker: { volumeThreshold: 5 },
			graceful: false,
			registry,
		});

		// There should be exactly one breaker named "shared".
		const states = registry.getAllCircuitStates();
		const sharedStates = states.filter((s) => s.name === "shared");
		expect(sharedStates).toHaveLength(1);
	});

	// -------------------------------------------------------------------------
	// Default config enables all layers
	// -------------------------------------------------------------------------

	it("enables all layers by default (no config)", async () => {
		const fn = vi.fn(async (input: string) => `default-${input}`);

		const resilientFn = withResilience("defaults", fn);

		// Should succeed with all layers active (defaults).
		const result = await resilientFn("test");
		expect(result).toBe("default-test");
	});
});
