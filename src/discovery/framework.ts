import type { ApiFramework } from "../core/types.ts";

interface FrameworkPattern {
  name: ApiFramework;
  imports: RegExp[];
  patterns: RegExp[];
}

const FRAMEWORKS: FrameworkPattern[] = [
  {
    name: "nestjs",
    imports: [/from\s+["']@nestjs\/common["']/, /from\s+["']@nestjs\/core["']/],
    patterns: [/@Controller\(/, /@Module\(/, /@Injectable\(\)/],
  },
  {
    name: "express",
    imports: [/from\s+["']express["']/, /require\s*\(\s*["']express["']\s*\)/],
    patterns: [/\.(get|post|put|patch|delete|use)\s*\(/, /Router\(\)/],
  },
  {
    name: "fastify",
    imports: [/from\s+["']fastify["']/, /require\s*\(\s*["']fastify["']\s*\)/],
    patterns: [/fastify\.(get|post|put|patch|delete)/],
  },
  {
    name: "hono",
    imports: [/from\s+["']hono["']/, /from\s+["']hono\/[^"']+["']/],
    patterns: [/new\s+Hono\(/, /app\.(get|post|put|patch|delete)/],
  },
  {
    name: "nextjs",
    imports: [/from\s+["']next\/[^"']+["']/],
    patterns: [/export\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/],
  },
  {
    name: "koa",
    imports: [/from\s+["']koa["']/, /require\s*\(\s*["']koa["']\s*\)/],
    patterns: [/new\s+Koa\(/, /\.use\s*\(/, /ctx\.(body|status|request|response)/],
  },
  {
    name: "elysia",
    imports: [/from\s+["']elysia["']/, /require\s*\(\s*["']elysia["']\s*\)/],
    patterns: [/new\s+Elysia\(/, /app\.(get|post|put|patch|delete|listen)/],
  },
  {
    name: "node:http",
    imports: [
      /from\s+["']node:http["']/,
      /require\s*\(\s*["']node:http["']\s*\)/,
      /from\s+["']http["']/,
      /require\s*\(\s*["']http["']\s*\)/,
    ],
    patterns: [/createServer\s*\(/, /\.listen\s*\(/, /IncomingMessage/, /ServerResponse/],
  },
];

export function detectFramework(files: string[], readFile: (p: string) => string): ApiFramework {
  const scores = new Map<ApiFramework, number>();

  for (const file of files) {
    let content: string;
    try {
      content = readFile(file);
    } catch {
      continue;
    }

    for (const fw of FRAMEWORKS) {
      for (const re of fw.imports) {
        if (re.test(content)) {
          scores.set(fw.name, (scores.get(fw.name) ?? 0) + 2);
        }
      }
      for (const re of fw.patterns) {
        if (re.test(content)) {
          scores.set(fw.name, (scores.get(fw.name) ?? 0) + 3);
        }
      }
    }
  }

  let best: ApiFramework = "unknown";
  let bestScore = 0;
  for (const [fw, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = fw;
    }
  }
  return best;
}

export function detectRoutePatterns(
  content: string,
): Array<{ method: string; path: string; line: number }> {
  const routes: Array<{ method: string; path: string; line: number }> = [];

  // Express/Fastify/Hono/Elysia: app.get("/path", ...)
  const routeRe =
    /(?:app|router|server)\.(get|post|put|patch|delete|head|options)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = routeRe.exec(content)) !== null) {
    const method = match[1] ?? "GET";
    const path = match[2] ?? "/";
    const line = countNewlines(content, match.index) + 1;
    routes.push({ method: method.toUpperCase(), path, line });
  }

  // NestJS: @Get('path')
  const decoratorRe = /@(Get|Post|Put|Patch|Delete|Head|Options)\s*\(\s*["'`]([^"'`]*)["'`]/g;
  while ((match = decoratorRe.exec(content)) !== null) {
    const method = match[1] ?? "GET";
    const path = match[2] ?? "/";
    const line = countNewlines(content, match.index) + 1;
    routes.push({ method: method.toUpperCase(), path: path || "/", line });
  }

  // Next.js route handlers: export async function GET(req, ...)
  const nextRe = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g;
  while ((match = nextRe.exec(content)) !== null) {
    const method = match[1] ?? "GET";
    const line = countNewlines(content, match.index) + 1;
    routes.push({ method, path: "/(inferred-from-file)", line });
  }

  // node:http: createServer((req, res) => { ... })
  const nodeRe =
    /if\s*\(\s*(?:req\.method|req\.url)\s*===?\s*["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g;
  while ((match = nodeRe.exec(content)) !== null) {
    const method = match[1] ?? "GET";
    const line = countNewlines(content, match.index) + 1;
    routes.push({ method, path: "/(inferred)", line });
  }

  return routes;
}

function countNewlines(s: string, upTo: number): number {
  let count = 0;
  for (let i = 0; i < upTo && i < s.length; i++) {
    const ch = s[i];
    if (ch === "\n") count++;
  }
  return count;
}
