import { describe, it, expect } from "bun:test";
import { extractEntities } from "../../src/discovery/extractor.ts";
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
