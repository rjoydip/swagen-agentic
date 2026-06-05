import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { loadSpec, analyzeSpec } from "../core/spec.ts";
import { generateTestFiles } from "../core/codegen.ts";
import { listRunRecords } from "./state.ts";
import { withCache, cacheKey } from "../cache.ts";
import type { ICache } from "../cache.ts";
import type {
  GeneratedFile,
  ResolvedEndpoint,
  SwagenConfig,
  CodebaseAnalysis,
} from "../core/types.ts";
import { formatDuration } from "../utils/fmt.ts";
import { discoverCodebase, formatDiscoveryPrompt } from "../discovery/index.ts";
import { walkFiles, isTestFile } from "../discovery/walker.ts";
import { enrichAnalysisWithCoverage, generateCoverageReport } from "../coverage/index.ts";
import {
  analyzeTestPatterns,
  mergeTestFiles,
  generateUnitTests,
  readTestFile,
} from "../core/augmenter.ts";

interface RunState {
  spec?: Awaited<ReturnType<typeof loadSpec>>;
  endpoints?: ResolvedEndpoint[];
  generatedFiles?: GeneratedFile[];
  codebaseAnalysis?: CodebaseAnalysis;
}

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
};

function ok(data: unknown, details: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, ...(data as object) }) }],
    details,
  };
}

function err(message: string): ToolResult {
  throw new Error(message);
}

function enrichWithCoverage(state: RunState): string[] {
  const allFiles = walkFiles(process.cwd(), { maxDepth: 8 });
  const testFilePaths = allFiles.filter((f) => isTestFile(f.path)).map((f) => f.absPath);
  const enriched = enrichAnalysisWithCoverage(
    state.codebaseAnalysis!,
    testFilePaths,
    process.cwd(),
  );
  state.codebaseAnalysis = enriched;
  return testFilePaths;
}

