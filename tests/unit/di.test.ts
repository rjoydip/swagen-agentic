import { describe, it, expect } from "bun:test";
import { Container } from "@inferdi/inferdi";
import { buildContainer } from "../../src/di.ts";
import { SwagenHarness } from "../../src/harness.ts";
import { MemoryStorage } from "../../src/storage.ts";
import { MemoryCache } from "../../src/cache.ts";
import type { SwagenConfig } from "../../src/core/types.ts";

function testConfig(overrides: Partial<SwagenConfig> = {}): SwagenConfig {
  return {
    baseUrl: "http://localhost:3000",
    runner: "bun",
    outDir: "tests/api",
    auth: { type: "none" },
    includeTags: [],
    excludeTags: [],
    skipOperations: [],
    emitFixtures: false,
    emitSetup: false,
    assertStatusCodes: false,
    assertSchemas: false,
    testTimeoutMs: 10_000,
    dryRun: true,
    aiProvider: "anthropic",
    aiModel: "test",
    storage: { backend: "memory" },
    cache: { strategy: "memory", ttlMs: 300_000, maxEntries: 256 },
    mode: "spec",
    discoveryPath: "src",
    augment: false,
    coverageThreshold: 0.7,
    augmentStrategy: "smart-merge",
    ...overrides,
  };
}

describe("buildContainer", () => {
  it("returns a container with all services registered", async () => {
    const config = testConfig();
    const c = await buildContainer(config);

    expect(c).toBeInstanceOf(Container);

    const resolvedConfig = c.get("config");
    expect(resolvedConfig).toBe(config);
    expect(resolvedConfig.dryRun).toBe(true);
  });

  it("registers storage service", async () => {
    const c = await buildContainer(testConfig());
    const storage = c.get("storage");
    expect(storage).toBeDefined();
    expect(typeof storage.putSession).toBe("function");
    expect(typeof storage.getSession).toBe("function");
  });

  it("registers cache service", async () => {
    const c = await buildContainer(testConfig());
    const cache = c.get("cache");
    expect(cache).toBeDefined();
    expect(typeof cache.get).toBe("function");
    expect(typeof cache.set).toBe("function");
  });

  it("registers skillManager service", async () => {
    const c = await buildContainer(testConfig());
    const sm = c.get("skillManager");
    expect(sm).toBeDefined();
  });

  it("registers tools service", async () => {
    const c = await buildContainer(testConfig());
    const tools = c.get("tools");
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("registers runState service", async () => {
    const c = await buildContainer(testConfig());
    const rs = c.get("runState");
    expect(rs).toBeDefined();
    expect(typeof rs).toBe("object");
  });

  it("runState is a singleton (shared across gets)", async () => {
    const c = await buildContainer(testConfig());
    const rs1 = c.get("runState");
    const rs2 = c.get("runState");
    expect(rs1).toBe(rs2);
  });

  it("runState is mutable across tools", async () => {
    const c = await buildContainer(testConfig());
    const rs = c.get("runState");
    rs.testField = "hello";
    const rsAgain = c.get("runState");
    expect(rsAgain.testField).toBe("hello");
  });
});

describe("SwagenHarness — container constructor", () => {
  it("creates harness from container", async () => {
    const config = testConfig();
    const container = await buildContainer(config);
    const harness = new SwagenHarness(container);

    expect(harness.config).toBe(config);
    expect(harness.storage).toBe(container.get("storage"));
    expect(harness.cache).toBe(container.get("cache"));
    expect(harness.skillManager).toBe(container.get("skillManager"));
    expect(harness.container).toBe(container);
  });

  it("creates harness via static create() method", async () => {
    const config = testConfig();
    const harness = await SwagenHarness.create(config);

    expect(harness.config.dryRun).toBe(true);
    expect(harness.storage).toBeDefined();
    expect(harness.cache).toBeDefined();
    expect(harness.skillManager).toBeDefined();
    expect(harness.container).toBeDefined();
  });

  it("legacy constructor still works", () => {
    const config = testConfig();
    const storage = new MemoryStorage();
    const cache = new MemoryCache();
    const harness = new SwagenHarness(config, storage, cache, null);

    expect(harness.config).toBe(config);
    expect(harness.storage).toBe(storage);
    expect(harness.cache).toBe(cache);
    expect(harness.skillManager).toBeNull();
    expect(harness.container).toBeNull();
  });

  it("legacy constructor defaults skillManager to null", () => {
    const config = testConfig();
    const storage = new MemoryStorage();
    const cache = new MemoryCache();
    const harness = new SwagenHarness(config, storage, cache);

    expect(harness.skillManager).toBeNull();
  });

  it("harness from container resolves tools from container", async () => {
    const config = testConfig();
    const container = await buildContainer(config);
    const harness = new SwagenHarness(container);

    const harnessTools = (harness as any).container?.get("tools");
    expect(Array.isArray(harnessTools)).toBe(true);
  });
});
