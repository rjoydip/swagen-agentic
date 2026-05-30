import { SwagenHarness, resolveConfig } from "../src/index.ts";

const config = await resolveConfig({
  dryRun: true,
  storage: { backend: "memory" },
  cache: { strategy: "memory", ttlMs: 60_000 },
});

const harness = await SwagenHarness.create(config);

for await (const event of harness.run({
  prompt:
    "Generate Bun tests for https://petstore3.swagger.io/api/v3/openapi.json. Only the pet tag. Dry run.",
})) {
  if (event.type === "tool_execution_start") {
    const e = event as Record<string, unknown>;
    process.stdout.write(`  → ${e["toolName"]}\n`);
  }
  if (event.type === "message_update") {
    const ame = (event as Record<string, unknown>)["assistantMessageEvent"] as
      | Record<string, unknown>
      | undefined;
    if (ame?.["type"] === "text_delta") {
      process.stdout.write(String(ame["delta"]));
    }
  }
}
