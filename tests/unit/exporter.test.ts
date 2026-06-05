import { describe, it, expect } from "bun:test";
import { formatDiscoveryPrompt, formatEntitySummary } from "../../src/discovery/exporter.ts";
import type { CodebaseAnalysis, SourceEntity } from "../../src/core/types.ts";

function makeAnalysis(overrides?: Partial<CodebaseAnalysis>): CodebaseAnalysis {
  return {
    entities: [],
    dependencies: [],
    coverageGaps: [],
    entryPoints: [],
    apiEndpoints: [],
    framework: "unknown",
    ...overrides,
  };
}

function makeEntity(name: string, overrides?: Partial<SourceEntity>): SourceEntity {
  return {
    type: "function",
    name,
    file: "src/test.ts",
    line: 10,
    column: 0,
    isAsync: false,
    isExported: true,
    ...overrides,
  };
}

describe("formatDiscoveryPrompt", () => {
  it("returns header with framework and counts", () => {
    const result = formatDiscoveryPrompt(
      makeAnalysis({ framework: "express", entities: [makeEntity("foo"), makeEntity("bar")] }),
    );
    expect(result).toContain("Codebase Discovery Results");
    expect(result).toContain("express");
    expect(result).toContain("2");
  });

  it("lists coverage gaps when present", () => {
    const entity = makeEntity("uncoveredFn");
    const result = formatDiscoveryPrompt(
      makeAnalysis({
        coverageGaps: [{ entity, coverage: "none", gapDescription: "no tests", existingTests: [] }],
      }),
    );
    expect(result).toContain("Coverage Gaps");
    expect(result).toContain("uncoveredFn");
    expect(result).toContain("none");
  });

  it("truncates long gap lists at 20", () => {
    const gap = {
      entity: makeEntity("fn"),
      coverage: "none" as const,
      gapDescription: "",
      existingTests: [] as string[],
    };
    const gaps = Array.from({ length: 25 }, (_, i) => ({ ...gap, entity: makeEntity(`fn${i}`) }));
    const result = formatDiscoveryPrompt(makeAnalysis({ coverageGaps: gaps }));
    expect(result).toContain("... and 5 more");
  });

  it("omits coverage gaps section when empty", () => {
    const result = formatDiscoveryPrompt(makeAnalysis());
    expect(result).not.toContain("Coverage Gaps");
  });

  it("includes api endpoint count", () => {
    const result = formatDiscoveryPrompt(makeAnalysis({ apiEndpoints: [makeEntity("getUsers")] }));
    expect(result).toContain("1");
  });

  it("includes entry points", () => {
    const result = formatDiscoveryPrompt(makeAnalysis({ entryPoints: ["src/index.ts"] }));
    expect(result).toContain("src/index.ts");
  });
});

describe("formatEntitySummary", () => {
  it("formats entities with type, name, export, file, line", () => {
    const result = formatEntitySummary([makeEntity("myFunc")]);
    expect(result).toContain("myFunc");
    expect(result).toContain("function");
    expect(result).toContain("exported");
    expect(result).toContain("src/test.ts:10");
  });

  it("marks async entities", () => {
    const result = formatEntitySummary([makeEntity("asyncFunc", { isAsync: true })]);
    expect(result).toContain("async");
  });

  it("respects custom limit", () => {
    const entities = Array.from({ length: 10 }, (_, i) => makeEntity(`fn${i}`));
    const result = formatEntitySummary(entities, 3);
    expect(result.split("\n").length).toBe(3);
  });
});
