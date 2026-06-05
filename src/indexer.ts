import { existsSync, mkdirSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export interface IndexEntry {
  path: string;
  size: number;
  mtimeMs: number;
  lines: number;
  type: "source" | "test" | "spec" | "config" | "other";
}

export interface CodebaseIndex {
  version: number;
  createdAt: string;
  root: string;
  files: IndexEntry[];
  testNames: string[];
  specPaths: string[];
  importGraph: Record<string, string[]>;
  /** Entities discovered from source files (populated in codebase mode) */
  entities?: Array<{ name: string; type: string; file: string; line: number }>;
  /** Detected API endpoints from route patterns */
  apiEndpoints?: Array<{ name: string; method: string; path: string }>;
}

const INDEX_VERSION = 1;
const INDEX_DIR = ".swagen/index";

function indexDir(cwd: string): string {
  return join(cwd, INDEX_DIR);
}

function indexPath(cwd: string): string {
  return join(indexDir(cwd), "codebase.json");
}

export async function buildIndex(cwd = process.cwd()): Promise<CodebaseIndex> {
  const files: IndexEntry[] = [];
  const testNames: string[] = [];
  const specPaths: string[] = [];
  const importGraph: Record<string, string[]> = {};

  walkDir(cwd, cwd, files, testNames, specPaths, importGraph, 0);

  // Extract entities from source files for codebase mode
  const entities: CodebaseIndex["entities"] = [];
  const apiEndpoints: CodebaseIndex["apiEndpoints"] = [];
  try {
    const { extractEntities } = await import("./discovery/extractor.ts");
    const { detectRoutePatterns } = await import("./discovery/framework.ts");
    for (const f of files) {
      if (f.type === "source") {
        try {
          const content = readFileSync(join(cwd, f.path), "utf-8");
          const ents = extractEntities(join(cwd, f.path), content);
          for (const e of ents) {
            entities.push({ name: e.name, type: e.type, file: f.path, line: e.line });
          }
          const routes = detectRoutePatterns(content, f.path);
          for (const r of routes) {
            apiEndpoints.push({ name: r.method, method: r.method, path: r.path });
          }
        } catch {}
      }
    }
  } catch {}

  const idx: CodebaseIndex = {
    version: INDEX_VERSION,
    createdAt: new Date().toISOString(),
    root: cwd,
    files,
    testNames,
    specPaths,
    importGraph,
  } as CodebaseIndex;
  if (entities.length > 0) (idx as any).entities = entities;
  if (apiEndpoints.length > 0) (idx as any).apiEndpoints = apiEndpoints;

  const dir = indexDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await Bun.write(indexPath(cwd), JSON.stringify(idx, null, 2));

  return idx;
}

export async function loadIndex(cwd = process.cwd()): Promise<CodebaseIndex | null> {
  const p = indexPath(cwd);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await Bun.file(p).text()) as CodebaseIndex;
  } catch {
    return null;
  }
}

export async function getIndex(cwd = process.cwd()): Promise<CodebaseIndex> {
  const cached = await loadIndex(cwd);
  if (cached) return cached;
  return buildIndex(cwd);
}

export function searchIndex(index: CodebaseIndex, query: string): IndexEntry[] {
  const lower = query.toLowerCase();
  return index.files.filter((f) => f.path.toLowerCase().includes(lower));
}

export function searchTests(index: CodebaseIndex, query: string): string[] {
  const lower = query.toLowerCase();
  return index.testNames.filter((n) => n.toLowerCase().includes(lower));
}

function walkDir(
  dir: string,
  base: string,
  files: IndexEntry[],
  testNames: string[],
  specPaths: string[],
  importGraph: Record<string, string[]>,
  depth: number,
): void {
  if (depth > 8) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules" || name === ".swagen") continue;
    const abs = join(dir, name);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(abs, base, files, testNames, specPaths, importGraph, depth + 1);
      continue;
    }

    if (!name.match(/\.(ts|js|mjs|yaml|yml|json)$/)) continue;
    if (stat.size > 500_000) continue;

    const rel = relative(base, abs).replace(/\\/g, "/");

    let type: IndexEntry["type"] = "other";
    if (rel.match(/\.(test|spec)\.(ts|js|mjs)$/)) type = "test";
    else if (rel.startsWith("openapi") || rel.startsWith("swagger") || rel.includes("spec"))
      type = "spec";
    else if (rel.match(/\.(ts|js|mjs)$/) && !rel.includes("node_modules")) type = "source";
    else if (rel.match(/package\.json|tsconfig|\.env/)) type = "config";

    files.push({ path: rel, size: stat.size, mtimeMs: stat.mtimeMs, lines: 0, type });

    if (type === "spec") specPaths.push(rel);

    // Extract test names and imports
    if (type === "test" || type === "source") {
      try {
        const content = readFileSync(abs, "utf-8");
        if (type === "test") {
          const matches = content.matchAll(/(?:it|test)\s*\(\s*["'`]([^"'`]+)["'`]/g);
          for (const m of matches) {
            const testName = m[1];
            if (testName) testNames.push(testName);
          }
        }
        const imports = [...content.matchAll(/from\s+["']([^"']+)["']/g)]
          .map((m) => m[1])
          .filter((x): x is string => !!x);
        if (imports.length > 0) importGraph[rel] = imports;
      } catch {}
    }
  }
}
