import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ApiFramework } from "./core/types.ts";
import { walkFiles, isTestFile, isSourceFile } from "./discovery/walker.ts";

export interface ProjectContext {
  testRunner: "bun" | "vitest" | "jest" | "unknown";
  packageManager: "bun" | "npm" | "unknown";
  hasTsconfig: boolean;
  hasEnvFile: boolean;
  envVars: string[];
  specs: string[];
  existingTestFiles: string[];
  sourceFiles: number;
  testFiles: number;
  conventions: {
    usesDescribe: boolean;
    usesAsyncAwait: boolean;
    usesExpect: boolean;
  };
  /** Detected API frameworks in the project */
  apiFrameworks: ApiFramework[];
  /** Module system detected from package.json */
  moduleSystem: "esm" | "cjs" | "unknown";
}

export async function detectContext(cwd = process.cwd()): Promise<ProjectContext> {
  const ctx: ProjectContext = {
    testRunner: "unknown",
    packageManager: "unknown",
    hasTsconfig: false,
    hasEnvFile: false,
    envVars: [],
    specs: [],
    existingTestFiles: [],
    sourceFiles: 0,
    testFiles: 0,
    conventions: { usesDescribe: false, usesAsyncAwait: false, usesExpect: false },
    apiFrameworks: [],
    moduleSystem: "unknown",
  };

  // Detect package manager
  if (existsSync(join(cwd, "bun.lock"))) ctx.packageManager = "bun";
  else if (existsSync(join(cwd, "package-lock.json"))) ctx.packageManager = "npm";

  // Config files
  ctx.hasTsconfig = existsSync(join(cwd, "tsconfig.json"));
  ctx.hasEnvFile = existsSync(join(cwd, ".env"));

  // Read .env for declared vars
  if (ctx.hasEnvFile) {
    try {
      const text = await Bun.file(join(cwd, ".env")).text();
      for (const line of text.split("\n")) {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
        if (match?.[1]) ctx.envVars.push(match[1]);
      }
    } catch {}
  }

  // Read package.json for test runner, module system, and framework deps
  try {
    const pkg = JSON.parse(await Bun.file(join(cwd, "package.json")).text()) as Record<
      string,
      unknown
    >;
    const deps = {
      ...((pkg.dependencies as Record<string, string>) ?? {}),
      ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };
    if (deps["vitest"]) ctx.testRunner = "vitest";
    else if (deps["jest"] || deps["@jest/globals"]) ctx.testRunner = "jest";
    else ctx.testRunner = "bun";

    // Detect module system
    const typeField = pkg["type"] as string | undefined;
    if (typeField === "module") ctx.moduleSystem = "esm";
    else if (typeField === "commonjs") ctx.moduleSystem = "cjs";
    else ctx.moduleSystem = "cjs";

    // Detect API frameworks from dependencies
    const frameworkMap: Record<string, ApiFramework> = {
      "@nestjs/core": "nestjs",
      express: "express",
      fastify: "fastify",
      hono: "hono",
      next: "nextjs",
    };
    for (const [dep, fw] of Object.entries(frameworkMap)) {
      if (deps[dep]) ctx.apiFrameworks.push(fw);
    }
  } catch {}

  // Also walk src directory for patterns to detect framework
  if (ctx.apiFrameworks.length === 0) {
    try {
      const all = walkFiles(join(cwd, "src"), { maxDepth: 4 });
      for (const entry of all.slice(0, 50)) {
        // eslint-disable-next-line no-await-in-loop
        const content = await Bun.file(entry.absPath).text();
        if (content.includes("@Controller(") || content.includes("@Module(")) {
          ctx.apiFrameworks.push("nestjs");
          break;
        }
        if (content.includes("Router()") || content.includes("app.get(")) {
          if (!ctx.apiFrameworks.includes("express")) ctx.apiFrameworks.push("express");
        }
      }
    } catch {}
  }

  // Find specs and test files via walkFiles
  try {
    const all = walkFiles(cwd, { maxDepth: 6 });
    for (const entry of all) {
      if (isSourceFile(entry.path)) ctx.sourceFiles++;
      if (isTestFile(entry.path)) {
        ctx.testFiles++;
        ctx.existingTestFiles.push(entry.path);
      }
      if (
        entry.path.match(/^.*\.(yaml|json)$/) &&
        (entry.path.startsWith("openapi") || entry.path.startsWith("swagger"))
      ) {
        ctx.specs.push(entry.path);
      }
    }
  } catch {}

  // Check a few test files for conventions
  const contents = await Promise.all(
    ctx.existingTestFiles.slice(0, 5).map(async (tf) => {
      try {
        return await Bun.file(join(cwd, tf)).text();
      } catch {
        return "";
      }
    }),
  );
  for (const content of contents) {
    if (content.includes("describe(")) ctx.conventions.usesDescribe = true;
    if (content.includes("async (")) ctx.conventions.usesAsyncAwait = true;
    if (content.includes("expect(")) ctx.conventions.usesExpect = true;
  }

  return ctx;
}

export function contextPrompt(ctx: ProjectContext): string {
  const lines: string[] = ["## Project Context"];

  lines.push(`- Test runner: ${ctx.testRunner}`);
  lines.push(`- Package manager: ${ctx.packageManager}`);
  lines.push(`- TypeScript: ${ctx.hasTsconfig ? "yes" : "no"}`);
  lines.push(`- Module system: ${ctx.moduleSystem}`);
  lines.push(`- Source files: ${ctx.sourceFiles}`);
  lines.push(`- Existing test files: ${ctx.testFiles}`);

  if (ctx.apiFrameworks.length > 0) {
    lines.push(`- API frameworks: ${ctx.apiFrameworks.join(", ")}`);
  }
  if (ctx.specs.length > 0) {
    lines.push(`- API specs found: ${ctx.specs.join(", ")}`);
  }
  if (ctx.existingTestFiles.length > 0) {
    lines.push(
      `- Existing tests: ${ctx.existingTestFiles.slice(0, 10).join(", ")}${ctx.existingTestFiles.length > 10 ? "..." : ""}`,
    );
  }
  if (ctx.envVars.length > 0) {
    lines.push(
      `- Environment variables: ${ctx.envVars.slice(0, 8).join(", ")}${ctx.envVars.length > 8 ? "..." : ""}`,
    );
  }
  if (ctx.conventions.usesDescribe || ctx.conventions.usesExpect) {
    const parts: string[] = [];
    if (ctx.conventions.usesDescribe) parts.push("describe/it blocks");
    if (ctx.conventions.usesExpect) parts.push("expect assertions");
    if (ctx.conventions.usesAsyncAwait) parts.push("async/await");
    lines.push(`- Conventions detected: ${parts.join(", ")}`);
  }

  return lines.join("\n");
}
