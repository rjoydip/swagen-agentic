import { describe, it, expect } from "bun:test";
import {
  parseTestStructure,
  analyzeTestPatterns,
  generateUnitTests,
  mergeTestFiles,
  readTestFile,
} from "../../src/core/augmenter.ts";
import type { SourceEntity, SwagenConfig, GeneratedFile } from "../../src/core/types.ts";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SAMPLE_TEST = `import { describe, it, expect } from "bun:test";

describe("UserService", () => {
  it("should get user", async () => {
    const result = await getUser("1");
    expect(result).toBeDefined();
  });

  it("should handle error", async () => {
    expect.assertions(1);
    try {
      await getUser("");
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});
`;

const EMPTY_TEST = ``;

function makeEntity(overrides: Partial<SourceEntity>): SourceEntity {
  return {
    type: "function",
    entityKind: "declaration",
    name: "testFn",
    file: "src/test.ts",
    line: 1,
    column: 0,
    isAsync: false,
    isExported: true,
    ...overrides,
  };
}

function makeConfig(): SwagenConfig {
  return {
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
}

describe("parseTestStructure", () => {
  it("parses describe blocks and tests", () => {
    const structure = parseTestStructure(SAMPLE_TEST);
    expect(structure.blocks.length).toBeGreaterThanOrEqual(1);
    const describeBlock = structure.blocks.find((b) => b.type === "describe");
    expect(describeBlock).toBeDefined();
    expect(describeBlock!.name).toBe("UserService");
  });

  it("parses it blocks inside describe", () => {
    const structure = parseTestStructure(SAMPLE_TEST);
    const describeBlock = structure.blocks.find((b) => b.type === "describe");
    expect(describeBlock!.children.length).toBe(2);
    expect(describeBlock!.children.map((c) => c.name)).toContain("should get user");
  });

  it("handles empty content", () => {
    const structure = parseTestStructure(EMPTY_TEST);
    expect(structure).toBeDefined();
    expect(structure.blocks.length).toBe(0);
  });

  it("detects test conventions", () => {
    const structure = parseTestStructure(SAMPLE_TEST);
    expect(structure.conventions.runner).toBe("bun");
    expect(structure.conventions.usesDescribe).toBe(true);
  });

  it("detects vitest runner from import", () => {
    const vitestTest = `import { describe, it, expect } from "vitest";\n\ndescribe("suite", () => {\n  it("works", () => {\n    expect(1).toBe(1);\n  });\n});`;
    const structure = parseTestStructure(vitestTest);
    expect(structure.conventions.runner).toBe("vitest");
  });

  it("detects vitest runner with single quotes", () => {
    const vitestTest = `import { test } from 'vitest';\ntest("works", () => {});`;
    const structure = parseTestStructure(vitestTest);
    expect(structure.conventions.runner).toBe("vitest");
  });

  it("detects bun as default runner when no vitest import", () => {
    const bunTest = `import { describe, it, expect } from "bun:test";\n\ndescribe("suite", () => {\n  it("works", () => {\n    expect(1).toBe(1);\n  });\n});`;
    const structure = parseTestStructure(bunTest);
    expect(structure.conventions.runner).toBe("bun");
  });

  it("detects bun as default when no import at all", () => {
    const noImport = `describe("suite", () => {\n  it("works", () => {\n    expect(1).toBe(1);\n  });\n});`;
    const structure = parseTestStructure(noImport);
    expect(structure.conventions.runner).toBe("bun");
  });

  it("detects assert-style assertions", () => {
    const assertTest = `import { describe, it } from "bun:test";\nimport assert from "node:assert";\n\ndescribe("suite", () => {\n  it("works", () => {\n    assert.ok(true);\n  });\n});`;
    const structure = parseTestStructure(assertTest);
    expect(structure.conventions.assertionStyle).toBe("assert");
  });

  it("detects expect-style assertions", () => {
    const expectTest = `import { describe, it, expect } from "bun:test";\n\ndescribe("suite", () => {\n  it("works", () => {\n    expect(1).toBe(1);\n  });\n});`;
    const structure = parseTestStructure(expectTest);
    expect(structure.conventions.assertionStyle).toBe("expect");
  });

  it("detects async/await usage", () => {
    const asyncTest = `import { describe, it, expect } from "bun:test";\n\ndescribe("suite", () => {\n  it("async test", async () => {\n    const result = await fetch("/api");\n    expect(result).toBeDefined();\n  });\n});`;
    const structure = parseTestStructure(asyncTest);
    expect(structure.conventions.usesAsyncAwait).toBe(true);
  });

  it("detects no async/await in sync tests", () => {
    const syncTest = `import { describe, it } from "bun:test";\n\ndescribe("suite", () => {\n  it("sync test", () => {\n    expect(1).toBe(1);\n  });\n});`;
    const structure = parseTestStructure(syncTest);
    expect(structure.conventions.usesAsyncAwait).toBe(false);
  });
});

describe("analyzeTestPatterns", () => {
  it("returns default patterns for empty file list", () => {
    const patterns = analyzeTestPatterns([]);
    expect(patterns.runner).toBe("bun");
    expect(patterns.assertionStyle).toBe("expect");
  });
});

describe("generateUnitTests", () => {
  it("generates test files for entities", () => {
    const entities = [makeEntity({ name: "getUser" })];
    const files = generateUnitTests(entities, makeConfig(), {
      runner: "bun",
      usesDescribe: true,
      usesAsyncAwait: true,
      assertionStyle: "expect",
    });
    expect(files.length).toBe(1);
    expect(files[0]!.content).toContain("getUser");
    expect(files[0]!.relativePath).toContain(".test.ts");
  });

  it("generates multiple test files for entities in different files", () => {
    const entities = [
      makeEntity({ name: "fn1", file: "src/a.ts" }),
      makeEntity({ name: "fn2", file: "src/b.ts" }),
    ];
    const files = generateUnitTests(entities, makeConfig(), {
      runner: "bun",
      usesDescribe: true,
      usesAsyncAwait: false,
      assertionStyle: "expect",
    });
    expect(files.length).toBe(2);
  });

  it("generates imports for source entities", () => {
    const entities = [makeEntity({ name: "getUser" })];
    const files = generateUnitTests(entities, makeConfig(), {
      runner: "bun",
      usesDescribe: true,
      usesAsyncAwait: true,
      assertionStyle: "expect",
    });
    expect(files[0]!.content).toContain("import { getUser }");
  });
});

describe("mergeTestFiles", () => {
  it("returns generated files unchanged when no existing file", () => {
    const gen = [
      {
        relativePath: "src/test.test.ts",
        content: "test content",
        testCount: 1,
      },
    ];
    const merged = mergeTestFiles(gen, "/nonexistent", "smart-merge");
    expect(merged).toEqual(gen);
  });
});

describe("readTestFile", () => {
  it("returns null for non-existent file", () => {
    const result = readTestFile("/nonexistent/test.ts");
    expect(result).toBeNull();
  });
});

// ─── Smart-merge unit tests ────────────────────────────────────────────────────

function setupTempDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "augment-test-"));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

