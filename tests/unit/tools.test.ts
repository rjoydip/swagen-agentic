import { describe, it, expect } from "bun:test";
import { createTools } from "../../src/tools/index.ts";
import { MemoryCache } from "../../src/cache.ts";
import { DEFAULT_CONFIG, type SwagenConfig } from "../../src/core/types.ts";

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
    expect(tools.length).toBe(16);
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
});
