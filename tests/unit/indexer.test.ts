import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), "swagen-idx-test-" + Date.now());

describe("indexer", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(join(TEST_DIR, "src"), { recursive: true });
    mkdirSync(join(TEST_DIR, "tests"), { recursive: true });
    mkdirSync(join(TEST_DIR, "specs"), { recursive: true });

    writeFileSync(join(TEST_DIR, "src/api.ts"), "export const api = { url: '/api' };");
    writeFileSync(
      join(TEST_DIR, "src/items.ts"),
      "import { api } from './api.js';\nexport const items = () => fetch(api.url);",
    );
    writeFileSync(
      join(TEST_DIR, "tests/items.test.ts"),
      `
      import { describe, it, expect } from "bun:test";
      describe("items", () => {
        it("returns items", () => expect(true).toBe(true));
        it("handles errors", () => {});
      });
    `,
    );
    writeFileSync(join(TEST_DIR, "specs/openapi.yaml"), "openapi: 3.0.0\ninfo:\n  title: test\n");
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("builds and loads an index", async () => {
    const { buildIndex, loadIndex } = await import("../../src/indexer.js");
    const idx = await buildIndex(TEST_DIR);
    expect(idx.files.length).toBeGreaterThan(0);
    expect(idx.version).toBe(1);
    expect(idx.root).toBe(TEST_DIR);

    const loaded = await loadIndex(TEST_DIR);
    expect(loaded).not.toBeNull();
    expect(loaded!.files.length).toBe(idx.files.length);
  });

  it("categorizes files correctly", async () => {
    const { buildIndex } = await import("../../src/indexer.js");
    const idx = await buildIndex(TEST_DIR);

    const sourceFiles = idx.files.filter((f) => f.type === "source");
    const testFiles = idx.files.filter((f) => f.type === "test");
    const specFiles = idx.files.filter((f) => f.type === "spec");

    expect(sourceFiles.length).toBeGreaterThan(0);
    expect(testFiles.length).toBeGreaterThan(0);
    expect(specFiles.length).toBeGreaterThan(0);

    expect(sourceFiles.some((f) => f.path.includes("api.ts"))).toBe(true);
    expect(testFiles.some((f) => f.path.includes("items.test.ts"))).toBe(true);
    expect(specFiles.some((f) => f.path.includes("openapi.yaml"))).toBe(true);
  });

  it("extracts test names", async () => {
    const { buildIndex } = await import("../../src/indexer.js");
    const idx = await buildIndex(TEST_DIR);
    expect(idx.testNames.length).toBeGreaterThan(0);
    expect(idx.testNames).toContain("returns items");
    expect(idx.testNames).toContain("handles errors");
  });

  it("builds import graph", async () => {
    const { buildIndex } = await import("../../src/indexer.js");
    const idx = await buildIndex(TEST_DIR);
    const itemsEntry = Object.entries(idx.importGraph).find(([k]) => k.includes("items"))?.[1];
    expect(itemsEntry).toBeTruthy();
    expect(itemsEntry!.some((i) => i.includes("api"))).toBe(true);
  });

  it("searchIndex finds files by path", async () => {
    const { buildIndex, searchIndex } = await import("../../src/indexer.js");
    const idx = await buildIndex(TEST_DIR);
    const results = searchIndex(idx, "items");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.path.includes("items"))).toBe(true);
  });

  it("searchTests finds tests by name", async () => {
    const { buildIndex, searchTests } = await import("../../src/indexer.js");
    const idx = await buildIndex(TEST_DIR);
    const results = searchTests(idx, "returns");
    expect(results.length).toBeGreaterThan(0);
    expect(results).toContain("returns items");
  });

  it("getIndex loads cached index or builds new", async () => {
    const { getIndex, buildIndex } = await import("../../src/indexer.js");
    await buildIndex(TEST_DIR);
    const idx2 = await getIndex(TEST_DIR);
    expect(idx2.files.length).toBeGreaterThan(0);
  });
});
