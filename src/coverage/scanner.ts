import { readFileSync } from "node:fs";
import { relative } from "node:path";
import type { SourceEntity, CoverageGap, CoverageLevel } from "../core/types.ts";

export interface CoverageScanOptions {
  sourceEntities: SourceEntity[];
  testFiles: string[];
  baseDir: string;
}

export function scanCoverage(options: CoverageScanOptions): CoverageGap[] {
  const { sourceEntities, testFiles, baseDir } = options;
  const gaps: CoverageGap[] = [];

  // Read all test file contents
  const testContents: Array<{ path: string; content: string }> = [];
  for (const tf of testFiles) {
    try {
      testContents.push({
        path: relative(baseDir, tf).replace(/\\/g, "/"),
        content: readFileSync(tf, "utf-8"),
      });
    } catch {
      // skip unreadable
    }
  }

  for (const entity of sourceEntities) {
    const refs = findReferences(entity, testContents);
    const coverage = assessCoverage(entity, refs);
    if (coverage !== "full") {
      gaps.push({
        entity,
        coverage,
        gapDescription: buildGapDescription(coverage, entity),
        existingTests: refs.map((r) => r.file),
      });
    }
  }

  return gaps;
}

interface EntityReference {
  file: string;
  line: number;
  type: "import" | "describe" | "it" | "call";
}

function findReferences(
  entity: SourceEntity,
  testContents: Array<{ path: string; content: string }>,
): EntityReference[] {
  const refs: EntityReference[] = [];
  const names = buildNameVariations(entity.name);
  const seen = new Set<string>();

  for (const tc of testContents) {
    const lines = tc.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;

      // Check for import reference
      for (const name of names) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`import\\s+.*\\b${escaped}\\b`).test(line)) {
          const key = `${tc.path}:${i + 1}:import`;
          if (!seen.has(key)) {
            seen.add(key);
            refs.push({ file: tc.path, line: i + 1, type: "import" });
          }
        }
        // Check for describe/it title mentioning entity name
        if (new RegExp(`(?:describe|it|test)\\s*\\(\\s*["'\`][^"'\`]*\\b${escaped}\\b`).test(line)) {
          const key = `${tc.path}:${i + 1}:it`;
          if (!seen.has(key)) {
            seen.add(key);
            refs.push({ file: tc.path, line: i + 1, type: "it" });
          }
        }
        // Check for direct function call
        if (new RegExp(`\\b${escaped}\\s*\\(`).test(line) && !line.trim().startsWith("import")) {
          const key = `${tc.path}:${i + 1}:call`;
          if (!seen.has(key)) {
            seen.add(key);
            refs.push({ file: tc.path, line: i + 1, type: "call" });
          }
        }
      }
    }
  }

  return refs;
}

function assessCoverage(entity: SourceEntity, refs: EntityReference[]): CoverageLevel {
  if (refs.length === 0) return "none";

  const itRefs = refs.filter((r) => r.type === "it");
  const callRefs = refs.filter((r) => r.type === "call");
  const importRefs = refs.filter((r) => r.type === "import");

  // Import-only references do not constitute test coverage
  if (itRefs.length === 0 && callRefs.length === 0) return "none";

  if (itRefs.length >= 2 && callRefs.length >= 1) return "full";
  if (itRefs.length === 1 && callRefs.length >= 1) return "full";
  if (itRefs.length >= 2) return "partial";
  if (itRefs.length === 1) return "partial";
  if (callRefs.length >= 2) return "partial";
  if (callRefs.length === 1) return "low";

  return "low";
}

function buildGapDescription(coverage: CoverageLevel, entity: SourceEntity): string {
  switch (coverage) {
    case "none":
      return `No tests found for ${entity.type} "${entity.name}"`;
    case "low":
      return `Minimal test coverage for ${entity.type} "${entity.name}"`;
    case "partial":
      return `Partial coverage for ${entity.type} "${entity.name}" — missing edge cases`;
    default:
      return "";
  }
}

function buildNameVariations(name: string): string[] {
  const names = [name];
  // CamelCase to kebab-case
  names.push(name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase());
  // CamelCase to snake_case
  names.push(name.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase());
  // Lowercase first letter
  names.push(name.charAt(0).toLowerCase() + name.slice(1));
  return [...new Set(names)];
}
