import { readFileSync, existsSync } from "node:fs";
import { join, isAbsolute } from "node:path";

import type { CodebaseAnalysis, SourceEntity } from "../core/types.ts";
import { walkFiles, isSourceFile, isTestFile } from "./walker.ts";
import { extractEntities } from "./extractor.ts";
import { detectFramework, detectRoutePatterns } from "./framework.ts";

export interface DiscoveryOptions {
  discoveryPath?: string;
  excludeDirs?: string[];
  maxDepth?: number;
}

export function discoverCodebase(options: DiscoveryOptions = {}): CodebaseAnalysis {
  const { discoveryPath = "src", excludeDirs = [], maxDepth = 10 } = options;

  const base = isAbsolute(discoveryPath) ? discoveryPath : join(process.cwd(), discoveryPath);
  if (!existsSync(base)) {
    return {
      entities: [],
      dependencies: [],
      coverageGaps: [],
      entryPoints: [],
      apiEndpoints: [],
      framework: "unknown",
    };
  }

  const allFiles = walkFiles(base, { excludeDirs, maxDepth });
  const sourceFiles = allFiles.filter((f) => isSourceFile(f.path));
  const testFilePaths = allFiles.filter((f) => isTestFile(f.path)).map((f) => f.absPath);

  const allEntities: SourceEntity[] = [];

  for (const sf of sourceFiles) {
    try {
      const entities = extractEntities(sf.absPath, sf.path);
      allEntities.push(...entities);
    } catch {
      // skip unreadable files
    }
  }

  // Detect framework from all source files
  const fileReader = (p: string) => readFileSync(p, "utf-8");
  const framework = detectFramework(
    sourceFiles.map((f) => f.absPath),
    fileReader,
  );

  // Discover API route patterns
  const apiEndpoints: SourceEntity[] = [];
  for (const sf of sourceFiles) {
    try {
      const content = fileReader(sf.absPath);
      const routes = detectRoutePatterns(content, sf.path);
      for (const route of routes) {
        const existing = allEntities.find((e) => e.file === sf.path && e.line === route.line);
        if (existing) {
          apiEndpoints.push(existing);
        }
      }
    } catch {
      // skip
    }
  }

  // Find entry points
  const entryPoints = sourceFiles
    .filter((f) => {
      const name = f.path.split("/").pop() ?? "";
      return name === "index.ts" || name === "main.ts" || name === "app.ts";
    })
    .map((f) => f.path);

  return {
    entities: allEntities,
    dependencies: [],
    coverageGaps: [],
    entryPoints,
    apiEndpoints,
    framework,
    testFilePaths,
  };
}

export { walkFiles, isSourceFile, isTestFile } from "./walker.ts";
export { extractEntities } from "./extractor.ts";
export { detectFramework, detectRoutePatterns } from "./framework.ts";
export { formatDiscoveryPrompt, formatEntitySummary } from "./exporter.ts";
