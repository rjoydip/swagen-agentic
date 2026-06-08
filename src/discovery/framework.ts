import type { ApiFramework } from "../core/types.ts";
import { countNewlines } from "../utils/fmt.ts";

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
    patterns: [/createServer\s*\(/, /IncomingMessage/, /ServerResponse/],
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
  filePath?: string,
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

  function addInferredRoutes(re: RegExp) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      const method = m[1] ?? "GET";
      const line = countNewlines(content, m.index) + 1;
      routes.push({ method, path: "/(inferred)", line });
    }
  }

  // node:http switch-case routing: switch(req.method) { case "GET": ...
  const nodeSwitchRe =
    /switch\s*\(\s*(?:req\.method)\s*\)\s*\{[.\s\S]*?case\s+["'`](GET|POST|PUT|PATCH|DELETE)["'`]/g;
  addInferredRoutes(nodeSwitchRe);

  // node:http object-lookup routing: const routes = { GET: handler, POST: handler }
  const nodeMapRe = /(?:const|let|var)\s+\w+\s*=\s*\{\s*(?:\s*(GET|POST|PUT|PATCH|DELETE)\s*:)/g;
  addInferredRoutes(nodeMapRe);

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
    const path = filePath ? inferNextJSPath(filePath) : "/(inferred-from-file)";
    routes.push({ method, path, line });
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

function inferNextJSPath(filePath: string): string {
  // Normalize to forward slashes and strip cwd
  const normalized = filePath.replace(/\\/g, "/");
  const stripped = normalized.replace(/^.*?(?=\/(?:app|pages)\/)/, "");

  // Pages Router: pages/api/users.ts → /api/users
  let path = stripped
    .replace(/^\/pages\//, "/")
    .replace(/^\/app\//, "/")
    // Remove file extension
    .replace(/\.(tsx?|jsx?)$/, "")
    // Remove route group markers: (group) → ""
    .replace(/\/?\([^)]+\)/g, "")
    // Remove optional catch-all segments: [[...slug]] → ""
    .replace(/\/\[{2}\.\.\.[^\]]+\]{2}/g, "")
    // Remove catch-all segments: [...slug] → ""
    .replace(/\/\[\.\.\.[^\]]+\]/g, "")
    // Dynamic params: [id] → :id
    .replace(/\[([^\]]+)\]/g, ":$1")
    // Remove trailing /route or /page
    .replace(/\/(route|page)$/, "")
    // Remove trailing index
    .replace(/\/index$/, "");

  if (!path) path = "/";
  return path;
}
