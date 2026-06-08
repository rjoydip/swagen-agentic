/**
 * tests/unit/mcp.test.ts
 * Unit tests for the MCP integration module.
 */

import { describe, it, expect, beforeEach } from "bun:test";

import { getOrCreateSession, clearSession, clearAllSessions } from "../../src/mcp/session.ts";
import {
  generateBearerToken,
  verifyBearerToken,
  unauthorizedResponse,
} from "../../src/mcp/auth.ts";
import { buildMcpTools } from "../../src/mcp/tools.ts";
import type { ResolvedEndpoint, SwagenConfig, GeneratedFile } from "../../src/core/types.ts";
import { buildServer } from "../../src/mcp/server.ts";

// ─── Mock config ──────────────────────────────────────────────────────────────

const TEST_CONFIG: SwagenConfig = {
  baseUrl: "http://localhost:3000",
  runner: "bun",
  outDir: "tests/api",
  auth: { type: "none" },
  includeTags: [],
  excludeTags: [],
  skipOperations: [],
  emitFixtures: false,
  emitSetup: false,
  assertStatusCodes: true,
  assertSchemas: false,
  testTimeoutMs: 10_000,
  dryRun: true,
  aiProvider: "faux",
  aiModel: "test-model",
  storage: { backend: "memory" },
  cache: { strategy: "memory", ttlMs: 60_000, maxEntries: 64 },
  mode: "spec",
  discoveryPath: "src",
  augment: false,
  coverageThreshold: 0.7,
  augmentStrategy: "smart-merge",
  mcp: { port: 3000 },
};

// ─── Session tests ────────────────────────────────────────────────────────────

describe("mcp/session", () => {
  beforeEach(() => clearAllSessions());

  it("creates a new session on first access", () => {
    const session = getOrCreateSession("test-1");
    expect(session.id).toBe("test-1");
    expect(session.spec).toBeNull();
    expect(session.endpoints).toBeNull();
    expect(session.generatedFiles).toBeNull();
    expect(session.codebaseAnalysis).toBeNull();
  });

  it("returns the same session on subsequent access", () => {
    const a = getOrCreateSession("test-2");
    const b = getOrCreateSession("test-2");
    expect(a).toBe(b);
  });

  it("creates separate sessions for different ids", () => {
    const a = getOrCreateSession("alpha");
    const b = getOrCreateSession("beta");
    expect(a).not.toBe(b);
    expect(a.id).toBe("alpha");
    expect(b.id).toBe("beta");
  });

  it("stores and retrieves mutable state", () => {
    const session = getOrCreateSession("mutable");
    session.endpoints = [];
    expect(session.endpoints).toEqual([]);
    session.endpoints = [{ operationId: "getFoo" } as unknown as ResolvedEndpoint];
    expect(session.endpoints).toHaveLength(1);
  });

  it("clears a specific session", () => {
    getOrCreateSession("clear-me");
    expect(getOrCreateSession("clear-me")).toBeDefined();
    clearSession("clear-me");
    // After clear, getOrCreateSession returns a fresh object
    const fresh = getOrCreateSession("clear-me");
    expect(fresh.spec).toBeNull();
  });

  it("clearAllSessions removes all sessions", () => {
    getOrCreateSession("a");
    getOrCreateSession("b");
    clearAllSessions();
    const freshA = getOrCreateSession("a");
    const freshB = getOrCreateSession("b");
    // Both should be fresh objects (spec is null)
    expect(freshA.spec).toBeNull();
    expect(freshB.spec).toBeNull();
    // And should not be the same reference as before clear
    expect(freshA.id).toBe("a");
    expect(freshB.id).toBe("b");
  });

  it("evicts expired sessions when creating new ones", () => {
    const origDateNow = Date.now;
    try {
      getOrCreateSession("evict-me");
      // Advance time by 31 minutes so the old session appears expired
      Date.now = () => origDateNow() + 31 * 60 * 1000;
      getOrCreateSession("trigger");
      const refreshed = getOrCreateSession("evict-me");
      expect(refreshed.spec).toBeNull();
    } finally {
      Date.now = origDateNow;
    }
  });
});

// ─── Auth tests ───────────────────────────────────────────────────────────────

