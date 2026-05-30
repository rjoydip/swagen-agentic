import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GeneratedFile } from "./types.ts";

const FORMAT_TIMEOUT = 10_000;

interface ImportStatement {
  lineIndex: number;
  source: string;
  names: string[];
  isTypeImport: boolean;
  isNamespaceImport: boolean;
  importVar: string | null;
  raw: string;
}

export function parseImports(code: string): ImportStatement[] {
  const imports: ImportStatement[] = [];
  const lines = code.split("\n");
  const re =
    /^\s*import\s+(?:type\s+)?(?:(?:\*\s+as\s+(\w+))|\{([^}]*)\}|(\w+))\s+from\s+["']([^"']+)["']\s*;?\s*$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(re);
    if (!m) continue;
    const source = m[4]!;
    const isTypeImport = lines[i]!.includes("import type");
    if (m[1]) {
      imports.push({
        lineIndex: i,
        source,
        names: [m[1]],
        isTypeImport,
        isNamespaceImport: true,
        importVar: m[1],
        raw: lines[i]!,
      });
    } else if (m[2] !== undefined) {
      const names = m[2]
        .split(",")
        .map((n) => n.trim())
        .filter((n) => n.length > 0);
      imports.push({
        lineIndex: i,
        source,
        names,
        isTypeImport,
        isNamespaceImport: false,
        importVar: null,
        raw: lines[i]!,
      });
    } else if (m[3]) {
      imports.push({
        lineIndex: i,
        source,
        names: [m[3]],
        isTypeImport,
        isNamespaceImport: false,
        importVar: null,
        raw: lines[i]!,
      });
    }
  }
  return imports;
}

export function stripUnusedImports(code: string): string {
  const imports = parseImports(code);
  if (imports.length === 0) return code;

  const lines = code.split("\n");
  const importLineSet = new Set(imports.map((i) => i.lineIndex));

  const codeBody = lines.filter((_, i) => !importLineSet.has(i)).join("\n");

  const toRemove = new Set<number>();
  const lineReplacements = new Map<number, string>();

  for (const imp of imports) {
    const usedNames = imp.names.filter((name) => {
      const re = new RegExp(`(?<![\\w$])${escapeRegex(name)}(?![\\w$])`);
      return re.test(codeBody);
    });

    if (usedNames.length === 0) {
      toRemove.add(imp.lineIndex);
    } else if (usedNames.length < imp.names.length && !imp.isNamespaceImport) {
      const keptStr = usedNames.join(", ");
      lineReplacements.set(imp.lineIndex, `import { ${keptStr} } from "${imp.source}";`);
    }
  }

  return lines
    .map((line, i) => {
      if (toRemove.has(i)) return null;
      return lineReplacements.get(i) ?? line;
    })
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function deduplicateTests(code: string): string {
  const lines = code.split("\n");
  const seen = new Set<string>();
  const keep = new Array<boolean>(lines.length).fill(true);
  let inDupBlock = -1;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const testMatch = line.match(/(?:it|test)\s*\(\s*["'`]([^"'`]+)["'`]/);
    if (testMatch) {
      const title = testMatch[1]!.toLowerCase().trim();
      if (seen.has(title)) {
        inDupBlock = i;
        braceDepth = 0;
      } else {
        seen.add(title);
      }
    }
    if (inDupBlock >= 0) {
      keep[i] = false;
      for (const ch of line) {
        if (ch === "{") braceDepth++;
        if (ch === "}") braceDepth--;
      }
      if (braceDepth <= 0) {
        inDupBlock = -1;
      }
    }
  }

  return lines
    .filter((_, i) => keep[i])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function formatFile(filePath: string): Promise<void> {
  try {
    const proc = Bun.spawn(["bunx", "oxfmt", "--write", filePath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = AbortSignal.timeout(FORMAT_TIMEOUT);
    const exited = await Promise.race([
      proc.exited,
      new Promise<never>((_, reject) => {
        timeout.onabort = () => {
          proc.kill();
          reject(new Error("oxfmt timed out"));
        };
      }),
    ]);
    if (exited !== 0) throw new Error(`oxfmt exited with code ${exited}`);
  } catch {
    await normalizeNewlines(filePath);
  }
}

async function normalizeNewlines(filePath: string): Promise<void> {
  const content = await Bun.file(filePath).text();
  const cleaned =
    content
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd() + "\n";
  await Bun.write(filePath, cleaned);
}

async function runFallowFix(dir: string): Promise<void> {
  try {
    const proc = Bun.spawn(["bunx", "fallow", "fix", "--yes", "--no-create-config", "--quiet"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
  } catch {
    // fallow fix is optional; silently skip if unavailable
  }
}

export interface PostProcessOptions {
  format?: boolean;
  deduplicate?: boolean;
  stripUnused?: boolean;
  runFallow?: boolean;
}

export async function postProcessGeneratedFiles(
  files: GeneratedFile[],
  outDir: string,
  options: PostProcessOptions = {},
): Promise<void> {
  const { format = true, deduplicate = true, stripUnused = true, runFallow = false } = options;

  for (const file of files) {
    const absPath = join(process.cwd(), file.relativePath);
    if (!existsSync(absPath)) continue;

    let code = await Bun.file(absPath).text(); // eslint-disable-line no-await-in-loop
    let changed = false;

    if (stripUnused) {
      const cleaned = stripUnusedImports(code);
      if (cleaned !== code) {
        code = cleaned;
        changed = true;
      }
    }

    if (deduplicate) {
      const deduped = deduplicateTests(code);
      if (deduped !== code) {
        code = deduped;
        changed = true;
      }
    }

    if (changed) {
      await Bun.write(absPath, code); // eslint-disable-line no-await-in-loop
    }

    if (format && existsSync(absPath)) {
      await formatFile(absPath); // eslint-disable-line no-await-in-loop
    }
  }

  if (runFallow && files.length > 0) {
    await runFallowFix(join(process.cwd(), outDir));
  }
}
