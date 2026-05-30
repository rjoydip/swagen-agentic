import { describe, it, expect } from "bun:test";
import {
  BASE_SYSTEM_PROMPT,
  REST_SKILL_PROMPT,
  GRAPHQL_SKILL_PROMPT,
  GRPC_SKILL_PROMPT,
  SOAP_SKILL_PROMPT,
  buildSkillSystemPrompt,
  buildGeneratePrompt,
  buildValidatePrompt,
  buildOrchestratorGeneratePrompt,
  buildParallelAgentPrompt,
  buildActionsBotPrompt,
  buildPushWebhookPrompt,
  buildPrWebhookPrompt,
} from "../../src/core/prompts.ts";
import type { SwagenConfig } from "../../src/core/types.ts";

const MOCK_CONFIG: SwagenConfig = {
  baseUrl: "http://petstore.swagger.io/api/v3",
  runner: "bun",
  outDir: ".swagen/tests",
  auth: { type: "none" },
  includeTags: [],
  excludeTags: [],
  skipOperations: [],
  emitFixtures: false,
  emitSetup: false,
  assertStatusCodes: true,
  assertSchemas: false,
  testTimeoutMs: 10_000,
  dryRun: false,
  aiProvider: "anthropic",
  aiModel: "claude-opus-4-5-20251101",
  storage: { backend: "memory" },
  cache: { strategy: "memory", ttlMs: 300_000, maxEntries: 256 },
};

describe("BASE_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(BASE_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("mentions available tools", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("load_spec");
    expect(BASE_SYSTEM_PROMPT).toContain("generate_tests");
    expect(BASE_SYSTEM_PROMPT).toContain("write_files");
  });

  it("forbids duplicate tests and dead code", () => {
    expect(BASE_SYSTEM_PROMPT).toContain("Do NOT generate duplicate");
    expect(BASE_SYSTEM_PROMPT).toContain("automatically formatted and deduplicated");
  });
});

describe("skill prompt constants", () => {
  it("REST_SKILL_PROMPT contains REST rules", () => {
    expect(REST_SKILL_PROMPT).toContain("REST API RULES");
    expect(REST_SKILL_PROMPT).toContain("status code");
    expect(REST_SKILL_PROMPT).toContain("CRUD lifecycle");
  });

  it("GRAPHQL_SKILL_PROMPT contains GraphQL rules", () => {
    expect(GRAPHQL_SKILL_PROMPT).toContain("GRAPHQL RULES");
    expect(GRAPHQL_SKILL_PROMPT).toContain("operation type");
    expect(GRAPHQL_SKILL_PROMPT).toContain("fragments");
  });

  it("GRPC_SKILL_PROMPT contains gRPC rules", () => {
    expect(GRPC_SKILL_PROMPT).toContain("gRPC RULES");
    expect(GRPC_SKILL_PROMPT).toContain("call type");
    expect(GRPC_SKILL_PROMPT).toContain("bidirectional");
  });

  it("SOAP_SKILL_PROMPT contains SOAP rules", () => {
    expect(SOAP_SKILL_PROMPT).toContain("SOAP RULES");
    expect(SOAP_SKILL_PROMPT).toContain("envelope");
    expect(SOAP_SKILL_PROMPT).toContain("WS-Security");
  });

  it("all skill prompts include dedup warning", () => {
    for (const p of [REST_SKILL_PROMPT, GRAPHQL_SKILL_PROMPT, GRPC_SKILL_PROMPT, SOAP_SKILL_PROMPT]) {
      expect(p).toContain("Avoid generating duplicate tests");
    }
  });
});

describe("buildSkillSystemPrompt", () => {
  it("returns base unchanged for empty skill list", () => {
    expect(buildSkillSystemPrompt("hello", [])).toBe("hello");
  });

  it("returns base unchanged when all prompts are falsy", () => {
    expect(buildSkillSystemPrompt("base", ["", null as unknown as string, undefined as unknown as string])).toBe("base");
  });

  it("appends active skill prompts under heading", () => {
    const result = buildSkillSystemPrompt("base", ["REST rules", "GraphQL rules"]);
    expect(result).toContain("base");
    expect(result).toContain("## Active Skills");
    expect(result).toContain("REST rules");
    expect(result).toContain("GraphQL rules");
  });

  it("separates skill prompts with ---", () => {
    const result = buildSkillSystemPrompt("base", ["A", "B"]);
    expect(result).toContain("---");
  });
});

