/**
 * Example: Codebase Discovery & Test Augmentation
 *
 * This example demonstrates the new codebase mode:
 * 1. Discover entities in a project
 * 2. Scan coverage gaps
 * 3. Generate tests for uncovered entities
 * 4. Smart-merge into existing test files
 *
 * Usage:
 *   bun run examples/codebase-mode.ts
 */

import { discoverCodebase } from "../src/discovery/index.ts";
import { scanCoverage } from "../src/coverage/scanner.ts";
import { generateUnitTests, mergeTestFiles } from "../src/core/augmenter.ts";
import type { SwagenConfig, SourceEntity } from "../src/core/types.ts";

const config: SwagenConfig = {
  baseUrl: "",
  runner: "bun",
  outDir: "tests",
  auth: { type: "none" },
  includeTags: [],
  excludeTags: [],
  skipOperations: [],
  emitFixtures: false,
  emitSetup: false,
  assertStatusCodes: false,
  assertSchemas: false,
  testTimeoutMs: 10_000,
  dryRun: false,
  aiProvider: "anthropic",
  aiModel: "test",
  storage: { backend: "memory" },
  cache: { strategy: "none" },
  mode: "codebase",
  discoveryPath: "src",
  augment: true,
  coverageThreshold: 0.7,
  augmentStrategy: "smart-merge",
};

// ─── Step 1: Discover ──────────────────────────────────────────────────────────

const analysis = discoverCodebase({ discoveryPath: "src" });

console.log(`Framework: ${analysis.framework}`);
console.log(`Entities found: ${analysis.entities.length}`);
console.log(
  `  Functions: ${analysis.entities.filter((e: SourceEntity) => e.type === "function").length}`,
);
console.log(
  `  Classes: ${analysis.entities.filter((e: SourceEntity) => e.type === "class").length}`,
);
console.log(`  Exported: ${analysis.entities.filter((e: SourceEntity) => e.isExported).length}`);
console.log(`  API endpoints: ${analysis.apiEndpoints.length}`);
console.log(`  Entry points: ${analysis.entryPoints.join(", ")}`);

// ─── Step 2: Coverage scan ─────────────────────────────────────────────────────

const testFiles: string[] = [];
const testChecks = analysis.entities.map(async (entity) => {
  const testPath = `tests/${entity.file.replace(/\.(ts|js)$/, ".test.ts")}`;
  if (!testFiles.includes(testPath)) {
    try {
      await Bun.file(testPath).text();
      testFiles.push(testPath);
    } catch {
      // no existing test
    }
  }
});
await Promise.all(testChecks);

const gaps = scanCoverage({
  sourceEntities: analysis.entities,
  testFiles,
  baseDir: process.cwd(),
});

const uncovered = gaps.filter((g) => g.coverage === "none");
console.log(`\nCoverage gaps: ${gaps.length} (${uncovered.length} completely uncovered)`);
for (const gap of uncovered.slice(0, 5)) {
  console.log(`  - ${gap.entity.name} (${gap.entity.file}:${gap.entity.line})`);
}

// ─── Step 3: Generate tests for uncovered entities ─────────────────────────────

const genFiles = generateUnitTests(
  uncovered.map((g) => g.entity),
  config,
  {
    runner: "bun",
    usesDescribe: true,
    usesAsyncAwait: true,
    assertionStyle: "expect",
  },
);

console.log(`\nGenerated ${genFiles.length} test files`);
for (const f of genFiles) {
  console.log(`  ${f.relativePath} (${f.testCount} tests)`);
}

// ─── Step 4: Smart-merge into existing tests ───────────────────────────────────

const merged = mergeTestFiles(genFiles, process.cwd(), "smart-merge");
console.log(`\nMerged ${merged.length} files`);

for (const f of merged) {
  Bun.write(f.relativePath, f.content);
  console.log(`  Written: ${f.relativePath}`);
}
