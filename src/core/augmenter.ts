import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";

import type { SourceEntity, SwagenConfig, GeneratedFile } from "./types.ts";

const BUILT_IN_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "null",
  "undefined",
  "void",
  "never",
  "any",
  "unknown",
  "bigint",
  "symbol",
  "true",
  "false",
  "Promise",
  "Array",
  "Record",
  "Partial",
  "Required",
  "Readonly",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "ReturnType",
  "Parameters",
  "Awaited",
  "Capitalize",
  "Uncapitalize",
  "Uppercase",
  "Lowercase",
  "Function",
  "Error",
  "Date",
  "RegExp",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "Buffer",
  "URL",
  "URLSearchParams",
  "File",
  "Blob",
]);

// ─── Test file parsing ───────────────────────────────────────────────────────

export interface TestBlock {
  type: "describe" | "it" | "test" | "beforeAll" | "afterAll" | "beforeEach" | "afterEach";
  name: string;
  body: string;
  children: TestBlock[];
  startLine: number;
  endLine: number;
}

export interface TestFileStructure {
  imports: string[];
  blocks: TestBlock[];
  rawContent: string;
  conventions: {
    runner: "bun" | "vitest";
    usesDescribe: boolean;
    usesAsyncAwait: boolean;
    assertionStyle: "expect" | "assert" | "should";
  };
}

export function readTestFile(path: string): TestFileStructure | null {
  const absPath = join(process.cwd(), path);
  if (!existsSync(absPath)) return null;
  try {
    const content = readFileSync(absPath, "utf-8");
    return parseTestStructure(content);
  } catch {
    return null;
  }
}

