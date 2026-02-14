/**
 * Minimal type declarations for the `opossum` circuit breaker library.
 *
 * Opossum ships without TypeScript types and `@types/opossum` is not
 * installed. This declaration covers only the subset of the API used
 * by the resilience layer.
 */
declare module "opossum" {
  import { EventEmitter } from "node:events";

  interface CircuitBreakerOptions {
    timeout?: number;
    errorThresholdPercentage?: number;
    resetTimeout?: number;
    rollingCountTimeout?: number;
    rollingCountBuckets?: number;
    rollingPercentilesEnabled?: boolean;
    capacity?: number;
    errorFilter?: (error: Error) => boolean;
    enabled?: boolean;
    allowWarmUp?: boolean;
    volumeThreshold?: number;
    name?: string;
    group?: string;
    cache?: boolean;
    cacheTTL?: number;
    enableSnapshots?: boolean;
  }

  class CircuitBreaker<
    TArgs extends unknown[] = unknown[],
    TReturn = unknown,
  > extends EventEmitter {
    constructor(action: (...args: TArgs) => Promise<TReturn>, options?: CircuitBreakerOptions);

    readonly name: string;
    readonly group: string;
    readonly opened: boolean;
    readonly closed: boolean;
    readonly halfOpen: boolean;
    readonly enabled: boolean;
    readonly warmUp: boolean;
    readonly volumeThreshold: number;
    readonly pendingClose: boolean;
    readonly stats: Record<string, unknown>;

    fire(...args: TArgs): Promise<TReturn>;
    fallback(fn: ((...args: TArgs) => TReturn) | CircuitBreaker<TArgs, TReturn>): this;
    close(): void;
    open(): void;
    shutdown(): void;
    enable(): void;
    disable(): void;
    clearCache(): void;

    static isOurError(error: Error): boolean;
  }

  export default CircuitBreaker;
}
