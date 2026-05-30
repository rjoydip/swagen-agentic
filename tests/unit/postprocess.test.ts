import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";

import {
  stripUnusedImports,
  deduplicateTests,
  parseImports,
  escapeRegex,
  postProcessGeneratedFiles,
} from "../../src/core/postprocess.ts";
import type { GeneratedFile } from "../../src/core/types.ts";

// ─── stripUnusedImports ───────────────────────────────────────────────────

describe("stripUnusedImports", () => {
  it("removes an unused named import", () => {
    const code = [`import { unused } from "./utils";`, `const x = 1;`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).not.toContain("unused");
    expect(result).not.toContain(`import {`);
  });

  it("keeps a used named import", () => {
    const code = [`import { used } from "./utils";`, `const x = used;`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).toContain("used");
    expect(result).toContain(`import { used }`);
  });

  it("narrows a mixed import to only used names", () => {
    const code = [`import { used, unused } from "./utils";`, `const x = used;`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).toContain("used");
    expect(result).not.toContain("unused");
    expect(result).toContain(`import { used }`);
  });

  it("removes unused default import", () => {
    const code = [`import thing from "./utils";`, `const x = 1;`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).not.toContain("thing");
    expect(result).not.toContain(`import`);
  });

  it("keeps used default import", () => {
    const code = [`import thing from "./utils";`, `const x = thing;`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).toContain(`import thing`);
  });

  it("removes unused namespace import", () => {
    const code = [`import * as utils from "./utils";`, `const x = 1;`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).not.toContain("import");
  });

  it("keeps used namespace import", () => {
    const code = [`import * as utils from "./utils";`, `const x = utils.foo;`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).toContain(`import * as utils`);
  });

  it("handles no imports", () => {
    const code = "const x = 1;\n";
    expect(stripUnusedImports(code)).toBe(code);
  });

  it("handles empty string", () => {
    expect(stripUnusedImports("")).toBe("");
  });

  it("handles type imports", () => {
    const code = [`import type { Foo } from "./types";`, `const x: Foo = { a: 1 };`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).toContain("Foo");
    expect(result).toContain(`import type { Foo }`);
  });

  it("does not falsely match similar names", () => {
    const code = [
      `import { format } from "./fmt";`,
      `import { formatDate } from "./date";`,
      `const x = formatDate(new Date());`,
      ``,
    ].join("\n");
    const result = stripUnusedImports(code);
    expect(result).not.toContain(`format } from`);
    expect(result).toContain(`formatDate } from`);
  });

  it("keeps side-effect imports", () => {
    const code = [`import "./polyfill";`, `const x = 1;`, ``].join("\n");
    const result = stripUnusedImports(code);
    expect(result).toContain(`import "./polyfill"`);
  });

  it("collapses blank lines after removals", () => {
    const code = [
      `import { used } from "./a";`,
      `import { unused } from "./b";`,
      `import { alsoUsed } from "./c";`,
      ``,
      `const x = used;`,
      `const y = alsoUsed;`,
      ``,
    ].join("\n");
    const result = stripUnusedImports(code);
    expect(result).not.toContain("unused");
    expect(result).not.toContain("\n\n\n");
  });

  it("keeps imports where all names are used", () => {
    const code = [
      `import { describe, it, expect } from "bun:test";`,
      `describe("test", () => {`,
      `  it("works", () => { expect(1).toBe(1); });`,
      `});`,
      ``,
    ].join("\n");
    const result = stripUnusedImports(code);
    expect(result).toContain(`import { describe, it, expect }`);
  });
});

// ─── deduplicateTests ─────────────────────────────────────────────────────

