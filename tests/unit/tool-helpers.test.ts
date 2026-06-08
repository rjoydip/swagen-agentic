import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  mapEndpointsToSummary,
  filterEntitiesByNames,
  parseTestOutput,
  isFileProtected,
  PROTECTED_FILES,
  writeGeneratedFiles,
} from "../../src/shared/tool-helpers.ts";
import type { ResolvedEndpoint, SourceEntity, GeneratedFile } from "../../src/core/types.ts";

describe("mapEndpointsToSummary", () => {
  it("returns summary for each endpoint", () => {
    const endpoints: ResolvedEndpoint[] = [
      {
        operationId: "getPets",
        method: "get",
        path: "/api/pets",
        summary: "List pets",
        tags: ["pets"],
        params: [],
        body: undefined,
        responses: [
          { statusCode: 200, contentType: "application/json", schema: {}, description: "OK" },
        ],
        security: [],
        deprecated: false,
      },
    ];
    const result = mapEndpointsToSummary(endpoints);
    expect(result).toHaveLength(1);
    expect(result[0]?.operationId).toBe("getPets");
    expect(result[0]?.method).toBe("GET");
    expect(result[0]?.deprecated).toBe(false);
  });

  it("marks endpoints with body", () => {
    const endpoints: ResolvedEndpoint[] = [
      {
        operationId: "createPet",
        method: "post",
        path: "/api/pets",
        summary: "Create pet",
        tags: ["pets"],
        params: [],
        body: { required: true, contentType: "application/json", schema: {} },
        responses: [
          { statusCode: 201, contentType: "application/json", schema: {}, description: "Created" },
        ],
        security: [],
        deprecated: false,
      },
    ];
    const result = mapEndpointsToSummary(endpoints);
    expect(result[0]?.hasBody).toBe(true);
  });
});

describe("filterEntitiesByNames", () => {
  it("filters entities matching given names", () => {
    const entities = [
      { name: "getUser", file: "a.ts", line: 1, type: "function", isExported: true },
      { name: "getPets", file: "b.ts", line: 5, type: "function", isExported: true },
      { name: "helper", file: "c.ts", line: 10, type: "function", isExported: false },
    ] as SourceEntity[];
    const result = filterEntitiesByNames(entities, ["getUser", "helper"]);
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe("getUser");
    expect(result[1]?.name).toBe("helper");
  });

  it("returns empty array when no names match", () => {
    const entities = [{ name: "foo" }] as SourceEntity[];
    const result = filterEntitiesByNames(entities, ["nonexistent"]);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty entities", () => {
    const result = filterEntitiesByNames([], ["anything"]);
    expect(result).toEqual([]);
  });
});

