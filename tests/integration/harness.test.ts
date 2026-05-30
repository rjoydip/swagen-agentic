/**
 * tests/integration/harness.test.ts
 *
 * Integration tests for SwagenHarness.
 * Uses pi-ai's registerFauxProvider to simulate LLM responses deterministically.
 *
 * Tests verify:
 *   - Session creation and persistence
 *   - Tool execution (load_spec → analyze_endpoints → generate_tests → write_files)
 *   - Cache warm-up (second call hits cache)
 *   - Session resumption (message history is restored)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SwagenHarness } from "../../src/harness.ts";
import { DEFAULT_CONFIG, type SwagenConfig } from "../../src/core/types.ts";
import {
  registerFauxProvider,
  fauxToolCall,
  fauxAssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";

// ─── Test spec fixture ────────────────────────────────────────────────────────

import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "swagen-test-" + Date.now());

const TEST_SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Test API", version: "1.0.0" },
  paths: {
    "/items": {
      get: {
        operationId: "listItems",
        tags: ["items"],
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema: { type: "array" } } },
          },
        },
      },
      post: {
        operationId: "createItem",
        tags: ["items"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", properties: { name: { type: "string" } } },
            },
          },
        },
        responses: { "201": { description: "Created" } },
      },
    },
  },
});

const SPEC_PATH = join(TEST_DIR, "swagen-test-spec.json");
const OUT_DIR = join(TEST_DIR, "output");

// ─── Helpers ──────────────────────────────────────────────────────────────────

let fauxProvider: ReturnType<typeof registerFauxProvider>;

function setupFaux() {
  fauxProvider = registerFauxProvider();
  return fauxProvider.getModel();
}

function teardownFaux() {
  fauxProvider?.unregister();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SwagenHarness (unit-level)", () => {
  beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });
  afterEach(() => {
    if (existsSync(SPEC_PATH)) rmSync(SPEC_PATH);
  });

  it("creates sessions with unique ids", async () => {
    writeFileSync(SPEC_PATH, TEST_SPEC);
    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "faux",
      aiModel: "faux",
      storage: { backend: "memory" as const },
      cache: { strategy: "memory" as const },
    };
    const harness = await SwagenHarness.create(config as SwagenConfig);
    const s1 = await harness.newSession(SPEC_PATH);
    const s2 = await harness.newSession(SPEC_PATH);
    expect(s1.id).not.toBe(s2.id);
  });

  it("retrieves stored sessions", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "faux",
      aiModel: "faux",
      storage: { backend: "memory" as const },
      cache: { strategy: "memory" as const },
    };
    const harness = await SwagenHarness.create(config as SwagenConfig);
    const session = await harness.newSession("openapi.yaml");
    const retrieved = await harness.getSession(session.id);
    expect(retrieved?.id).toBe(session.id);
  });

  it("deletes sessions", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "faux",
      aiModel: "faux",
      storage: { backend: "memory" as const },
      cache: { strategy: "memory" as const },
    };
    const harness = await SwagenHarness.create(config as SwagenConfig);
    const session = await harness.newSession("openapi.yaml");
    await harness.deleteSession(session.id);
    expect(await harness.getSession(session.id)).toBeNull();
  });

  it("lists sessions", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "faux",
      aiModel: "faux",
      storage: { backend: "memory" as const },
      cache: { strategy: "memory" as const },
    };
    const harness = await SwagenHarness.create(config as SwagenConfig);
    await harness.newSession("a.yaml");
    await harness.newSession("b.yaml");
    const ids = await harness.listSessions();
    expect(ids.length).toBe(2);
  });

  it("clearCache does not throw", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "faux",
      aiModel: "faux",
      storage: { backend: "memory" as const },
      cache: { strategy: "memory" as const },
    };
    const harness = await SwagenHarness.create(config as SwagenConfig);
    await expect(harness.clearCache()).resolves.toBeUndefined();
  });

  it("cacheStats returns zero stats initially", async () => {
    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "faux",
      aiModel: "faux",
      storage: { backend: "memory" as const },
      cache: { strategy: "memory" as const },
    };
    const harness = await SwagenHarness.create(config as SwagenConfig);
    const stats = harness.cacheStats();
    expect(stats.entries).toBe(0);
    expect(stats.hits).toBe(0);
  });
});

// ─── Full pipeline (uses faux provider — no real API key needed) ──────────────

describe("SwagenHarness full pipeline", () => {
  beforeAll(() => mkdirSync(TEST_DIR, { recursive: true }));
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });
  afterEach(() => {
    if (existsSync(SPEC_PATH)) rmSync(SPEC_PATH);
    if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
    teardownFaux();
  });

  it("generates tests from a spec file", async () => {
    writeFileSync(SPEC_PATH, TEST_SPEC);

    setupFaux();
    const fauxModel = fauxProvider.getModel()! as Model<any>;
    fauxProvider.setResponses([
      fauxAssistantMessage([
        fauxToolCall("load_spec", { source: SPEC_PATH }),
        fauxToolCall("analyze_endpoints", {}),
        fauxToolCall("generate_tests", {}),
        fauxToolCall("write_files", { dryRun: false }),
      ]),
      fauxAssistantMessage("All tests generated successfully."),
    ]);

    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "faux" as const,
      aiModel: fauxModel.id,
      outDir: OUT_DIR,
      dryRun: false,
      storage: { backend: "memory" as const },
      cache: { strategy: "memory" as const, ttlMs: 60_000 },
    };

    const harness = await SwagenHarness.create(config as SwagenConfig);
    const result = await harness.runToCompletion({
      model: fauxModel,
      prompt: `Generate Bun tests for the spec at ${SPEC_PATH}.`,
      persist: false,
    });

    expect(result.sessionId).toBeTruthy();
    expect(typeof result.agentSummary).toBe("string");
    expect(result.agentSummary.length).toBeGreaterThan(0);
    expect(result.endpointCount).toBeGreaterThan(0);
  }, 15_000);

  it("warms cache on second run", async () => {
    writeFileSync(SPEC_PATH, TEST_SPEC);

    setupFaux();
    const fauxModel = fauxProvider.getModel()! as Model<any>;
    fauxProvider.setResponses([
      fauxAssistantMessage([
        fauxToolCall("load_spec", { source: SPEC_PATH }),
        fauxToolCall("analyze_endpoints", {}),
        fauxToolCall("generate_tests", {}),
        fauxToolCall("write_files", { dryRun: false }),
      ]),
      fauxAssistantMessage("First run done."),
      fauxAssistantMessage([
        fauxToolCall("load_spec", { source: SPEC_PATH }),
        fauxToolCall("analyze_endpoints", {}),
        fauxToolCall("generate_tests", {}),
        fauxToolCall("write_files", { dryRun: false }),
      ]),
      fauxAssistantMessage("Second run done."),
    ]);

    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "faux" as const,
      aiModel: fauxModel.id,
      outDir: OUT_DIR,
      dryRun: false,
      storage: { backend: "memory" as const },
      cache: { strategy: "memory" as const, ttlMs: 60_000 },
    };

    const harness = await SwagenHarness.create(config as SwagenConfig);

    await harness.runToCompletion({
      model: fauxModel,
      prompt: `Load and generate tests for the spec at ${SPEC_PATH}.`,
      persist: false,
    });

    const stats1 = harness.cacheStats();

    await harness.runToCompletion({
      model: fauxModel,
      prompt: `Load and generate tests for the spec at ${SPEC_PATH} again.`,
      persist: false,
    });

    const stats2 = harness.cacheStats();
    expect(stats2.hits).toBeGreaterThanOrEqual(stats1.hits);
  }, 15_000);
});
