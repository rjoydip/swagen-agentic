import { describe, it, expect } from "bun:test";
import { SkillManager } from "../../src/skills/manager.ts";
import { skill as restSkill } from "../../src/skills/rest.ts";
import { skill as graphqlSkill } from "../../src/skills/graphql.ts";
import { skill as grpcSkill } from "../../src/skills/grpc.ts";
import { skill as soapSkill } from "../../src/skills/soap.ts";
import {
  REST_SKILL_PROMPT,
  GRAPHQL_SKILL_PROMPT,
  GRPC_SKILL_PROMPT,
  SOAP_SKILL_PROMPT,
} from "../../src/core/prompts.ts";
import type {
  Skill,
  SkillContext,
  SkillHook,
  ResolvedEndpoint,
  GeneratedFile,
} from "../../src/core/types.ts";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill> & { name: string }): Skill {
  return {
    version: "1.0.0",
    description: "test skill",
    activation: () => true,
    ...overrides,
  };
}

function makeContext(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    config: {
      baseUrl: "http://petstore3.swagger.io/api/v3",
      runner: "bun",
      outDir: ".swagen/tests",
      auth: { type: "none" },
      includeTags: [],
      excludeTags: [],
      skipOperations: [],
      emitFixtures: false,
      emitSetup: false,
      assertStatusCodes: false,
      assertSchemas: false,
      testTimeoutMs: 10_000,
      dryRun: false,
      aiProvider: "anthropic",
      aiModel: "claude-opus-4-5-20251101",
      storage: { backend: "memory" },
      cache: { strategy: "memory", ttlMs: 300_000, maxEntries: 256 },
    },
    endpoints: [],
    projectContext: {
      testRunner: "bun",
      packageManager: "bun",
      hasTsconfig: true,
      hasEnvFile: false,
      envVars: [],
      specs: [],
      existingTestFiles: [],
      sourceFiles: 0,
      testFiles: 0,
      conventions: {
        usesDescribe: false,
        usesAsyncAwait: false,
        usesExpect: false,
      },
    },
    ...overrides,
  };
}

// ─── SkillManager ──────────────────────────────────────────────────────────────

