#!/usr/bin/env bun
/**
 * swagen CLI — zero non-essential dependencies.
 * Arg parsing: native parseArgs() from utils/fmt.ts
 * Colour/spinner: native ANSI from utils/fmt.ts
 */

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import {
  parseArgs,
  printHelp,
  printCommandHelp,
  createSpinner,
  ansi,
  formatDuration,
} from "./utils/fmt.ts";
import type { CommandDef } from "./utils/fmt.ts";
import { friendlyError } from "./utils/errors.ts";
import { resolveConfig, starterConfig } from "./core/config.ts";
import { getLastRun } from "./tools/state.ts";
import { SwagenHarness } from "./harness.ts";
import { buildIndex } from "./indexer.ts";
import { loadSpec, analyzeSpec } from "./core/spec.ts";
import { generateTestFiles } from "./core/codegen.ts";
import { splitAndGenerate } from "./orchestrator.ts";
import type { HarnessRunResult } from "./harness.ts";
import type { SwagenConfig } from "./core/types.ts";
import {
  buildGeneratePrompt,
  buildValidatePrompt,
  buildCodebaseGeneratePrompt,
} from "./core/prompts.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";

const VERSION = JSON.parse(await Bun.file(join(import.meta.dir, "../../package.json")).text())
  .version as string;

const COMMANDS: CommandDef[] = [
  {
    name: "generate",
    args: "<spec>",
    description:
      "Agentic test generation from a spec file or URL. Use --existing for codebase mode.",
    flags: [
      {
        flag: "--existing",
        description: "Enable codebase mode (discover existing code instead of spec)",
      },
      { flag: "--provider <name>", description: "AI provider (e.g. anthropic, openai)" },
      { flag: "--model <id>", description: "AI model id" },
      { flag: "--out-dir, -o <dir>", description: "Output directory for generated tests" },
      { flag: "--runner, -r <name>", description: "Test runner (bun or vitest)" },
      { flag: "--dry-run", description: "Preview generated files without writing them" },
      { flag: "--parallel <N>", description: "Run N parallel agents" },
      { flag: "--verbose", description: "Stream all agent events" },
      { flag: "--augment", description: "Augment existing test files" },
      {
        flag: "--augment-strategy <s>",
        description: "Augmentation strategy (smart-merge, append, separate)",
      },
    ],
    examples: [
      { cmd: "swagen generate openapi.yaml", desc: "Generate tests from spec" },
      { cmd: "swagen generate --existing src/", desc: "Generate tests for existing codebase" },
    ],
  },
  {
    name: "run",
    args: "<spec>",
    description:
      "Generate and then execute tests in a single pass. Accepts same flags as generate.",
    flags: [
      { flag: "--existing", description: "Enable codebase mode" },
      { flag: "--provider <name>", description: "AI provider" },
      { flag: "--model <id>", description: "AI model id" },
      { flag: "--out-dir, -o <dir>", description: "Output directory" },
      { flag: "--runner, -r <name>", description: "Test runner" },
      { flag: "--dry-run", description: "Preview only" },
      { flag: "--parallel <N>", description: "Run N parallel agents" },
    ],
  },
  {
    name: "validate",
    args: "<spec>",
    description: "Validate an OpenAPI spec without generating tests.",
  },
  {
    name: "resume",
    args: "<id>",
    description: "Resume a previous session with a follow-up prompt",
    flags: [
      { flag: "--prompt, -p <text>", description: "Follow-up instruction (required)" },
      { flag: "--provider <name>", description: "AI provider" },
      { flag: "--model <id>", description: "Model id" },
    ],
    examples: [
      {
        cmd: 'swagen resume sess_abc123 --prompt "Add tests for admin endpoints"',
        desc: "Continue a previous session",
      },
    ],
  },
  {
    name: "sessions",
    args: "",
    description: "List stored agent sessions",
    examples: [{ cmd: "swagen sessions", desc: "Show all sessions" }],
  },
  {
    name: "status",
    args: "",
    description: "Show last generation run summary",
    examples: [{ cmd: "swagen status", desc: "Show last run details" }],
  },
  {
    name: "cache",
    args: "[clear]",
    description: "Show cache stats, or clear the cache",
    examples: [
      { cmd: "swagen cache", desc: "Show cache hit/miss stats" },
      { cmd: "swagen cache clear", desc: "Clear all cached entries" },
    ],
  },
  {
    name: "index",
    args: "[dir]",
    description: "Build or refresh the codebase index",
    examples: [
      { cmd: "swagen index", desc: "Index current directory" },
      { cmd: "swagen index src/", desc: "Index a specific directory" },
    ],
  },
  {
    name: "init",
    args: "",
    description: "Create a starter swagen.config.ts",
    examples: [{ cmd: "swagen init", desc: "Create swagen.config.ts in current dir" }],
  },
  {
    name: "bench",
    args: "<spec>",
    description: "Benchmark spec loading, analysis, and codegen (no agent call)",
    flags: [{ flag: "--iterations <N>", description: "Number of benchmark runs (default: 3)" }],
    examples: [
      { cmd: "swagen bench openapi.yaml", desc: "Run 3 benchmark iterations" },
      { cmd: "swagen bench openapi.yaml --iterations 10", desc: "Run 10 benchmark iterations" },
    ],
  },
  { name: "discover", args: "[dir]", description: "Discover and display project code structure" },
  { name: "coverage", args: "[dir]", description: "Show existing test coverage gaps" },
  { name: "analyze", args: "<entity>", description: "Deep analysis of a code entity" },
  { name: "help", args: "", description: "Show this help" },
];

