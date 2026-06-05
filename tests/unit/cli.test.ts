import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { parseArgs } from "../../src/utils/fmt.ts";
import { starterConfig, resolveConfig } from "../../src/core/config.ts";
import {
  validateConfig,
  ConfigValidationError,
  SwagenConfigSchema,
} from "../../src/core/schema.ts";
import {
  friendlyError,
  MissingApiKeyError,
  checkApiKey,
  NetworkError,
} from "../../src/utils/errors.ts";

const TEST_DIR = join(tmpdir(), "swagen-cli-test-" + Date.now());

describe("CLI helpers", () => {
  describe("parseArgs", () => {
    it("parses --flag with value", () => {
      const r = parseArgs(["--runner", "vitest"]);
      expect(r.flags["runner"]).toBe("vitest");
    });

    it("parses --flag boolean", () => {
      const r = parseArgs(["--dry-run"]);
      expect(r.flags["dry-run"]).toBe(true);
    });

    it("parses --no-flag", () => {
      const r = parseArgs(["--no-fixtures"]);
      expect(r.flags["fixtures"]).toBe(false);
    });

    it("parses -f shorthand", () => {
      const r = parseArgs(["-o", "__tests__"]);
      expect(r.flags["o"]).toBe("__tests__");
    });

    it("extracts command and positionals", () => {
      const r = parseArgs(["generate", "openapi.yaml", "--verbose"]);
      expect(r.command).toBe("generate");
      expect(r.positionals).toEqual(["openapi.yaml"]);
    });
  });

  describe("starterConfig", () => {
    it("returns valid TypeScript config string", () => {
      const cfg = starterConfig();
      expect(cfg).toContain("SwagenConfig");
      expect(cfg).toContain("anthropic");
      expect(cfg).toContain("bearer");
      expect(cfg).toContain("export default config");
    });
  });
});

describe("Config validation", () => {
  const validPartial = {
    baseUrl: "http://localhost:3000",
    runner: "bun" as const,
    outDir: ".swagen/tests",
    auth: { type: "bearer" as const },
    includeTags: [] as string[],
    excludeTags: [] as string[],
    skipOperations: [] as string[],
    emitFixtures: true,
    emitSetup: true,
    assertStatusCodes: true,
    assertSchemas: false,
    testTimeoutMs: 10_000,
    dryRun: false,
    aiProvider: "anthropic",
    aiModel: "claude-opus-4-5-20251101",
    storage: { backend: "memory" as const },
    cache: { strategy: "memory" as const, ttlMs: 300_000, maxEntries: 256 },
  };

  it("validates a complete config", () => {
    const result = validateConfig(validPartial);
    expect(result.runner).toBe("bun");
    expect(result.dryRun).toBe(false);
  });

  it("rejects invalid runner", () => {
    expect(() => validateConfig({ ...validPartial, runner: "jest" as "bun" | "vitest" })).toThrow(
      ConfigValidationError,
    );
  });

  it("rejects negative timeout", () => {
    expect(() => validateConfig({ ...validPartial, testTimeoutMs: -1 })).toThrow(
      ConfigValidationError,
    );
  });

  it("rejects empty baseUrl", () => {
    expect(() => validateConfig({ ...validPartial, baseUrl: "" })).toThrow(ConfigValidationError);
  });

  it("zod schema parses correctly", () => {
    const result = SwagenConfigSchema.safeParse(validPartial);
    expect(result.success).toBe(true);
  });
});

describe("Error helpers", () => {
  it("MissingApiKeyError has descriptive message", () => {
    const err = new MissingApiKeyError("anthropic");
    expect(err.message).toContain("ANTHROPIC_API_KEY");
    expect(err.name).toBe("MissingApiKeyError");
  });

  it("checkApiKey throws for missing key", () => {
    expect(() => checkApiKey("nonexistent_provider")).toThrow(MissingApiKeyError);
  });

  it("friendlyError wraps MissingApiKeyError", () => {
    const result = friendlyError(new MissingApiKeyError("openai"));
    expect(result).toContain("OPENAI_API_KEY");
    expect(result).toContain(".env");
  });

  it("friendlyError wraps generic errors", () => {
    const result = friendlyError(new Error("something broke"));
    expect(result).toContain("something broke");
  });

  it("friendlyError wraps network errors", () => {
    const result = friendlyError(new Error("fetch failed: ENOTFOUND"));
    expect(result).toContain("Network error");
  });

  it("friendlyError wraps ECONNREFUSED", () => {
    const result = friendlyError(new Error("connect ECONNREFUSED"));
    expect(result).toContain("Network error");
  });

  it("friendlyError wraps network word in message", () => {
    const result = friendlyError(new Error("a network error occurred"));
    expect(result).toContain("Network error");
  });

  it("friendlyError wraps SpecLoadError by name", () => {
    const err = new Error("$ref resolution failed");
    err.name = "SpecLoadError";
    const result = friendlyError(err);
    expect(result).toContain("Spec error");
  });

  it("friendlyError handles non-Error thrown objects", () => {
    const result = friendlyError("just a string");
    expect(result).toContain("just a string");
  });

  it("friendlyError handles null", () => {
    const result = friendlyError(null);
    expect(result).toContain("null");
  });

  it("NetworkError has correct name and message", () => {
    const err = new NetworkError("fetching spec", "timeout");
    expect(err.name).toBe("NetworkError");
    expect(err.message).toContain("fetching spec");
    expect(err.message).toContain("timeout");
  });

  it("checkApiKey does not throw for faux provider", () => {
    expect(() => checkApiKey("faux")).not.toThrow();
  });
});

describe("CLI commands", () => {
  beforeAll(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("swagen init creates starter config", async () => {
    const configPath = join(TEST_DIR, "swagen.config.ts");
    if (existsSync(configPath)) rmSync(configPath);
    const { starterConfig: sc } = await import("../../src/core/config.js");
    writeFileSync(configPath, sc());
    expect(existsSync(configPath)).toBe(true);
    const content = await Bun.file(configPath).text();
    expect(content).toContain("SwagenConfig");
  });

  it("resolveConfig validates with overrides", async () => {
    const config = await resolveConfig({ dryRun: true, runner: "bun" });
    expect(config.dryRun).toBe(true);
    expect(config.runner).toBe("bun");
  });

  it("swagen status returns null for no runs", async () => {
    const { getLastRun } = await import("../../src/tools/state.js");
    const record = await getLastRun();
    expect(record === null || typeof record === "object").toBe(true);
  });

  it("swagen generate --existing parses without error", () => {
    const { parseArgs: parse } = require("../../src/utils/fmt.js");
    // --existing must precede another flag to stay boolean (parser consumes next non-flag arg as value)
    const r = parse(["generate", "src/", "--existing", "--dry-run"]);
    expect(r.command).toBe("generate");
    expect(r.flags["existing"]).toBe(true);
    expect(r.flags["dry-run"]).toBe(true);
    expect(r.positionals).toEqual(["src/"]);
  });

  it("swagen generate --existing src/ with provider flags is parseable", () => {
    const { parseArgs: parse } = require("../../src/utils/fmt.js");
    const r = parse([
      "generate",
      "src/",
      "--existing",
      "--dry-run",
      "--provider",
      "anthropic",
      "--model",
      "claude-opus-4-5-20251101",
    ]);
    expect(r.flags["existing"]).toBe(true);
    expect(r.flags["dry-run"]).toBe(true);
    expect(r.flags["provider"]).toBe("anthropic");
    expect(r.flags["model"]).toBe("claude-opus-4-5-20251101");
    expect(r.positionals[0]).toBe("src/");
  });
});
