import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import type { SwagenConfig } from "../core/types.ts";
import { resolveConfig } from "../core/config.ts";
import { buildMcpTools } from "./tools.ts";

export interface McpServerOptions {
  config?: Partial<SwagenConfig>;
}

export async function buildServer(opts: McpServerOptions = {}) {
  const config = await resolveConfig(opts.config);

  const server = new Server(
    { name: "swagen-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const tools = buildMcpTools(config);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    const raw = request.params.arguments?.["_sessionId"];
    const sessionId = typeof raw === "string" ? raw : "default";
    try {
      return await tool.handler(request.params.arguments ?? {}, sessionId);
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error: ${String(err)}` }],
        isError: true,
      };
    }
  });

  return { server, config, tools };
}
