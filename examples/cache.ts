import { MemoryCache, FileCache, NoopCache, cacheKey, withCache } from "../src/index.ts";

const memCache = new MemoryCache(256, 60_000);
console.log("MemoryCache created (max 256 entries, 60s TTL)");

const fn = withCache(memCache, "demo", async (x: number) => {
  console.log("  (computing expensive result...)");
  return x * 2;
});

console.log("Result 1:", await fn(21));
console.log("Result 2 (cached):", await fn(21));
console.log("Result 3:", await fn(10));

console.log("\nStats:", memCache.stats());

const key1 = await cacheKey("test", { a: 1, b: 2 });
const key2 = await cacheKey("test", { b: 2, a: 1 });
console.log("\nDeterministic keys match:", key1 === key2);

await memCache.clear();
console.log("Cache cleared, stats:", memCache.stats());

const fileCache = new FileCache(".swagen/cache", 60_000);
console.log("\nFileCache at .swagen/cache", fileCache.stats());

const noop = new NoopCache();
console.log("NoopCache (no-op, 0 hits/0 misses)");
noop.clear();
