import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  mapEndpointsToSummary,
  filterEntitiesByNames,
  getTestFilePaths,
  discoverAndEnrich,
  generateAndMergeTests,
  searchProjectFiles,
  runTestRunner,
  writeGeneratedFiles,
} from "../shared/tool-helpers.ts";
import { loadSpec, analyzeSpec } from "../core/spec.ts";
import { generateTestFiles } from "../core/codegen.ts";
import type { SwagenConfig } from "../core/types.ts";
import { getOrCreateSession } from "./session.ts";
import { listRunRecords } from "../tools/state.ts";
import { discoverCodebase, formatDiscoveryPrompt } from "../discovery/index.ts";
import { generateCoverageReport } from "../coverage/index.ts";

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, sessionId: string) => Promise<CallToolResult>;
}

function textContent(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorContent(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function specSource(source: string) {
  return source.startsWith("http")
    ? { kind: "url" as const, url: source }
    : { kind: "file" as const, path: source };
}

function enrichSession(sid: string, discoveryPath?: string) {
  const session = getOrCreateSession(sid);
  if (session.codebaseAnalysis) {
    return {
      enriched: session.codebaseAnalysis,
      testFilePaths: getTestFilePaths(process.cwd()),
    };
  }
  const result = discoverAndEnrich(discoveryPath);
  session.codebaseAnalysis = result.enriched;
  return result;
}

export function buildMcpTools(config: SwagenConfig): McpToolDef[] {
  // ── 1. validate_spec ────────────────────────────────────────────────────
  const validateSpec: McpToolDef = {
    name: "validate_spec",
    description: "Validate an OpenAPI/Swagger spec without generating tests.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "File path or URL to the spec." },
      },
      required: ["source"],
    },
    async handler(args, _sid) {
      const source = String(args["source"] ?? "");
      try {
        await loadSpec(specSource(source));
        return textContent(JSON.stringify({ ok: true, message: "Spec is valid." }));
      } catch (err) {
        return errorContent(String(err));
      }
    },
  };

  // ── 2. analyze_spec ─────────────────────────────────────────────────────
  const analyzeSpecTool: McpToolDef = {
    name: "analyze_spec",
    description: "Load and analyze an OpenAPI spec. Returns endpoints with full metadata.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "File path or URL to the spec." },
        includeTags: {
          type: "array",
          items: { type: "string" },
          description: "Only include these tags. Empty = all.",
        },
        excludeTags: {
          type: "array",
          items: { type: "string" },
          description: "Exclude endpoints with these tags.",
        },
        skipOperations: {
          type: "array",
          items: { type: "string" },
          description: "OperationIds to skip.",
        },
      },
      required: ["source"],
    },
    async handler(args, sid) {
      const source = String(args["source"] ?? "");
      const session = getOrCreateSession(sid);
      try {
        const doc = await loadSpec(specSource(source));
        session.spec = doc;

        const includeTags = (args["includeTags"] as string[]) ?? config.includeTags;
        const excludeTags = (args["excludeTags"] as string[]) ?? config.excludeTags;
        const skipOperations = (args["skipOperations"] as string[]) ?? config.skipOperations;

        const { endpoints, skipped } = analyzeSpec(doc, {
          includeTags,
          excludeTags,
          skipOperations,
        });
        session.endpoints = endpoints;

        const info = (doc as Record<string, unknown>)["info"] as
          | Record<string, unknown>
          | undefined;
        return textContent(
          JSON.stringify(
            {
              title: info?.["title"] ?? "Unknown API",
              version: info?.["version"] ?? "?",
              endpointCount: endpoints.length,
              skippedCount: skipped.length,
              endpoints: mapEndpointsToSummary(endpoints),
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return errorContent(String(err));
      }
    },
  };

  // ── 3. generate_tests ───────────────────────────────────────────────────
  const generateTestsTool: McpToolDef = {
    name: "generate_tests",
    description: "Generate test source code for analyzed endpoints.",
    inputSchema: {
      type: "object",
      properties: {
        runner: {
          type: "string",
          enum: ["bun", "vitest"],
          description: "Test runner. Defaults to config.",
        },
        operationIds: {
          type: "array",
          items: { type: "string" },
          description: "Subset of operationIds to target. Empty = all analyzed.",
        },
      },
    },
    async handler(args, sid) {
      const session = getOrCreateSession(sid);
      if (!session.endpoints?.length) {
        return errorContent("No endpoints analyzed. Call analyze_spec first.");
      }
      const runner = (args["runner"] as "bun" | "vitest") ?? config.runner;
      const operationIds = args["operationIds"] as string[] | undefined;
      const targets = operationIds?.length
        ? session.endpoints.filter((ep) => operationIds.includes(ep.operationId))
        : session.endpoints;

      const files = generateTestFiles(targets, config, runner);
      session.generatedFiles = files;

      return textContent(
        JSON.stringify(
          {
            fileCount: files.length,
            totalTests: files.reduce((s, f) => s + f.testCount, 0),
            files: files.map((f) => ({ path: f.relativePath, tests: f.testCount })),
          },
          null,
          2,
        ),
      );
    },
  };

  // ── 4. write_test_files ─────────────────────────────────────────────────
  const writeFilesTool: McpToolDef = {
    name: "write_test_files",
    description: "Write generated test files to disk.",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: {
          type: "boolean",
          description: "Preview only. Nothing written.",
        },
      },
    },
    async handler(args, sid) {
      const session = getOrCreateSession(sid);
      if (!session.generatedFiles?.length) {
        return errorContent("No generated files. Call generate_tests first.");
      }
      const dryRun = args["dryRun"] === true || config.dryRun;
      const { written } = await writeGeneratedFiles(session.generatedFiles, dryRun, process.cwd());

      if (!dryRun && written.length > 0) {
        const { postProcessGeneratedFiles } = await import("../core/postprocess.ts");
        await postProcessGeneratedFiles(session.generatedFiles, config.outDir, {
          format: true,
          deduplicate: true,
          stripUnused: true,
        });
      }

      return textContent(
        JSON.stringify({ written, skipped: [], dryRun, count: written.length }, null, 2),
      );
    },
  };

  // ── 5. run_tests ────────────────────────────────────────────────────────
  const runTestsTool: McpToolDef = {
    name: "run_tests",
    description: "Execute generated tests via Bun test or Vitest.",
    inputSchema: {
      type: "object",
      properties: {
        runner: {
          type: "string",
          enum: ["bun", "vitest"],
          description: "Test runner. Defaults to config.",
        },
        targetDir: {
          type: "string",
          description: "Test directory. Defaults to config.outDir.",
        },
      },
    },
    async handler(args) {
      const runner = (args["runner"] as "bun" | "vitest") ?? config.runner;
      const dir = String(args["targetDir"] ?? config.outDir);

      try {
        const parsed = await runTestRunner(runner, dir);
        return textContent(
          JSON.stringify(
            {
              exitCode: parsed.exitCode,
              passed: parsed.passed,
              failed: parsed.failed,
              durationMs: parsed.durationMs,
              output: parsed.output.slice(0, 5000),
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return errorContent(String(err));
      }
    },
  };

  // ── 6. read_source_file ─────────────────────────────────────────────────
  const readFileTool: McpToolDef = {
    name: "read_source_file",
    description: "Read any file for context or review.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path to read." },
      },
      required: ["path"],
    },
    async handler(args) {
      const filePath = String(args["path"] ?? "");
      const abs = join(process.cwd(), filePath);
      if (!existsSync(abs)) return errorContent(`File not found: ${filePath}`);
      try {
        const content = await Bun.file(abs).text();
        return textContent(content);
      } catch (err) {
        return errorContent(String(err));
      }
    },
  };

  // ── 7. search_project_files ────────────────────────────────────────────
  const searchFilesTool: McpToolDef = {
    name: "search_project_files",
    description: "Search file contents in the project using a regex pattern.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern to search for." },
        pathPattern: {
          type: "string",
          description: "Only search files matching this glob (e.g. '*.test.ts').",
        },
        maxResults: {
          type: "number",
          description: "Max results to return. Default 20.",
        },
      },
      required: ["pattern"],
    },
    async handler(args) {
      const pattern = String(args["pattern"] ?? "");
      const pathPattern = args["pathPattern"] as string | undefined;
      const maxResults = Number(args["maxResults"] ?? 20);
      const results = await searchProjectFiles(pathPattern, maxResults, pattern, "i");

      return textContent(JSON.stringify({ matchCount: results.length, results }, null, 2));
    },
  };

  // ── 8. analyze_codebase ─────────────────────────────────────────────────
  const discoverCodeTool: McpToolDef = {
    name: "analyze_codebase",
    description: "Walk the project source and discover functions, classes, exports, API handlers.",
    inputSchema: {
      type: "object",
      properties: {
        discoveryPath: {
          type: "string",
          description: "Root path for discovery. Default: src.",
        },
      },
    },
    async handler(args, sid) {
      const discoveryPath = args["discoveryPath"] as string | undefined;
      const analysis = discoverCodebase({ ...(discoveryPath ? { discoveryPath } : {}) });
      const session = getOrCreateSession(sid);
      session.codebaseAnalysis = analysis;

      return textContent(
        JSON.stringify(
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
          null,
          2,
        ),
      );
    },
  };

  // ── 9. check_test_coverage ──────────────────────────────────────────────
  const checkCoverageTool: McpToolDef = {
    name: "check_test_coverage",
    description: "Scan existing tests against discovered source entities.",
    inputSchema: {
      type: "object",
      properties: {
        discoveryPath: {
          type: "string",
          description: "Root path for discovery. Default: src.",
        },
      },
    },
    async handler(args, sid) {
      const discoveryPath = args["discoveryPath"] as string | undefined;
      const { enriched, testFilePaths } = enrichSession(sid, discoveryPath);

      const gaps = enriched.coverageGaps.filter((g) => g.coverage !== "full");
      const report = generateCoverageReport(enriched, testFilePaths, process.cwd(), {
        skipFallback: true,
      });

      return textContent(
        JSON.stringify(
          {
            totalEntities: enriched.entities.length,
            totalGaps: gaps.length,
            gaps: gaps.map((g) => ({
              name: g.entity.name,
              type: g.entity.type,
              file: g.entity.file,
              coverage: g.coverage,
              description: g.gapDescription,
            })),
            report,
          },
          null,
          2,
        ),
      );
    },
  };

  // ── 10. generate_from_spec (high-level convenience) ─────────────────────
  const generateFromSpecTool: McpToolDef = {
    name: "generate_from_spec",
    description:
      "Full pipeline: load spec → analyze → generate tests → write files → optionally run tests.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", description: "File path or URL to the spec." },
        runner: {
          type: "string",
          enum: ["bun", "vitest"],
          description: "Test runner. Defaults to config.",
        },
        includeTags: {
          type: "array",
          items: { type: "string" },
          description: "Only include these tags.",
        },
        excludeTags: {
          type: "array",
          items: { type: "string" },
          description: "Exclude endpoints with these tags.",
        },
        dryRun: {
          type: "boolean",
          description: "Preview only. Nothing written.",
        },
        runTests: {
          type: "boolean",
          description: "Also execute the generated tests.",
        },
      },
      required: ["source"],
    },
    async handler(args, sid) {
      const source = String(args["source"] ?? "");
      const runner = (args["runner"] as "bun" | "vitest") ?? config.runner;
      const dryRun = args["dryRun"] === true || config.dryRun;
      const session = getOrCreateSession(sid);

      try {
        const doc = await loadSpec(specSource(source));
        session.spec = doc;

        const { endpoints } = analyzeSpec(doc, {
          includeTags: (args["includeTags"] as string[]) ?? config.includeTags,
          excludeTags: (args["excludeTags"] as string[]) ?? config.excludeTags,
          skipOperations: config.skipOperations,
        });
        session.endpoints = endpoints;

        const files = generateTestFiles(endpoints, config, runner);
        session.generatedFiles = files;

        let written: string[] = [];
        if (!dryRun) {
          ({ written } = await writeGeneratedFiles(files, false, process.cwd()));

          if (written.length > 0) {
            const { postProcessGeneratedFiles } = await import("../core/postprocess.ts");
            await postProcessGeneratedFiles(files, config.outDir, {
              format: true,
              deduplicate: true,
              stripUnused: true,
            });
          }
        }

        let testResult: Record<string, unknown> | undefined;
        if (args["runTests"] === true && !dryRun) {
          const parsed = await runTestRunner(runner, config.outDir);
          testResult = { exitCode: parsed.exitCode, output: parsed.output.slice(0, 2000) };
        }

        return textContent(
          JSON.stringify(
            {
              endpointCount: endpoints.length,
              fileCount: files.length,
              totalTests: files.reduce((s, f) => s + f.testCount, 0),
              written,
              dryRun,
              testResult,
              files: files.map((f) => ({ path: f.relativePath, tests: f.testCount })),
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return errorContent(String(err));
      }
    },
  };

  // ── 11. augment_tests (high-level convenience) ──────────────────────────
  const augmentTestsTool: McpToolDef = {
    name: "augment_tests",
    description: "Generate new test cases that augment existing test files.",
    inputSchema: {
      type: "object",
      properties: {
        discoveryPath: {
          type: "string",
          description: "Root path for discovery. Default: src.",
        },
        strategy: {
          type: "string",
          enum: ["smart-merge", "append", "separate"],
          description: "Augmentation strategy. Default: smart-merge.",
        },
        targetEntities: {
          type: "array",
          items: { type: "string" },
          description: "Specific entities to test. Empty = all.",
        },
      },
    },
    async handler(args, sid) {
      const discoveryPath = args["discoveryPath"] as string | undefined;
      const strategy =
        (args["strategy"] as "smart-merge" | "append" | "separate") ?? config.augmentStrategy;
      const targetNames = args["targetEntities"] as string[] | undefined;
      const { enriched, testFilePaths } = enrichSession(sid, discoveryPath);

      const targetEntities = targetNames?.length
        ? filterEntitiesByNames(enriched.entities, targetNames)
        : enriched.entities;
      const mergedFiles = generateAndMergeTests(targetEntities, testFilePaths, config, strategy);
      getOrCreateSession(sid).generatedFiles = mergedFiles;

      return textContent(
        JSON.stringify(
          {
            fileCount: mergedFiles.length,
            totalTests: mergedFiles.reduce((s, f) => s + f.testCount, 0),
            strategy,
            files: mergedFiles.map((f) => ({
              path: f.relativePath,
              tests: f.testCount,
            })),
          },
          null,
          2,
        ),
      );
    },
  };

  // ── 12. coverage_report (high-level convenience) ────────────────────────
  const coverageReportTool: McpToolDef = {
    name: "coverage_report",
    description: "Full coverage analysis: discover code → scan tests → report gaps.",
    inputSchema: {
      type: "object",
      properties: {
        discoveryPath: {
          type: "string",
          description: "Root path for discovery. Default: src.",
        },
      },
    },
    async handler(args) {
      const discoveryPath = args["discoveryPath"] as string | undefined;
      const { enriched, testFilePaths } = discoverAndEnrich(discoveryPath);
      const report = generateCoverageReport(enriched, testFilePaths, process.cwd(), {
        skipFallback: true,
      });

      const uncovered = enriched.coverageGaps.filter((g) => g.coverage === "none");
      const partial = enriched.coverageGaps.filter((g) => g.coverage === "partial");

      return textContent(
        JSON.stringify(
          {
            totalEntities: enriched.entities.length,
            uncoveredCount: uncovered.length,
            partialCount: partial.length,
            coveredCount: enriched.entities.length - uncovered.length - partial.length,
            uncovered: uncovered.map((g) => ({
              name: g.entity.name,
              file: g.entity.file,
              description: g.gapDescription,
            })),
            partial: partial.map((g) => ({
              name: g.entity.name,
              file: g.entity.file,
              description: g.gapDescription,
            })),
            report,
          },
          null,
          2,
        ),
      );
    },
  };

  // ── 13. get_run_history ─────────────────────────────────────────────────
  const runHistoryTool: McpToolDef = {
    name: "get_run_history",
    description: "List recent swagen run records for audit or resumption context.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max records. Default 10.",
        },
      },
    },
    async handler(args) {
      const limit = Number(args["limit"] ?? 10);
      const records = (await listRunRecords()).slice(0, limit);
      return textContent(JSON.stringify({ records }, null, 2));
    },
  };

  return [
    validateSpec,
    analyzeSpecTool,
    generateTestsTool,
    writeFilesTool,
    runTestsTool,
    readFileTool,
    searchFilesTool,
    discoverCodeTool,
    checkCoverageTool,
    generateFromSpecTool,
    augmentTestsTool,
    coverageReportTool,
    runHistoryTool,
  ];
}
