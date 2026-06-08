/**
 * tests/integration/mcp.test.ts
 *
 * Integration tests for the MCP server over stdio transport.
 * Spawns `swagen mcp --stdio` as a child process, sends JSON-RPC messages
 * via stdin, and validates responses from stdout.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";

const CLI_ENTRY = join(import.meta.dir, "../../src/cli.ts");

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ─── MCP client over stdio ────────────────────────────────────────────────────

class McpStdioClient {
  private proc: ReturnType<typeof Bun.spawn>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending = new Map<
    number,
    { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }
  >();
  private buffer = "";
  private nextId = 1;
  private closed = false;

  constructor() {
    this.proc = Bun.spawn(["bun", "run", CLI_ENTRY, "mcp", "--stdio"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    this.reader = (this.proc.stdout as any).getReader()!;

    this.readLoop().catch((err) => {
      if (!this.closed) process.stderr.write("MCP read loop error: " + err + "\n");
    });
  }

  private async readLoop() {
    const decoder = new TextDecoder();
    while (!this.closed) {
      const { done, value } = await this.reader.read(); // eslint-disable-line no-await-in-loop
      if (done) break;
      this.buffer += decoder.decode(value, { stream: true });

      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (msg.id != null) {
            const pending = this.pending.get(msg.id);
            if (pending) {
              this.pending.delete(msg.id);
              pending.resolve(msg);
            }
          }
        } catch {
          // Ignore non-JSON output
        }
      }
    }
  }

  async request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method };
    if (params) req.params = params;

    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    const stdin = this.proc.stdin as unknown as { write(data: string): void };
    stdin.write(JSON.stringify(req) + "\n");
    return promise;
  }

  async close() {
    this.closed = true;
    this.proc.kill("SIGTERM");
    await this.reader.cancel().catch(() => {});
  }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("MCP server (stdio transport)", () => {
  let client: McpStdioClient;

  beforeAll(() => {
    client = new McpStdioClient();
  });

  afterAll(async () => {
    await client.close();
  });

  it("responds to initialize", async () => {
    const res = await client.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      clientInfo: { name: "test-client", version: "0.1.0" },
    });
    expect(res.jsonrpc).toBe("2.0");
    expect(res.error).toBeUndefined();
    const result = res.result as Record<string, unknown>;
    expect(result.protocolVersion).toBeDefined();
    expect(result.capabilities).toBeDefined();
    expect(result.serverInfo).toBeDefined();
  });

  it("lists all expected tools", async () => {
    const res = await client.request("tools/list");
    expect(res.error).toBeUndefined();
    const result = res.result as { tools: Array<{ name: string; description: string }> };
    expect(result.tools).toBeDefined();

    const names = result.tools.map((t) => t.name);
    expect(names).toContain("validate_spec");
    expect(names).toContain("analyze_spec");
    expect(names).toContain("generate_tests");
    expect(names).toContain("write_test_files");
    expect(names).toContain("run_tests");
    expect(names).toContain("read_source_file");
    expect(names).toContain("search_project_files");
    expect(names).toContain("analyze_codebase");
    expect(names).toContain("check_test_coverage");
    expect(names).toContain("generate_from_spec");
    expect(names).toContain("augment_tests");
    expect(names).toContain("coverage_report");
    expect(names).toContain("get_run_history");

    for (const tool of result.tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });

  it("read_source_file reads package.json", async () => {
    const res = await client.request("tools/call", {
      name: "read_source_file",
      arguments: { path: "package.json" },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { content: Array<{ text: string }> };
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("swagen");
    expect(text).toContain("@modelcontextprotocol/sdk");
  });

  it("read_source_file returns error for non-existent file", async () => {
    const res = await client.request("tools/call", {
      name: "read_source_file",
      arguments: { path: "no-such-file.xyz" },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("search_project_files finds SwagenConfig references", async () => {
    const res = await client.request("tools/call", {
      name: "search_project_files",
      arguments: {
        pattern: "SwagenConfig",
        pathPattern: "*.ts",
        maxResults: 5,
      },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { content: Array<{ text: string }> };
    const text = result.content[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(parsed.matchCount).toBeGreaterThan(0);
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  it("analyze_codebase discovers code entities", async () => {
    const res = await client.request("tools/call", {
      name: "analyze_codebase",
      arguments: { discoveryPath: "src" },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { content: Array<{ text: string }> };
    const text = result.content[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(parsed.entityCount).toBeGreaterThan(0);
    expect(parsed.framework).toBeDefined();
    expect(Array.isArray(parsed.entities)).toBe(true);
  });

  it("validate_spec returns error for non-existent file", async () => {
    const res = await client.request("tools/call", {
      name: "validate_spec",
      arguments: { source: "/void/openapi.yaml" },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { isError?: boolean };
    expect(result.isError).toBe(true);
  });

  it("get_run_history returns records array", async () => {
    const res = await client.request("tools/call", {
      name: "get_run_history",
      arguments: { limit: 5 },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { content: Array<{ text: string }> };
    const text = result.content[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed.records)).toBe(true);
  });

  it("unknown tool returns isError in result", async () => {
    const res = await client.request("tools/call", {
      name: "not_a_real_tool_name",
      arguments: {},
    });
    // Unknown tools are returned as isError inside result (MCP CallToolResult convention)
    expect(res.error).toBeUndefined();
    const result = res.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Unknown tool");
  });

  it("run_tests completes without crashing", async () => {
    // Use a small, fast test subset that doesn't include integration tests
    // to avoid infinite recursion (the test runner would find this test file)
    const res = await client.request("tools/call", {
      name: "run_tests",
      arguments: { targetDir: "tests/unit/mcp.test.ts", runner: "bun" },
    });
    expect(res.error).toBeUndefined();
    const result = res.result as { content: Array<{ text: string }> };
    const text = result.content[0]?.text ?? "";
    expect(() => JSON.parse(text)).not.toThrow();
    const parsed = JSON.parse(text);
    expect(typeof parsed.exitCode).toBe("number");
  }, 60000);

  it("survives sequential tool/list calls", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await client.request("tools/list"); // eslint-disable-line no-await-in-loop
      expect(res.error).toBeUndefined();
      const result = res.result as { tools: Array<{ name: string }> };
      expect(result.tools.length).toBeGreaterThan(0);
    }
  });

  it("survives mixed tool calls", async () => {
    // Call a read_source_file, then tools/list, then search
    const r1 = await client.request("tools/call", {
      name: "read_source_file",
      arguments: { path: "package.json" },
    });
    expect(r1.error).toBeUndefined();

    const r2 = await client.request("tools/list");
    expect(r2.error).toBeUndefined();

    const r3 = await client.request("tools/call", {
      name: "search_project_files",
      arguments: { pattern: "export", pathPattern: "*.ts", maxResults: 3 },
    });
    expect(r3.error).toBeUndefined();
    const text = (r3.result as { content: Array<{ text: string }> }).content[0]?.text ?? "";
    const parsed = JSON.parse(text);
    expect(parsed.matchCount).toBeGreaterThan(0);
  });
});

// ─── Token generation (E2E via CLI) ────────────────────────────────────────────

describe("MCP token generation (CLI)", () => {
  it("--generate-token prints a 64-char hex token to stdout", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_ENTRY, "mcp", "--generate-token"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const token = stdout.trim();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("auto-generates token when --token is omitted in HTTP mode", async () => {
    const proc = Bun.spawn(["bun", "run", CLI_ENTRY, "mcp", "--port", "0"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderrReader = (proc.stderr as any).getReader();
    const decoder = new TextDecoder();
    const lines: string[] = [];
    let tokenFound = false;

    while (true) {
      const { done, value } = await stderrReader.read(); // eslint-disable-line no-await-in-loop
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (line.includes("Auto-generated token:")) {
          tokenFound = true;
          expect(line).toMatch(/[0-9a-f]{64}/);
          proc.kill("SIGTERM");
        }
        lines.push(line);
      }
      if (tokenFound) break;
    }

    // Drain remaining stderr
    await stderrReader.cancel().catch(() => {});
    expect(tokenFound).toBe(true);
  });

  it("explicit --token is used instead of auto-generation", async () => {
    const proc = Bun.spawn(
      ["bun", "run", CLI_ENTRY, "mcp", "--port", "0", "--token", "my-explicit-token"],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const stderrReader = (proc.stderr as any).getReader();
    const decoder = new TextDecoder();
    const lines: string[] = [];
    let authFound = false;

    while (true) {
      const { done, value } = await stderrReader.read(); // eslint-disable-line no-await-in-loop
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n")) {
        if (line.includes("Bearer token authentication enabled")) {
          authFound = true;
          expect(line).not.toContain("Auto-generated token");
          proc.kill("SIGTERM");
        }
        lines.push(line);
      }
      if (authFound) break;
    }

    await stderrReader.cancel().catch(() => {});
    expect(authFound).toBe(true);
  });
});
