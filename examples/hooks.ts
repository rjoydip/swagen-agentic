import {
  SwagenHarness,
  resolveConfig,
  loadSpec,
  analyzeSpec,
  generateTestFiles,
} from "../src/index.ts";

const config = await resolveConfig({
  dryRun: true,
  storage: { backend: "memory" },
  cache: { strategy: "none" },
});

const harness = await SwagenHarness.create(config);

const spec = await loadSpec({
  kind: "url",
  url: "https://petstore3.swagger.io/api/v3/openapi.json",
});

const { endpoints } = analyzeSpec(spec, {
  includeTags: [],
  excludeTags: ["deprecated"],
  skipOperations: [],
});

console.log(
  `Loaded ${endpoints.length} endpoints (${endpoints.filter((e) => e.deprecated).length} deprecated filtered)`,
);

const filtered = await harness.applyBeforeGenerateHooks(endpoints);
console.log(`After beforeGenerate hooks: ${filtered.length} endpoints`);

const files = generateTestFiles(filtered, config);

const final = await harness.applyAfterGenerateHooks(files, {
  endpointCount: filtered.length,
  skippedCount: endpoints.length - filtered.length,
});

for (const f of final) {
  console.log(`  ${f.relativePath} — ${f.testCount} test(s)`);
}