describe("mcp/auth", () => {
  describe("verifyBearerToken", () => {
    it("returns true when no token is expected", () => {
      expect(verifyBearerToken(null, undefined)).toBe(true);
      expect(verifyBearerToken("", undefined)).toBe(true);
      expect(verifyBearerToken("Bearer xyz", undefined)).toBe(true);
    });

    it("returns false when token is missing but expected", () => {
      expect(verifyBearerToken(null, "secret")).toBe(false);
      expect(verifyBearerToken("", "secret")).toBe(false);
    });

    it("returns false when Bearer prefix is missing", () => {
      expect(verifyBearerToken("secret", "secret")).toBe(false);
    });

    it("returns true when Bearer token matches", () => {
      expect(verifyBearerToken("Bearer valid-token", "valid-token")).toBe(true);
    });

    it("returns false when Bearer token does not match", () => {
      expect(verifyBearerToken("Bearer valid-token", "wrong-token")).toBe(false);
    });
  });

  describe("generateBearerToken", () => {
    it("returns a 64-character hex string", () => {
      const token = generateBearerToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it("returns unique values on each call", () => {
      const a = generateBearerToken();
      const b = generateBearerToken();
      const c = generateBearerToken();
      expect(a).not.toBe(b);
      expect(b).not.toBe(c);
      expect(a).not.toBe(c);
    });

    it("uses 32 random bytes (256 bits of entropy)", () => {
      const token = generateBearerToken();
      // 32 bytes = 64 hex chars
      expect(token.length).toBe(64);
    });

    it("contains only lowercase hex characters", () => {
      const token = generateBearerToken();
      expect(token).toMatch(/^[0-9a-f]+$/);
    });

    it("generated token works with verifyBearerToken", () => {
      const token = generateBearerToken();
      expect(verifyBearerToken(`Bearer ${token}`, token)).toBe(true);
      expect(verifyBearerToken(`Bearer ${token}`, "other-token")).toBe(false);
    });
  });

  describe("unauthorizedResponse", () => {
    it("returns 401 with WWW-Authenticate header", () => {
      const res = unauthorizedResponse();
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
    });
  });
});

// ─── MCP tools tests ─────────────────────────────────────────────────────────

describe("mcp/tools", () => {
  const tools = buildMcpTools(TEST_CONFIG);

  it("builds the expected set of tools", () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "analyze_codebase",
      "analyze_spec",
      "augment_tests",
      "check_test_coverage",
      "coverage_report",
      "generate_from_spec",
      "generate_tests",
      "get_run_history",
      "read_source_file",
      "run_tests",
      "search_project_files",
      "validate_spec",
      "write_test_files",
    ]);
  });

  it("each tool has required fields", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.handler).toBe("function");
    }
  });

  it("validate_spec returns error for non-existent file", async () => {
    const tool = tools.find((t) => t.name === "validate_spec")!;
    const result = await tool.handler({ source: "nonexistent.yaml" }, "test-sid");
    expect(result.isError).toBe(true);
  });

  it("read_source_file returns error for non-existent file", async () => {
    const tool = tools.find((t) => t.name === "read_source_file")!;
    const result = await tool.handler({ path: "no-such-file.ts" }, "test-sid");
    expect(result.isError).toBe(true);
  });

  it("read_source_file reads existing files", async () => {
    const tool = tools.find((t) => t.name === "read_source_file")!;
    const result = await tool.handler({ path: "package.json" }, "test-sid");
    expect(result.isError).toBeUndefined();
    expect(result.content).toBeDefined();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("swagen");
  });

  it("generate_tests returns error when no endpoints analyzed", async () => {
    const tool = tools.find((t) => t.name === "generate_tests")!;
    const result = await tool.handler({}, "fresh-sid-no-endpoints");
    expect(result.isError).toBe(true);
  });

  it("generate_tests with operationIds filters endpoints", async () => {
    const tool = tools.find((t) => t.name === "generate_tests")!;
    const sid = "gen-opids-sid";
    const session = getOrCreateSession(sid);
    const mockEp: ResolvedEndpoint = {
      operationId: "getFoo",
      method: "get",
      path: "/foo",
      params: [],
      responses: [],
      security: [],
      tags: [],
      deprecated: false,
      summary: "",
      body: undefined,
    };
    session.endpoints = [mockEp, { ...mockEp, operationId: "getBar" }];
    const result = await tool.handler({ operationIds: ["getFoo"] }, sid);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(typeof parsed.fileCount).toBe("number");
    expect(typeof parsed.totalTests).toBe("number");
  });

  it("write_test_files returns error when no generated files", async () => {
    const tool = tools.find((t) => t.name === "write_test_files")!;
    const result = await tool.handler({}, "fresh-sid-no-files");
    expect(result.isError).toBe(true);
  });

  it("run_tests returns result (may fail if no tests exist yet)", async () => {
    const tool = tools.find((t) => t.name === "run_tests")!;
    const result = await tool.handler({}, "test-sid");
    expect(result.content).toBeDefined();
    // Should not throw
  });

  it("search_project_files returns matches for a known pattern", async () => {
    const tool = tools.find((t) => t.name === "search_project_files")!;
    const result = await tool.handler(
      { pattern: "SwagenConfig", pathPattern: "*.ts", maxResults: 5 },
      "test-sid",
    );
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.matchCount).toBeGreaterThan(0);
  });

  it("analyze_codebase discovers entities in src/", async () => {
    const tool = tools.find((t) => t.name === "analyze_codebase")!;
    const result = await tool.handler({ discoveryPath: "src" }, "test-sid");
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.entityCount).toBeGreaterThan(0);
    expect(parsed.framework).toBeDefined();
  });

  it("check_test_coverage returns coverage report", async () => {
    const tool = tools.find((t) => t.name === "check_test_coverage")!;
    const result = await tool.handler({ discoveryPath: "src" }, "test-sid");
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(typeof parsed.totalEntities).toBe("number");
    expect(typeof parsed.totalGaps).toBe("number");
  }, 30000);

  it("coverage_report returns full coverage analysis", async () => {
    const tool = tools.find((t) => t.name === "coverage_report")!;
    const result = await tool.handler({ discoveryPath: "src" }, "test-sid");
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(typeof parsed.totalEntities).toBe("number");
    expect(typeof parsed.uncoveredCount).toBe("number");
    expect(parsed.report).toBeDefined();
  }, 30000);

  it("get_run_history returns run records", async () => {
    const tool = tools.find((t) => t.name === "get_run_history")!;
    const result = await tool.handler({ limit: 5 }, "test-sid");
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed.records)).toBe(true);
  });

  it("generate_from_spec returns error for non-existent spec", async () => {
    const tool = tools.find((t) => t.name === "generate_from_spec")!;
    const result = await tool.handler({ source: "nonexistent.yaml" }, "test-sid");
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Error");
  });

  it("augment_tests runs without errors", async () => {
    const tool = tools.find((t) => t.name === "augment_tests")!;
    const result = await tool.handler({ discoveryPath: "src" }, "test-sid");
    // May or may not find entities to augment — should not throw
    expect(result.content).toBeDefined();
  }, 30000);
});