const COMMAND_MAP = new Map(COMMANDS.map((c) => [c.name, c]));

async function main() {
  const { command, positionals, flags } = parseArgs();

  if (flags["version"] || flags["v"]) {
    process.stdout.write(`swagen v${VERSION}\n`);
    process.exit(0);
  }

  // Detailed help for a specific command
  const helpTarget = command === "help" ? positionals[0] : null;
  if (helpTarget && COMMAND_MAP.has(helpTarget)) {
    printCommandHelp(COMMAND_MAP.get(helpTarget)!, VERSION);
    process.exit(0);
  }

  // --help/-h on a specific command → per-command help
  if ((flags["help"] || flags["h"]) && command) {
    const cmd = COMMAND_MAP.get(command);
    if (cmd) {
      printCommandHelp(cmd, VERSION);
      process.exit(0);
    }
  }

  // General help — no command, bare "help", or bare --help/-h
  if (!command || command === "help") {
    printHelp(COMMANDS, VERSION);
    process.exit(0);
  }

  const config = await resolveConfig(flagsToConfig(flags));

  switch (command) {
    case "generate":
      return cmdGenerate(positionals[0], config, flags, false);
    case "run":
      return cmdGenerate(positionals[0], config, flags, true);
    case "validate":
      return cmdValidate(positionals[0], config);
    case "resume":
      return cmdResume(positionals[0], config, flags);
    case "sessions":
      return cmdSessions(config);
    case "status":
      return cmdStatus();
    case "cache":
      return cmdCache(positionals[0] === "clear", config);
    case "index":
      return cmdIndex(positionals[0]);
    case "bench":
      return cmdBench(positionals[0], config, flags);
    case "init":
      return cmdInit();
    case "discover":
      return cmdDiscover(positionals[0]);
    case "coverage":
      return cmdCoverage(positionals[0]);
    case "analyze":
      return cmdAnalyze(positionals[0]);
    default:
      process.stderr.write(ansi.red(`Unknown command: ${command}\n`));
      printHelp(COMMANDS, VERSION);
      process.exit(1);
  }
}

// ─── generate / run ───────────────────────────────────────────────────────────