describe("deduplicateTests", () => {
  it("removes a duplicate it() block", () => {
    const code = [
      `describe("tests", () => {`,
      `  it("first", async () => {`,
      `    expect(1).toBe(1);`,
      `  });`,
      `  it("first", async () => {`,
      `    expect(2).toBe(2);`,
      `  });`,
      `});`,
      ``,
    ].join("\n");
    const result = deduplicateTests(code);
    expect(result).toContain(`it("first"`);
    expect(result).not.toContain("expect(2).toBe(2)");
  });

  it("removes duplicate test() blocks", () => {
    const code = [
      `test("hello", () => {`,
      `  expect(1).toBe(1);`,
      `});`,
      `test("hello", () => {`,
      `  expect(2).toBe(2);`,
      `});`,
      ``,
    ].join("\n");
    const result = deduplicateTests(code);
    expect(result).toContain(`test("hello"`);
    expect((result.match(/test\("hello"/g) ?? []).length).toBe(1);
  });

  it("keeps unique it() blocks", () => {
    const code = [
      `describe("tests", () => {`,
      `  it("first", async () => {`,
      `    expect(1).toBe(1);`,
      `  });`,
      `  it("second", async () => {`,
      `    expect(2).toBe(2);`,
      `  });`,
      `});`,
      ``,
    ].join("\n");
    const result = deduplicateTests(code);
    expect((result.match(/it\("/g) ?? []).length).toBe(2);
  });

  it("handles nested braces in duplicate block", () => {
    const code = [
      `it("nested", () => {`,
      `  if (true) {`,
      `    console.log("hi");`,
      `  }`,
      `});`,
      `it("nested", () => {`,
      `  console.log("dup");`,
      `});`,
      ``,
    ].join("\n");
    const result = deduplicateTests(code);
    expect(result).not.toContain("dup");
  });

  it("handles no duplicates", () => {
    const code = 'it("only", () => {});\n';
    expect(deduplicateTests(code).trim()).toBe(code.trim());
  });

  it("handles empty string", () => {
    expect(deduplicateTests("")).toBe("");
  });

  it("is case-insensitive for titles", () => {
    const code = [`it("GET /api", () => {});`, `it("get /api", () => {});`, ``].join("\n");
    const result = deduplicateTests(code);
    expect((result.match(/it\("/g) ?? []).length).toBe(1);
  });

  it("collapses blank lines after removals", () => {
    const code = [`it("a", () => {});`, ``, `it("a", () => {});`, `it("b", () => {});`, ``].join(
      "\n",
    );
    const result = deduplicateTests(code);
    expect(result).toContain('it("a"');
    expect(result).toContain('it("b"');
    expect(result).not.toContain("\n\n\n");
  });

  it("keeps only first occurrence of duplicate", () => {
    const code = [
      `it("first call works", () => console.log("original"));`,
      `it("first call works", () => console.log("duplicate"));`,
      ``,
    ].join("\n");
    const result = deduplicateTests(code);
    expect(result).toContain("original");
    expect(result).not.toContain("duplicate");
  });
});

// ─── parseImports ─────────────────────────────────────────────────────────

describe("parseImports", () => {
  it("parses named imports", () => {
    const result = parseImports(`import { foo, bar } from "./utils";\n`);
    expect(result).toHaveLength(1);
    expect(result[0]!.names).toEqual(["foo", "bar"]);
    expect(result[0]!.source).toBe("./utils");
  });

  it("parses default imports", () => {
    const result = parseImports(`import thing from "./utils";\n`);
    expect(result).toHaveLength(1);
    expect(result[0]!.names).toEqual(["thing"]);
  });

  it("parses namespace imports", () => {
    const result = parseImports(`import * as utils from "./utils";\n`);
    expect(result).toHaveLength(1);
    expect(result[0]!.names).toEqual(["utils"]);
    expect(result[0]!.isNamespaceImport).toBe(true);
  });

  it("parses type imports", () => {
    const result = parseImports(`import type { Foo } from "./types";\n`);
    expect(result).toHaveLength(1);
    expect(result[0]!.names).toEqual(["Foo"]);
    expect(result[0]!.isTypeImport).toBe(true);
  });

  it("returns empty for no imports", () => {
    expect(parseImports("const x = 1;\n")).toEqual([]);
  });

  it("handles multiple import lines", () => {
    const code = [`import { a } from "./a";`, `import { b } from "./b";`, ``].join("\n");
    expect(parseImports(code)).toHaveLength(2);
  });

  it("parses import with semicolon", () => {
    const result = parseImports(`import { x } from "./x";\n`);
    expect(result).toHaveLength(1);
    expect(result[0]!.names).toEqual(["x"]);
  });

  it("parses import without semicolon", () => {
    const result = parseImports(`import { x } from "./x"\n`);
    expect(result).toHaveLength(1);
  });
});

// ─── escapeRegex ──────────────────────────────────────────────────────────

describe("escapeRegex", () => {
  it("escapes dot", () => {
    expect(escapeRegex("foo.bar")).toBe("foo\\.bar");
  });

  it("escapes plus", () => {
    expect(escapeRegex("foo+bar")).toBe("foo\\+bar");
  });

  it("escapes dollar", () => {
    expect(escapeRegex("foo$bar")).toBe("foo\\$bar");
  });

  it("passes through normal text", () => {
    expect(escapeRegex("hello")).toBe("hello");
    expect(escapeRegex("foo_bar")).toBe("foo_bar");
  });
});

// ─── postProcessGeneratedFiles (integration) ──────────────────────────────

describe("postProcessGeneratedFiles", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync("swagen-pp-");
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function relPath(name: string): string {
    return join(tmpDir, name);
  }

  function write(name: string, content: string): string {
    const rp = relPath(name);
    mkdirSync(dirname(rp), { recursive: true });
    writeFileSync(rp, content);
    return join(process.cwd(), rp);
  }

  it("strips unused imports from written files", async () => {
    const rp = relPath("pets.test.ts");
    const absPath = write(
      "pets.test.ts",
      [
        `import { unused, used } from "./utils";`,
        `import { something } from "./other";`,
        `const x = used;`,
        ``,
      ].join("\n"),
    );
    const files: GeneratedFile[] = [{ relativePath: rp, content: "", testCount: 1 }];

    await postProcessGeneratedFiles(files, tmpDir, {
      format: false,
      deduplicate: false,
      stripUnused: true,
    });

    const result = await Bun.file(absPath).text();
    expect(result).toContain("used");
    expect(result).not.toContain("unused");
    expect(result).not.toContain("something");
  });

  it("deduplicates test files", async () => {
    const rp = relPath("dup.test.ts");
    const absPath = write(
      "dup.test.ts",
      [
        `import { describe, it, expect } from "bun:test";`,
        `describe("tests", () => {`,
        `  it("same", () => { expect(1).toBe(1); });`,
        `  it("same", () => { expect(2).toBe(2); });`,
        `});`,
        ``,
      ].join("\n"),
    );
    const files: GeneratedFile[] = [{ relativePath: rp, content: "", testCount: 2 }];

    await postProcessGeneratedFiles(files, tmpDir, {
      format: false,
      deduplicate: true,
      stripUnused: false,
    });

    const result = await Bun.file(absPath).text();
    expect(result).toContain('it("same"');
    expect((result.match(/it\("same"/g) ?? []).length).toBe(1);
  });

  it("skips non-existent files", async () => {
    const files: GeneratedFile[] = [
      {
        relativePath: relPath("nonexistent/test.ts"),
        content: `import { x } from "./y";\nconst a = x;\n`,
        testCount: 1,
      },
    ];
    await expect(
      postProcessGeneratedFiles(files, tmpDir, {
        format: false,
        deduplicate: false,
        stripUnused: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("handles empty files array", async () => {
    await expect(postProcessGeneratedFiles([], tmpDir)).resolves.toBeUndefined();
  });

  it("does not format when format is disabled", async () => {
    const rp = relPath("noformat.test.ts");
    const messy = "import { x } from './y';\nconst a =   x;\n\n";
    const absPath = write("noformat.test.ts", messy);
    const files: GeneratedFile[] = [{ relativePath: rp, content: "", testCount: 1 }];

    await postProcessGeneratedFiles(files, tmpDir, {
      format: false,
      deduplicate: false,
      stripUnused: false,
    });

    const result = await Bun.file(absPath).text();
    expect(result).toBe(messy);
  });

  it("applies all options together", async () => {
    const rp = relPath("all.test.ts");
    const absPath = write(
      "all.test.ts",
      [
        `import { unused, used } from "./utils";`,
        `import { something } from "./other";`,
        ``,
        `describe("t", () => {`,
        `  it("a", () => { console.log(used); });`,
        `  it("a", () => { console.log("dup"); });`,
        `});`,
        ``,
      ].join("\n"),
    );
    const files: GeneratedFile[] = [{ relativePath: rp, content: "", testCount: 2 }];

    await postProcessGeneratedFiles(files, tmpDir, {
      format: false,
      deduplicate: true,
      stripUnused: true,
    });

    const result = await Bun.file(absPath).text();
    expect(result).toContain("used");
    expect(result).not.toContain("unused");
    expect(result).not.toContain("something");
    expect(result).not.toContain("dup");
  });
});
