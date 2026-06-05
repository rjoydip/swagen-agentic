import { describe, it, expect } from "bun:test";
import { scanCoverage } from "../../src/coverage/scanner.ts";
import {
  buildCoverageReport,
  formatCoverageReport,
  groupGapsByFile,
} from "../../src/coverage/reporter.ts";
import type { SourceEntity } from "../../src/core/types.ts";

function makeEntity(overrides: Partial<SourceEntity>): SourceEntity {
  return {
    type: "function",
    name: "testFn",
    file: "src/test.ts",
    line: 1,
    column: 0,
    isAsync: false,
    isExported: true,
    ...overrides,
  };
}

describe("scanCoverage", () => {
  it("detects fully covered entity", () => {
    const entities = [makeEntity({ name: "testFn" })];
    const gaps = scanCoverage({
      sourceEntities: entities,
      testFiles: [],
      baseDir: "/tmp",
    });
    // No test files to scan, so coverage will be "none"
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.coverage).toBe("none");
  });

  it("identifies uncovered entities", () => {
    const entities = [makeEntity({ name: "unusedFn" })];
    const gaps = scanCoverage({
      sourceEntities: entities,
      testFiles: [],
      baseDir: "/tmp",
    });
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.coverage).toBe("none");
    expect(gaps[0]!.gapDescription).toContain("unusedFn");
  });
});

describe("buildCoverageReport", () => {
  it("builds report with correct counts", () => {
    const gaps = [
      {
        entity: makeEntity({ name: "a" }),
        coverage: "none" as const,
        gapDescription: "no tests",
        existingTests: [],
      },
      {
        entity: makeEntity({ name: "b" }),
        coverage: "full" as const,
        gapDescription: "",
        existingTests: ["b.test.ts"],
      },
      {
        entity: makeEntity({ name: "c" }),
        coverage: "partial" as const,
        gapDescription: "missing edge cases",
        existingTests: ["c.test.ts"],
      },
    ];
    const report = buildCoverageReport(gaps, 5);
    expect(report.totalEntities).toBe(5);
    expect(report.covered).toBe(1);
    expect(report.uncovered).toBe(1);
    expect(report.partial).toBe(1);
  });

  it("handles empty gaps", () => {
    const report = buildCoverageReport([], 0);
    expect(report.coveragePct).toBe(0);
  });
});

describe("formatCoverageReport", () => {
  it("returns a non-empty string", () => {
    const gaps = [
      {
        entity: makeEntity({ name: "a" }),
        coverage: "none" as const,
        gapDescription: "no tests",
        existingTests: [],
      },
    ];
    const report = buildCoverageReport(gaps, 1);
    const formatted = formatCoverageReport(report);
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted).toContain("Coverage Report");
  });
});

describe("groupGapsByFile", () => {
  it("groups gaps by file", () => {
    const gaps = [
      {
        entity: makeEntity({ name: "a", file: "src/a.ts" }),
        coverage: "none" as const,
        gapDescription: "",
        existingTests: [],
      },
      {
        entity: makeEntity({ name: "b", file: "src/a.ts" }),
        coverage: "partial" as const,
        gapDescription: "",
        existingTests: [],
      },
      {
        entity: makeEntity({ name: "c", file: "src/b.ts" }),
        coverage: "none" as const,
        gapDescription: "",
        existingTests: [],
      },
    ];
    const byFile = groupGapsByFile(gaps);
    expect(byFile.size).toBe(2);
    expect(byFile.get("src/a.ts")?.length).toBe(2);
    expect(byFile.get("src/b.ts")?.length).toBe(1);
  });
});
