/**
 * cache/index.ts — tool result caching with memory-LRU and file backends.
 *
 * Used to:
 *   - Cache loaded+dereferenced specs (expensive HTTP + parse)
 *   - Cache analyze_endpoints results for the same spec hash
 *   - Cache generated file content for unchanged specs
 *
 * Cache keys are SHA-256 hashes of (tool_name + JSON.stringify(args)).
 */

import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { CacheConfig, CacheEntry } from "./core/types.ts";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface ICache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): CacheStats;
}

export interface CacheStats {
  entries: number;
  hits: number;
  misses: number;
  evictions: number;
}

// ─── Key helper — SHA-256 via Web Crypto ──────────────────────────────────────

export async function cacheKey(toolName: string, args: unknown): Promise<string> {
  const input = `${toolName}:${JSON.stringify(args)}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

// ─── NoopCache ────────────────────────────────────────────────────────────────

export class NoopCache implements ICache {
  async get<T>(_key: string): Promise<T | null> {
    return null;
  }
  async set<T>(_key: string, _value: T): Promise<void> {}
  async delete(_key: string): Promise<void> {}
  async clear(): Promise<void> {}
  stats() {
    return { entries: 0, hits: 0, misses: 0, evictions: 0 };
  }
}

// ─── Memory LRU cache ─────────────────────────────────────────────────────────

export class MemoryCache implements ICache {
  private readonly store = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly defaultTtl: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxEntries = 256, defaultTtlMs = 5 * 60_000) {
    this.maxEntries = maxEntries;
    this.defaultTtl = defaultTtlMs;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return null;
    }
    entry.hits++;
    // Move to end (LRU: most-recently-used stays)
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    // Evict oldest entry if at capacity
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest) {
        this.store.delete(oldest);
        this.evictions++;
      }
    }
    const now = Date.now();
    this.store.set(key, {
      key,
      value,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtl),
      hits: 0,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  stats(): CacheStats {
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    };
  }
}

// ─── File cache ───────────────────────────────────────────────────────────────

export class FileCache implements ICache {
  private readonly dir: string;
  private readonly defaultTtl: number;
  private hits = 0;
  private misses = 0;

  constructor(dir = ".swagen/cache", defaultTtlMs = 5 * 60_000) {
    this.dir = dir;
    this.defaultTtl = defaultTtlMs;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private path(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  async get<T>(key: string): Promise<T | null> {
    const p = this.path(key);
    if (!existsSync(p)) {
      this.misses++;
      return null;
    }
    try {
      const entry = JSON.parse(await Bun.file(p).text()) as CacheEntry<T>;
      if (Date.now() > entry.expiresAt) {
        rmSync(p, { force: true });
        this.misses++;
        return null;
      }
      this.hits++;
      return entry.value;
    } catch {
      this.misses++;
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const now = Date.now();
    const entry: CacheEntry<T> = {
      key,
      value,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtl),
      hits: 0,
    };
    await Bun.write(this.path(key), JSON.stringify(entry));
  }

  async delete(key: string): Promise<void> {
    const p = this.path(key);
    rmSync(p, { force: true });
  }

  async clear(): Promise<void> {
    const glob = new Bun.Glob("*.json");
    for await (const f of glob.scan(this.dir)) {
      rmSync(join(this.dir, f), { force: true });
    }
  }

  stats(): CacheStats {
    let entries = 0;
    if (existsSync(this.dir)) {
      try {
        entries = readdirSync(this.dir).filter((f) => f.endsWith(".json")).length;
      } catch {
        entries = 0;
      }
    }
    return { entries, hits: this.hits, misses: this.misses, evictions: 0 };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createCache(config: CacheConfig): ICache {
  switch (config.strategy) {
    case "none":
      return new NoopCache();
    case "memory":
      return new MemoryCache(config.maxEntries ?? 256, config.ttlMs ?? 5 * 60_000);
    case "file":
      return new FileCache(config.dir ?? ".swagen/cache", config.ttlMs ?? 5 * 60_000);
    default:
      throw new Error(`Unknown cache strategy: ${config.strategy as string}`);
  }
}

// ─── Cached tool wrapper ──────────────────────────────────────────────────────

/** Wraps an async function with cache get/set. */
export function withCache<A, R>(
  cache: ICache,
  toolName: string,
  fn: (args: A) => Promise<R>,
  ttlMs?: number,
): (args: A) => Promise<R> {
  return async (args: A): Promise<R> => {
    const key = await cacheKey(toolName, args);
    const cached = await cache.get<R>(key);
    if (cached !== null) return cached;
    const result = await fn(args);
    await cache.set(key, result, ttlMs);
    return result;
  };
}