async function cmdGenerate(
  spec: string | undefined,
  config: SwagenConfig,
  flags: Record<string, string | boolean>,
  andRun: boolean,
) {
  if (flags["existing"]) {
    config.mode = "codebase";
    // --existing src/ sets discoveryPath; --existing (boolean) falls back to spec positional
    if (typeof flags["existing"] === "string") {
      config.discoveryPath = flags["existing"];
    } else if (spec) {
      config.discoveryPath = spec;
    }
    return cmdCodebaseGenerate(config, andRun);
  }

  if (!spec) {
    process.stderr.write(ansi.red("Error: <spec> argument is required (or use --existing)\n"));
    process.exit(1);
  }

  const parallel =
    typeof flags["parallel"] === "string" ? parseInt(flags["parallel"] as string, 10) : 0;

  if (parallel > 1) {
    const spinner = createSpinner(`Starting ${parallel} parallel agents...`);
    const startTime = Date.now();
    try {
      const { results, totalEndpoints, totalFiles } = await splitAndGenerate(
        spec,
        parallel,
        config,
        { concurrency: parallel },
      );
      const errors = results.filter((r) => r.error);
      spinner.succeed(
        `Done in ${formatDuration(Date.now() - startTime)} (${parallel} agents, ${totalEndpoints} endpoints, ${totalFiles.length} files)`,
      );
      if (errors.length > 0) {
        process.stderr.write(ansi.yellow(`\n${errors.length} agent(s) reported errors:\n`));
        for (const e of errors) {
          process.stderr.write(ansi.yellow(`  [${e.id}] ${e.error}\n`));
        }
      }
    } catch (err) {
      spinner.fail(friendlyError(err));
      process.exit(1);
    }
    return;
  }

  const harness = await SwagenHarness.create(config);
  const spinner = createSpinner("Agent is thinking...");
  const startTime = Date.now();

  const prompt = buildGeneratePrompt({ spec, config, andRun });

  try {
    let toolCount = 0;
    const onEvent: ((e: AgentEvent) => void) | undefined = flags["verbose"]
      ? (e: AgentEvent) => {
          process.stderr.write(ansi.gray(JSON.stringify(e) + "\n"));
        }
      : undefined;
    const gen = harness.run({
      prompt,
      persist: !config.dryRun,
      onEvent,
    });
    let result: IteratorResult<AgentEvent, HarnessRunResult>;
    do {
      result = await gen.next(); // eslint-disable-line no-await-in-loop
      const event = result.value as AgentEvent | undefined;
      if (!event) continue;
      if (event.type === "tool_execution_start") {
        const e = event as Record<string, unknown>;
        toolCount++;
        spinner.text = ansi.cyan(`[${toolCount}] `) + String(e["toolName"] ?? "tool") + "...";
      }
      if (event.type === "message_update") {
        const delta = extractTextDelta(event);
        if (delta && !flags["verbose"]) {
          spinner.text = "Agent: " + delta.slice(-72);
        }
      }
    } while (!result.done);
    const runResult = result.value as HarnessRunResult;

    spinner.succeed(`Done in ${formatDuration(Date.now() - startTime)}`);

    // Show dry-run output
    if (config.dryRun && runResult.generatedFileContents.length > 0) {
      process.stdout.write("\n" + ansi.bold("Generated files (dry run):") + "\n");
      for (const f of runResult.generatedFileContents) {
        process.stdout.write(ansi.gray("─".repeat(60)) + "\n");
        process.stdout.write(ansi.boldCyan(`// ${f.path}`) + ansi.gray(` (${f.tests} tests)\n`));
        process.stdout.write(f.content + "\n");
      }
      process.stdout.write(ansi.gray("─".repeat(60)) + "\n");
    }

    showCacheStats(harness);
  } catch (err) {
    spinner.fail(friendlyError(err));
    process.exit(1);
  }
}

// ─── validate ─────────────────────────────────────────────────────────────────

async function cmdValidate(spec: string | undefined, config: SwagenConfig) {
  if (!spec) {
    process.stderr.write(ansi.red("Error: <spec> required\n"));
    process.exit(1);
  }

  const harness = await SwagenHarness.create(config);
  const spinner = createSpinner(`Validating ${spec}...`);

  try {
    await harness.runToCompletion({
      prompt: buildValidatePrompt(spec),
    });
    spinner.succeed("Validation complete");
  } catch (err) {
    spinner.fail(friendlyError(err));
    process.exit(1);
  }
}

// ─── resume ───────────────────────────────────────────────────────────────────

async function cmdResume(
  sessionId: string | undefined,
  config: SwagenConfig,
  flags: Record<string, string | boolean>,
) {
  if (!sessionId) {
    process.stderr.write(ansi.red("Error: <id> required\n"));
    process.exit(1);
  }

  const followUp = (flags["prompt"] ?? flags["p"]) as string | undefined;
  if (!followUp) {
    process.stderr.write(ansi.red("Error: --prompt <text> required for resume\n"));
    process.exit(1);
  }

  const harness = await SwagenHarness.create(config);
  const spinner = createSpinner(`Resuming session ${sessionId}...`);

  try {
    const result = await harness.runToCompletion({ prompt: followUp, sessionId });
    spinner.succeed("Done");
    process.stdout.write("\n" + ansi.bold("Summary:") + "\n" + result.agentSummary + "\n");
  } catch (err) {
    spinner.fail(friendlyError(err));
    process.exit(1);
  }
}

// ─── sessions ─────────────────────────────────────────────────────────────────

