import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute, relative, dirname } from "node:path";

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
  sourceBase = "src",
): GeneratedFile[] {
  const byFile = groupEntitiesByFile(entities);
  const files: GeneratedFile[] = [];

  const EXT_RE = /\.(tsx?|mts|jsx?|mjs|cjs)$/;

  for (const [filePath, fileEntities] of byFile) {
    const sourceRelPath = join(sourceBase, filePath).replace(/\\/g, "/");
    const testPath = filePath.replace(EXT_RE, ".test.ts");
    const testRelPath = config.outDir ? `${config.outDir}/${testPath}` : testPath;
    const testDir = dirname(testRelPath);
    const importPath = relative(testDir, sourceRelPath).replace(/\\/g, "/").replace(EXT_RE, ".js");
    const relativeImport = importPath.startsWith(".") ? importPath : `./${importPath}`;

    const testName = filePath.split("/").pop()?.replace(EXT_RE, "") ?? "unknown";
    const importLine =
      conventions.runner === "vitest"
        ? `import { describe, it, expect } from "vitest";`
        : `import { describe, it, expect } from "bun:test";`;

    const testBlocks = fileEntities.map((entity) => {
      const imports = buildEntityImport(entity, relativeImport);
      const testCases = buildTestCases(entity, conventions);
      return { imports, testCases };
    });

    const allImports = mergeImportLines(testBlocks.flatMap((b) => b.imports));
    const allTestCases = testBlocks.flatMap((b) => b.testCases);

    const content = [
      `// Generated by swagen — do not edit manually`,
      `// Source: ${sourceRelPath}`,
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
      relativePath: testRelPath,
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
  // Use paren-depth tracking to skip destructuring braces inside parameter lists
  const sig = entity.signature ?? "";
  const sigHead = extractSigHead(sig);
  const typeMatch = sigHead.match(/: (\w+)/g);
  const genericMatch = sigHead.match(/<(\w+)>/g);
  const extendsMatch = sigHead.match(/extends\s+(\w+)/);
  const implementsMatch = sigHead.match(/implements\s+([^{]+)/);
  const allTypeCandidates = [
    ...(typeMatch ?? []).map((m) => m.replace(": ", "")),
    ...(genericMatch ?? []).map((m) => m.replace(/[<>]/g, "")),
    ...(extendsMatch ? [extendsMatch[1]!] : []),
    ...(implementsMatch
      ? (implementsMatch[1] ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : []),
  ];
  if (allTypeCandidates.length > 0) {
    const types = [
      ...new Set(
        allTypeCandidates.filter(
          (t) => !BUILT_IN_TYPES.has(t) && t[0]?.toUpperCase() === t[0] && !/^[A-Z]$/.test(t), // skip single-letter generic params (T, K, V, etc.)
        ),
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
        // Append new tests after existing content (strip imports to avoid duplicates)
        const bodyOnly = stripImports(gen.content);
        const merged = existingContent.trimEnd() + "\n\n" + bodyOnly;
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
        const augAbsPath = isAbsolute(existingDir)
          ? join(existingDir, augPath)
          : join(process.cwd(), existingDir, augPath);
        const existingAugContent = existsSync(augAbsPath)
          ? readFileSync(augAbsPath, "utf-8")
          : null;
        if (existingAugContent) {
          // Augment file exists — overwrite with new content (separate file is regenerated each run)
          results.push({ ...gen, relativePath: augPath });
        } else {
          results.push({ ...gen, relativePath: augPath });
        }
        break;
      }
      case "smart-merge":
      default: {
        // Smart merge: insert new tests into matching describe blocks
        const merged = smartMergeContent(existingContent, gen.content);
        // Merge any new import lines from generated content
        const existingImports = parseTestStructure(existingContent).imports;
        const genImports = parseTestStructure(gen.content).imports;
        const newImports = genImports.filter((imp) => !existingImports.some((e) => e === imp));
        const finalContent =
          newImports.length > 0
            ? mergeImportLines(newImports).join("\n") + "\n\n" + merged
            : merged;
        results.push({
          ...gen,
          content: finalContent,
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
        const childNames = new Set(matchingBlock.children.map((c) => c.name.toLowerCase()));
        const newTests = genBlock.children.filter((c) => !childNames.has(c.name.toLowerCase()));
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
  return name
    .replace(/([a-z])([A-Z])/g, "$1-$2") // camelCase → kebab
    .toLowerCase()
    .replace(/\s+/g, "-") // spaces → hyphens
    .replace(/_/g, "-") // underscores → hyphens
    .replace(/[^a-z0-9-]/g, "") // strip everything else
    .replace(/-+/g, "-") // collapse runs
    .replace(/^-|-$/g, ""); // trim edges
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

function extractSigHead(sig: string): string {
  let parenDepth = 0;
  for (let i = 0; i < sig.length; i++) {
    if (sig[i] === "(") parenDepth++;
    else if (sig[i] === ")") parenDepth--;
    else if (sig[i] === "{" && parenDepth === 0) return sig.slice(0, i);
  }
  return sig;
}

// Regex to parse import lines into { names, modulePath, isType }
const IMPORT_RE = /import\s+(?:type\s+)?(?:{([^}]+)}|(\w+))\s+from\s+"([^"]+)"/;

function mergeImportLines(lines: string[]): string[] {
  // Group named imports by (modulePath, isType); keep default/unparseable as-is
  const groups = new Map<string, Set<string>>();
  const order: string[] = [];
  const others: string[] = [];

  for (const line of lines) {
    const m = line.match(IMPORT_RE);
    if (!m || m[2]) {
      // Unparseable or default import — keep as-is
      others.push(line);
      continue;
    }
    const names = m[1]!
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    const modulePath = m[3]!;
    const isType = line.includes("import type");
    const key = `${modulePath}:${isType}`;

    if (!groups.has(key)) {
      groups.set(key, new Set());
      order.push(key);
    }
    const set = groups.get(key)!;
    for (const n of names) set.add(n);
  }

  const merged = order.map((key) => {
    const names = [...groups.get(key)!].join(", ");
    const colonIdx = key.lastIndexOf(":");
    const modulePath = key.slice(0, colonIdx);
    const isType = key.slice(colonIdx + 1) === "true";
    const prefix = isType ? "import type" : "import";
    return `${prefix} { ${names} } from "${modulePath}";`;
  });

  return [...merged, ...others];
}

function countTests(content: string): number {
  return (content.match(/\b(it|test)\s*\(/g) ?? []).length;
}

function stripImports(content: string): string {
  return content
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("import ") && !t.startsWith("// Generated");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
