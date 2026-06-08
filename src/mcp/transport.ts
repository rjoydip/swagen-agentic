import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { verifyBearerToken, unauthorizedResponse } from "./auth.ts";

export async function startStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export interface HttpServerOptions {
  port: number;
  authToken?: string | undefined;
}

export async function startHttp(server: Server, options: HttpServerOptions): Promise<void> {
  const { port, authToken } = options;
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  server.connect(transport);

  Bun.serve({
    port,
    async fetch(req) {
      if (authToken) {
        const auth = req.headers.get("authorization");
        if (!verifyBearerToken(auth, authToken)) {
          return unauthorizedResponse();
        }
      }

      const url = new URL(req.url);

      if (req.method === "GET" && url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp")) {
        return transport.handleRequest(req);
      }

      return new Response("Not found", { status: 404 });
    },
  });
}
