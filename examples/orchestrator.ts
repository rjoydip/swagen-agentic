import { runParallel, splitAndGenerate } from "../src/index.ts";

const results = await runParallel(
  [
    {
      id: "pets",
      prompt:
        "Generate Bun tests for the pet endpoints at https://petstore3.swagger.io/api/v3/openapi.json. Dry run.",
    },
    {
      id: "store",
      prompt:
        "Generate Bun tests for the store endpoints at https://petstore3.swagger.io/api/v3/openapi.json. Dry run.",
    },
    {
      id: "users",
      prompt:
        "Generate Bun tests for the user endpoints at https://petstore3.swagger.io/api/v3/openapi.json. Dry run.",
    },
  ],
  { concurrency: 3 },
);

for (const r of results) {
  console.log(
    `${r.id}: ${r.endpointCount} endpoints — ${r.writtenFiles.length} files${r.error ? ` (error: ${r.error})` : ""}`,
  );
}

const split = await splitAndGenerate("https://petstore3.swagger.io/api/v3/openapi.json", 3, {
  dryRun: true,
  storage: { backend: "memory" },
  cache: { strategy: "memory", ttlMs: 60_000 },
});

console.log(`\nSplit: ${split.totalEndpoints} endpoints across ${split.results.length} agents`);
console.log(`Total files: ${split.totalFiles.length}`);
