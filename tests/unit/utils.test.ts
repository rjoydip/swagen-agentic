/**
 * tests/unit/utils.test.ts
 * Unit tests for fmt utilities and cache — no network, no LLM.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import {
  parseArgs,
  dedent,
  slugify,
  formatDuration,
  truncate,
  stripAnsi,
  ansi,
} from "../../src/utils/fmt.ts";
import { MemoryCache, NoopCache, createCache, cacheKey, withCache } from "../../src/cache.ts";

// ─── parseArgs ────────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  it("extracts command and positionals", () => {
    const r = parseArgs(["generate", "openapi.yaml"]);
    expect(r.command).toBe("generate");
    expect(r.positionals).toEqual(["openapi.yaml"]);
    expect(r.flags).toEqual({});
  });

  it("parses --flag value", () => {
    const r = parseArgs(["generate", "api.yaml", "--runner", "vitest", "--out-dir", "__tests__"]);
    expect(r.flags["runner"]).toBe("vitest");
    expect(r.flags["out-dir"]).toBe("__tests__");
  });

  it("parses --flag (boolean)", () => {
    const r = parseArgs(["gen", "api.yaml", "--dry-run"]);
    expect(r.flags["dry-run"]).toBe(true);
  });

  it("parses --no-flag", () => {
    const r = parseArgs(["gen", "api.yaml", "--no-fixtures"]);
    expect(r.flags["fixtures"]).toBe(false);
  });

  it("parses -f shorthand", () => {
    const r = parseArgs(["-r", "bun"]);
    expect(r.flags["r"]).toBe("bun");
  });

  it("handles empty args", () => {
    const r = parseArgs([]);
    expect(r.command).toBeUndefined();
    expect(r.positionals).toEqual([]);
    expect(r.flags).toEqual({});
  });
});

// ─── dedent ───────────────────────────────────────────────────────────────────

describe("dedent", () => {
  it("removes common leading indent", () => {
    const result = dedent`
      hello
      world
    `;
    expect(result).toBe("hello\nworld");
  });

  it("handles interpolation", () => {
    const name = "swagen";
    const result = dedent`
      Hello ${name}!
      Welcome.
    `;
    expect(result).toBe(`Hello ${name}!\nWelcome.`);
  });

  it("preserves relative indent differences", () => {
    const result = dedent`
      outer
        inner
    `;
    expect(result).toBe("outer\n  inner");
  });

  it("handles single line", () => {
    const result = dedent`  hello  `;
    expect(result.trim()).toBe("hello");
  });
});

// ─── slugify ──────────────────────────────────────────────────────────────────

describe("slugify", () => {
  it("lowercases and replaces spaces", () => {
    expect(slugify("Pet Store")).toBe("pet-store");
  });
  it("strips leading/trailing hyphens", () => {
    expect(slugify("  api  ")).toBe("api");
  });
  it("handles special characters", () => {
    expect(slugify("User/Auth (v2)")).toBe("user-auth-v2");
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("shows ms for < 1s", () => expect(formatDuration(400)).toBe("400ms"));
  it("shows s for < 60s", () => expect(formatDuration(2500)).toBe("2.5s"));
  it("shows m+s for >= 60s", () => expect(formatDuration(75_000)).toBe("1m 15s"));
});

// ─── truncate ─────────────────────────────────────────────────────────────────

describe("truncate", () => {
  it("leaves short strings unchanged", () => expect(truncate("hello", 10)).toBe("hello"));
  it("truncates long strings with ...", () => expect(truncate("hello world", 8)).toBe("hello..."));
});

// ─── ANSI / stripAnsi ─────────────────────────────────────────────────────────

describe("ansi + stripAnsi", () => {
  it("wraps text with escape codes", () => {
    const coloured = ansi.green("OK");
    expect(coloured).toContain("\x1b[");
    expect(coloured).toContain("OK");
  });
  it("strips escape codes", () => {
    expect(stripAnsi(ansi.bold(ansi.red("error")))).toBe("error");
  });
});

// ─── MemoryCache ──────────────────────────────────────────────────────────────

describe("MemoryCache", () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache(3, 5000);
  });

  it("returns null for missing keys", async () => {
    expect(await cache.get<unknown>("missing")).toBeNull();
  });

  it("stores and retrieves values", async () => {
    await cache.set("k", { data: 42 });
    expect(await cache.get<{ data: number }>("k")).toEqual({ data: 42 });
  });

  it("respects TTL expiry", async () => {
    await cache.set("k", "value", 10); // 10ms TTL
    await Bun.sleep(20);
    expect(await cache.get<unknown>("k")).toBeNull();
  });

  it("evicts LRU entry at capacity", async () => {
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);
    // Access "a" to make it recently-used
    await cache.get("a");
    // Insert "d" — should evict "b" (oldest unused)
    await cache.set("d", 4);
    expect(await cache.get<number>("b")).toBeNull();
    expect(await cache.get<number>("a")).toBe(1);
    expect(await cache.get<number>("d")).toBe(4);
  });

  it("deletes entries", async () => {
    await cache.set("x", 99);
    await cache.delete("x");
    expect(await cache.get<unknown>("x")).toBeNull();
  });

  it("clears all entries", async () => {
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.clear();
    expect(cache.stats().entries).toBe(0);
  });

  it("tracks hit/miss stats", async () => {
    await cache.set("k", "v");
    await cache.get("k"); // hit
    await cache.get("z"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });
});

// ─── cacheKey ─────────────────────────────────────────────────────────────────

describe("cacheKey", () => {
  it("produces consistent hex strings", async () => {
    const k1 = await cacheKey("load_spec", { source: "api.yaml" });
    const k2 = await cacheKey("load_spec", { source: "api.yaml" });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{32}$/);
  });

  it("differs for different inputs", async () => {
    const k1 = await cacheKey("load_spec", { source: "a.yaml" });
    const k2 = await cacheKey("load_spec", { source: "b.yaml" });
    expect(k1).not.toBe(k2);
  });
});

// ─── withCache ────────────────────────────────────────────────────────────────

describe("withCache", () => {
  it("calls fn on first call, uses cache on second", async () => {
    const cache = new MemoryCache();
    let callCount = 0;
    const fn = withCache(cache, "test_fn", async (args: { n: number }) => {
      callCount++;
      return args.n * 2;
    });

    expect(await fn({ n: 5 })).toBe(10);
    expect(await fn({ n: 5 })).toBe(10);
    expect(callCount).toBe(1); // only called once
  });

  it("calls fn again after TTL expires", async () => {
    const cache = new MemoryCache(256, 10);
    let callCount = 0;
    const fn = withCache(
      cache,
      "ttl_test",
      async (n: number) => {
        callCount++;
        return n;
      },
      10,
    );
    await fn(1);
    await Bun.sleep(20);
    await fn(1);
    expect(callCount).toBe(2);
  });
});

describe("NoopCache", () => {
  it("get returns null", async () => {
    const c = new NoopCache();
    expect(await c.get("x")).toBeNull();
  });

  it("set does not throw", () => {
    const c = new NoopCache();
    expect(() => c.set("x", "y")).not.toThrow();
  });

  it("delete resolves and does not throw", async () => {
    const c = new NoopCache();
    await expect(c.delete("x")).resolves.toBeUndefined();
  });

  it("clear does not throw", () => {
    const c = new NoopCache();
    expect(() => c.clear()).not.toThrow();
  });

  it("stats are always zero", () => {
    const c = new NoopCache();
    c.set("a", 1);
    c.get("a");
    const s = c.stats();
    expect(s.entries).toBe(0);
    expect(s.hits).toBe(0);
    expect(s.misses).toBe(0);
  });
});

describe("createCache", () => {
  it("returns MemoryCache for memory strategy", () => {
    const c = createCache({ strategy: "memory" });
    expect(c).toBeInstanceOf(MemoryCache);
  });

  it("returns MemoryCache with explicit params", () => {
    const c = createCache({ strategy: "memory", ttlMs: 5000, maxEntries: 100 });
    expect(c).toBeInstanceOf(MemoryCache);
  });

  it("returns NoopCache for none strategy", () => {
    const c = createCache({ strategy: "none" });
    expect(c).toBeInstanceOf(NoopCache);
  });
});