describe("SkillManager", () => {
  describe("register / get / list", () => {
    it("registers and retrieves a skill by name", () => {
      const mgr = new SkillManager();
      mgr.register(makeSkill({ name: "my-skill" }));
      expect(mgr.get("my-skill")).toBeTruthy();
      expect(mgr.get("my-skill")?.name).toBe("my-skill");
    });

    it("returns undefined for unknown skill", () => {
      const mgr = new SkillManager();
      expect(mgr.get("nonexistent")).toBeUndefined();
    });

    it("lists all registered skills", () => {
      const mgr = new SkillManager();
      mgr.register(makeSkill({ name: "a" }));
      mgr.register(makeSkill({ name: "b" }));
      expect(mgr.list()).toHaveLength(2);
    });

    it("overwrites on duplicate registration", () => {
      const mgr = new SkillManager();
      mgr.register(makeSkill({ name: "x", description: "first" }));
      mgr.register(makeSkill({ name: "x", description: "second" }));
      expect(mgr.get("x")?.description).toBe("second");
    });
  });

  describe("resolve", () => {
    it("returns active skills where activation returns true", () => {
      const mgr = new SkillManager();
      mgr.register(makeSkill({ name: "active", activation: () => true }));
      mgr.register(makeSkill({ name: "inactive", activation: () => false }));
      const { active, inactive } = mgr.resolve(makeContext());
      expect(active).toHaveLength(1);
      expect(active[0]?.name).toBe("active");
      expect(inactive).toHaveLength(1);
      expect(inactive[0]?.name).toBe("inactive");
    });

    it("catches activation errors gracefully", () => {
      const mgr = new SkillManager();
      mgr.register(
        makeSkill({
          name: "broken",
          activation: () => {
            throw new Error("oops");
          },
        }),
      );
      const { active, inactive } = mgr.resolve(makeContext());
      expect(active).toHaveLength(0);
      expect(inactive).toHaveLength(1);
      expect(inactive[0]?.name).toBe("broken");
    });

    it("passes context to activation function", () => {
      const fn = (ctx: SkillContext) => ctx.endpoints.length > 0;
      const mgr = new SkillManager();
      mgr.register(makeSkill({ name: "needs-endpoints", activation: fn }));

      const ctxNoEndpoints = makeContext({ endpoints: [] });
      expect(mgr.resolve(ctxNoEndpoints).active).toHaveLength(0);

      const ctxWithEndpoints = makeContext({
        endpoints: [{ operationId: "test" }] as ResolvedEndpoint[],
      });
      expect(mgr.resolve(ctxWithEndpoints).active).toHaveLength(1);
    });
  });

  describe("buildSystemPrompt", () => {
    it("returns base prompt unchanged when no skills are active", () => {
      const mgr = new SkillManager();
      const result = mgr.buildSystemPrompt([], "base prompt");
      expect(result).toBe("base prompt");
    });

    it("appends skill system prompts wrapped in sections", () => {
      const mgr = new SkillManager();
      const skills = [
        makeSkill({ name: "a", systemPrompt: "Skill A rules." }),
        makeSkill({ name: "b", systemPrompt: "Skill B rules." }),
      ];
      const result = mgr.buildSystemPrompt(skills, "base prompt");
      expect(result).toContain("base prompt");
      expect(result).toContain("## Active Skills");
      expect(result).toContain("Skill A rules.");
      expect(result).toContain("Skill B rules.");
    });

    it("ignores skills without systemPrompt", () => {
      const mgr = new SkillManager();
      const skills = [
        makeSkill({ name: "a" }),
        makeSkill({ name: "b", systemPrompt: "Has rules." }),
      ];
      const result = mgr.buildSystemPrompt(skills, "base");
      expect(result).not.toContain("Skill a"); // a has no systemPrompt
      expect(result).toContain("Has rules.");
    });
  });

  describe("collectTools", () => {
    it("collects tools from all active skills", () => {
      const mgr = new SkillManager();
      const toolA = { name: "tool_a" } as any;
      const toolB = { name: "tool_b" } as any;
      const skills = [
        makeSkill({ name: "a", tools: [toolA] }),
        makeSkill({ name: "b", tools: [toolB] }),
      ];
      const tools = mgr.collectTools(skills);
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(["tool_a", "tool_b"]);
    });

    it("returns empty array when no skills provide tools", () => {
      const mgr = new SkillManager();
      const tools = mgr.collectTools([]);
      expect(tools).toEqual([]);
    });
  });

  describe("collectHooks", () => {
    it("collects hooks from active skills", () => {
      const mgr = new SkillManager();
      const hookA = { beforeGenerate: async (e: any) => e };
      const hookB = { afterGenerate: async (f: any) => f };
      const skills = [
        makeSkill({ name: "a", hooks: hookA } as any),
        makeSkill({ name: "b", hooks: hookB } as any),
        makeSkill({ name: "c" }),
      ];
      const hooks = mgr.collectHooks(skills);
      expect(hooks).toHaveLength(2);
    });
  });

  describe("builtin skills", () => {
    it("registers all builtin skills", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      expect(mgr.get("rest")).toBeTruthy();
      expect(mgr.get("graphql")).toBeTruthy();
      expect(mgr.get("grpc")).toBeTruthy();
      expect(mgr.get("soap")).toBeTruthy();
    });

    it("activates rest skill when endpoints have security", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();

      const ctxWithSecurity = makeContext({
        endpoints: [
          {
            operationId: "getStuff",
            path: "/stuff",
            method: "get",
            summary: "Get stuff",
            tags: ["stuff"],
            params: [],
            body: undefined,
            responses: [],
            security: [["api_key"]],
            deprecated: false,
          },
        ],
      });
      expect(mgr.resolve(ctxWithSecurity).active.some((s) => s.name === "rest")).toBe(true);
    });

    it("does not activate rest when no endpoints", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      const ctxEmpty = makeContext({ endpoints: [] });
      expect(mgr.resolve(ctxEmpty).active.some((s) => s.name === "rest")).toBe(false);
    });

    it("activates rest skill on RESTful methods", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      const ctx = makeContext({
        endpoints: [
          {
            operationId: "listUsers",
            path: "/users",
            method: "get",
            summary: "List users",
            tags: [],
            params: [],
            body: undefined,
            responses: [],
            security: [],
            deprecated: false,
          },
        ],
      });
      expect(mgr.resolve(ctx).active.some((s) => s.name === "rest")).toBe(true);
    });

    it("activates graphql skill on GraphQL path", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      const ctx = makeContext({
        endpoints: [
          {
            operationId: "graphql",
            path: "/graphql",
            method: "post",
            summary: "GraphQL endpoint",
            tags: [],
            params: [],
            body: undefined,
            responses: [],
            security: [],
            deprecated: false,
          },
        ],
      });
      expect(mgr.resolve(ctx).active.some((s) => s.name === "graphql")).toBe(true);
    });

    it("activates graphql skill on gql tag", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      const ctx = makeContext({
        endpoints: [
          {
            operationId: "users",
            path: "/api/users",
            method: "get",
            summary: "Users",
            tags: ["graphql"],
            params: [],
            body: undefined,
            responses: [],
            security: [],
            deprecated: false,
          },
        ],
      });
      expect(mgr.resolve(ctx).active.some((s) => s.name === "graphql")).toBe(true);
    });

    it("activates grpc skill on rpc path pattern", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      const ctx = makeContext({
        endpoints: [
          {
            operationId: "findUsers",
            path: "/rpc/UserService/Find",
            method: "post",
            summary: "Find users",
            tags: [],
            params: [],
            body: undefined,
            responses: [],
            security: [],
            deprecated: false,
          },
        ],
      });
      expect(mgr.resolve(ctx).active.some((s) => s.name === "grpc")).toBe(true);
    });

    it("activates grpc skill on grpc tag", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      const ctx = makeContext({
        endpoints: [
          {
            operationId: "getUsers",
            path: "/api/grpc",
            method: "post",
            summary: "gRPC users",
            tags: ["grpc"],
            params: [],
            body: undefined,
            responses: [],
            security: [],
            deprecated: false,
          },
        ],
      });
      expect(mgr.resolve(ctx).active.some((s) => s.name === "grpc")).toBe(true);
    });

    it("activates soap skill on soap path", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      const ctx = makeContext({
        endpoints: [
          {
            operationId: "getWeather",
            path: "/soap/WeatherService",
            method: "post",
            summary: "Get weather",
            tags: ["wsdl"],
            params: [],
            body: undefined,
            responses: [],
            security: [],
            deprecated: false,
          },
        ],
      });
      expect(mgr.resolve(ctx).active.some((s) => s.name === "soap")).toBe(true);
    });

    it("activates soap skill on xml content type", async () => {
      const mgr = new SkillManager();
      await mgr.registerBuiltins();
      const ctx = makeContext({
        endpoints: [
          {
            operationId: "getWeather",
            path: "/weather",
            method: "post",
            summary: "Get weather",
            tags: [],
            params: [],
            body: undefined,
            responses: [
              { statusCode: 200, contentType: "text/xml", schema: {}, description: "OK" },
            ],
            security: [],
            deprecated: false,
          },
        ],
      });
      expect(mgr.resolve(ctx).active.some((s) => s.name === "soap")).toBe(true);
    });
  });

  describe("hook pipeline", () => {
    it("applyBeforeGenerateHooks chains and modifies endpoints", async () => {
      const mgr = new SkillManager();
      const hook: SkillHook = {
        beforeGenerate: async (endpoints) => endpoints.filter((ep) => !ep.deprecated),
      };
      mgr.register(makeSkill({ name: "filter-deprecated", hooks: hook } as any));

      const ctx = makeContext();
      const { active } = mgr.resolve(ctx);
      const hooks = mgr.collectHooks(active);
      expect(hooks).toHaveLength(1);

      const eps: ResolvedEndpoint[] = [
        {
          operationId: "a",
          path: "/a",
          method: "get",
          summary: "",
          tags: [],
          params: [],
          body: undefined,
          responses: [],
          security: [],
          deprecated: false,
        },
        {
          operationId: "b",
          path: "/b",
          method: "get",
          summary: "",
          tags: [],
          params: [],
          body: undefined,
          responses: [],
          security: [],
          deprecated: true,
        },
      ];

      let result = eps;
      for (const h of hooks) {
        // eslint-disable-line no-await-in-loop
        if (h.beforeGenerate) result = await h.beforeGenerate(result, ctx); // eslint-disable-line no-await-in-loop
      }
      expect(result).toHaveLength(1);
      expect(result[0]?.operationId).toBe("a");
    });

    it("applyAfterGenerateHooks chains and modifies files", async () => {
      const mgr = new SkillManager();
      const hook: SkillHook = {
        afterGenerate: async (files, _meta) =>
          files.map((f) => ({
            ...f,
            content: `// AUTO-GENERATED\n${f.content}`,
          })),
      };
      mgr.register(makeSkill({ name: "add-header", hooks: hook } as any));

      const ctx = makeContext();
      const { active } = mgr.resolve(ctx);
      const hooks = mgr.collectHooks(active);
      expect(hooks).toHaveLength(1);

      const files: GeneratedFile[] = [
        { relativePath: "test.ts", content: "it('works', () => {});", testCount: 1 },
      ];

      let result = files;
      for (const h of hooks) {
        // eslint-disable-line no-await-in-loop
        if (h.afterGenerate)
          result = await h.afterGenerate(result, { endpointCount: 1, skippedCount: 0 }, ctx); // eslint-disable-line no-await-in-loop
      }
      expect(result[0]?.content).toContain("AUTO-GENERATED");
    });
  });
});

