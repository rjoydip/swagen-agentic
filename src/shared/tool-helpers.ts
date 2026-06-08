import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import type { GeneratedFile, ResolvedEndpoint, SourceEntity, SwagenConfig } from "../core/types.ts";

type Entity = SourceEntity;
import { discoverCodebase } from "../discovery/index.ts";
import { walkFiles, isTestFile } from "../discovery/walker.ts";
import { enrichAnalysisWithCoverage } from "../coverage/index.ts";
import { analyzeTestPatterns, generateUnitTests, mergeTestFiles } from "../core/augmenter.ts";

export const PROTECTED_FILES = new Set(["setup.ts", "fixtures.ts"]);

export interface FileSearchResult {
  file: string;
  line: number;
  content: string;
}

export function mapEndpointsToSummary(endpoints: ResolvedEndpoint[]) {
  return endpoints.map((ep) => ({
    operationId: ep.operationId,
    method: ep.method.toUpperCase(),
    path: ep.path,
    tags: ep.tags,
    params: ep.params.length,
    hasBody: !!ep.body,
    deprecated: ep.deprecated,
  }));
}

export function filterEntitiesByNames(entities: Entity[], names: string[]) {
  return entities.filter((e) => names.includes(e.name));
}

export function parseTestOutput(stdout: string, stderr: string, exitCode: number, startMs: number) {
  const durationMs = Date.now() - startMs;
  const combined = stdout + stderr;
  return {
    exitCode,
    passed: parseInt(combined.match(/(\d+) passed/)?.[1] ?? "0", 10),
    failed: parseInt(combined.match(/(\d+) failed/)?.[1] ?? "0", 10),
    durationMs,
    output: combined,
  };
}

export function isFileProtected(baseName: string, absPath: string) {
  return PROTECTED_FILES.has(baseName) && existsSync(absPath);
}

export function ensureDirForFile(absPath: string) {
  mkdirSync(dirname(absPath), { recursive: true });
}

export function getTestFilePaths(cwd: string) {
  const allFiles = walkFiles(cwd, { maxDepth: 8 });
  return allFiles.filter((f) => isTestFile(f.path)).map((f) => f.absPath);
}

export function discoverAndEnrich(discoveryPath?: string) {
  const analysis = discoverCodebase({ ...(discoveryPath ? { discoveryPath } : {}) });
  const testFilePaths = getTestFilePaths(process.cwd());
  const enriched = enrichAnalysisWithCoverage(analysis, testFilePaths, process.cwd());
  return { enriched, testFilePaths };
}

export function generateAndMergeTests(
  targetEntities: Entity[],
  testFilePaths: string[],
  config: SwagenConfig,
  strategy: "smart-merge" | "append" | "separate",
) {
  const conventions = analyzeTestPatterns(testFilePaths.map((f) => relative(process.cwd(), f)));
  const generatedFiles = generateUnitTests(
    targetEntities,
    config,
    conventions,
    config.discoveryPath,
  );
  return mergeTestFiles(generatedFiles, process.cwd(), strategy);
}

export async function runTestRunner(runner: string, dir: string) {
  const cmd = runner === "vitest" ? ["bunx", "vitest", "run", dir] : ["bun", "test", dir];
  const start = Date.now();
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return parseTestOutput(stdout, stderr, code, start);
}

export async function writeGeneratedFiles(
  files: GeneratedFile[],
  dryRun: boolean,
  cwd: string,
): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const base = file.relativePath.split("/").pop() ?? "";
    const abs = join(cwd, file.relativePath);
    if (isFileProtected(base, abs)) {
      skipped.push(file.relativePath);
      continue;
    }
    if (!dryRun) {
      ensureDirForFile(abs);
      await Bun.write(abs, file.content); // eslint-disable-line no-await-in-loop
    }
    written.push(file.relativePath);
  }
  return { written, skipped };
}

export async function searchProjectFiles(
  pathPattern: string | undefined,
  maxResults: number,
  pattern: string,
  flags: string,
): Promise<FileSearchResult[]> {
  const results: FileSearchResult[] = [];
  const glob = new Bun.Glob(pathPattern ?? "**/*.{ts,js,mjs,yaml,yml,json}");
  let count = 0;

  for await (const file of glob.scan({ cwd: process.cwd(), absolute: true })) {
    if (file.includes("node_modules") || file.includes(".swagen")) continue;
    if (count >= maxResults) break;
    try {
      const text = await Bun.file(file).text();
      const lines = text.split("\n");
      const rel = file.slice(process.cwd().length + 1).replace(/\\/g, "/");
      for (let i = 0; i < lines.length && count < maxResults; i++) {
        const line = lines[i];
        if (line && line.match(new RegExp(pattern, flags))) {
          results.push({ file: rel, line: i + 1, content: line.trim().slice(0, 200) });
          count++;
        }
      }
    } catch (e) {
      console.warn(`searchProjectFiles: Failed to read ${file}: ${e}`);
    }
  }

  return results;
}
