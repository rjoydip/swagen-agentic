import { describe, it, expect } from "bun:test";
import { generateTestFiles } from "../../src/core/codegen.ts";
import type { ResolvedEndpoint, SwagenConfig } from "../../src/core/types.ts";

const BASE_CONFIG: SwagenConfig = {
  baseUrl: "http://localhost:3000",
  runner: "bun",
  outDir: "tests/api",
  auth: { type: "none" },
  includeTags: [],
  excludeTags: [],
  skipOperations: [],
  emitFixtures: false,
  emitSetup: false,
  assertStatusCodes: true,
  assertSchemas: false,
  testTimeoutMs: 10_000,
  dryRun: true,
  aiProvider: "faux",
  aiModel: "test-model",
  storage: { backend: "memory" },
  cache: { strategy: "memory", ttlMs: 60_000, maxEntries: 64 },
  mode: "spec",
  discoveryPath: "src",
  augment: false,
  coverageThreshold: 0.7,
  augmentStrategy: "smart-merge",
};

function makeEndpoint(overrides: Partial<ResolvedEndpoint> = {}): ResolvedEndpoint {
  return {
    operationId: "getPets",
    method: "get",
    path: "/api/pets",
    summary: "List all pets",
    tags: ["pets"],
    params: [],
    body: undefined,
    responses: [
      { statusCode: 200, contentType: "application/json", schema: {}, description: "OK" },
    ],
    security: [],
    deprecated: false,
    ...overrides,
  };
}

