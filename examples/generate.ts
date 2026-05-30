import { SwagenHarness, resolveConfig } from "../src/index.ts";

const config = await resolveConfig({
  dryRun: true,
  storage: { backend: "memory" },
  cache: { strategy: "memory", ttlMs: 60_000 },
});

const harness = await SwagenHarness.create(config);

const result = await harness.runToCompletion({
  prompt: `Generate Bun tests from https://petstore3.swagger.io/api/v3/openapi.json for the "pet" tag. Dry run — do not write files, only generate summary.`,
});

console.log("Session:", result.sessionId);
console.log("Endpoints:", result.endpointCount);
console.log("Files:", result.writtenFiles.length);
console.log("Summary:", result.agentSummary);
