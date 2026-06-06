import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface WalkOptions {
  includeGlob?: string[];
  excludeDirs?: string[];
  maxDepth?: number;
  maxSize?: number;
}

export interface WalkEntry {
  path: string;
  absPath: string;
  size: number;
}

const DEFAULT_SKIP = new Set([
  ".git",
  ".swagen",
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
]);

export function walkFiles(base: string, options: WalkOptions = {}): WalkEntry[] {
  const { excludeDirs = [], maxDepth = 10, maxSize = 500_000 } = options;
  const skip = new Set([...DEFAULT_SKIP, ...excludeDirs]);
  const results: WalkEntry[] = [];

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".") || skip.has(name)) continue;
      const abs = join(dir, name);
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(abs, depth + 1);
      } else if (stat.size <= maxSize && name.match(/\.(ts|js|mjs|tsx|jsx)$/)) {
        results.push({
          path: relative(base, abs).replace(/\\/g, "/"),
          absPath: abs,
          size: stat.size,
        });
      }
    }
  }

  walk(base, 0);
  return results;
}

export function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|js|mjs|tsx|jsx)$/.test(path);
}

export function isSourceFile(path: string): boolean {
  return !isTestFile(path) && /\.(ts|js|mjs|tsx|jsx)$/.test(path);
}
