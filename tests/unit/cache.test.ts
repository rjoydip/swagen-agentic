/**
 * tests/unit/cache.test.ts
 * Unit tests for FileCache and cache factory edge cases.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FileCache, createCache } from "../../src/cache.ts";

const TEST_DIR = ".swagen/test-cache";

// ─── FileCache ────────────────────────────────────────────────────────────────

describe("FileCache", () => {
  let cache: FileCache;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    cache = new FileCache(TEST_DIR, 5000);
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates the cache directory on construction", () => {
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it("returns null for missing key", async () => {
    expect(await cache.get("missing")).toBeNull();
  });

  it("stores and retrieves values", async () => {
    await cache.set("k1", { data: 42 });
    const val = await cache.get<{ data: number }>("k1");
    expect(val).toEqual({ data: 42 });
  });

  it("persists data to disk as JSON", async () => {
    await cache.set("persist", "hello");
    const content = readFileSync(join(TEST_DIR, "persist.json"), "utf-8");
    expect(content).toContain("hello");
    expect(content).toContain("expiresAt");
  });

  it("reads value immediately after set", async () => {
    await cache.set("immediate", "present", 30_000);
    const val = await cache.get<string>("immediate");
    expect(val).not.toBeNull();
    expect(val).toBe("present");
  });

  it("expires entries after TTL", async () => {
    await cache.set("exp-key", "gone", 10);
    await Bun.sleep(30);
    expect(await cache.get("exp-key")).toBeNull();
  });

  it("deletes expired entries on read and removes file", async () => {
    await cache.set("expire", "gone", 10);
    await Bun.sleep(30);
    expect(await cache.get("expire")).toBeNull();
    expect(existsSync(join(TEST_DIR, "expire.json"))).toBe(false);
  });

  it("handles corrupted JSON gracefully", async () => {
    const p = join(TEST_DIR, "corrupt.json");
    await Bun.write(p, "{not-json");
    expect(await cache.get("corrupt")).toBeNull();
  });

  it("deletes entries", async () => {
    await cache.set("del-key", 99);
    await cache.delete("del-key");
    expect(await cache.get("del-key")).toBeNull();
    expect(existsSync(join(TEST_DIR, "del-key.json"))).toBe(false);
  });

  it("clears all entries", async () => {
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.clear();
    const stats = cache.stats();
    expect(stats.entries).toBe(0);
  });

  it("clear does not throw when directory is empty", async () => {
    await cache.clear();
    expect(existsSync(TEST_DIR)).toBe(true);
  });

  it("tracks hit/miss stats", async () => {
    await cache.set("hit-key", "v");
    const val = await cache.get<string>("hit-key");
    expect(val).not.toBeNull();
    expect(val).toBe("v");
    expect(await cache.get("miss-key")).toBeNull();
    const s = cache.stats();
    expect(s.hits).toBe(1);
    expect(s.misses).toBe(1);
    expect(s.entries).toBe(1);
  });

  it("stats reports zero entries after clear", async () => {
    await cache.set("x", 1);
    await cache.clear();
    expect(cache.stats().entries).toBe(0);
  });

  it("stats works when directory does not exist", async () => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    const s = cache.stats();
    expect(s.entries).toBe(0);
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
  });

  it("overwrites existing key", async () => {
    await cache.set("k", "first");
    await cache.set("k", "second");
    const val = await cache.get<string>("k");
    expect(val).not.toBeNull();
    expect(val).toBe("second");
  });

  it("serves cached value within TTL", async () => {
    await cache.set("fresh", "alive", 60_000);
    const val = await cache.get<string>("fresh");
    expect(val).not.toBeNull();
    expect(val).toBe("alive");
  });

  it("constructor uses default dir and TTL when omitted", () => {
    const c = new FileCache();
    expect(c).toBeInstanceOf(FileCache);
    if (existsSync(".swagen/cache")) rmSync(".swagen/cache", { recursive: true, force: true });
  });
});

// ─── createCache factory edge cases ───────────────────────────────────────────

describe("createCache factory", () => {
  it("returns FileCache for file strategy", () => {
    const c = createCache({ strategy: "file", dir: TEST_DIR, ttlMs: 5000 });
    expect(c).toBeInstanceOf(FileCache);
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("throws for unknown strategy", () => {
    expect(() => createCache({ strategy: "lru" as "none" })).toThrow("Unknown cache strategy");
  });
});
