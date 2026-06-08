import { describe, it, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { discoverCodebase, extractEntities } from "../../src/discovery/index.ts";
import { detectFramework, detectRoutePatterns } from "../../src/discovery/framework.ts";

const SAMPLE_SOURCE = `
import { something } from "./helper.ts";

export function getUser(id: number): Promise<User> {
  return fetch(\`/api/users/\${id}\`).then(r => r.json());
}

function helper() {
  return "ok";
}

export class UserService {
  async find(id: string) {
    return { id };
  }
}

export const createUser = async (data: unknown) => {
  return data;
};
`;

const EMPTY_SOURCE = ``;

const ROUTE_SOURCE = `
import { Router } from "express";
const app = express();
app.get("/api/users", (req, res) => { });
app.post("/api/users", (req, res) => { });
`;

const KOA_SOURCE = `
import Koa from "koa";
import Router from "@koa/router";
const app = new Koa();
const router = new Router();
router.get("/api/users", (ctx) => { });
router.post("/api/users", (ctx) => { });
app.use(router.routes());
`;

const ELYSIA_SOURCE = `
import { Elysia } from "elysia";
const app = new Elysia();
app.get("/api/users", () => "ok");
app.post("/api/users", () => "ok");
`;

const NODE_HTTP_SOURCE = `
import { createServer, IncomingMessage, ServerResponse } from "node:http";
const server = createServer((req, res) => {
  if (req.method === "GET") {
    res.end("ok");
  }
  if (req.url === "/api/users") {
    res.end("users");
  }
});
server.listen(3000);
`;

describe("extractEntities", () => {
  it("extracts exported functions", () => {
    const entities = extractEntities("test.ts", undefined, SAMPLE_SOURCE);
    const exports = entities.filter((e) => e.isExported && e.type === "function");
    expect(exports.length).toBeGreaterThanOrEqual(2);
    expect(exports.some((e) => e.name === "getUser")).toBe(true);
  });

  it("extracts classes", () => {
    const entities = extractEntities("test.ts", undefined, SAMPLE_SOURCE);
    const classes = entities.filter((e) => e.type === "class");
    expect(classes.length).toBe(1);
    expect(classes[0]!.name).toBe("UserService");
  });

  it("returns empty array for empty source", () => {
    const entities = extractEntities("empty.ts", undefined, EMPTY_SOURCE);
    expect(entities.length).toBe(0);
  });

  it("extracts async functions", () => {
    const entities = extractEntities("test.ts", undefined, SAMPLE_SOURCE);
    const asyncFns = entities.filter((e) => e.isAsync);
    expect(asyncFns.length).toBeGreaterThanOrEqual(1);
  });

  it("marks exported entities correctly", () => {
    const entities = extractEntities("test.ts", undefined, SAMPLE_SOURCE);
    const exported = entities.filter((e) => e.isExported);
    expect(exported.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts default exports", () => {
    const src = `export default function main() {\n  return "ok";\n}\n`;
    const entities = extractEntities("main.ts", undefined, src);
    expect(entities.some((e) => e.name === "main" && e.visibility === "default")).toBe(true);
  });

  it("extracts default class exports", () => {
    const src = `export default class App {\n  run() {}\n}\n`;
    const entities = extractEntities("app.ts", undefined, src);
    const app = entities.find((e) => e.name === "App");
    expect(app).toBeDefined();
    expect(app?.type).toBe("class");
    expect(app?.isExported).toBe(true);
  });

  it("extracts decorated methods", () => {
    const src = [
      `class UsersController {`,
      `  @Get("/users")`,
      `  async findAll() { return []; }`,
      `}`,
      ``,
    ].join("\n");
    const entities = extractEntities("users.ts", undefined, src);
    const method = entities.find((e) => e.name === "findAll");
    expect(method).toBeDefined();
    expect(method?.type).toBe("method");
    expect(method?.decorators).toBeDefined();
    expect(method?.decorators?.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts decorated methods with Post", () => {
    const src = [
      `class ItemsController {`,
      `  @Post("/items")`,
      `  async create() { return {}; }`,
      `}`,
      ``,
    ].join("\n");
    const entities = extractEntities("items.ts", undefined, src);
    expect(entities.some((e) => e.name === "create" && e.type === "method")).toBe(true);
  });

  it("extracts decorated methods with Put, Patch, Delete", () => {
    for (const decorator of ["Put", "Patch", "Delete"]) {
      const src = [
        `class C {`,
        `  @${decorator}("/")`,
        `  async handler() { return {}; }`,
        `}`,
        ``,
      ].join("\n");
      const entities = extractEntities("c.ts", undefined, src);
      expect(entities.some((e) => e.name === "handler" && e.type === "method")).toBe(true);
    }
  });

  it("extracts decorated methods with Head, Options", () => {
    for (const decorator of ["Head", "Options"]) {
      const src = [`class C {`, `  @${decorator}("/")`, `  handler() { return {}; }`, `}`, ``].join(
        "\n",
      );
      const entities = extractEntities("c.ts", undefined, src);
      expect(entities.some((e) => e.name === "handler" && e.type === "method")).toBe(true);
    }
  });

  it("skips decorated method when next line is blank", () => {
    const src = [`class Foo {`, `  @Get("/foo")`, ``, `  helper() {}`, `}`, ``].join("\n");
    const entities = extractEntities("foo.ts", undefined, src);
    expect(entities.some((e) => e.name === "helper")).toBe(true);
  });

  it("extracts interfaces", () => {
    const src = [`interface User {`, `  id: number;`, `  name: string;`, `}`, ``].join("\n");
    const entities = extractEntities("types.ts", undefined, src);
    expect(entities.some((e) => e.name === "User" && e.type === "interface")).toBe(true);
  });

  it("extracts exported interfaces", () => {
    const src = [`export interface Config {`, `  debug: boolean;`, `}`, ``].join("\n");
    const entities = extractEntities("types.ts", undefined, src);
    const cfg = entities.find((e) => e.name === "Config");
    expect(cfg).toBeDefined();
    expect(cfg?.isExported).toBe(true);
  });

  it("extracts type aliases", () => {
    const src = `type Predicate<T> = (value: T) => boolean;\n`;
    const entities = extractEntities("types.ts", undefined, src);
    expect(entities.some((e) => e.name === "Predicate" && e.type === "type")).toBe(true);
  });

  it("extracts exported type aliases", () => {
    const src = [`export type Options = {`, `  verbose: boolean;`, `};\n`].join("\n");
    const entities = extractEntities("types.ts", undefined, src);
    const opt = entities.find((e) => e.name === "Options");
    expect(opt).toBeDefined();
    expect(opt?.isExported).toBe(true);
  });

  it("extracts exported variables", () => {
    const src = `export const VERSION = "1.0.0";\n`;
    const entities = extractEntities("consts.ts", undefined, src);
    expect(entities.some((e) => e.name === "VERSION" && e.type === "variable")).toBe(true);
  });

  it("extracts non-exported classes", () => {
    const src = `class InternalHelper {\n  doStuff() {}\n}\n`;
    const entities = extractEntities("helper.ts", undefined, src);
    const cls = entities.find((e) => e.name === "InternalHelper");
    expect(cls).toBeDefined();
    expect(cls?.isExported).toBe(false);
  });

  it("deduplicates by (name, line)", () => {
    const src = [`export const foo = (x: number) => x;`].join("\n");
    const entities = extractEntities("test.ts", undefined, src);
    const foos = entities.filter((e) => e.name === "foo");
    expect(foos.length).toBe(1); // variable + arrow function → deduped
  });
});

describe("detectFramework", () => {
  it("detects express from route patterns", () => {
    const fw = detectFramework(["test.ts"], () => ROUTE_SOURCE);
    expect(fw).toBe("express");
  });

  it("returns unknown for empty source", () => {
    const fw = detectFramework(["empty.ts"], () => "");
    expect(fw).toBe("unknown");
  });

  it("detects nestjs from decorator patterns", () => {
    const nestSource = `
      import { Controller, Get } from "@nestjs/common";
      @Controller("users")
      export class UserController {}
    `;
    const fw = detectFramework(["app.ts"], () => nestSource);
    expect(fw).toBe("nestjs");
  });

  it("detects fastify from import", () => {
    const src = `import Fastify from "fastify";\nconst fastify = Fastify();\nfastify.get("/", () => {});`;
    expect(detectFramework(["f.ts"], () => src)).toBe("fastify");
  });

  it("detects hono from patterns", () => {
    const src = `import { Hono } from "hono";\nconst app = new Hono();\napp.get("/", (c) => c.text("hi"));`;
    expect(detectFramework(["h.ts"], () => src)).toBe("hono");
  });

  it("detects nextjs from export function GET", () => {
    const src = `export async function GET(req) { return Response.json({}); }`;
    expect(detectFramework(["route.ts"], () => src)).toBe("nextjs");
  });

  it("detects koa from import and patterns", () => {
    const fw = detectFramework(["app.ts"], () => KOA_SOURCE);
    expect(fw).toBe("koa");
  });

  it("detects elysia from import and patterns", () => {
    const fw = detectFramework(["app.ts"], () => ELYSIA_SOURCE);
    expect(fw).toBe("elysia");
  });

  it("detects node:http from createServer and IncomingMessage", () => {
    const fw = detectFramework(["server.ts"], () => NODE_HTTP_SOURCE);
    expect(fw).toBe("node:http");
  });

  it("scores express higher than koa for express code", () => {
    const fw = detectFramework(["app.ts"], () => ROUTE_SOURCE);
    expect(fw).toBe("express");
  });
});

describe("detectFramework — realistic sample code", () => {
  it("detects express from a realistic Express app", () => {
    const src = `
import express from "express";
import { join } from "node:path";

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/users", (req, res) => {
  res.status(201).json(req.body);
});

app.listen(3000);
`;
    expect(detectFramework(["server.ts"], () => src)).toBe("express");
  });

  it("detects nestjs from a realistic NestJS module", () => {
    const src = `
import { Module, Controller, Get, Post } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

@Controller("users")
export class UserController {
  @Get()
  findAll() { return []; }

  @Post()
  create() { return {}; }
}

@Module({ controllers: [UserController] })
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
`;
    expect(detectFramework(["app.module.ts"], () => src)).toBe("nestjs");
  });

  it("detects koa from a realistic Koa app", () => {
    const src = `
import Koa from "koa";
import Router from "@koa/router";

const app = new Koa();
const router = new Router();

app.use(async (ctx, next) => {
  ctx.body = { message: "Hello" };
  await next();
});

router.get("/api/items", (ctx) => {
  ctx.body = { items: [] };
});

router.post("/api/items", (ctx) => {
  ctx.status = 201;
  ctx.body = { id: 1 };
});

app.use(router.routes());
app.listen(4000);
`;
    expect(detectFramework(["app.ts"], () => src)).toBe("koa");
  });

  it("detects fastify from a realistic Fastify server", () => {
    const src = `
import Fastify from "fastify";

const fastify = Fastify({ logger: true });

fastify.get("/api/health", async (_req, _reply) => {
  return { status: "ok" };
});

fastify.post("/api/users", async (req, reply) => {
  reply.code(201);
  return { id: Date.now(), ...req.body };
});

fastify.listen({ port: 3000 });
`;
    expect(detectFramework(["server.ts"], () => src)).toBe("fastify");
  });

  it("detects hono from a realistic Hono app", () => {
    const src = `
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

app.use("*", cors());

app.get("/api/users", (c) => {
  return c.json([{ id: 1 }]);
});

app.post("/api/users", async (c) => {
  const body = await c.req.json();
  return c.json(body, 201);
});

export default app;
`;
    expect(detectFramework(["app.ts"], () => src)).toBe("hono");
  });

  it("detects elysia from a realistic Elysia server", () => {
    const src = `
import { Elysia } from "elysia";

const app = new Elysia();

app.get("/api/health", () => {
  return { status: "ok" };
});

app.post("/api/users", ({ body }) => {
  return { id: 1, ...body };
});

app.listen(3000);
`;
    expect(detectFramework(["server.ts"], () => src)).toBe("elysia");
  });

  it("detects nextjs from a realistic route handler", () => {
    const src = `
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const data = await req.json();
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  return NextResponse.json({ created: true }, { status: 201 });
}
`;
    expect(detectFramework(["route.ts"], () => src)).toBe("nextjs");
  });

  it("detects node:http from a realistic HTTP server", () => {
    const src = `
import { createServer, IncomingMessage, ServerResponse } from "node:http";

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && req.url === "/api/health") {
    res.end(JSON.stringify({ status: "ok" }));
  } else if (req.method === "POST" && req.url === "/api/users") {
    res.statusCode = 201;
    res.end(JSON.stringify({ id: 1 }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

server.listen(3000, () => console.log("running"));
`;
    expect(detectFramework(["server.ts"], () => src)).toBe("node:http");
  });

  it("returns unknown for a plain file with no framework code", () => {
    expect(
      detectFramework(["utils.ts"], () => "export const add = (a: number, b: number) => a + b;"),
    ).toBe("unknown");
  });
});

describe("discoverCodebase", () => {
  it("returns empty analysis for non-existent path", () => {
    const result = discoverCodebase({ discoveryPath: "/nonexistent/path/xyz123" });
    expect(result.entities).toEqual([]);
    expect(result.framework).toBe("unknown");
    expect(result.entryPoints).toEqual([]);
  });

  it("discovers entities in src/", () => {
    const result = discoverCodebase({ discoveryPath: "src" });
    expect(result.entities.length).toBeGreaterThan(0);
    expect(typeof result.framework).toBe("string");
    expect(Array.isArray(result.entryPoints)).toBe(true);
  });

  it("detects entry points (index.ts, main.ts, app.ts)", () => {
    const result = discoverCodebase({ discoveryPath: "src" });
    const hasIndex = result.entryPoints.some((ep: string) => ep.endsWith("index.ts"));
    expect(hasIndex).toBe(true);
  });

  it("discovers test files via testPath option (lines 37-45)", () => {
    const {
      mkdtempSync: mkdtemp,
      mkdirSync: mkdirs,
      writeFileSync: writeFile,
      rmSync: rmdir,
    } = require("node:fs");
    const { join: joinPath } = require("node:path");
    const tmpDir = mkdtemp("swagen-testpath-");
    try {
      mkdirs(joinPath(tmpDir, "src"), { recursive: true });
      mkdirs(joinPath(tmpDir, "tests"), { recursive: true });
      writeFile(joinPath(tmpDir, "src", "lib.ts"), "export function foo() {}");
      writeFile(joinPath(tmpDir, "tests", "lib.test.ts"), "it('test', () => {})");
      const result = discoverCodebase({
        discoveryPath: joinPath(tmpDir, "src"),
        testPath: joinPath(tmpDir, "tests"),
      });
      expect(result.testFilePaths?.length ?? 0).toBeGreaterThan(0);
      expect(result.testFilePaths?.some((p) => p.endsWith("lib.test.ts")) ?? false).toBe(true);
    } finally {
      rmdir(tmpDir, { recursive: true, force: true });
    }
  });

  it("discovers test files from separate testPath", () => {
    const tmpDir = mkdtempSync("swagen-disc-");
    try {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "helper.ts"), "export function helper() { return 1; }");
      mkdirSync(join(tmpDir, "tests"), { recursive: true });
      writeFileSync(
        join(tmpDir, "tests", "helper.test.ts"),
        "import { describe } from 'bun:test';",
      );
      const result = discoverCodebase({
        discoveryPath: join(tmpDir, "src"),
        testPath: join(tmpDir, "tests"),
      });
      expect(result.entities.length).toBeGreaterThan(0);
      expect(result.testFilePaths?.length).toBeGreaterThan(0);
      expect(result.testFilePaths?.some((p: string) => p.includes("helper.test.ts"))).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("detectRoutePatterns", () => {
  it("extracts express routes", () => {
    const routes = detectRoutePatterns(ROUTE_SOURCE);
    expect(routes.length).toBe(2);
    expect(routes[0]!.method).toBe("GET");
    expect(routes[0]!.path).toBe("/api/users");
  });

  it("returns empty array for source with no routes", () => {
    const routes = detectRoutePatterns("const x = 1;");
    expect(routes.length).toBe(0);
  });

  it("extracts koa routes", () => {
    const routes = detectRoutePatterns(KOA_SOURCE);
    expect(routes.length).toBe(2);
    expect(routes[0]!.method).toBe("GET");
    expect(routes[0]!.path).toBe("/api/users");
  });

  it("extracts elysia routes", () => {
    const routes = detectRoutePatterns(ELYSIA_SOURCE);
    expect(routes.length).toBe(2);
    expect(routes[0]!.method).toBe("GET");
    expect(routes[0]!.path).toBe("/api/users");
  });

  it("extracts node:http routes from inline method checks", () => {
    const routes = detectRoutePatterns(NODE_HTTP_SOURCE);
    expect(routes.length).toBe(1);
    expect(routes[0]!.method).toBe("GET");
  });

  it("extracts nestjs decorator routes", () => {
    const src = `@Get("/api/items")\nasync find() {}`;
    const routes = detectRoutePatterns(src);
    expect(routes.length).toBe(1);
    expect(routes[0]!.method).toBe("GET");
    expect(routes[0]!.path).toBe("/api/items");
  });

  it("extracts next.js handler routes", () => {
    const src = `export async function POST(req) { return Response.json({}); }`;
    const routes = detectRoutePatterns(src);
    expect(routes.length).toBe(1);
    expect(routes[0]!.method).toBe("POST");
  });
});
