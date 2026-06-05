import { readFileSync } from "node:fs";
import type { SourceEntity } from "../core/types.ts";

export function extractEntities(filePath: string, content?: string): SourceEntity[] {
  const code = content ?? readFileSync(filePath, "utf-8");
  const entities: SourceEntity[] = [];
  const lines = code.split("\n");
  const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

  const patterns: Array<{
    regex: RegExp;
    build: (m: RegExpExecArray, line: number) => SourceEntity | null;
  }> = [
    // Exported function declarations: export function foo(...)
    {
      regex: /export\s+(async\s+)?function\s+(\w+)\s*\(/g,
      build: (m, line) => {
        return {
          type: "function",
          name: m[2] ?? "unknown",
          file: fileName,
          line,
          column: m.index,
          signature: extractSignature(lines, line),
          isAsync: !!m[1],
          isExported: true,
        };
      },
    },
    // Function declarations: function foo(...)
    {
      regex: /^(?:async\s+)?function\s+(\w+)\s*\(/gm,
      build: (m, line) => {
        const fullMatch = m[0] ?? "";
        return {
          type: "function",
          name: m[1] ?? "unknown",
          file: fileName,
          line,
          column: m.index,
          signature: extractSignature(lines, line),
          isAsync: fullMatch.startsWith("async"),
          isExported: false,
        };
      },
    },
    // Exported class: export class Foo ...
    {
      regex: /export\s+(abstract\s+)?class\s+(\w+)/g,
      build: (m, line) => ({
        type: "class",
        name: m[2] ?? "unknown",
        file: fileName,
        line,
        column: m.index,
        signature: extractClassSignature(lines, line),
        isAsync: false,
        isExported: true,
      }),
    },
    // Class: class Foo ...
    {
      regex: /^(?:abstract\s+)?class\s+(\w+)/gm,
      build: (m, line) => ({
        type: "class",
        name: m[1] ?? "unknown",
        file: fileName,
        line,
        column: m.index,
        signature: extractClassSignature(lines, line),
        isAsync: false,
        isExported: false,
      }),
    },
    // Exported const arrow functions: export const foo = (...) => ...
    {
      regex: /export\s+(async\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/g,
      build: (m, line) => {
        const fullMatch = m[0] ?? "";
        return {
          type: "function",
          name: m[2] ?? "unknown",
          file: fileName,
          line,
          column: m.index,
          signature: extractArrowSignature(lines, line),
          isAsync: !!m[1] || fullMatch.includes("async"),
          isExported: true,
        };
      },
    },
    // Exported variable: export const|let|var Foo = ...
    {
      regex: /export\s+(?:const|let|var)\s+(\w+)\s*=/g,
      build: (m, line) => ({
        type: "variable",
        name: m[1] ?? "unknown",
        file: fileName,
        line,
        column: m.index,
        isAsync: false,
        isExported: true,
      }),
    },
    // Default export: export default ...
    {
      regex: /export\s+default\s+(?:function|class)\s+(\w+)/g,
      build: (m, line) => {
        const fullMatch = m[0] ?? "";
        return {
          type: fullMatch.includes("function") ? "function" : "class",
          name: m[1] ?? "unknown",
          file: fileName,
          line,
          column: m.index,
          isAsync: false,
          isExported: true,
          visibility: "default",
        };
      },
    },
    // Decorated methods: @Get @Post etc.
    {
      regex: /@(Get|Post|Put|Patch|Delete|Head|Options)\(/g,
      build: (m, line) => {
        const methodLineIdx = findNextNonBlankLine(lines, line);
        if (methodLineIdx === null) return null;
        const methodContent = lines[methodLineIdx];
        if (methodContent === undefined) return null;
        const methodMatch = methodContent.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/);
        if (!methodMatch) return null;
        const methodName = methodMatch[1] ?? "unknown";
        return {
          type: "method",
          name: methodName,
          file: fileName,
          line: methodLineIdx,
          column: 0,
          signature: extractSignature(lines, methodLineIdx),
          decorators: [m[0] ?? ""],
          isAsync: methodContent.includes("async"),
          isExported: methodContent.includes("export"),
        };
      },
    },
    // Interface: interface Foo ...
    {
      regex: /^(?:export\s+)?interface\s+(\w+)/gm,
      build: (m, line) => {
        const fullMatch = m[0] ?? "";
        return {
          type: "interface",
          name: m[1] ?? "unknown",
          file: fileName,
          line,
          column: m.index,
          isAsync: false,
          isExported: fullMatch.startsWith("export"),
        };
      },
    },
    // Type: type Foo = ...
    {
      regex: /^(?:export\s+)?type\s+(\w+)\s*=/gm,
      build: (m, line) => {
        const fullMatch = m[0] ?? "";
        return {
          type: "type",
          name: m[1] ?? "unknown",
          file: fileName,
          line,
          column: m.index,
          isAsync: false,
          isExported: fullMatch.startsWith("export"),
        };
      },
    },
  ];

  for (const { regex, build } of patterns) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(code)) !== null) {
      const line = countNewlines(code, match.index) + 1;
      const entity = build(match, line);
      if (entity) entities.push(entity);
    }
  }

  // Deduplicate by (name, line) — catches export const foo = (...) => ...
  // matching both arrow-function and variable patterns on the same line
  const seen = new Set<string>();
  return entities.filter((e) => {
    const key = `${e.name}:${e.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractSignature(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 3);
  return lines
    .slice(start, end)
    .map((l) => (l ?? "").trim())
    .join(" ")
    .slice(0, 200);
}

function extractClassSignature(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 2);
  return lines
    .slice(start, end)
    .map((l) => (l ?? "").trim())
    .join(" ")
    .slice(0, 200);
}

function extractArrowSignature(lines: string[], lineIndex: number): string {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 2);
  return lines
    .slice(start, end)
    .map((l) => (l ?? "").trim())
    .join(" ")
    .slice(0, 200);
}

function findNextNonBlankLine(lines: string[], from: number): number | null {
  for (let i = from + 1; i < lines.length; i++) {
    const ln = lines[i];
    if (ln && ln.trim()) return i;
  }
  return null;
}

function countNewlines(s: string, upTo: number): number {
  let count = 0;
  for (let i = 0; i < upTo && i < s.length; i++) {
    const ch = s[i];
    if (ch === "\n") count++;
  }
  return count;
}