describe("buildGeneratePrompt", () => {
  it("includes spec, runner, output, baseUrl", () => {
    const p = buildGeneratePrompt({ spec: "api.yaml", config: MOCK_CONFIG, andRun: false });
    expect(p).toContain("api.yaml");
    expect(p).toContain("bun");
    expect(p).toContain(".swagen/tests");
    expect(p).toContain("petstore.swagger.io");
  });

  it("includes include tags when present", () => {
    const p = buildGeneratePrompt({
      spec: "api.yaml",
      config: { ...MOCK_CONFIG, includeTags: ["users", "pets"] },
      andRun: false,
    });
    expect(p).toContain("users");
    expect(p).toContain("pets");
  });

  it("includes exclude tags when present", () => {
    const p = buildGeneratePrompt({
      spec: "api.yaml",
      config: { ...MOCK_CONFIG, excludeTags: ["internal"] },
      andRun: false,
    });
    expect(p).toContain("internal");
  });

  it("includes skip operations when present", () => {
    const p = buildGeneratePrompt({
      spec: "api.yaml",
      config: { ...MOCK_CONFIG, skipOperations: ["deleteUser"] },
      andRun: false,
    });
    expect(p).toContain("deleteUser");
  });

  it("marks dry run when enabled", () => {
    const p = buildGeneratePrompt({
      spec: "api.yaml",
      config: { ...MOCK_CONFIG, dryRun: true },
      andRun: false,
    });
    expect(p).toContain("DRY RUN");
  });

  it("includes run-tests instruction when andRun is true", () => {
    const p = buildGeneratePrompt({ spec: "api.yaml", config: MOCK_CONFIG, andRun: true });
    expect(p).toContain("run the tests");
  });
});

describe("buildValidatePrompt", () => {
  it("mentions spec path and validation", () => {
    const p = buildValidatePrompt("openapi.yaml");
    expect(p).toContain("openapi.yaml");
    expect(p).toContain("Validate");
    expect(p).toContain("Do not generate tests");
  });
});

describe("buildOrchestratorGeneratePrompt", () => {
  it("includes spec path, runner, output", () => {
    const p = buildOrchestratorGeneratePrompt({ specPath: "spec.yaml", config: MOCK_CONFIG });
    expect(p).toContain("spec.yaml");
    expect(p).toContain("bun");
    expect(p).toContain(".swagen/tests");
  });
});

describe("buildParallelAgentPrompt", () => {
  it("includes agent index, total, assigned tags", () => {
    const p = buildParallelAgentPrompt({
      agentIndex: 0,
      totalAgents: 3,
      tags: ["pets", "users"],
      specPath: "spec.yaml",
      config: MOCK_CONFIG,
    });
    expect(p).toContain("agent 1 of 3");
    expect(p).toContain("pets");
    expect(p).toContain("users");
    expect(p).toContain("Do not generate tests for other tags");
  });
});

describe("buildActionsBotPrompt", () => {
  it("includes event, repo, spec", () => {
    const p = buildActionsBotPrompt({
      event: "pull_request",
      repo: "owner/repo",
      prNumber: 42,
      specPath: "spec.yaml",
      andRun: false,
      dryRun: false,
    });
    expect(p).toContain("pull_request");
    expect(p).toContain("owner/repo");
    expect(p).toContain("PR: #42");
    expect(p).toContain("spec.yaml");
  });

  it("marks dry run when enabled", () => {
    const p = buildActionsBotPrompt({
      event: "push",
      repo: "o/r",
      prNumber: undefined,
      specPath: "spec.yaml",
      andRun: false,
      dryRun: true,
    });
    expect(p).toContain("DRY RUN");
  });

  it("mentions running tests when andRun is true", () => {
    const p = buildActionsBotPrompt({
      event: "push",
      repo: "o/r",
      prNumber: undefined,
      specPath: "spec.yaml",
      andRun: true,
      dryRun: false,
    });
    expect(p).toContain("then run the tests");
  });

  it("omits PR number when undefined", () => {
    const p = buildActionsBotPrompt({
      event: "push",
      repo: "o/r",
      prNumber: undefined,
      specPath: "s.yaml",
      andRun: false,
      dryRun: false,
    });
    expect(p).not.toContain("PR:");
  });
});

describe("buildPushWebhookPrompt", () => {
  it("includes spec path and repo", () => {
    const p = buildPushWebhookPrompt("api.yaml", "my-org/my-repo");
    expect(p).toContain("api.yaml");
    expect(p).toContain("my-org/my-repo");
  });
});

describe("buildPrWebhookPrompt", () => {
  it("includes PR number and repo", () => {
    const p = buildPrWebhookPrompt(7, "org/repo");
    expect(p).toContain("PR #7");
    expect(p).toContain("org/repo");
  });
});
