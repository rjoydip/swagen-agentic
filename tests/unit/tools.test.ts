import { describe, it, expect } from "bun:test";
import { createTools } from "../../src/tools/index.ts";
import { MemoryCache } from "../../src/cache.ts";
import { DEFAULT_CONFIG, type SwagenConfig } from "../../src/core/types.ts";
import type { RunState } from "../../src/di.ts";
import type { OpenAPI } from "openapi-types";

function makeConfig() {
  return {
    ...DEFAULT_CONFIG,
    aiProvider: "anthropic",
    aiModel: "claude-opus-4-5-20251101",
    dryRun: true,
    outDir: ".swagen/tests",
  } as SwagenConfig;
}

describe("createTools", () => {
  it("returns an array of tools", () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThan(0);
  });

  it("returns exactly 16 tools", () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    expect(tools.length).toBe(17);
  });

  it("each tool has name, label, description, parameters, execute", () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.label).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("tool names are unique", () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes all expected tools", () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const names = tools.map((t) => t.name);
    expect(names).toContain("validate_spec");
    expect(names).toContain("load_spec");
    expect(names).toContain("analyze_endpoints");
    expect(names).toContain("generate_tests");
    expect(names).toContain("write_files");
    expect(names).toContain("run_tests");
    expect(names).toContain("read_file");
    expect(names).toContain("get_run_history");
    expect(names).toContain("cache_stats");
    expect(names).toContain("search_files");
    expect(names).toContain("replace_in_files");
    expect(names).toContain("discover_code");
    expect(names).toContain("analyze_entity");
    expect(names).toContain("check_coverage");
    expect(names).toContain("read_existing_tests");
    expect(names).toContain("augment_tests");
    expect(names).toContain("task_complete");
  });

  it("cache_stats tool returns zero stats before any use", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const cacheStatsTool = tools.find((t) => t.name === "cache_stats")!;
    const result = await cacheStatsTool.execute("1", {});
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.entries).toBe(0);
    expect(data.hits).toBe(0);
  });

  it("task_complete tool returns summary with counts", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "task_complete")!;
    const result = await tool.execute("1", {
      summary: "Generated tests for all pets endpoints.",
      endpointCount: 5,
      fileCount: 3,
    });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.summary).toBe("Generated tests for all pets endpoints.");
    expect(data.endpointCount).toBe(5);
    expect(data.fileCount).toBe(3);
  });

  it("task_complete tool defaults counts when not provided", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "task_complete")!;
    const result = await tool.execute("1", { summary: "Done." });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.summary).toBe("Done.");
    expect(typeof data.endpointCount).toBe("number");
    expect(typeof data.fileCount).toBe("number");
  });

  it("search_files returns no matches for nonsense pattern", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "search_files")!;
    const result = await tool.execute("1", {
      pattern: "XYZZY_NOTHING_12345",
      pathPattern: "*.ts",
      maxResults: 5,
    });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.results).toEqual([]);
  });

  it("get_run_history returns array", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "get_run_history")!;
    const result = await tool.execute("1", { limit: 3 });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(Array.isArray(data.records)).toBe(true);
  });

  it("validate_spec returns error for non-existent spec", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "validate_spec")!;
    await expect(tool.execute("1", { source: "nonexistent.yaml" })).rejects.toThrow();
  });

  it("analyze_endpoints throws when load_spec not called first", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "analyze_endpoints")!;
    await expect(tool.execute("1", {})).rejects.toThrow("Call load_spec first");
  });

  it("generate_tests throws when analyze_endpoints not called first", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "generate_tests")!;
    await expect(tool.execute("1", {})).rejects.toThrow("Call analyze_endpoints first");
  });

  it("write_files throws when generate_tests not called first", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "write_files")!;
    await expect(tool.execute("1", {})).rejects.toThrow("Call generate_tests first");
  });

  it("read_file throws for non-existent file", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "read_file")!;
    await expect(tool.execute("1", { path: "_nonexistent_file_xyzzy_98765.ts" })).rejects.toThrow(
      "File not found",
    );
  });

  it("analyze_endpoints with pre-loaded spec returns endpoints", async () => {
    const cache = new MemoryCache();
    const runState: RunState = {
      spec: {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        paths: {
          "/items": {
            get: {
              operationId: "listItems",
              tags: ["items"],
              responses: { "200": { description: "OK" } },
            },
          },
        },
      } as OpenAPI.Document,
    };
    const tools = createTools(makeConfig(), cache, runState);
    const tool = tools.find((t) => t.name === "analyze_endpoints")!;
    const result = await tool.execute("1", {});
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.endpointCount).toBe(1);
    expect(data.endpoints[0].operationId).toBe("listItems");
  });

  it("analyze_endpoints with includeTags filtering", async () => {
    const cache = new MemoryCache();
    const runState: RunState = {
      spec: {
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        paths: {
          "/items": {
            get: {
              operationId: "listItems",
              tags: ["items"],
              responses: { "200": { description: "OK" } },
            },
          },
          "/users": {
            get: {
              operationId: "listUsers",
              tags: ["users"],
              responses: { "200": { description: "OK" } },
            },
          },
        },
      } as OpenAPI.Document,
    };
    const tools = createTools(makeConfig(), cache, runState);
    const tool = tools.find((t) => t.name === "analyze_endpoints")!;
    const result = await tool.execute("1", { includeTags: ["items"] });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.endpointCount).toBe(1);
    expect(data.endpoints[0].operationId).toBe("listItems");
  });

  it("generate_tests with pre-loaded endpoints returns generated files", async () => {
    const cache = new MemoryCache();
    const runState: RunState = {
      endpoints: [
        {
          path: "/items",
          method: "get",
          operationId: "listItems",
          summary: "List items",
          tags: ["items"],
          params: [],
          body: undefined,
          responses: [
            {
              statusCode: 200,
              contentType: "application/json",
              schema: { type: "array" },
              description: "OK",
            },
          ],
          security: [],
          deprecated: false,
        },
      ],
    };
    const tools = createTools(makeConfig(), cache, runState);
    const tool = tools.find((t) => t.name === "generate_tests")!;
    const result = await tool.execute("1", {});
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.fileCount).toBeGreaterThan(0);
    expect(data.totalTests).toBeGreaterThan(0);
  });

  it("generate_tests with operationIds filter", async () => {
    const cache = new MemoryCache();
    const runState: RunState = {
      endpoints: [
        {
          path: "/items",
          method: "get",
          operationId: "listItems",
          summary: "List items",
          tags: ["items"],
          params: [],
          body: undefined,
          responses: [
            {
              statusCode: 200,
              contentType: "application/json",
              schema: { type: "array" },
              description: "OK",
            },
          ],
          security: [],
          deprecated: false,
        },
        {
          path: "/users",
          method: "get",
          operationId: "listUsers",
          summary: "List users",
          tags: ["users"],
          params: [],
          body: undefined,
          responses: [
            {
              statusCode: 200,
              contentType: "application/json",
              schema: { type: "array" },
              description: "OK",
            },
          ],
          security: [],
          deprecated: false,
        },
      ],
    };
    const tools = createTools(makeConfig(), cache, runState);
    const tool = tools.find((t) => t.name === "generate_tests")!;
    const result = await tool.execute("1", { operationIds: ["listItems"] });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.fileCount).toBeGreaterThan(0);
  });

  it("write_files dryRun returns preview content", async () => {
    const cache = new MemoryCache();
    const runState: RunState = {
      generatedFiles: [
        {
          relativePath: ".swagen/tests/tools-test-write-dry.test.ts",
          content: [
            'import { describe, it, expect } from "bun:test";',
            "",
            'describe("write_dry", () => {',
            '  it("works", () => {',
            "    expect(1).toBe(1);",
            "  });",
            "});",
            "",
          ].join("\n"),
          testCount: 1,
        },
      ],
    };
    const tools = createTools(makeConfig(), cache, runState);
    const tool = tools.find((t) => t.name === "write_files")!;
    const result = await tool.execute("1", { dryRun: true });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.dryRun).toBe(true);
    expect(data.files).toBeDefined();
    expect(data.files.length).toBe(1);
    expect(data.files[0].path).toBe(".swagen/tests/tools-test-write-dry.test.ts");
    expect(data.written.length).toBe(1);
  });

  it("write_files with dryRun false writes files and post-processes", async () => {
    const cache = new MemoryCache();
    const config = {
      ...DEFAULT_CONFIG,
      aiProvider: "anthropic",
      aiModel: "claude-opus-4-5-20251101",
      dryRun: false,
      outDir: ".swagen/tests",
    } as SwagenConfig;
    const runState: RunState = {
      generatedFiles: [
        {
          relativePath: ".swagen/tests/tools-test-write-real.test.ts",
          content: [
            'import { describe, it, expect } from "bun:test";',
            "",
            'describe("write_real", () => {',
            '  it("works", () => {',
            "    expect(1).toBe(1);",
            "  });",
            "});",
            "",
          ].join("\n"),
          testCount: 1,
        },
      ],
    };
    const tools = createTools(config, cache, runState);
    const tool = tools.find((t) => t.name === "write_files")!;
    const result = await tool.execute("1", { dryRun: false });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.dryRun).toBe(false);
    expect(data.written.length).toBe(1);
    const { unlinkSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const writtenFile = join(process.cwd(), ".swagen/tests/tools-test-write-real.test.ts");
    if (existsSync(writtenFile)) unlinkSync(writtenFile);
  });

  it("discover_code returns analysis from src directory", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "discover_code")!;
    const result = await tool.execute("1", {});
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.framework).toBeTruthy();
    expect(typeof data.entityCount).toBe("number");
    expect(data.entityCount).toBeGreaterThan(0);
    expect(typeof data.apiEndpoints).toBe("number");
    expect(data.summary).toBeTruthy();
    expect(Array.isArray(data.entities)).toBe(true);
  });

  it("analyze_entity with auto-discovery finds entity", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "analyze_entity")!;
    const result = await tool.execute("1", { name: "createTools" });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.entity.name).toBe("createTools");
    expect(data.entity.type).toBe("function");
    expect(data.coverage).toBeDefined();
  });

  it("analyze_entity throws for non-existent entity name", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "analyze_entity")!;
    await expect(tool.execute("1", { name: "_nonexistent_entity_XYZ_" })).rejects.toThrow(
      'Entity "_nonexistent_entity_XYZ_" not found in codebase',
    );
  });

  it("check_coverage auto-discovers and returns report", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "check_coverage")!;
    const result = await tool.execute("1", {});
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(typeof data.totalEntities).toBe("number");
    expect(data.totalEntities).toBeGreaterThan(0);
    expect(typeof data.totalGaps).toBe("number");
    expect(Array.isArray(data.gaps)).toBe(true);
    expect(typeof data.report).toBe("string");
    expect(data.report.length).toBeGreaterThan(0);
  }, 30_000);

  it("check_coverage filters by maxGapLevel", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "check_coverage")!;
    const result = await tool.execute("1", { maxGapLevel: "none" });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(typeof data.totalGaps).toBe("number");
    expect(Array.isArray(data.gaps)).toBe(true);
  }, 30_000);

  it("read_existing_tests by path parses test structure", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "read_existing_tests")!;
    const result = await tool.execute("1", { path: "tests/unit/tools.test.ts" });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.file).toBe("tests/unit/tools.test.ts");
    expect(data.conventions).toBeTruthy();
    expect(data.conventions.runner).toBe("bun");
    expect(Array.isArray(data.blocks)).toBe(true);
    expect(data.blocks.length).toBeGreaterThan(0);
  });

  it("read_existing_tests throws for non-existent test file", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "read_existing_tests")!;
    await expect(
      tool.execute("1", { path: "_nonexistent_test_file_xyzzy.test.ts" }),
    ).rejects.toThrow("Test file not found");
  });

  it("read_existing_tests auto-discovers test files", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "read_existing_tests")!;
    const result = await tool.execute("1", { maxFiles: 5 });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.fileCount).toBeGreaterThan(0);
    expect(data.conventions).toBeTruthy();
    expect(Array.isArray(data.files)).toBe(true);
  });

  it("augment_tests with auto-discovery returns merged files", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "augment_tests")!;
    const result = await tool.execute("1", { strategy: "append" });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.strategy).toBe("append");
    expect(typeof data.fileCount).toBe("number");
    expect(typeof data.totalTests).toBe("number");
    expect(Array.isArray(data.files)).toBe(true);
  }, 30_000);

  it("augment_tests with targeted entities produces results", async () => {
    const cache = new MemoryCache();
    const runState: RunState = {};
    const config = makeConfig();
    const tools = createTools(config, cache, runState);
    const discoverTool = tools.find((t) => t.name === "discover_code")!;
    await discoverTool.execute("1", {});
    const tool = tools.find((t) => t.name === "augment_tests")!;
    const result = await tool.execute("1", {
      strategy: "separate",
      targetEntities: ["createTools"],
      notes: "Focus on createTools",
    });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.strategy).toBe("separate");
    expect(typeof data.fileCount).toBe("number");
    expect(data.totalTests).toBeGreaterThan(0);
    expect(data.notes).toBe("Focus on createTools");
  }, 30_000);

  it("replace_in_files dry-run finds matches without writing", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "replace_in_files")!;
    const result = await tool.execute("1", {
      pattern: "describe",
      pathPattern: "tests/unit/tools.test.ts",
      dryRun: true,
    });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.dryRun).toBe(true);
    expect(data.changeCount).toBeGreaterThan(0);
    expect(data.changes.length).toBeGreaterThan(0);
    expect(data.changes[0].file).toBe("tests/unit/tools.test.ts");
  });

  it("replace_in_files returns no matches for unknown pattern", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "replace_in_files")!;
    const result = await tool.execute("1", {
      pattern: "this_pattern_should_not_exist_anywhere_98765",
      pathPattern: "__nonexistent_dir_xyz__/**/*.ts",
      dryRun: true,
    });
    const text = result.content[0] as { text: string };
    const data = JSON.parse(text.text);
    expect(data.ok).toBe(true);
    expect(data.changes).toEqual([]);
    expect(data.message).toBe("No matches found.");
  });

  it("replace_in_files non-dry-run actually replaces content", async () => {
    const cache = new MemoryCache();
    const tools = createTools(makeConfig(), cache);
    const tool = tools.find((t) => t.name === "replace_in_files")!;
    const { writeFileSync, unlinkSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const tempFile = join(process.cwd(), "swagen-test-replace-temp.test.ts");
    const originalContent = `const x = "hello world";\n`;
    writeFileSync(tempFile, originalContent, "utf-8");
    try {
      const result = await tool.execute("1", {
        pattern: "hello world",
        replacement: "replaced",
        pathPattern: "swagen-test-replace-temp.test.ts",
        dryRun: false,
      });
      const text = result.content[0] as { text: string };
      const data = JSON.parse(text.text);
      expect(data.ok).toBe(true);
      expect(data.dryRun).toBe(false);
      expect(data.changeCount).toBe(1);
      expect(data.message).toBe("Changes applied.");
      const newContent = readFileSync(tempFile, "utf-8");
      expect(newContent).toContain("replaced");
      expect(newContent).not.toContain("hello world");
      writeFileSync(tempFile, originalContent, "utf-8");
    } finally {
      unlinkSync(tempFile);
    }
  });
});