// ─── Individual skill module tests ─────────────────────────────────────────────

describe("rest skill module", () => {
  it("has correct metadata", () => {
    expect(restSkill.name).toBe("rest");
    expect(restSkill.version).toBe("1.0.0");
    expect(restSkill.description).toContain("REST");
  });

  it("uses the shared REST_SKILL_PROMPT", () => {
    expect(restSkill.systemPrompt).toBe(REST_SKILL_PROMPT);
  });

  it("activates on RESTful methods", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "get",
          path: "/items",
          tags: [],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(restSkill.activation(ctx)).toBe(true);
  });

  it("activates on security presence", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "get",
          path: "/items",
          tags: [],
          params: [],
          responses: [],
          security: [["api_key"]],
          operationId: "x",
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(restSkill.activation(ctx)).toBe(true);
  });

  it("activates on pagination params", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "get",
          path: "/items",
          tags: [],
          params: [{ name: "page", in: "query" }],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(restSkill.activation(ctx)).toBe(true);
  });

  it("activates on 4xx error responses", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "get",
          path: "/items",
          tags: [],
          params: [],
          responses: [
            {
              statusCode: 400,
              contentType: "application/json",
              schema: {},
              description: "Bad Request",
            },
          ],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(restSkill.activation(ctx)).toBe(true);
  });

  it("activates on auth/security tag", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "get",
          path: "/items",
          tags: ["auth"],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(restSkill.activation(ctx)).toBe(true);
  });

  it("does not activate on empty endpoints", () => {
    expect(restSkill.activation(makeContext())).toBe(false);
  });

  it("does not activate for non-RESTful method without other triggers", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "options",
          path: "/items",
          tags: [],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(restSkill.activation(ctx)).toBe(false);
  });
});

