/**
 * tests/unit/spec.test.ts
 * Unit tests for spec analysis and code generation.
 */

import { describe, it, expect } from "bun:test";
import { analyzeSpec } from "../../src/core/spec.ts";
import { generateTestFiles } from "../../src/core/codegen.ts";
import { DEFAULT_CONFIG, type SwagenConfig } from "../../src/core/types.ts";
import type { OpenAPI } from "openapi-types";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSpec(overrides: Partial<OpenAPI.Document> = {}): OpenAPI.Document {
  return {
    openapi: "3.0.0",
    info: { title: "Test API", version: "1.0.0" },
    paths: {
      "/pets": {
        get: {
          operationId: "listPets",
          tags: ["pets"],
          summary: "List pets",
          parameters: [
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "array" } } },
            },
          },
        },
        post: {
          operationId: "createPet",
          tags: ["pets"],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    age: { type: "integer" },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created" } },
        },
      },
      "/pets/{petId}": {
        get: {
          operationId: "getPet",
          tags: ["pets"],
          deprecated: true,
          parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/admin/stats": {
        get: {
          operationId: "adminStats",
          tags: ["admin"],
          responses: { "200": { description: "OK" } },
        },
      },
    },
    ...overrides,
  } as OpenAPI.Document;
}

// ─── analyzeSpec ──────────────────────────────────────────────────────────────

describe("analyzeSpec", () => {
  it("extracts all endpoints by default", () => {
    const { endpoints, skipped } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    expect(endpoints.length).toBe(4);
    expect(skipped.length).toBe(0);
  });

  it("includes only specified tags", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: ["admin"],
      excludeTags: [],
      skipOperations: [],
    });
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0]!.operationId).toBe("adminStats");
  });

  it("excludes specified tags", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: ["admin"],
      skipOperations: [],
    });
    expect(endpoints.some((e) => e.operationId === "adminStats")).toBe(false);
    expect(endpoints.length).toBe(3);
  });

  it("skips specific operationIds", () => {
    const { endpoints, skipped } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: ["createPet"],
    });
    expect(skipped).toContain("createPet");
    expect(endpoints.some((e) => e.operationId === "createPet")).toBe(false);
  });

  it("marks deprecated endpoints", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const getPet = endpoints.find((e) => e.operationId === "getPet");
    expect(getPet?.deprecated).toBe(true);
  });

  it("extracts query params", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const listPets = endpoints.find((e) => e.operationId === "listPets");
    expect(listPets?.params[0]?.name).toBe("limit");
    expect(listPets?.params[0]?.in).toBe("query");
  });

  it("extracts path params", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const getPet = endpoints.find((e) => e.operationId === "getPet");
    expect(getPet?.params[0]?.name).toBe("petId");
    expect(getPet?.params[0]?.in).toBe("path");
  });

  it("extracts request body", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const createPet = endpoints.find((e) => e.operationId === "createPet");
    expect(createPet?.body?.contentType).toBe("application/json");
    expect(createPet?.body?.required).toBe(true);
  });

  it("extracts response status codes", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const listPets = endpoints.find((e) => e.operationId === "listPets");
    expect(listPets?.responses[0]?.statusCode).toBe(200);
  });
});

// ─── generateTestFiles ────────────────────────────────────────────────────────

describe("generateTestFiles", () => {
  const config: SwagenConfig = {
    ...DEFAULT_CONFIG,
    aiProvider: "anthropic",
    aiModel: "claude-opus-4-5-20251101",
    outDir: ".swagen/tests",
    runner: "bun" as const,
  } as SwagenConfig;

  it("groups tests by tag", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const files = generateTestFiles(endpoints, config);
    const testFiles = files.filter((f) => f.relativePath.endsWith(".test.ts"));
    expect(testFiles.some((f) => f.relativePath.includes("pets"))).toBe(true);
    expect(testFiles.some((f) => f.relativePath.includes("admin"))).toBe(true);
  });

  it("emits bun:test imports for bun runner", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const files = generateTestFiles(endpoints, config, "bun");
    const petsFile = files.find((f) => f.relativePath.includes("pets.test.ts"));
    expect(petsFile?.content).toContain(`from "bun:test"`);
    expect(petsFile?.content).not.toContain("vitest");
  });

  it("emits vitest imports for vitest runner", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const files = generateTestFiles(endpoints, config, "vitest");
    const petsFile = files.find((f) => f.relativePath.includes("pets.test.ts"));
    expect(petsFile?.content).toContain(`from "vitest"`);
  });

  it("uses it.skip for deprecated endpoints", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const files = generateTestFiles(endpoints, config);
    const petsFile = files.find((f) => f.relativePath.includes("pets.test.ts"));
    expect(petsFile?.content).toContain("it.skip");
  });

  it("emits status assertions when assertStatusCodes: true", () => {
    const cfg = { ...config, assertStatusCodes: true };
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const files = generateTestFiles(endpoints, cfg);
    const petsFile = files.find((f) => f.relativePath.includes("pets.test.ts"));
    expect(petsFile?.content).toContain("toBe(200)");
  });

  it("emits bearer auth header when configured", () => {
    const cfg = { ...config, auth: { type: "bearer" as const, envVar: "MY_TOKEN" } };
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const files = generateTestFiles(endpoints, cfg);
    const petsFile = files.find((f) => f.relativePath.includes("pets.test.ts"));
    expect(petsFile?.content).toContain("MY_TOKEN");
    expect(petsFile?.content).toContain("Bearer");
  });

  it("emits setup and fixtures files when configured", () => {
    const cfg = { ...config, emitSetup: true, emitFixtures: true };
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
    });
    const files = generateTestFiles(endpoints, cfg);
    expect(files.some((f) => f.relativePath.endsWith("setup.ts"))).toBe(true);
    expect(files.some((f) => f.relativePath.endsWith("fixtures.ts"))).toBe(true);
  });

  it("counts tests correctly", () => {
    const { endpoints } = analyzeSpec(makeSpec(), {
      includeTags: ["pets"],
      excludeTags: [],
      skipOperations: [],
    });
    const files = generateTestFiles(endpoints, config);
    const petsFile = files.find((f) => f.relativePath.includes("pets.test.ts"));
    // listPets + createPet + getPet = 3
    expect(petsFile?.testCount).toBe(3);
  });
});
