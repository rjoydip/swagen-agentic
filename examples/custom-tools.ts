import { resolveConfig, createTools } from "../src/index.ts";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, Type } from "@earendil-works/pi-ai";
import { MemoryCache } from "../src/index.ts";

const healthTool = {
  name: "check_api_health",
  description: "Ping an API health endpoint before generating tests.",
  parameters: Type.Object({
    url: Type.String({ description: "Base URL to check." }),
  }),
  async execute(_id: string, { url }: { url: string }) {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify({ reachable: res.ok, status: res.status }) },
      ],
      details: {},
    };
  },
};

const config = await resolveConfig({
  dryRun: true,
  storage: { backend: "memory" },
  cache: { strategy: "none" },
});

const cache = new MemoryCache(256, 60_000);
const tools = [...createTools(config, cache), healthTool];

const model = getModel(config.aiProvider as any, config.aiModel);

const agent = new Agent({
  initialState: {
    systemPrompt: "You are swagen. Check API health before generating tests.",
    model,
    tools: tools as any,
    messages: [],
  },
  sessionId: "custom-tools-demo",
  convertToLlm: (msgs) =>
    msgs.filter((m) => ["user", "assistant", "toolResult"].includes(m.role)) as any,
  toolExecution: "sequential",
});

agent.subscribe((e) => console.log(JSON.stringify(e, null, 2)));

await agent.prompt(
  "Check health of http://petstore3.swagger.io/api/v3, then generate tests for openapi.yaml.",
);
