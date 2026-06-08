/**
 * examples/mcp-server.ts — MCP server integration example.
 *
 * This example shows how to:
 *   1. Build an MCP server from swagen's tools
 *   2. Start it over stdio transport (for Claude Desktop, Cursor, VS Code)
 *   3. Start it over HTTP with Bearer authentication
 *
 * Run:
 *   bun run examples/mcp-server.ts                    # HTTP mode (port 3000, no auth)
 *   bun run examples/mcp-server.ts --stdio             # Stdio mode
 *   bun run examples/mcp-server.ts --port 8080 --token sk-secret  # HTTP with auth
 */

import { resolveConfig } from "../src/core/config.ts";
import { buildServer } from "../src/mcp/server.ts";
import { startStdio, startHttp } from "../src/mcp/transport.ts";
import { parseArgs } from "../src/utils/fmt.ts";

async function main() {
  const args = parseArgs();
  const useStdio = args.flags["stdio"] === true;
  const port =
    typeof args.flags["port"] === "string" ? parseInt(args.flags["port"] as string, 10) : 3000;
  const token = args.flags["token"] as string | undefined;

  // Load swagen config (swagen.config.ts or defaults)
  const mcpCfg: { port: number; authToken?: string } = { port };
  if (token) mcpCfg.authToken = token;
  const config = await resolveConfig({ mcp: mcpCfg });

  // Build the MCP server with all 13 tools
  const { server } = await buildServer({ config });

  if (useStdio) {
    console.error("Starting MCP server (stdio)...");
    console.error("Connect via Claude Desktop, Cursor, or VS Code.");
    console.error();
    console.error("  Claude Desktop config:");
    console.error('  { "mcpServers": { "swagen": {');
    console.error('      "command": "bun",');
    console.error('      "args": ["run", "examples/mcp-server.ts", "--stdio"]');
    console.error("  } } }");
    await startStdio(server);
  } else {
    console.error(`Starting MCP server on http://localhost:${port}/mcp`);
    if (token) {
      console.error("Auth: Bearer token enabled");
    } else {
      console.error("Warning: No auth token. Set with --token or SWAGEN_MCP_TOKEN env var.");
    }
    console.error("Health: http://localhost:PORT/health");
    console.error();
    console.error("Available tools:");
    const { buildMcpTools } = await import("../src/mcp/tools.ts");
    const tools = buildMcpTools(config);
    for (const tool of tools) {
      console.error(`  - ${tool.name}: ${tool.description}`);
    }

    await startHttp(server, { port, authToken: token });
  }
}

main().catch((err) => {
  console.error("MCP server error:", err);
  process.exit(1);
});