describe("graphql skill module", () => {
  it("has correct metadata", () => {
    expect(graphqlSkill.name).toBe("graphql");
    expect(graphqlSkill.version).toBe("1.0.0");
    expect(graphqlSkill.description).toContain("GraphQL");
  });

  it("uses the shared GRAPHQL_SKILL_PROMPT", () => {
    expect(graphqlSkill.systemPrompt).toBe(GRAPHQL_SKILL_PROMPT);
  });

  it("activates on /graphql path", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "post",
          path: "/graphql",
          tags: [],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(graphqlSkill.activation(ctx)).toBe(true);
  });

  it("activates on graphql tag", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "get",
          path: "/api",
          tags: ["graphql"],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(graphqlSkill.activation(ctx)).toBe(true);
  });

  it("activates on query/mutation/params", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "post",
          path: "/api",
          tags: [],
          params: [{ name: "query", in: "body" }],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(graphqlSkill.activation(ctx)).toBe(true);
  });

  it("does not activate on empty endpoints", () => {
    expect(graphqlSkill.activation(makeContext())).toBe(false);
  });
});

describe("grpc skill module", () => {
  it("has correct metadata", () => {
    expect(grpcSkill.name).toBe("grpc");
    expect(grpcSkill.version).toBe("1.0.0");
    expect(grpcSkill.description).toContain("gRPC");
  });

  it("uses the shared GRPC_SKILL_PROMPT", () => {
    expect(grpcSkill.systemPrompt).toBe(GRPC_SKILL_PROMPT);
  });

  it("activates on /rpc/ path", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "post",
          path: "/rpc/UserService/Find",
          tags: [],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(grpcSkill.activation(ctx)).toBe(true);
  });

  it("activates on grpc tag", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "post",
          path: "/api",
          tags: ["grpc"],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(grpcSkill.activation(ctx)).toBe(true);
  });

  it("activates on proto path", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "post",
          path: "/proto/Service/Do",
          tags: [],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(grpcSkill.activation(ctx)).toBe(true);
  });

  it("does not activate on empty endpoints", () => {
    expect(grpcSkill.activation(makeContext())).toBe(false);
  });
});

describe("soap skill module", () => {
  it("has correct metadata", () => {
    expect(soapSkill.name).toBe("soap");
    expect(soapSkill.version).toBe("1.0.0");
    expect(soapSkill.description).toContain("SOAP");
  });

  it("uses the shared SOAP_SKILL_PROMPT", () => {
    expect(soapSkill.systemPrompt).toBe(SOAP_SKILL_PROMPT);
  });

  it("activates on soap path", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "post",
          path: "/soap/WeatherService",
          tags: [],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(soapSkill.activation(ctx)).toBe(true);
  });

  it("activates on wsdl tag", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "post",
          path: "/service",
          tags: ["wsdl"],
          params: [],
          responses: [],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(soapSkill.activation(ctx)).toBe(true);
  });

  it("activates on XML content type", () => {
    const ctx = makeContext({
      endpoints: [
        {
          method: "post",
          path: "/service",
          tags: [],
          params: [],
          responses: [{ statusCode: 200, contentType: "text/xml", schema: {}, description: "OK" }],
          security: [],
        } as unknown as ResolvedEndpoint,
      ],
    });
    expect(soapSkill.activation(ctx)).toBe(true);
  });

  it("does not activate on empty endpoints", () => {
    expect(soapSkill.activation(makeContext())).toBe(false);
  });
});