async function cmdSessions(config: SwagenConfig) {
  const harness = await SwagenHarness.create(config);
  const ids = await harness.listSessions();

  if (ids.length === 0) {
    process.stdout.write(ansi.gray("No sessions found.\n"));
    return;
  }

  process.stdout.write(ansi.bold(`Sessions (${ids.length}):\n`));
  const sessions = await Promise.all(ids.map((id) => harness.getSession(id)));
  for (const session of sessions) {
    if (!session) continue;
    process.stdout.write(
      `  ${ansi.cyan(session.id)}  ${ansi.gray(session.updatedAt)}  ${session.specSource}\n`,
    );
  }
}

// ─── status ───────────────────────────────────────────────────────────────────

async function cmdStatus() {
  const record = await getLastRun();
  if (!record) {
    process.stdout.write(ansi.gray("No runs yet.\n"));
    return;
  }
  process.stdout.write(ansi.bold("Last run:\n"));
  process.stdout.write(`  ID:        ${ansi.cyan(record.id)}\n`);
  process.stdout.write(`  Timestamp: ${record.timestamp}\n`);
  process.stdout.write(`  Endpoints: ${record.endpointCount}\n`);
  process.stdout.write(`  Files:     ${record.generatedFiles.length}\n`);
  if (record.agentSummary) {
    process.stdout.write(`\n${ansi.bold("Agent summary:")}\n${record.agentSummary}\n`);
  }
}

// ─── index ────────────────────────────────────────────────────────────────────

async function cmdIndex(dir: string | undefined) {
  const cwd = dir ? join(process.cwd(), dir) : process.cwd();
  const spinner = createSpinner(`Indexing ${cwd}...`);
  try {
    const idx = await buildIndex(cwd);
    spinner.succeed(
      `Indexed ${idx.files.length} files (${idx.testNames.length} tests, ${idx.specPaths.length} specs)`,
    );
  } catch (err) {
    spinner.fail(friendlyError(err));
    process.exit(1);
  }
}

// ─── cache ────────────────────────────────────────────────────────────────────

async function cmdCache(clear: boolean, config: SwagenConfig) {
  const harness = await SwagenHarness.create(config);
  if (clear) {
    await harness.clearCache();
    process.stdout.write(ansi.green("✓ Cache cleared\n"));
    return;
  }
  const stats = harness.cacheStats();
  process.stdout.write(ansi.bold("Cache stats:\n"));
  process.stdout.write(`  Entries:   ${stats.entries}\n`);
  process.stdout.write(`  Hits:      ${stats.hits}\n`);
  process.stdout.write(`  Misses:    ${stats.misses}\n`);
  process.stdout.write(`  Evictions: ${stats.evictions}\n`);
}

// ─── init ─────────────────────────────────────────────────────────────────────

async function cmdInit() {
  const dest = "swagen.config.ts";
  if (existsSync(dest)) {
    process.stdout.write(ansi.yellow(`${dest} already exists — skipping.\n`));
    return;
  }
  await Bun.write(dest, starterConfig());
  process.stdout.write(ansi.green(`✓ Created ${dest}\n`));
}

// ─── bench ────────────────────────────────────────────────────────────────────

async function cmdBench(
  spec: string | undefined,
  config: SwagenConfig,
  flags: Record<string, string | boolean>,
) {
  if (!spec) {
    process.stderr.write(ansi.red("Error: <spec> required\n"));
    process.exit(1);
  }

  const iterations =
    typeof flags["iterations"] === "string" ? parseInt(flags["iterations"] as string, 10) : 3;
  const specSource = spec.startsWith("http")
    ? { kind: "url" as const, url: spec }
    : { kind: "file" as const, path: spec };

  process.stdout.write(ansi.bold(`\nBenchmarking ${spec}\n`));
  process.stdout.write(ansi.gray(`Iterations: ${iterations}\n\n`));

  let loadTimes: number[] = [];
  let analyzeTimes: number[] = [];
  let codegenTimes: number[] = [];
  let lastDoc: unknown;
  let lastEndpoints: unknown[] = [];

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    // eslint-disable-next-line no-await-in-loop
    const doc = await loadSpec(specSource);
    const t1 = performance.now();
    const { endpoints } = analyzeSpec(doc, config as Parameters<typeof analyzeSpec>[1]);
    const t2 = performance.now();
    generateTestFiles(endpoints, config);
    const t3 = performance.now();

    loadTimes.push(t1 - t0);
    analyzeTimes.push(t2 - t1);
    codegenTimes.push(t3 - t2);
    lastDoc = doc;
    lastEndpoints = endpoints;
  }

  function stats(times: number[]): string {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    return `${avg.toFixed(1)}ms (min ${min.toFixed(1)}ms / max ${max.toFixed(1)}ms)`;
  }

  const epCount = lastEndpoints.length;
  const pathCount = Object.keys(
    ((lastDoc as Record<string, unknown>)["paths"] as Record<string, unknown>) ?? {},
  ).length;

  process.stdout.write(`  ${ansi.bold("Load spec:")}    ${stats(loadTimes)}\n`);
  process.stdout.write(`  ${ansi.bold("Analyze:")}      ${stats(analyzeTimes)}\n`);
  process.stdout.write(`  ${ansi.bold("Codegen:")}      ${stats(codegenTimes)}\n`);
  process.stdout.write(`\n  Paths: ${pathCount}, Endpoints: ${epCount}\n`);
  process.stdout.write(
    ansi.gray("  (Benchmarks load, analysis, and codegen only — no agent call)\n\n"),
  );
}