describe("generateTestFiles", () => {
  it("generates a test file for each tag", () => {
    const endpoints = [
      makeEndpoint({ operationId: "getPets", tags: ["pets"] }),
      makeEndpoint({ operationId: "getUsers", tags: ["users"] }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files.length).toBe(2);
    expect(files[0]?.relativePath).toContain("tests/api/");
    expect(files[0]?.testCount).toBe(1);
  });

  it("groups endpoints by tag into the same file", () => {
    const endpoints = [
      makeEndpoint({ operationId: "getPets", tags: ["pets"] }),
      makeEndpoint({ operationId: "createPet", tags: ["pets"] }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files.length).toBe(1);
    expect(files[0]?.testCount).toBe(2);
  });

  it("uses 'general' tag when endpoint has no tags", () => {
    const endpoints = [makeEndpoint({ tags: [] })];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files.length).toBe(1);
    expect(files[0]?.relativePath).toContain("general");
  });

  it("includes setup file when emitSetup is true", () => {
    const config = { ...BASE_CONFIG, emitSetup: true, emitFixtures: false };
    const files = generateTestFiles([makeEndpoint()], config);
    const setupFile = files.find((f) => f.relativePath.includes("setup"));
    expect(setupFile).toBeDefined();
  });

  it("includes fixtures file when emitFixtures is true", () => {
    const config = { ...BASE_CONFIG, emitFixtures: true, emitSetup: false };
    const files = generateTestFiles([makeEndpoint()], config);
    const fixtureFile = files.find((f) => f.relativePath.includes("fixtures"));
    expect(fixtureFile).toBeDefined();
  });

  it("marks deprecated endpoints with it.skip", () => {
    const endpoints = [makeEndpoint({ deprecated: true })];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files[0]?.content).toContain("it.skip");
  });

  it("generates vitest import when runner is vitest", () => {
    const config = { ...BASE_CONFIG, runner: "vitest" as const };
    const files = generateTestFiles([makeEndpoint()], config);
    expect(files[0]?.content).toContain("vitest");
    expect(files[0]?.content).not.toContain("bun:test");
  });

  it("generates bun test import by default", () => {
    const files = generateTestFiles([makeEndpoint()], BASE_CONFIG);
    expect(files[0]?.content).toContain("bun:test");
  });

  it("generates auth headers for bearer auth", () => {
    const config = { ...BASE_CONFIG, auth: { type: "bearer" as const, envVar: "API_TOKEN" } };
    const files = generateTestFiles([makeEndpoint()], config);
    expect(files[0]?.content).toContain("Authorization");
    expect(files[0]?.content).toContain("API_TOKEN");
  });

  it("generates auth headers for apiKey auth", () => {
    const config = {
      ...BASE_CONFIG,
      auth: { type: "apiKey" as const, envVar: "API_KEY", headerName: "X-API-Key" },
    };
    const files = generateTestFiles([makeEndpoint()], config);
    expect(files[0]?.content).toContain("X-API-Key");
  });

  it("generates auth headers for basic auth", () => {
    const config = {
      ...BASE_CONFIG,
      auth: { type: "basic" as const, envVar: "API_CREDENTIALS" },
    };
    const files = generateTestFiles([makeEndpoint()], config);
    expect(files[0]?.content).toContain("Basic");
    expect(files[0]?.content).toContain("API_CREDENTIALS");
  });

  it("includes header params in request", () => {
    const endpoints = [
      makeEndpoint({
        params: [
          { name: "X-Request-Id", in: "header", required: true, schema: { type: "string" } },
        ],
      }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files[0]?.content).toContain("X-Request-Id");
  });

  it("includes query params in URL construction", () => {
    const endpoints = [
      makeEndpoint({
        params: [{ name: "limit", in: "query", required: true, schema: { type: "integer" } }],
      }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files[0]?.content).toContain("searchParams");
    expect(files[0]?.content).toContain("limit");
  });

  it("includes path params in URL template", () => {
    const endpoints = [
      makeEndpoint({
        path: "/api/pets/{petId}",
        params: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
      }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files[0]?.content).toContain("petId");
  });

  it("sets Content-Type for JSON body endpoints", () => {
    const endpoints = [
      makeEndpoint({
        method: "post",
        body: {
          required: true,
          contentType: "application/json",
          schema: { type: "object", properties: { name: { type: "string" } } },
        },
      }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files[0]?.content).toContain("Content-Type");
  });

  it("uses sample values for param schemas", () => {
    const endpoints = [
      makeEndpoint({
        params: [
          { name: "count", in: "query", required: true, schema: { type: "integer" } },
          { name: "active", in: "query", required: false, schema: { type: "boolean" } },
          { name: "tags", in: "query", required: false, schema: { type: "array" } },
        ],
      }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files[0]?.content).toContain("1");
    expect(files[0]?.content).toContain("true");
    expect(files[0]?.content).toContain("[]");
  });

  it("uses example value when provided", () => {
    const endpoints = [
      makeEndpoint({
        params: [
          { name: "id", in: "query", required: true, schema: { type: "integer" }, example: 42 },
        ],
      }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files[0]?.content).toContain("42");
  });

  it("asserts status code range when assertStatusCodes is false", () => {
    const config = { ...BASE_CONFIG, assertStatusCodes: false };
    const files = generateTestFiles([makeEndpoint()], config);
    expect(files[0]?.content).toContain("toBeGreaterThanOrEqual");
    expect(files[0]?.content).toContain("toBeLessThan");
  });

  it("asserts specific status code when assertStatusCodes is true", () => {
    const files = generateTestFiles([makeEndpoint()], BASE_CONFIG);
    expect(files[0]?.content).toContain("toBe(200)");
  });

  it("parses response body for JSON responses", () => {
    const files = generateTestFiles([makeEndpoint()], BASE_CONFIG);
    expect(files[0]?.content).toContain("res.json()");
  });

  it("handles responses without contentType", () => {
    const endpoints = [
      makeEndpoint({
        responses: [
          { statusCode: 204, contentType: undefined, schema: undefined, description: undefined },
        ],
      }),
    ];
    const files = generateTestFiles(endpoints, BASE_CONFIG);
    expect(files[0]?.content).toBeDefined();
  });
});