describe("mergeTestFiles — smart-merge strategy", () => {
  it("appends a new describe block when no match exists in existing file", () => {
    const dir = setupTempDir({
      "services/user.test.ts": `import { describe, it, expect } from "bun:test";\n\ndescribe("auth", () => {\n  it("should login", () => {\n    expect(1).toBe(1);\n  });\n});\n`,
    });
    const gen = [
      {
        relativePath: "services/user.test.ts",
        content: `describe("user", () => {\n  it("should create user", () => {\n    expect(2).toBe(2);\n  });\n});`,
        testCount: 1,
      },
    ];
    const merged = mergeTestFiles(gen, dir, "smart-merge");
    expect(merged.length).toBe(1);
    // Original block preserved, new block appended
    expect(merged[0]!.content).toContain('describe("auth"');
    expect(merged[0]!.content).toContain('describe("user"');
    expect(merged[0]!.content).toContain("should login");
    expect(merged[0]!.content).toContain("should create user");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("mergeTestFiles — append strategy", () => {
  it("appends generated content after existing content", () => {
    const dir = setupTempDir({
      "test.test.ts": `describe("existing", () => {\n  it("test 1", () => {});\n});`,
    });
    const gen = [
      {
        relativePath: "test.test.ts",
        content: `describe("new", () => {\n  it("test 2", () => {});\n});`,
        testCount: 1,
      },
    ];
    const merged = mergeTestFiles(gen, dir, "append");
    const content = merged[0]!.content;
    expect(content).toContain('describe("new"');
    expect(content).toContain('describe("existing"');
    rmSync(dir, { recursive: true, force: true });
  });

  it("smart-merge with matching describe block inserts new tests", () => {
    const dir = setupTempDir({
      "user.test.ts": `import { describe, it, expect } from "bun:test";\ndescribe("user", () => {\n  it("existing test", () => {\n    expect(1).toBe(1);\n  });\n});\n`,
    });
    const gen: GeneratedFile[] = [
      {
        relativePath: "user.test.ts",
        content: `describe("user", () => {\n  it("new test", () => {\n    expect(2).toBe(2);\n  });\n});`,
        testCount: 1,
      },
    ];
    const merged = mergeTestFiles(gen, dir, "smart-merge");
    expect(merged[0]!.content).toContain("existing test");
    expect(merged[0]!.content).toContain("new test");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fallback indent is 2 when file has no indented content", () => {
    const dir = setupTempDir({
      "empty.test.ts": ``,
    });
    const gen: GeneratedFile[] = [
      {
        relativePath: "empty.test.ts",
        content: `describe("fallback", () => {});`,
        testCount: 0,
      },
    ];
    const merged = mergeTestFiles(gen, dir, "smart-merge");
    expect(merged[0]!.content).toContain('describe("fallback"');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("generateUnitTests — entity import type extraction", () => {
  it("does not import built-in TS types", () => {
    const entities: SourceEntity[] = [
      {
        type: "function",
        entityKind: "declaration",
        name: "processData",
        file: "src/utils.ts",
        line: 5,
        column: 0,
        isAsync: false,
        isExported: true,
        signature: "export function processData(input: string, config: AppConfig): Promise<Result>",
      },
    ];
    const files = generateUnitTests(entities, makeConfig(), {
      runner: "bun",
      usesDescribe: true,
      usesAsyncAwait: true,
      assertionStyle: "expect",
    });
    const content = files[0]!.content;
    // Built-in types like string and Promise should NOT appear
    expect(content).not.toContain("import type { string");
    expect(content).not.toContain("import type { Promise");
    // User-defined types AppConfig and Result SHOULD appear (combined line)
    expect(content).toContain("import type { AppConfig, Result }");
  });

  it("does not extract types from function body content", () => {
    const entities: SourceEntity[] = [
      {
        type: "function",
        entityKind: "declaration",
        name: "doStuff",
        file: "src/utils.ts",
        line: 5,
        column: 0,
        isAsync: false,
        isExported: true,
        // Multi-line signature where body contains types
        signature:
          "export function doStuff(input: RequestData): ResponseData { const cache: InternalCache = new InternalCache(); return {} }",
      },
    ];
    const files = generateUnitTests(entities, makeConfig(), {
      runner: "bun",
      usesDescribe: true,
      usesAsyncAwait: false,
      assertionStyle: "expect",
    });
    const content = files[0]!.content;
    // Body types like InternalCache should NOT be imported
    expect(content).not.toContain("InternalCache");
    // Decl-only types should appear
    expect(content).toContain("RequestData");
    expect(content).toContain("ResponseData");
  });
});