// ─── discover ──────────────────────────────────────────────────────────────────

async function cmdDiscover(dir: string | undefined) {
  const { discoverCodebase, formatDiscoveryPrompt, formatEntitySummary } =
    await import("./discovery/index.ts");
  const cwd = dir ? join(process.cwd(), dir) : process.cwd();
  const spinner = createSpinner(`Discovering code in ${cwd}...`);
  try {
    const analysis = discoverCodebase({ ...(dir ? { discoveryPath: dir } : {}) });
    spinner.succeed(`Found ${analysis.entities.length} entities, framework: ${analysis.framework}`);
    process.stdout.write("\n" + formatDiscoveryPrompt(analysis) + "\n");
    if (analysis.entities.length > 0) {
      process.stdout.write("\n" + ansi.bold("Entities:") + "\n");
      process.stdout.write(formatEntitySummary(analysis.entities, 30) + "\n");
      if (analysis.entities.length > 30) {
        process.stdout.write(ansi.gray(`  ... and ${analysis.entities.length - 30} more\n`));
      }
    }
  } catch (err) {
    spinner.fail(friendlyError(err));
    process.exit(1);
  }
}

// ─── coverage ──────────────────────────────────────────────────────────────────

async function cmdCoverage(dir: string | undefined) {
  const { discoverCodebase } = await import("./discovery/index.ts");
  const { generateCoverageReport, enrichAnalysisWithCoverage } =
    await import("./coverage/index.ts");

  const cwd = dir ? join(process.cwd(), dir) : process.cwd();
  const spinner = createSpinner(`Analyzing coverage in ${cwd}...`);
  try {
    const analysis = discoverCodebase({
      ...(dir ? { discoveryPath: dir } : {}),
      testPath: ".",
    });
    const testFilePaths = analysis.testFilePaths ?? [];
    const enriched = enrichAnalysisWithCoverage(analysis, testFilePaths, cwd);
    const report = generateCoverageReport(enriched, testFilePaths, cwd);
    spinner.succeed(
      `Coverage: ${enriched.coverageGaps.filter((g) => g.coverage === "none").length} uncovered entities`,
    );
    process.stdout.write("\n" + report + "\n");
  } catch (err) {
    spinner.fail(friendlyError(err));
    process.exit(1);
  }
}

// ─── analyze ──────────────────────────────────────────────────────────────────

async function cmdAnalyze(entity: string | undefined) {
  if (!entity) {
    process.stderr.write(ansi.red("Error: <entity> argument is required\n"));
    process.exit(1);
  }

  const { discoverCodebase } = await import("./discovery/index.ts");
  const { enrichAnalysisWithCoverage } = await import("./coverage/index.ts");

  const spinner = createSpinner(`Analyzing entity "${entity}"...`);
  try {
    const analysis = discoverCodebase({ testPath: "." });
    const testFilePaths = analysis.testFilePaths ?? [];
    const enriched = enrichAnalysisWithCoverage(analysis, testFilePaths, process.cwd());

    const candidates = enriched.entities.filter(
      (e) => e.name === entity || e.name.toLowerCase() === entity.toLowerCase(),
    );

    if (candidates.length === 0) {
      spinner.fail(`Entity "${entity}" not found`);
      process.exit(1);
    }

    spinner.succeed(`Found ${candidates.length} match(es) for "${entity}"`);
    for (const e of candidates) {
      process.stdout.write(ansi.bold(`\n${e.type}: ${e.name}\n`));
      process.stdout.write(`  File:     ${e.file}:${e.line}\n`);
      process.stdout.write(`  Exported: ${e.isExported}\n`);
      if (e.isAsync) process.stdout.write(`  Async:    yes\n`);
      if (e.signature) process.stdout.write(`  Signature: ${e.signature}\n`);
      if (e.decorators?.length) process.stdout.write(`  Decorators: ${e.decorators.join(", ")}\n`);

      const gaps = enriched.coverageGaps.filter((g) => g.entity.name === e.name);
      if (gaps.length > 0) {
        const gap = gaps[0]!;
        process.stdout.write(`  Coverage: ${ansi.yellow(gap.coverage)} — ${gap.gapDescription}\n`);
        if (gap.existingTests.length > 0) {
          process.stdout.write(
            `  Tests referencing: ${gap.existingTests.slice(0, 5).join(", ")}\n`,
          );
        }
      } else {
        process.stdout.write(ansi.green(`  Coverage: full\n`));
      }
    }
  } catch (err) {
    spinner.fail(friendlyError(err));
    process.exit(1);
  }
}

