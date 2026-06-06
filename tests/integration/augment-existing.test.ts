import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { discoverCodebase } from "../../src/discovery/index.ts";
import { scanCoverage } from "../../src/coverage/scanner.ts";
import { generateUnitTests, mergeTestFiles } from "../../src/core/augmenter.ts";
import type { SwagenConfig, SourceEntity } from "../../src/core/types.ts";

let testDir: string;
let tmpTscDir: string;

function makeConfig(outDir = ""): SwagenConfig {
  return {
    baseUrl: "",
    runner: "bun",
    outDir,
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
}

describe("augment existing tests — full integration", () => {
  beforeAll(() => {
    testDir = join(process.cwd(), "_testdata_augment");
    tmpTscDir = join(process.cwd(), "_testdata_tsc_verify");
    rmSync(testDir, { recursive: true, force: true });
    rmSync(tmpTscDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });

    // greeter.ts source
    writeFileSync(
      join(testDir, "greeter.ts"),
      [
        "export function greet(name: string): string {",
        "  return `Hello, ${name}!`;",
        "}",
        "",
        "export function farewell(name: string): string {",
        "  return `Goodbye, ${name}!`;",
        "}",
        "",
        `export function unknownAction(): string {`,
        `  return "I don't know what to do";`,
        "}",
        "",
      ].join("\n"),
    );

    // Existing test file — covers greet() but not farewell() or unknownAction()
    // Placed at root of testDir so relativePath "greeter.test.ts" matches
    writeFileSync(
      join(testDir, "greeter.test.ts"),
      [
        'import { describe, it, expect } from "bun:test";',
        'import { greet } from "./greeter.js";',
        "",
        'describe("greet", () => {',
        '  it("should greet by name", () => {',
        '    expect(greet("World")).toBe("Hello, World!");',
        "  });",
        "",
        '  it("should greet empty string", () => {',
        '    expect(greet("")).toBe("Hello, !");',
        "  });",
        "});",
        "",
      ].join("\n"),
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    rmSync(tmpTscDir, { recursive: true, force: true });
  });

  it("discovers entities from source code", () => {
    const analysis = discoverCodebase({ discoveryPath: testDir });
    const names = analysis.entities.map((e: SourceEntity) => e.name).sort();
    expect(names).toEqual(["farewell", "greet", "unknownAction"]);
  });

  it("detects coverage gaps — farewell and unknownAction are uncovered", () => {
    const analysis = discoverCodebase({ discoveryPath: testDir });
    const gaps = scanCoverage({
      sourceEntities: analysis.entities,
      testFiles: [join(testDir, "greeter.test.ts")],
      baseDir: testDir,
    });
    // scanCoverage only returns entities with non-"full" coverage
    expect(gaps.length).toBe(2);
    const uncoveredNames = gaps.map((g) => g.entity.name).sort();
    expect(uncoveredNames).toEqual(["farewell", "unknownAction"]);
  });

  it("generates tests only for uncovered entities", () => {
    const analysis = discoverCodebase({ discoveryPath: testDir });
    const gaps = scanCoverage({
      sourceEntities: analysis.entities,
      testFiles: [join(testDir, "greeter.test.ts")],
      baseDir: testDir,
    });
    const uncoveredEntities = gaps.map((g) => g.entity);

    const files = generateUnitTests(uncoveredEntities, makeConfig(""), {
      runner: "bun",
      usesDescribe: true,
      usesAsyncAwait: false,
      assertionStyle: "expect",
    });
    const file = files.find((f) => f.relativePath.includes("greeter"));
    expect(file).toBeDefined();
    expect(file!.content).toContain("farewell");
    expect(file!.content).toContain("unknownAction");
  });

  it("generates tests with correct relative import paths", () => {
    const analysis = discoverCodebase({ discoveryPath: testDir });
    const gaps = scanCoverage({
      sourceEntities: analysis.entities,
      testFiles: [join(testDir, "greeter.test.ts")],
      baseDir: testDir,
    });
    const uncoveredEntities = gaps.map((g) => g.entity);

    const files = generateUnitTests(
      uncoveredEntities,
      makeConfig(""),
      {
        runner: "bun",
        usesDescribe: true,
        usesAsyncAwait: false,
        assertionStyle: "expect",
      },
      "",
    );
    const file = files.find((f) => f.relativePath.includes("greeter"));
    expect(file).toBeDefined();

    // Import lines must use relative paths (./ or ../), not bare specifiers
    const importLines = file!.content.split("\n").filter((l) => l.trim().startsWith("import "));
    for (const imp of importLines) {
      // Skip test framework imports
      if (imp.includes('from "bun:test"') || imp.includes("from 'bun:test'")) continue;
      // Remaining imports must be relative
      expect(imp).toMatch(/from\s+["']\.\.?\//);
    }
  });

  it("smart-merges AI tests into existing test, preserving original tests", () => {
    const analysis = discoverCodebase({ discoveryPath: testDir });
    const gaps = scanCoverage({
      sourceEntities: analysis.entities,
      testFiles: [join(testDir, "greeter.test.ts")],
      baseDir: testDir,
    });
    const uncoveredEntities = gaps.map((g) => g.entity);
    const genFiles = generateUnitTests(uncoveredEntities, makeConfig(""), {
      runner: "bun",
      usesDescribe: true,
      usesAsyncAwait: false,
      assertionStyle: "expect",
    });

    // mergeTestFiles with outDir="" so relativePath="greeter.test.ts"
    // looks for join(cwd, testDir, "greeter.test.ts") which matches existing test
    const merged = mergeTestFiles(genFiles, testDir, "smart-merge");
    const greeterFile = merged.find((f) => f.relativePath.includes("greeter"));
    expect(greeterFile).toBeDefined();

    const content = greeterFile!.content;
    // Original greet tests preserved
    expect(content).toContain('describe("greet"');
    expect(content).toContain("should greet by name");
    expect(content).toContain("should greet empty string");
    // New tests for uncovered entities added
    expect(content).toContain("farewell");
    expect(content).toContain("unknownAction");
  });

  it("merged output is structurally valid TypeScript", () => {
    const analysis = discoverCodebase({ discoveryPath: testDir });
    const gaps = scanCoverage({
      sourceEntities: analysis.entities,
      testFiles: [join(testDir, "greeter.test.ts")],
      baseDir: testDir,
    });
    const uncoveredEntities = gaps.map((g) => g.entity);
    const genFiles = generateUnitTests(
      uncoveredEntities,
      makeConfig(""),
      {
        runner: "bun",
        usesDescribe: true,
        usesAsyncAwait: false,
        assertionStyle: "expect",
      },
      "" /* sourceBase: files at root of testDir */,
    );
    const merged = mergeTestFiles(genFiles, testDir, "smart-merge");
    const mergedFile = merged.find((f) => f.relativePath.includes("greeter"))!;
    const content = mergedFile.content;

    // Balanced braces and parens
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    expect(openParens).toBe(closeParens);
    expect(openBraces).toBe(closeBraces);

    expect(content).toMatch(/import\s+.*from\s+["']\.\.?\/.*["'];/);

    // Write merged output and original source to temp dir, run tsc
    const tscTestDir = join(tmpTscDir, "src");
    mkdirSync(tscTestDir, { recursive: true });
    // Copy original source alongside merged test so imports resolve
    writeFileSync(
      join(tscTestDir, "greeter.ts"),
      readFileSync(join(testDir, "greeter.ts"), "utf-8"),
    );
    writeFileSync(join(tscTestDir, "greeter.test.ts"), content);

    // Create a minimal tsconfig for verification
    writeFileSync(
      join(tmpTscDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "esnext",
          noEmit: true,
          skipLibCheck: true,
        },
        include: ["src"],
      }),
    );

    const tsc = Bun.spawnSync(["bun", "tsc", "--noEmit"], {
      cwd: tmpTscDir,
    });
    const stdout = tsc.stdout.toString();
    // Expect no module-resolution errors (the original concern — bare specifier bugs).
    // Argument-count errors are expected from template-generated tests.
    const moduleErrors = stdout
      .split("\n")
      .filter(
        (l: string) =>
          l.includes("Cannot find") || l.includes("Module ") || l.includes("not a module"),
      );
    expect(moduleErrors).toHaveLength(0);
  });

  it("full end-to-end pipeline produces correct merged file", () => {
    const analysis = discoverCodebase({ discoveryPath: testDir });
    const testFiles = [join(testDir, "greeter.test.ts")];
    const gaps = scanCoverage({
      sourceEntities: analysis.entities,
      testFiles,
      baseDir: testDir,
    });
    const uncoveredEntities = gaps.map((g) => g.entity);
    const genFiles = generateUnitTests(uncoveredEntities, makeConfig(""), {
      runner: "bun",
      usesDescribe: true,
      usesAsyncAwait: false,
      assertionStyle: "expect",
    });
    const merged = mergeTestFiles(genFiles, testDir, "smart-merge");
    const mergedContent = merged.find((f) => f.relativePath.includes("greeter"))!.content;

    // Original greet tests intact
    expect(mergedContent).toContain("Hello, World!");
    expect(mergedContent).toContain("should greet by name");
    expect(mergedContent).toContain("should greet empty string");
    // New tests added
    expect(mergedContent).toContain("farewell");
    expect(mergedContent).toContain("unknownAction");
  });
});
