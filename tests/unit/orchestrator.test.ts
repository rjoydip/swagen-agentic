import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { runParallel, splitAndGenerate } from "../../src/orchestrator.ts";

describe("runParallel", () => {
  it("returns empty for no tasks", async () => {
    const results = await runParallel([]);
    expect(results).toEqual([]);
  });

  it("runs a single task", async () => {
    const results = await runParallel([
      {
        id: "test1",
        prompt: "Say hello and nothing else.",
        config: { aiProvider: "anthropic", aiModel: "claude-opus-4-5-20251101" },
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("test1");
  });

  it("runs multiple tasks", async () => {
    const results = await runParallel([
      {
        id: "a",
        prompt: "Say hello.",
        config: { aiProvider: "anthropic", aiModel: "claude-opus-4-5-20251101" },
      },
      {
        id: "b",
        prompt: "Say goodbye.",
        config: { aiProvider: "anthropic", aiModel: "claude-opus-4-5-20251101" },
      },
    ]);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });

  it("handles concurrency limit", async () => {
    const config = { aiProvider: "anthropic", aiModel: "claude-opus-4-5-20251101" };
    const results = await runParallel(
      [
        { id: "a", prompt: "Say hi.", config },
        { id: "b", prompt: "Say bye.", config },
        { id: "c", prompt: "Say ok.", config },
      ],
      { concurrency: 2 },
    );
    expect(results).toHaveLength(3);
  });
});

describe("splitAndGenerate", () => {
  it("propagates loadSpec errors for non-existent spec", async () => {
    // splitAndGenerate internally calls loadSpec which throws for bad paths
    await expect(splitAndGenerate("/nonexistent/spec.yaml", 1)).rejects.toThrow();
  });

  it("propagates loadSpec errors for zero agents", async () => {
    await expect(splitAndGenerate("/nonexistent/spec.yaml", 0)).rejects.toThrow();
  });
});

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── splitAndGenerate — empty endpoints path (lines 131-132) ────────────────

describe("splitAndGenerate — empty endpoints", () => {
  const TEST_DIR = join(tmpdir(), "swagen-orch-empty-" + Date.now());
  let specPath: string;

  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    specPath = join(TEST_DIR, "empty-spec.json");
    writeFileSync(
      specPath,
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Empty API", version: "1.0.0" },
        paths: {},
      }),
    );
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("returns empty results when spec has no endpoints (line 131-132)", async () => {
    const result = await splitAndGenerate(specPath, 1, {
      aiProvider: "faux",
      aiModel: "faux-model",
    });
    expect(result).toEqual({ results: [], totalEndpoints: 0, totalFiles: [] });
  });
});

// ─── splitAndGenerate — single-agent / multi-agent paths ────────────────────
// Lines 134-154 (single agent) and 157-178 (multi-agent) cannot be exercised
// without a model. splitAndGenerate → SwagenHarness.create → runToCompletion
// calls getModel() internally, which only looks up models from the generated
// MODELS constant. The faux provider registers an API provider but does NOT
// add its models to MODELS, so getModel("faux", ...) returns undefined. These
// paths require a real AI provider + API key or harness-level model injection
// (not supported by splitAndGenerate).