// ─── codebase generate ─────────────────────────────────────────────────────────

async function cmdCodebaseGenerate(config: SwagenConfig, andRun: boolean) {
  const harness = await SwagenHarness.create(config);
  const spinner = createSpinner("Agent is analyzing codebase...");
  const startTime = Date.now();

  const prompt = buildCodebaseGeneratePrompt(config, andRun);

  try {
    const gen = harness.run({ prompt, persist: !config.dryRun });
    let result: IteratorResult<
      import("@earendil-works/pi-agent-core").AgentEvent,
      HarnessRunResult
    >;
    do {
      // eslint-disable-next-line no-await-in-loop
      result = await gen.next();
    } while (!result.done);
    const runResult = result.value as HarnessRunResult;

    spinner.succeed(`Done in ${formatDuration(Date.now() - startTime)}`);

    // Show generated file summary
    if (runResult.generatedFileContents.length > 0) {
      process.stdout.write("\n" + ansi.bold("Generated files:") + "\n");
      for (const f of runResult.generatedFileContents) {
        process.stdout.write(ansi.gray(`  ${f.path}`) + ansi.gray(` (${f.tests} tests)\n`));
      }
      process.stdout.write("\n");
    }

    showCacheStats(harness);
  } catch (err) {
    spinner.fail(friendlyError(err));
    process.exit(1);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showCacheStats(harness: SwagenHarness) {
  const stats = harness.cacheStats();
  if (stats.hits + stats.misses > 0) {
    process.stdout.write(ansi.gray(`Cache: ${stats.hits} hits / ${stats.misses} misses\n`));
  }
}

function flagsToConfig(flags: Record<string, string | boolean>): Partial<SwagenConfig> {
  const c: Partial<SwagenConfig> = {};
  if (typeof flags["out-dir"] === "string") c.outDir = flags["out-dir"];
  if (typeof flags["o"] === "string") c.outDir = flags["o"];
  if (typeof flags["runner"] === "string") c.runner = flags["runner"] as SwagenConfig["runner"];
  if (typeof flags["r"] === "string") c.runner = flags["r"] as SwagenConfig["runner"];
  if (typeof flags["base-url"] === "string") c.baseUrl = flags["base-url"];
  if (flags["dry-run"]) c.dryRun = true;
  if (typeof flags["include-tags"] === "string") c.includeTags = flags["include-tags"].split(",");
  if (typeof flags["exclude-tags"] === "string") c.excludeTags = flags["exclude-tags"].split(",");
  if (typeof flags["skip"] === "string") c.skipOperations = flags["skip"].split(",");
  if (typeof flags["provider"] === "string") c.aiProvider = flags["provider"];
  if (typeof flags["model"] === "string") c.aiModel = flags["model"];
  if (typeof flags["storage"] === "string")
    c.storage = { backend: flags["storage"] as SwagenConfig["storage"]["backend"] };
  if (flags["existing"]) c.mode = "codebase";
  if (flags["augment"]) c.augment = true;
  if (flags["augment-strategy"])
    c.augmentStrategy = flags["augment-strategy"] as SwagenConfig["augmentStrategy"];
  if (flags["coverage-threshold"])
    c.coverageThreshold = parseFloat(flags["coverage-threshold"] as string);
  return c;
}

function extractTextDelta(event: unknown): string | null {
  try {
    const e = event as Record<string, unknown>;
    const ame = e["assistantMessageEvent"] as Record<string, unknown>;
    if (ame?.["type"] === "text_delta") return String(ame["delta"]);
  } catch {}
  return null;
}

main().catch((err) => {
  process.stderr.write(friendlyError(err) + "\n");
  process.exit(1);
});