describe("parseTestOutput", () => {
  it("parses passed/failed counts from stdout", () => {
    const result = parseTestOutput("10 passed\n2 failed\n", "", 0, Date.now() - 500);
    expect(result.passed).toBe(10);
    expect(result.failed).toBe(2);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("returns 0 for both when no match", () => {
    const result = parseTestOutput("no numbers here", "", 1, Date.now());
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.exitCode).toBe(1);
  });

  it("parses counts from stderr when stdout is empty", () => {
    const result = parseTestOutput("", "5 passed 1 failed", 0, Date.now() - 1000);
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(1);
  });

  it("includes combined output in result", () => {
    const result = parseTestOutput("stdout line", "stderr line", 0, Date.now());
    expect(result.output).toContain("stdout line");
    expect(result.output).toContain("stderr line");
  });
});

describe("isFileProtected", () => {
  it("returns true for protected files that exist", () => {
    expect(isFileProtected("setup.ts", __filename)).toBe(true);
    expect(isFileProtected("fixtures.ts", __filename)).toBe(true);
  });

  it("returns false for non-existent protected files", () => {
    expect(isFileProtected("setup.ts", "/nonexistent/setup.ts")).toBe(false);
  });

  it("returns false for unprotected files", () => {
    expect(isFileProtected("pets.test.ts", __filename)).toBe(false);
  });

  it("recognizes all PROTECTED_FILES", () => {
    expect(PROTECTED_FILES.has("setup.ts")).toBe(true);
    expect(PROTECTED_FILES.has("fixtures.ts")).toBe(true);
    expect(PROTECTED_FILES.size).toBe(2);
  });
});

describe("writeGeneratedFiles", () => {
  it("skips protected files and writes non-protected ones", async () => {
    const tmpDir = mkdtempSync("swagen-th-");
    try {
      mkdirSync(join(tmpDir, "tests", "api"), { recursive: true });
      writeFileSync(join(tmpDir, "tests", "api", "setup.ts"), "// existing setup content\n");

      const files: GeneratedFile[] = [
        { relativePath: "tests/api/setup.ts", content: "// overwritten content", testCount: 1 },
        { relativePath: "tests/api/pets.test.ts", content: "// new test file", testCount: 1 },
      ];
      const result = await writeGeneratedFiles(files, false, tmpDir);
      expect(result.skipped).toContain("tests/api/setup.ts");
      expect(result.written).toContain("tests/api/pets.test.ts");
      expect(result.written).not.toContain("tests/api/setup.ts");

      const setupContent = await Bun.file(join(tmpDir, "tests", "api", "setup.ts")).text();
      expect(setupContent).toBe("// existing setup content\n");

      const petsContent = await Bun.file(join(tmpDir, "tests", "api", "pets.test.ts")).text();
      expect(petsContent).toBe("// new test file");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns skipped list when all files are protected", async () => {
    const tmpDir = mkdtempSync("swagen-th-");
    try {
      mkdirSync(join(tmpDir, "tests", "api"), { recursive: true });
      writeFileSync(join(tmpDir, "tests", "api", "setup.ts"), "// setup\n");
      writeFileSync(join(tmpDir, "tests", "api", "fixtures.ts"), "// fixtures\n");

      const files: GeneratedFile[] = [
        { relativePath: "tests/api/setup.ts", content: "new", testCount: 1 },
        { relativePath: "tests/api/fixtures.ts", content: "new", testCount: 1 },
      ];
      const result = await writeGeneratedFiles(files, false, tmpDir);
      expect(result.skipped).toHaveLength(2);
      expect(result.written).toHaveLength(0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("dryRun=true returns written/skipped but does not write files (lines 107-115)", async () => {
    const tmpDir = mkdtempSync("swagen-th-");
    try {
      mkdirSync(join(tmpDir, "tests", "api"), { recursive: true });
      // Create the protected file first so it's detected
      writeFileSync(join(tmpDir, "tests", "api", "setup.ts"), "// existing setup\n");

      const files: GeneratedFile[] = [
        { relativePath: "tests/api/setup.ts", content: "new setup", testCount: 1 },
        { relativePath: "tests/api/pets.test.ts", content: "new test", testCount: 1 },
      ];
      const result = await writeGeneratedFiles(files, true, tmpDir);

      expect(result.written).toContain("tests/api/pets.test.ts");
      expect(result.skipped).toContain("tests/api/setup.ts");

      // Files should not actually be written
      const petsPath = join(tmpDir, "tests", "api", "pets.test.ts");
      const setupPath = join(tmpDir, "tests", "api", "setup.ts");
      const { existsSync } = require("node:fs");
      expect(existsSync(petsPath)).toBe(false);
      expect(existsSync(setupPath)).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("dryRun=false writes non-protected files to disk", async () => {
    const tmpDir = mkdtempSync("swagen-th-");
    try {
      mkdirSync(join(tmpDir, "tests", "api"), { recursive: true });

      const files: GeneratedFile[] = [
        { relativePath: "tests/api/pets.test.ts", content: "new test", testCount: 1 },
      ];
      const result = await writeGeneratedFiles(files, false, tmpDir);

      expect(result.written).toContain("tests/api/pets.test.ts");

      const petsPath = join(tmpDir, "tests", "api", "pets.test.ts");
      const { readFileSync } = require("node:fs");
      const content = readFileSync(petsPath, "utf-8");
      expect(content).toBe("new test");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
