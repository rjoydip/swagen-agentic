import { describe, it, expect } from "bun:test";
import { SwagenHarness } from "../../src/harness.ts";
import { MemoryStorage } from "../../src/storage.ts";
import { MemoryCache } from "../../src/cache.ts";
import { DEFAULT_CONFIG } from "../../src/core/types.ts";
import type { SwagenConfig, ResolvedEndpoint, GeneratedFile } from "../../src/core/types.ts";
import { registerFauxProvider, fauxAssistantMessage, type Model } from "@earendil-works/pi-ai";

function makeConfig(overrides: Partial<SwagenConfig> = {}): SwagenConfig {
  return {
    ...DEFAULT_CONFIG,
    baseUrl: "http://localhost:3000",
    auth: { type: "none" },
    aiProvider: "faux",
    aiModel: "faux-model",
    storage: { backend: "memory" },
    cache: { strategy: "memory", ttlMs: 300_000, maxEntries: 256 },
    mode: "spec",
    ...overrides,
  } as SwagenConfig;
}

function makeEndpoint(overrides: Partial<ResolvedEndpoint> = {}): ResolvedEndpoint {
  return {
    operationId: "test",
    path: "/test",
    method: "get",
    summary: "",
    tags: [],
    params: [],
    body: undefined,
    responses: [],
    security: [],
    deprecated: false,
    ...overrides,
  };
}

function makeFile(overrides: Partial<GeneratedFile> = {}): GeneratedFile {
  return {
    relativePath: "test.ts",
    content: "it('works', () => {});",
    testCount: 1,
    ...overrides,
  };
}

// ─── buildSkillContext (lines 312-318) ──────────────────────────────────────

describe("SwagenHarness — buildSkillContext", () => {
  it("returns SkillContext with config, endpoints, and projectContext", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    const endpoints = [makeEndpoint()];

    const ctx = await harness.buildSkillContext(endpoints);

    expect(ctx.config).toBeDefined();
    expect(ctx.config.aiProvider).toBe("faux");
    expect(ctx.endpoints).toHaveLength(1);
    expect(ctx.endpoints[0]?.operationId).toBe("test");
    expect(ctx.projectContext).toBeDefined();
    expect(typeof ctx.projectContext.testRunner).toBe("string");
  });

  it("returns empty endpoints when passed empty array", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    const ctx = await harness.buildSkillContext([]);
    expect(ctx.endpoints).toEqual([]);
  });
});

// ─── applyBeforeGenerateHooks (lines 325-333) ───────────────────────────────

describe("SwagenHarness — applyBeforeGenerateHooks", () => {
  it("modifies endpoints through a beforeGenerate hook", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    harness.activeHooks = [
      {
        beforeGenerate: async (eps) => eps.filter((e) => !e.deprecated),
      },
    ];

    const endpoints = [
      makeEndpoint({ operationId: "active" }),
      makeEndpoint({ operationId: "dep", deprecated: true }),
    ];

    const result = await harness.applyBeforeGenerateHooks(endpoints);
    expect(result).toHaveLength(1);
    expect(result[0]?.operationId).toBe("active");
  });

  it("returns endpoints unchanged when no hooks active", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    const result = await harness.applyBeforeGenerateHooks([makeEndpoint()]);
    expect(result).toHaveLength(1);
  });

  it("chains multiple hooks in order", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    harness.activeHooks = [
      { beforeGenerate: async (eps) => eps.filter((e) => !e.deprecated) },
      { beforeGenerate: async (eps) => eps.map((e) => ({ ...e, summary: "modified" })) },
    ];

    const endpoints = [
      makeEndpoint({ operationId: "keep" }),
      makeEndpoint({ operationId: "skip", deprecated: true }),
    ];

    const result = await harness.applyBeforeGenerateHooks(endpoints);
    expect(result).toHaveLength(1);
    expect(result[0]?.operationId).toBe("keep");
    expect(result[0]?.summary).toBe("modified");
  });

  it("skips hooks without beforeGenerate method", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    harness.activeHooks = [{ afterGenerate: async (f) => f }];
    const result = await harness.applyBeforeGenerateHooks([makeEndpoint()]);
    expect(result).toHaveLength(1);
  });
});

// ─── applyAfterGenerateHooks (lines 340-352) ────────────────────────────────

describe("SwagenHarness — applyAfterGenerateHooks", () => {
  it("modifies files through an afterGenerate hook", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    harness.activeHooks = [
      {
        afterGenerate: async (files) =>
          files.map((f) => ({ ...f, content: `// HEADER\n${f.content}` })),
      },
    ];

    const result = await harness.applyAfterGenerateHooks([makeFile()], {
      endpointCount: 1,
      skippedCount: 0,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toContain("// HEADER");
  });

  it("returns files unchanged when no hooks active", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    const result = await harness.applyAfterGenerateHooks([makeFile()], {
      endpointCount: 1,
      skippedCount: 0,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe("it('works', () => {});");
  });

  it("skips hooks without afterGenerate method", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    harness.activeHooks = [{ beforeGenerate: async (e) => e }];
    const result = await harness.applyAfterGenerateHooks([makeFile()], {
      endpointCount: 1,
      skippedCount: 0,
    });
    expect(result).toHaveLength(1);
  });

  it("passes meta to afterGenerate hook", async () => {
    const harness = new SwagenHarness(makeConfig(), new MemoryStorage(), new MemoryCache(), null);
    let captured: { endpointCount: number; skippedCount: number } | undefined;
    harness.activeHooks = [
      {
        afterGenerate: async (files, meta) => {
          captured = meta;
          return files;
        },
      },
    ];

    await harness.applyAfterGenerateHooks([makeFile()], {
      endpointCount: 5,
      skippedCount: 2,
    });
    expect(captured).toEqual({ endpointCount: 5, skippedCount: 2 });
  });
});

// ─── runToCompletion (line 303) ────────────────────────────────────────────

describe("SwagenHarness — runToCompletion", () => {
  it("returns a HarnessRunResult with sessionId and agentSummary", async () => {
    const provider = registerFauxProvider();
    try {
      const fauxModel = provider.getModel() as Model<any>;
      provider.setResponses([fauxAssistantMessage("All done.")]);

      const harness = await SwagenHarness.create({
        ...makeConfig(),
        aiModel: fauxModel.id,
      });

      const result = await harness.runToCompletion({
        model: fauxModel,
        prompt: "Say hello.",
        persist: false,
      });

      expect(result.sessionId).toBeTruthy();
      expect(typeof result.agentSummary).toBe("string");
      expect(result.agentSummary.length).toBeGreaterThan(0);
    } finally {
      provider.unregister();
    }
  }, 10_000);
});
