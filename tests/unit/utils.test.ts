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
  supportsColor,
  hr,
  printHelp,
  createSpinner,
} from "../../src/utils/fmt.ts";
import type { CommandDef } from "../../src/utils/fmt.ts";
import { MemoryCache, NoopCache, createCache, cacheKey, withCache } from "../../src/cache.ts";
import { logger } from "../../src/utils/logger.ts";

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

  it("parses --flag=value syntax", () => {
    const r = parseArgs(["--runner=vitest", "--out-dir=__tests__"]);
    expect(r.flags["runner"]).toBe("vitest");
    expect(r.flags["out-dir"]).toBe("__tests__");
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

// ─── supportsColor ─────────────────────────────────────────────────────────────

describe("supportsColor", () => {
  it("returns false when NO_COLOR is set", () => {
    process.env["NO_COLOR"] = "1";
    expect(supportsColor()).toBe(false);
    delete process.env["NO_COLOR"];
  });

  it("returns true when FORCE_COLOR is set", () => {
    process.env["FORCE_COLOR"] = "1";
    expect(supportsColor()).toBe(true);
    delete process.env["FORCE_COLOR"];
  });
});

// ─── hr ───────────────────────────────────────────────────────────────────────

describe("hr", () => {
  it("returns default width of 64", () => {
    expect(hr()).toHaveLength(64);
  });

  it("uses custom character", () => {
    expect(hr("=")).toBe("=".repeat(64));
  });

  it("uses custom width", () => {
    expect(hr("-", 10)).toBe("-".repeat(10));
  });
});

// ─── printHelp ─────────────────────────────────────────────────────────────────

describe("printHelp", () => {
  it("outputs to stdout and includes all commands", () => {
    const commands: CommandDef[] = [
      { name: "generate", args: "<spec>", description: "Generate tests" },
      { name: "run", args: "<spec>", description: "Run tests" },
    ];
    const write = process.stdout.write.bind(process.stdout);
    const chunks: string[] = [];
    process.stdout.write = (c: string) => {
      chunks.push(c);
      return true;
    };
    printHelp(commands, "1.0.0");
    process.stdout.write = write;
    const output = chunks.join("");
    expect(output).toContain("generate");
    expect(output).toContain("run");
    expect(output).toContain("v1.0.0");
  });
});

// ─── createSpinner ────────────────────────────────────────────────────────────

describe("createSpinner", () => {
  it("returns spinner with text property", () => {
    process.env["NO_COLOR"] = "1";
    const s = createSpinner("working...");
    expect(s.text).toBe("working...");
    s.text = "updated";
    expect(s.text).toBe("updated");
    s.stop();
    delete process.env["NO_COLOR"];
  });
});

// ─── parseArgs additional edge cases ──────────────────────────────────────────

describe("parseArgs edge cases", () => {
  it("handles empty flag value as boolean", () => {
    const r = parseArgs(["--flag"]);
    expect(r.flags["flag"]).toBe(true);
  });

  it("handles --flag=value with empty value", () => {
    const r = parseArgs(["--flag="]);
    expect(r.flags["flag"]).toBe("");
  });

  it("preserves positionals mixed with boolean flags at end", () => {
    const r = parseArgs(["generate", "spec.yaml", "--verbose", "--dry-run"]);
    expect(r.command).toBe("generate");
    expect(r.positionals).toEqual(["spec.yaml"]);
    expect(r.flags["verbose"]).toBe(true);
    expect(r.flags["dry-run"]).toBe(true);
  });

  it("handles mixed --flag=value and --flag value", () => {
    const r = parseArgs(["--runner=vitest", "--out-dir", "tests"]);
    expect(r.flags["runner"]).toBe("vitest");
    expect(r.flags["out-dir"]).toBe("tests");
  });

  it("--no-flag with valid key", () => {
    const r = parseArgs(["--no-dry-run"]);
    expect(r.flags["dry-run"]).toBe(false);
  });
});

// ─── structured logger ────────────────────────────────────────────────────────

describe("logger", () => {
  it("logs at info level without throwing", () => {
    expect(() => logger.info("test", "hello")).not.toThrow();
  });

  it("logs at warn and error levels", () => {
    expect(() => logger.warn("ctx", "warning")).not.toThrow();
    expect(() => logger.error("ctx", "error")).not.toThrow();
  });

  it("logs JSON format when LOG_FORMAT=json", () => {
    const origFormat = process.env["LOG_FORMAT"];
    const origWrite = process.stderr.write.bind(process.stderr);
    try {
      process.env["LOG_FORMAT"] = "json";
      const chunks: string[] = [];
      process.stderr.write = ((c: string) => {
        chunks.push(c);
        return true;
      }) as typeof process.stderr.write;
      logger.info("test", "msg", { key: "val" });
      const parsed = JSON.parse(chunks.join(""));
      expect(parsed.level).toBe("info");
      expect(parsed.context).toBe("test");
      expect(parsed.message).toBe("msg");
      expect(parsed.data?.key).toBe("val");
    } finally {
      process.stderr.write = origWrite;
      if (origFormat === undefined) delete process.env["LOG_FORMAT"];
      else process.env["LOG_FORMAT"] = origFormat;
    }
  });

  it("includes data in stderr output", () => {
    expect(() => logger.debug("dbg", "detail", { n: 1 })).not.toThrow();
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
