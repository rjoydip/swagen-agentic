import { SwagenHarness, resolveConfig } from "../src/index.ts";

const config = await resolveConfig({
  dryRun: true,
  storage: { backend: "memory" },
  cache: { strategy: "memory", ttlMs: 60_000 },
});

const harness = await SwagenHarness.create(config);

const session = await harness.newSession("https://petstore3.swagger.io/api/v3/openapi.json");
console.log("New session:", session.id);

const result1 = await harness.runToCompletion({
  prompt: "Generate Bun tests for the pet tag. Dry run.",
  sessionId: session.id,
});

console.log("Run 1 — endpoints:", result1.endpointCount);
console.log("Run 1 — summary:", result1.agentSummary);

const result2 = await harness.runToCompletion({
  prompt: "Now add tests for the store tag too.",
  sessionId: session.id,
});

console.log("Run 2 — endpoints:", result2.endpointCount);
console.log("Run 2 — summary:", result2.agentSummary);

const sessions = await harness.listSessions();
console.log("\nStored sessions:", sessions);