export function parseTestStructure(content: string): TestFileStructure {
  const lines = content.split("\n");
  const importLines: string[] = [];
  const blocks: TestBlock[] = [];
  let currentDescribe: TestBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const trimmed = line.trim();

    // Reset currentDescribe when we've passed its end line
    if (currentDescribe && i >= currentDescribe.endLine) {
      currentDescribe = null;
    }

    // Collect import lines
    if (trimmed.startsWith("import ")) {
      importLines.push(trimmed);
      continue;
    }

    // Parse describe blocks
    const describeMatch = trimmed.match(/describe\(["'`]([^"'`]+)["'`]/);
    if (describeMatch) {
      const blockName = describeMatch[1] ?? "unknown";
      const block: TestBlock = {
        type: "describe",
        name: blockName,
        body: "",
        children: [],
        startLine: i + 1,
        endLine: findBlockEnd(lines, i),
      };
      blocks.push(block);
      currentDescribe = block;
      continue;
    }

    // Parse it/test blocks
    const itMatch = trimmed.match(/(?:it|test)\(["'`]([^"'`]+)["'`]/);
    if (itMatch) {
      const testName = itMatch[1] ?? "unknown test";
      const block: TestBlock = {
        type: "it",
        name: testName,
        body: "",
        children: [],
        startLine: i + 1,
        endLine: findBlockEnd(lines, i),
      };
      if (currentDescribe) {
        currentDescribe.children.push(block);
      } else {
        blocks.push(block);
      }
    }

    // Parse lifecycle hooks
    for (const hook of ["beforeAll", "afterAll", "beforeEach", "afterEach"]) {
      if (trimmed.startsWith(hook)) {
        const block: TestBlock = {
          type: hook as TestBlock["type"],
          name: hook,
          body: "",
          children: [],
          startLine: i + 1,
          endLine: findBlockEnd(lines, i),
        };
        blocks.push(block);
        break;
      }
    }
  }

  // Detect conventions
  const conventions = {
    runner:
      content.includes('from "vitest"') || content.includes("from 'vitest'")
        ? ("vitest" as const)
        : ("bun" as const),
    usesDescribe: blocks.some((b) => b.type === "describe"),
    usesAsyncAwait: content.includes("async ") || content.includes("await "),
    assertionStyle: content.includes("assert.") ? ("assert" as const) : ("expect" as const),
  };

  return { imports: importLines, blocks, rawContent: content, conventions };
}

export function analyzeTestPatterns(files: string[]): TestFileStructure["conventions"] {
  let runner: "bun" | "vitest" = "bun";
  let usesDescribe = false;
  let usesAsyncAwait = false;
  const styleCounts: Record<string, number> = { expect: 0, assert: 0, should: 0 };

  for (const file of files) {
    try {
      const content = readFileSync(join(process.cwd(), file), "utf-8");
      const structure = parseTestStructure(content);
      if (structure.conventions.runner === "vitest") runner = "vitest";
      if (structure.conventions.usesDescribe) usesDescribe = true;
      if (structure.conventions.usesAsyncAwait) usesAsyncAwait = true;
      styleCounts[structure.conventions.assertionStyle] =
        (styleCounts[structure.conventions.assertionStyle] ?? 0) + 1;
    } catch {
      // skip
    }
  }

  // Majority voting for assertion style
  const assertionStyle = (Object.entries(styleCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    "expect") as "expect" | "assert" | "should";

  return { runner, usesDescribe, usesAsyncAwait, assertionStyle };
}

// ─── Unit test generation ────────────────────────────────────────────────────

export function generateUnitTests(
  entities: SourceEntity[],
  config: SwagenConfig,
  conventions: TestFileStructure["conventions"],
): GeneratedFile[] {
  const byFile = groupEntitiesByFile(entities);
  const files: GeneratedFile[] = [];

  const EXT_RE = /\.(tsx?|mts|jsx?|mjs|cjs)$/;

  for (const [filePath, fileEntities] of byFile) {
    const importPath = filePath.replace(EXT_RE, ".js");
    const testPath = filePath.replace(EXT_RE, ".test.ts");

    const testName = filePath.split("/").pop()?.replace(EXT_RE, "") ?? "unknown";
    const importLine =
      conventions.runner === "vitest"
        ? `import { describe, it, expect } from "vitest";`
        : `import { describe, it, expect } from "bun:test";`;

    const testBlocks = fileEntities.map((entity) => {
      const imports = buildEntityImport(entity, importPath);
      const testCases = buildTestCases(entity, conventions);
      return { imports, testCases };
    });

    const allImports = [...new Set(testBlocks.flatMap((b) => b.imports))];
    const allTestCases = testBlocks.flatMap((b) => b.testCases);

    const content = [
      `// Generated by swagen — do not edit manually`,
      `// Source: ${filePath}`,
      ``,
      importLine,
      ...allImports,
      ``,
      `describe("${testName}", () => {`,
      ...allTestCases.map((t) => `  ${t}`),
      `});`,
      ``,
    ].join("\n");

    files.push({
      relativePath: config.outDir ? `${config.outDir}/${testPath}` : testPath,
      content,
      testCount: allTestCases.length,
    });
  }

  return files;
}

function buildEntityImport(entity: SourceEntity, importPath: string): string[] {
  const imports: string[] = [];
  // Add main import for the entity
  if (entity.visibility === "default") {
    imports.push(`import ${entity.name} from "${importPath}";`);
  } else {
    imports.push(`import { ${entity.name} } from "${importPath}";`);
  }

  // Extract types from signature — restrict to declaration only (before body brace)
  const sig = entity.signature ?? "";
  const sigHead = sig.split("{")[0] ?? "";
  const typeMatch = sigHead.match(/: (\w+)/g);
  const genericMatch = sigHead.match(/<(\w+)>/g);
  const allTypeCandidates = [
    ...(typeMatch ?? []).map((m) => m.replace(": ", "")),
    ...(genericMatch ?? []).map((m) => m.replace(/[<>]/g, "")),
  ];
  if (allTypeCandidates.length > 0) {
    const types = [
      ...new Set(
        allTypeCandidates.filter((t) => !BUILT_IN_TYPES.has(t) && t[0]?.toUpperCase() === t[0]),
      ),
    ];
    if (types.length > 0) {
      imports.push(`import type { ${types.join(", ")} } from "${importPath}";`);
    }
  }

  return imports;
}

function buildTestCases(
  entity: SourceEntity,
  conventions: TestFileStructure["conventions"],
): string[] {
  const tests: string[] = [];

  if (entity.type === "function") {
    tests.push(`it("should call ${entity.name} successfully", async () => {`);
    tests.push(`  const result = await ${entity.name}();`);
    tests.push(
      `  ${conventions.assertionStyle === "assert" ? "assert.ok(result)" : "expect(result).toBeDefined()"};`,
    );
    tests.push(`});`);

    // Error case
    tests.push(`it("should handle errors from ${entity.name}", async () => {`);
    tests.push(
      `  ${conventions.assertionStyle === "assert" ? "// expect.assertions not needed with assert" : "expect.assertions(1);"}`,
    );
    tests.push(`  try {`);
    tests.push(`    await ${entity.name}();`);
    tests.push(`  } catch (error) {`);
    tests.push(
      `    ${conventions.assertionStyle === "assert" ? "assert.ok(error)" : "expect(error).toBeDefined()"};`,
    );
    tests.push(`  }`);
    tests.push(`});`);
  } else if (entity.type === "class") {
    tests.push(`it("should instantiate ${entity.name}", async () => {`);
    tests.push(`  const instance = new ${entity.name}();`);
    if (conventions.assertionStyle === "assert") {
      tests.push(`  assert.ok(instance);`);
    } else {
      tests.push(`  expect(instance).toBeInstanceOf(${entity.name});`);
    }
    tests.push(`});`);
  }

  return tests;
}

// ─── Smart merge ─────────────────────────────────────────────────────────────

export function mergeTestFiles(
  generated: GeneratedFile[],
  existingDir: string,
  strategy: "smart-merge" | "append" | "separate" = "smart-merge",
): GeneratedFile[] {
  const results: GeneratedFile[] = [];

  for (const gen of generated) {
    const existingPath = isAbsolute(existingDir)
      ? join(existingDir, gen.relativePath)
      : join(process.cwd(), existingDir, gen.relativePath);
    const existingContent = existsSync(existingPath) ? readFileSync(existingPath, "utf-8") : null;

    if (!existingContent) {
      // No existing file, use as-is
      results.push(gen);
      continue;
    }

    switch (strategy) {
      case "append": {
        // Append new tests after existing content
        const merged = existingContent.trimEnd() + "\n\n" + gen.content;
        results.push({
          ...gen,
          content: merged,
          testCount: gen.testCount + countTests(existingContent),
        });
        break;
      }
      case "separate": {
        // Create a separate augmentation file
        const augPath = gen.relativePath.replace(/\.test\.ts$/, ".augment.test.ts");
        results.push({ ...gen, relativePath: augPath });
        break;
      }
      case "smart-merge":
      default: {
        // Smart merge: insert new tests into matching describe blocks
        const merged = smartMergeContent(existingContent, gen.content);
        results.push({
          ...gen,
          content: merged,
          testCount: gen.testCount + countTests(existingContent),
        });
        break;
      }
    }
  }

  return results;
}

function smartMergeContent(existing: string, generated: string): string {
  const existingLines = existing.split("\n");
  const genStructure = parseTestStructure(generated);
  const existingStructure = parseTestStructure(existing);

  // Track cumulative line offset after each splice to keep indices valid
  let lineOffset = 0;
  const indentSize = detectIndent(existing);

  for (const genBlock of genStructure.blocks) {
    if (genBlock.type === "describe") {
      const matchingBlock = existingStructure.blocks.find(
        (b) => b.type === "describe" && normalizeName(b.name) === normalizeName(genBlock.name),
      );
      if (matchingBlock) {
        // Insert new test cases into matching describe block
        const childNames = new Set(matchingBlock.children.map((c) => normalizeName(c.name)));
        const newTests = genBlock.children.filter((c) => !childNames.has(normalizeName(c.name)));
        if (newTests.length > 0) {
          // Find insertion point (just before closing of describe)
          const insertLine = matchingBlock.endLine - 2 + lineOffset;
          const generatedLines = generated.split("\n");
          const newBlocks = newTests.map((t) => {
            const testLines = generatedLines.slice(t.startLine - 1, t.endLine);
            return reindentBlock(testLines, indentSize);
          });
          existingLines.splice(insertLine, 0, ...newBlocks.flat());
          lineOffset += newBlocks.reduce((s, b) => s + b.length, 0);
        }
      } else {
        // No matching describe — append the whole block
        const genLines =
          genBlock.startLine > 0
            ? generated.split("\n").slice(genBlock.startLine - 1, genBlock.endLine)
            : [];
        if (genLines.length > 0) {
          existingLines.push("", ...genLines);
          // push doesn't affect earlier splice positions, no offset needed
        }
      }
    }
  }

  return existingLines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupEntitiesByFile(entities: SourceEntity[]): Map<string, SourceEntity[]> {
  const byFile = new Map<string, SourceEntity[]>();
  for (const entity of entities) {
    const existing = byFile.get(entity.file) ?? [];
    existing.push(entity);
    byFile.set(entity.file, existing);
  }
  return byFile;
}

function findBlockEnd(lines: string[], start: number): number {
  let depth = 0;
  let foundOpen = false;
  let inString: string | null = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const prev = ci > 0 ? line[ci - 1] : "";
      // Toggle string state (skip escaped quotes)
      if (!inString && (ch === '"' || ch === "'" || ch === "`") && prev !== "\\") {
        inString = ch;
        continue;
      }
      if (inString === ch && prev !== "\\") {
        inString = null;
        continue;
      }
      if (inString) continue;
      if (ch === "{") {
        depth++;
        foundOpen = true;
      } else if (ch === "}") depth--;
    }
    if (foundOpen && depth === 0) return i + 1;
  }
  return lines.length;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function detectIndent(existing: string): number {
  const indents = existing.match(/^( {2,4})(?=\S)/gm);
  if (!indents || indents.length === 0) return 2;
  const counts = new Map<number, number>();
  for (const i of indents) {
    const len = i.length;
    counts.set(len, (counts.get(len) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

function reindentBlock(lines: string[], targetBase: number): string[] {
  // Determine the base indent unit (smallest positive indent in the block)
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return lines;
  const indents = nonEmpty.map((l) => l.match(/^(\s*)/)?.[1]?.length ?? 0).filter((i) => i > 0);
  const baseUnit = indents.length > 0 ? Math.min(...indents) : targetBase;
  return lines.map((l) => {
    if (l.trim().length === 0) return "";
    const curIndent = l.match(/^(\s*)/)?.[1]?.length ?? 0;
    const level = baseUnit > 0 ? Math.round(curIndent / baseUnit) : 0;
    return " ".repeat(level * targetBase) + l.trimStart();
  });
}

function countTests(content: string): number {
  return (content.match(/\b(it|test)\s*\(/g) ?? []).length;
}