export function createTools(config: SwagenConfig, cache: ICache): AgentTool<any, any>[] {
  const state: RunState = {};

  // ── 1. validate_spec ──────────────────────────────────────────────────────

  const validateSpec: AgentTool<any, any> = {
    name: "validate_spec",
    label: "Validate Spec",
    description:
      "Validate an OpenAPI/Swagger spec without generating tests. Reports broken $refs, missing required fields, or schema errors.",
    parameters: Type.Object({
      source: Type.String({ description: "File path or URL to the spec." }),
    }),
    async execute(_id: string, params: unknown) {
      const { source } = params as { source: string };
      const specSource = source.startsWith("http")
        ? { kind: "url" as const, url: source }
        : { kind: "file" as const, path: source };
      await loadSpec(specSource);
      return ok({ message: "Spec is valid." });
    },
  };

  // ── 2. load_spec ──────────────────────────────────────────────────────────

  const cachedLoad = withCache(
    cache,
    "load_spec",
    async (source: string) => {
      const specSource = source.startsWith("http")
        ? { kind: "url" as const, url: source }
        : { kind: "file" as const, path: source };
      return loadSpec(specSource);
    },
    config.cache.ttlMs,
  );

  const loadSpecTool: AgentTool<any, any> = {
    name: "load_spec",
    label: "Load Spec",
    description:
      "Load and fully dereference an OpenAPI/Swagger spec from a file path or URL. Caches the result. Must be called before analyze_endpoints.",
    parameters: Type.Object({
      source: Type.String({ description: "File path (./openapi.yaml) or URL (https://...)." }),
    }),
    async execute(_id: string, params: unknown) {
      const { source } = params as { source: string };
      state.spec = await cachedLoad(source);
      const info = (state.spec as Record<string, unknown>)["info"] as
        | Record<string, unknown>
        | undefined;
      const pathCount = Object.keys((state.spec as Record<string, unknown>)["paths"] ?? {}).length;
      return ok(
        {
          title: info?.["title"] ?? "Unknown API",
          version: info?.["version"] ?? "?",
          pathCount,
          message: `Loaded spec with ${pathCount} paths.`,
        },
        { pathCount },
      );
    },
  };

  // ── 3. analyze_endpoints ─────────────────────────────────────────────────

  const analyzeEndpoints: AgentTool<any, any> = {
    name: "analyze_endpoints",
    label: "Analyze Endpoints",
    description:
      "Walk the loaded spec and extract a filtered list of endpoints with full metadata. Review the results before generating.",
    parameters: Type.Object({
      includeTags: Type.Optional(
        Type.Array(Type.String(), { description: "Include only these tags. Empty = all." }),
      ),
      excludeTags: Type.Optional(
        Type.Array(Type.String(), { description: "Exclude endpoints with any of these tags." }),
      ),
      skipOperations: Type.Optional(
        Type.Array(Type.String(), { description: "OperationIds to skip entirely." }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const args = params as {
        includeTags?: string[];
        excludeTags?: string[];
        skipOperations?: string[];
      };
      if (!state.spec) err("Call load_spec first.");

      const ck = await cacheKey("analyze_endpoints", args);
      const cached = await cache.get<{ endpoints: ResolvedEndpoint[]; skipped: string[] }>(ck);
      const result =
        cached ??
        analyzeSpec(state.spec!, {
          includeTags: args.includeTags ?? config.includeTags,
          excludeTags: args.excludeTags ?? config.excludeTags,
          skipOperations: args.skipOperations ?? config.skipOperations,
        });
      if (!cached) await cache.set(ck, result, config.cache.ttlMs);

      state.endpoints = result.endpoints;

      const summary = result.endpoints.map((ep) => ({
        operationId: ep.operationId,
        method: ep.method.toUpperCase(),
        path: ep.path,
        tags: ep.tags,
        params: ep.params.length,
        hasBody: !!ep.body,
        deprecated: ep.deprecated,
      }));

      return ok(
        {
          endpointCount: result.endpoints.length,
          skippedCount: result.skipped.length,
          skipped: result.skipped,
          endpoints: summary,
        },
        { endpointCount: result.endpoints.length },
      );
    },
  };

  // ── 4. generate_tests ────────────────────────────────────────────────────

  const generateTests: AgentTool<any, any> = {
    name: "generate_tests",
    label: "Generate Tests",
    description:
      "Generate Bun or Vitest test source for the analyzed endpoints. Optionally target specific operationIds.",
    parameters: Type.Object({
      runner: Type.Optional(
        Type.Union([Type.Literal("bun"), Type.Literal("vitest")], {
          description: "Test runner. Defaults to config.",
        }),
      ),
      operationIds: Type.Optional(
        Type.Array(Type.String(), {
          description: "Subset of operationIds to target. Empty = all analyzed.",
        }),
      ),
      notes: Type.Optional(
        Type.String({
          description: "Your reasoning about what to generate and why.",
        }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const args = params as { runner?: "bun" | "vitest"; operationIds?: string[]; notes?: string };
      if (!state.endpoints?.length) err("Call analyze_endpoints first.");

      const runner = args.runner ?? config.runner;
      const targets = args.operationIds?.length
        ? state.endpoints!.filter((ep) => args.operationIds!.includes(ep.operationId))
        : state.endpoints!;

      const ck = await cacheKey("generate_tests", {
        runner,
        ids: targets.map((e) => e.operationId),
      });
      const cached = await cache.get<GeneratedFile[]>(ck);
      state.generatedFiles = cached ?? generateTestFiles(targets, config, runner);
      if (!cached) await cache.set(ck, state.generatedFiles, config.cache.ttlMs);

      return ok(
        {
          fileCount: state.generatedFiles.length,
          totalTests: state.generatedFiles.reduce((s, f) => s + f.testCount, 0),
          files: state.generatedFiles.map((f) => ({ path: f.relativePath, tests: f.testCount })),
          notes: args.notes,
        },
        { fileCount: state.generatedFiles.length },
      );
    },
  };

  // ── 5. write_files ───────────────────────────────────────────────────────

  const PROTECTED = new Set(["setup.ts", "fixtures.ts"]);

  const writeFiles: AgentTool<any, any> = {
    name: "write_files",
    label: "Write Files",
    description:
      "Write generated test files to disk. Protected files (setup.ts, fixtures.ts) are never overwritten. Use dryRun to preview.",
    parameters: Type.Object({
      dryRun: Type.Optional(
        Type.Boolean({ description: "Print to stdout only. Nothing written." }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const { dryRun = false } = params as { dryRun?: boolean };
      if (!state.generatedFiles?.length) err("Call generate_tests first.");
      const dry = dryRun || config.dryRun;
      const written: string[] = [];
      const skipped: string[] = [];

      for (const file of state.generatedFiles!) {
        const base = file.relativePath.split("/").pop() ?? "";
        const abs = join(process.cwd(), file.relativePath);

        if (PROTECTED.has(base) && existsSync(abs)) {
          skipped.push(file.relativePath);
          continue;
        }

        if (dry) {
        } else {
          mkdirSync(dirname(abs), { recursive: true });
          await Bun.write(abs, file.content); // eslint-disable-line no-await-in-loop
        }
        written.push(file.relativePath);
      }

      if (!dry && written.length > 0) {
        const { postProcessGeneratedFiles } = await import("../core/postprocess.ts");
        await postProcessGeneratedFiles(state.generatedFiles!, config.outDir, {
          format: true,
          deduplicate: true,
          stripUnused: true,
        });
      }

      const payload: Record<string, unknown> = { written, skipped, dryRun: dry };
      if (dry) {
        payload.files = state.generatedFiles!.map((f) => ({
          path: f.relativePath,
          tests: f.testCount,
          content: f.content,
        }));
      }
      return ok(payload, { written: written.length });
    },
  };

  // ── 6. run_tests ────────────────────────────────────────────────────────

  const runTests: AgentTool<any, any> = {
    name: "run_tests",
    label: "Run Tests",
    description:
      "Execute generated tests via Bun test or Vitest. Returns pass/fail counts and output.",
    parameters: Type.Object({
      runner: Type.Optional(Type.Union([Type.Literal("bun"), Type.Literal("vitest")])),
      targetDir: Type.Optional(
        Type.String({ description: "Test directory. Defaults to config.outDir." }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const args = params as { runner?: "bun" | "vitest"; targetDir?: string };
      const runner = args.runner ?? config.runner;
      const dir = args.targetDir ?? config.outDir;
      const cmd = runner === "vitest" ? ["bunx", "vitest", "run", dir] : ["bun", "test", dir];

      const start = Date.now();
      const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      const durationMs = Date.now() - start;
      const combined = stdout + stderr;
      const passed = parseInt(combined.match(/(\d+) passed/)?.[1] ?? "0", 10);
      const failed = parseInt(combined.match(/(\d+) failed/)?.[1] ?? "0", 10);

      return ok(
        {
          exitCode: code,
          passed,
          failed,
          durationMs: formatDuration(durationMs),
          output: combined.slice(0, 3000),
        },
        { exitCode: code },
      );
    },
  };

  // ── 7. read_file ─────────────────────────────────────────────────────────

  const readFile: AgentTool<any, any> = {
    name: "read_file",
    label: "Read File",
    description:
      "Read any file for context or review. Useful for inspecting existing tests or spec content.",
    parameters: Type.Object({
      path: Type.String({ description: "Relative file path to read." }),
    }),
    async execute(_id: string, params: unknown) {
      const { path } = params as { path: string };
      const abs = join(process.cwd(), path);
      if (!existsSync(abs)) err(`File not found: ${path}`);
      const content = await Bun.file(abs).text();
      return {
        content: [{ type: "text" as const, text: content }],
        details: { path, bytes: content.length },
      };
    },
  };

  // ── 8. get_run_history ───────────────────────────────────────────────────

  const getRunHistory: AgentTool<any, any> = {
    name: "get_run_history",
    label: "Get Run History",
    description: "List recent swagen run records for audit or resumption context.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max records. Default 10." })),
    }),
    async execute(_id: string, params: unknown) {
      const { limit = 10 } = params as { limit?: number };
      const records = (await listRunRecords()).slice(0, limit);
      return ok({ records }, { count: records.length });
    },
  };

  // ── 9. cache_stats ───────────────────────────────────────────────────────

  const cacheStats: AgentTool<any, any> = {
    name: "cache_stats",
    label: "Cache Stats",
    description: "Report current cache hit/miss statistics.",
    parameters: Type.Object({}),
    async execute() {
      return ok(cache.stats());
    },
  };

  // ── 10. search_files ─────────────────────────────────────────────────────

  const searchFiles: AgentTool<any, any> = {
    name: "search_files",
    label: "Search Files",
    description:
      "Search file contents in the project using a regex pattern. Optionally filter by path pattern.",
    parameters: Type.Object({
      pattern: Type.String({ description: "Regex pattern to search for." }),
      pathPattern: Type.Optional(
        Type.String({
          description: "Only search files matching this glob (e.g. '*.test.ts', 'src/**/*.ts').",
        }),
      ),
      maxResults: Type.Optional(Type.Number({ description: "Max results to return. Default 20." })),
    }),
    async execute(_id: string, params: unknown) {
      const {
        pattern,
        pathPattern,
        maxResults = 20,
      } = params as { pattern: string; pathPattern?: string; maxResults?: number };
      const results: Array<{ file: string; line: number; content: string }> = [];
      const glob = new Bun.Glob(pathPattern ?? "**/*.{ts,js,mjs,yaml,yml,json}");
      let count = 0;
      try {
        for await (const file of glob.scan({ cwd: process.cwd(), absolute: true })) {
          if (file.includes("node_modules") || file.includes(".swagen")) continue;
          if (count >= maxResults) break;
          try {
            const text = await Bun.file(file).text();
            const lines = text.split("\n");
            const rel = file.slice(process.cwd().length + 1).replace(/\\/g, "/");
            for (let i = 0; i < lines.length && count < maxResults; i++) {
              const line = lines[i];
              if (line && line.match(new RegExp(pattern, "i"))) {
                results.push({ file: rel, line: i + 1, content: line.trim().slice(0, 200) });
                count++;
              }
            }
          } catch {}
        }
      } catch {}
      if (results.length === 0) return ok({ message: "No matches found.", results: [] });
      return ok({ matchCount: results.length, results });
    },
  };

  // ── 11. replace_in_files ─────────────────────────────────────────────────

  const replaceInFiles: AgentTool<any, any> = {
    name: "replace_in_files",
    label: "Replace In Files",
    description:
      "Replace text across multiple files using string or regex patterns. Dry-run by default unless confirmed.",
    parameters: Type.Object({
      pattern: Type.String({ description: "The string or regex pattern to find." }),
      replacement: Type.String({ description: "The replacement text." }),
      pathPattern: Type.Optional(
        Type.String({
          description: "Only operate on files matching this glob (e.g. 'src/**/*.ts').",
        }),
      ),
      regex: Type.Optional(Type.Boolean({ description: "Treat pattern as regex. Default false." })),
      dryRun: Type.Optional(
        Type.Boolean({ description: "Preview changes without writing. Default true." }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const args = params as {
        pattern: string;
        replacement: string;
        pathPattern?: string;
        regex?: boolean;
        dryRun?: boolean;
      };
      const isDryRun = args.dryRun !== false;
      const changes: Array<{ file: string; replaces: number }> = [];
      const glob = new Bun.Glob(args.pathPattern ?? "**/*.{ts,js,mjs,yaml,yml,json}");

      try {
        for await (const file of glob.scan({ cwd: process.cwd(), absolute: true })) {
          if (file.includes("node_modules") || file.includes(".swagen")) continue;
          try {
            const text = await Bun.file(file).text();
            const flags = "g" + (args.regex ? "" : "");
            const searchPattern = args.regex ? new RegExp(args.pattern, flags) : args.pattern;
            const replaced = text.replaceAll(searchPattern as string | RegExp, args.replacement);
            if (replaced === text) continue;
            const diff = (text.match(searchPattern as string | RegExp) ?? []).length;
            const rel = file.slice(process.cwd().length + 1).replace(/\\/g, "/");
            changes.push({ file: rel, replaces: diff });
            if (!isDryRun) {
              await Bun.write(file, replaced);
            }
          } catch {}
        }
      } catch {}

      if (changes.length === 0)
        return ok({ message: "No matches found.", changes: [], dryRun: isDryRun });
      return ok({
        changeCount: changes.length,
        changes,
        dryRun: isDryRun,
        message: isDryRun ? "Preview only — pass dryRun:false to apply." : "Changes applied.",
      });
    },
  };

  // ── 12. discover_code ─────────────────────────────────────────────────────

  const discoverCode: AgentTool<any, any> = {
    name: "discover_code",
    label: "Discover Code",
    description:
      "Walk the project source and discover functions, classes, exports, API handlers, and framework. Returns a summary of what was found.",
    parameters: Type.Object({
      discoveryPath: Type.Optional(
        Type.String({ description: "Root path for discovery. Default: src." }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const { discoveryPath } = params as { discoveryPath?: string };
      const analysis = discoverCodebase({ ...(discoveryPath ? { discoveryPath } : {}) });
      state.codebaseAnalysis = analysis;

      return ok(
        {
          entityCount: analysis.entities.length,
          functions: analysis.entities.filter((e) => e.type === "function").length,
          classes: analysis.entities.filter((e) => e.type === "class").length,
          exports: analysis.entities.filter((e) => e.isExported).length,
          apiEndpoints: analysis.apiEndpoints.length,
          entryPoints: analysis.entryPoints,
          framework: analysis.framework,
          summary: formatDiscoveryPrompt(analysis),
          entities: analysis.entities.map((e) => ({
            name: e.name,
            type: e.type,
            file: e.file,
            line: e.line,
            isExported: e.isExported,
          })),
        },
        { entityCount: analysis.entities.length },
      );
    },
  };

  // ── 13. analyze_entity ────────────────────────────────────────────────────

  const analyzeEntity: AgentTool<any, any> = {
    name: "analyze_entity",
    label: "Analyze Entity",
    description:
      "Deep-dive on a specific function or class: signature, body, dependencies, and existing test coverage.",
    parameters: Type.Object({
      name: Type.String({ description: "Entity name to analyze." }),
      file: Type.Optional(Type.String({ description: "Optional file path to narrow search." })),
    }),
    async execute(_id: string, params: unknown) {
      const { name, file } = params as { name: string; file?: string };
      if (!state.codebaseAnalysis) {
        // Auto-discover if not yet done
        state.codebaseAnalysis = discoverCodebase();
      }

      let candidates = state.codebaseAnalysis.entities.filter(
        (e) => e.name === name || e.name.toLowerCase() === name.toLowerCase(),
      );
      if (file) candidates = candidates.filter((e) => e.file === file);

      if (candidates.length === 0) err(`Entity "${name}" not found in codebase.`);

      const entity = candidates[0]!;
      return ok(
        {
          entity: {
            name: entity.name,
            type: entity.type,
            file: entity.file,
            line: entity.line,
            signature: entity.signature,
            isAsync: entity.isAsync,
            isExported: entity.isExported,
            decorators: entity.decorators,
            jsDoc: entity.jsDoc,
          },
          coverage: state.codebaseAnalysis.coverageGaps
            .filter((g) => g.entity.name === entity.name)
            .map((g) => ({ coverage: g.coverage, description: g.gapDescription })),
        },
        { found: true },
      );
    },
  };

  // ── 14. check_coverage ───────────────────────────────────────────────────

  const checkCoverage: AgentTool<any, any> = {
    name: "check_coverage",
    label: "Check Coverage",
    description:
      "Scan existing test files against discovered source entities. Returns coverage gaps: untested, low coverage, or partial coverage.",
    parameters: Type.Object({
      threshold: Type.Optional(
        Type.Number({ description: "Coverage threshold (0-1). Default: 0.7." }),
      ),
      minGapLevel: Type.Optional(
        Type.Union([Type.Literal("none"), Type.Literal("low"), Type.Literal("partial")], {
          description: "Minimum gap level to report. Default: none.",
        }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const { threshold: _threshold = 0.7, minGapLevel = "none" } = params as {
        threshold?: number;
        minGapLevel?: "none" | "low" | "partial";
      };
      if (!state.codebaseAnalysis) {
        state.codebaseAnalysis = discoverCodebase();
      }

      const gapLevels: Record<string, number> = { none: 0, low: 1, partial: 2, full: 3 };

      const testFilePaths = enrichWithCoverage(state);

      const filteredGaps = state.codebaseAnalysis.coverageGaps.filter(
        (g) => (gapLevels[g.coverage] ?? 0) <= (gapLevels[minGapLevel] ?? 0),
      );

      const report = generateCoverageReport(state.codebaseAnalysis, testFilePaths, process.cwd());

      return ok(
        {
          totalEntities: state.codebaseAnalysis.entities.length,
          totalGaps: filteredGaps.length,
          gaps: filteredGaps.map((g) => ({
            name: g.entity.name,
            type: g.entity.type,
            file: g.entity.file,
            line: g.entity.line,
            coverage: g.coverage,
            description: g.gapDescription,
          })),
          report,
        },
        { totalGaps: filteredGaps.length },
      );
    },
  };

  // ── 15. read_existing_tests ──────────────────────────────────────────────

  const readExistingTests: AgentTool<any, any> = {
    name: "read_existing_tests",
    label: "Read Existing Tests",
    description:
      "Read and parse existing test files to understand their structure, conventions, describe blocks, and test patterns.",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Specific test file path to read." })),
      maxFiles: Type.Optional(
        Type.Number({ description: "Max test files to analyze. Default: 10." }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const { path, maxFiles = 10 } = params as { path?: string; maxFiles?: number };

      if (path) {
        const structure = readTestFile(path);
        if (!structure) err(`Test file not found: ${path}`);
        return ok({
          file: path,
          conventions: structure!.conventions,
          blocks: structure!.blocks.map((b) => ({
            type: b.type,
            name: b.name,
            children: b.children.map((c) => ({ type: c.type, name: c.name })),
          })),
        });
      }

      // Auto-discover test files
      const allTestFiles = walkFiles(process.cwd(), { maxDepth: 8 });
      const testFilesFiltered = allTestFiles.filter((f) => isTestFile(f.path)).slice(0, maxFiles);
      const conventions = analyzeTestPatterns(testFilesFiltered.map((f) => f.path));

      return ok({
        conventions,
        fileCount: testFilesFiltered.length,
        files: testFilesFiltered.map((f) => f.path),
      });
    },
  };

  // ── 16. augment_tests ────────────────────────────────────────────────────

  const augmentTests: AgentTool<any, any> = {
    name: "augment_tests",
    label: "Augment Tests",
    description:
      "Generate new test cases that augment existing test files. Optionally specify target entities or files.",
    parameters: Type.Object({
      strategy: Type.Optional(
        Type.Union(
          [Type.Literal("smart-merge"), Type.Literal("append"), Type.Literal("separate")],
          { description: "Augmentation strategy. Default: smart-merge." },
        ),
      ),
      targetEntities: Type.Optional(
        Type.Array(Type.String(), { description: "Specific entities to test. Empty = all." }),
      ),
      notes: Type.Optional(
        Type.String({ description: "Your reasoning about what to generate and why." }),
      ),
    }),
    async execute(_id: string, params: unknown) {
      const args = params as {
        strategy?: "smart-merge" | "append" | "separate";
        targetEntities?: string[];
        notes?: string;
      };
      const strategy = args.strategy ?? config.augmentStrategy;

      if (!state.codebaseAnalysis) {
        state.codebaseAnalysis = discoverCodebase();
      }

      const testFilePaths = enrichWithCoverage(state);

      // Filter to target entities if specified
      let targetEntities = state.codebaseAnalysis.entities;
      if (args.targetEntities?.length) {
        targetEntities = state.codebaseAnalysis.entities.filter((e) =>
          args.targetEntities!.includes(e.name),
        );
      }

      // Detect conventions from existing tests
      const conventions = analyzeTestPatterns(testFilePaths.map((f) => relative(process.cwd(), f)));

      // Generate unit tests for target entities
      const generatedFiles = generateUnitTests(targetEntities, config, conventions);

      // Merge with existing test files
      const mergedFiles = mergeTestFiles(generatedFiles, config.outDir, strategy);

      state.generatedFiles = mergedFiles;

      return ok(
        {
          fileCount: mergedFiles.length,
          totalTests: mergedFiles.reduce((s, f) => s + f.testCount, 0),
          strategy,
          files: mergedFiles.map((f) => ({
            path: f.relativePath,
            tests: f.testCount,
            content: f.content.slice(0, 500) + "...", // preview
          })),
          notes: args.notes,
        },
        { fileCount: mergedFiles.length },
      );
    },
  };

  return [
    validateSpec,
    loadSpecTool,
    analyzeEndpoints,
    generateTests,
    writeFiles,
    runTests,
    readFile,
    getRunHistory,
    cacheStats,
    searchFiles,
    replaceInFiles,
    discoverCode,
    analyzeEntity,
    checkCoverage,
    readExistingTests,
    augmentTests,
  ];
}