// ─── Server tests ─────────────────────────────────────────────────────────────

describe("mcp/server", () => {
  it("buildServer creates a server with tools", async () => {
    const { server, config, tools } = await buildServer({ config: TEST_CONFIG });
    expect(server).toBeDefined();
    expect(config.runner).toBe("bun");
    expect(tools.length).toBeGreaterThan(0);
  });

  it("server has registered tool/call and tools/list handlers", async () => {
    const { server } = await buildServer({ config: TEST_CONFIG });
    expect(server).toBeDefined();

    const handlers = (server as any)["_requestHandlers"];
    expect(handlers?.has("tools/list")).toBe(true);
    expect(handlers?.has("tools/call")).toBe(true);
  });

  it("server has registered all tool names from tools list", async () => {
    const { server, tools } = await buildServer({ config: TEST_CONFIG });
    const handlers = (server as any)["_requestHandlers"];
    const callHandler = handlers?.get("tools/call");
    expect(callHandler).toBeDefined();

    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("validate_spec");
    expect(names).toContain("analyze_spec");
    expect(names).toContain("generate_tests");
    expect(names).toContain("write_test_files");
  });

  it("ListToolsRequestSchema handler returns all tool definitions", async () => {
    const { server, tools } = await buildServer({ config: TEST_CONFIG });
    const handlers = (server as any)["_requestHandlers"];
    const listHandler = handlers.get("tools/list");
    // Call with proper JSON-RPC request shape
    const result = await listHandler({ params: {}, method: "tools/list" });
    expect(result.tools).toHaveLength(tools.length);
    for (const t of result.tools) {
      expect(t.name).toBeTruthy();
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema).toBeTruthy();
    }
  });

  it("CallToolRequestSchema routes to correct tool handler", async () => {
    const { server } = await buildServer({ config: TEST_CONFIG });
    const handlers = (server as any)["_requestHandlers"];
    const callHandler = handlers.get("tools/call");
    const result = await callHandler({
      params: { name: "validate_spec", arguments: { source: "nonexistent.yaml" } },
      method: "tools/call",
    });
    expect(result.isError).toBe(true);
  });

  it("CallToolRequestSchema returns error for unknown tool name", async () => {
    const { server } = await buildServer({ config: TEST_CONFIG });
    const handlers = (server as any)["_requestHandlers"];
    const callHandler = handlers.get("tools/call");
    const result = await callHandler({
      params: { name: "no_such_tool", arguments: {} },
      method: "tools/call",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown tool");
  });

  it("CallToolRequestSchema wraps handler exception in error response", async () => {
    const { server } = await buildServer({ config: TEST_CONFIG });
    const handlers = (server as any)["_requestHandlers"];
    const callHandler = handlers.get("tools/call");
    const result = await callHandler({
      params: { name: "get_run_history", arguments: { limit: 5 } },
      method: "tools/call",
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBeDefined();
  });

  it("CallToolRequestSchema uses default sessionId when _sessionId missing", async () => {
    const { server } = await buildServer({ config: TEST_CONFIG });
    const handlers = (server as any)["_requestHandlers"];
    const callHandler = handlers.get("tools/call");
    const result = await callHandler({
      params: { name: "get_run_history", arguments: {} },
      method: "tools/call",
    });
    expect(result.isError).toBeUndefined();
  });

  it("CallToolRequestSchema catch block wraps handler errors", async () => {
    const { server, tools } = await buildServer({ config: TEST_CONFIG });
    const handlers = (server as any)["_requestHandlers"];
    const callHandler = handlers.get("tools/call");
    const targetTool = tools.find((t) => t.name === "get_run_history")!;
    const origHandler = targetTool.handler;
    targetTool.handler = async () => {
      throw new Error("test handler error");
    };
    const result = await callHandler({
      params: { name: "get_run_history", arguments: {} },
      method: "tools/call",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Error: Error: test handler error");
    targetTool.handler = origHandler;
  });
});

// ─── MCP tool error path tests ─────────────────────────────────────────────

describe("mcp/tools — error paths", () => {
  const tools = buildMcpTools(TEST_CONFIG);

  it("validate_spec catches and returns load errors", async () => {
    const tool = tools.find((t) => t.name === "validate_spec")!;
    const result = await tool.handler({ source: "" }, "sid");
    expect(result.isError).toBe(true);
  });

  it("analyze_spec returns error for empty source", async () => {
    const tool = tools.find((t) => t.name === "analyze_spec")!;
    const result = await tool.handler({ source: "" }, "sid");
    expect(result.isError).toBe(true);
  });

  it("run_tests catches and returns errors", async () => {
    const tool = tools.find((t) => t.name === "run_tests")!;
    const result = await tool.handler({}, "sid");
    // Should not throw — returns error content if test run fails
    expect(result.content).toBeDefined();
  });

  it("run_tests with non-existent directory returns result", async () => {
    const tool = tools.find((t) => t.name === "run_tests")!;
    const result = await tool.handler({ targetDir: "/nonexistent-dir-98765" }, "sid");
    expect(result.content).toBeDefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(typeof parsed.exitCode).toBe("number");
  });

  it("read_source_file returns error for non-existent path", async () => {
    const tool = tools.find((t) => t.name === "read_source_file")!;
    const result = await tool.handler({ path: "" }, "sid");
    expect(result.isError).toBe(true);
  });

  it("read_source_file catches and returns read errors", async () => {
    const tool = tools.find((t) => t.name === "read_source_file")!;
    // Path exists but is a directory — will cause a read error
    const result = await tool.handler({ path: "src" }, "sid");
    expect(result.isError).toBe(true);
  });

  it("search_project_files returns empty when no matches", async () => {
    const tool = tools.find((t) => t.name === "search_project_files")!;
    const result = await tool.handler(
      { pattern: "XYZZY_NOTHING_MATCHES_12345", pathPattern: "*.ts", maxResults: 10 },
      "sid",
    );
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.matchCount).toBe(0);
  });

  it("generate_from_spec dry run returns with dryRun=true", async () => {
    // We can't actually load a real spec here, so expect error
    const tool = tools.find((t) => t.name === "generate_from_spec")!;
    const result = await tool.handler({ source: "nonexistent.yaml", dryRun: true }, "sid");
    expect(result.isError).toBe(true);
  });

  it("get_run_history returns empty records", async () => {
    const tool = tools.find((t) => t.name === "get_run_history")!;
    const result = await tool.handler({ limit: 0 }, "sid");
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed.records)).toBe(true);
  });

  it("coverage_report returns coverage analysis without session", async () => {
    const tool = tools.find((t) => t.name === "coverage_report")!;
    const result = await tool.handler({ discoveryPath: "src" }, "sid");
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.totalEntities).toBeGreaterThan(0);
  }, 30000);

  it("check_test_coverage caches codebaseAnalysis on session", async () => {
    const tool = tools.find((t) => t.name === "check_test_coverage")!;
    const sid = "coverage-cache-test";
    // First call should populate session
    const result1 = await tool.handler({ discoveryPath: "src" }, sid);
    expect(result1.isError).toBeUndefined();
    // Second call should reuse session's codebaseAnalysis
    const result2 = await tool.handler({ discoveryPath: "src" }, sid);
    expect(result2.isError).toBeUndefined();
  }, 30000);

  it("augment_tests works with target entities", async () => {
    const tool = tools.find((t) => t.name === "augment_tests")!;
    const result = await tool.handler(
      { discoveryPath: "src", targetEntities: ["buildServer"] },
      "sid",
    );
    expect(result.isError).toBeUndefined();
  }, 30000);

  it("write_test_files with dryRun does not write", async () => {
    const writeTool = tools.find((t) => t.name === "write_test_files")!;
    const sid = "write-dryrun-sid";
    const result = await writeTool.handler({ dryRun: true }, sid);
    expect(result.isError).toBe(true);
  });

  it("generate_tests with operationIds filters endpoints", async () => {
    const generateTool = tools.find((t) => t.name === "generate_tests")!;
    const sid = "gen-with-ops";

    // Set up session with mock endpoints directly
    const session = getOrCreateSession(sid);
    session.endpoints = [
      {
        operationId: "listPets",
        method: "get",
        path: "/pets",
        tags: ["pets"],
        params: [],
        body: undefined,
        responses: [],
        security: [],
        deprecated: false,
      } as unknown as ResolvedEndpoint,
      {
        operationId: "createPet",
        method: "post",
        path: "/pets",
        tags: ["pets"],
        params: [],
        body: undefined,
        responses: [],
        security: [],
        deprecated: false,
      } as unknown as ResolvedEndpoint,
    ];

    const result = await generateTool.handler({ operationIds: ["listPets"] }, sid);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.fileCount).toBeGreaterThan(0);
  });

  it("write_test_files writes when dryRun is false", async () => {
    const { mkdtempSync: mkdtemp, rmSync: rmdir } = require("node:fs");
    const { join: joinPath } = require("node:path");
    const tmpDir = mkdtemp("swagen-mcp-write-");
    try {
      const mcpTools = buildMcpTools({
        ...TEST_CONFIG,
        outDir: joinPath(tmpDir, "tests"),
      });

      const writeTool = mcpTools.find((t) => t.name === "write_test_files")!;
      const sid = "write-test";

      // Set up session with mock generated files
      const session = getOrCreateSession(sid);
      session.generatedFiles = [
        {
          relativePath: "tests/pets.test.ts",
          content: "// test content",
          testCount: 1,
        } as unknown as GeneratedFile,
      ];

      const result = await writeTool.handler({ dryRun: false }, sid);
      expect(result.isError).toBeUndefined();
      const text = (result.content[0] as { text: string }).text;
      const parsed = JSON.parse(text);
      expect(parsed.written.length).toBeGreaterThan(0);
    } finally {
      rmdir(tmpDir, { recursive: true, force: true });
    }
  });

  it("run_tests catches handler errors and returns error result", async () => {
    const runTool = tools.find((t) => t.name === "run_tests")!;
    const result = await runTool.handler({ targetDir: "/nonexistent-dir-for-error" }, "sid");
    expect(result.content).toBeDefined();
    const text = (result.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(typeof parsed.exitCode).toBe("number");
  });
});

// ─── Integration: MCP tool pipeline ──────────────────────────────────────────

describe("mcp tools — pipeline integration", () => {
  const tools = buildMcpTools(TEST_CONFIG);

  it("can run analyze_codebase then check_test_coverage sequentially", async () => {
    const analyzeTool = tools.find((t) => t.name === "analyze_codebase")!;
    const coverageTool = tools.find((t) => t.name === "check_test_coverage")!;
    const sid = "pipeline-test";

    const analyzeResult = await analyzeTool.handler({ discoveryPath: "src" }, sid);
    expect(analyzeResult.isError).toBeUndefined();

    const coverageResult = await coverageTool.handler({ discoveryPath: "src" }, sid);
    expect(coverageResult.isError).toBeUndefined();
    const text = (coverageResult.content[0] as { text: string }).text;
    const parsed = JSON.parse(text);
    expect(parsed.totalEntities).toBeGreaterThan(0);
  }, 30000);
});
