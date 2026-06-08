import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";

import { resolveConfig, starterConfig } from "../../src/core/config.ts";

describe("resolveConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const cfg = await resolveConfig({ dryRun: true, runner: "bun" }, process.cwd());
    expect(cfg.dryRun).toBe(true);
    expect(cfg.runner).toBe("bun");
    expect(cfg.outDir).toBeTruthy();
  });

  it("resolves auth config from overrides", async () => {
    const cfg = await resolveConfig({ auth: { type: "bearer", envVar: "MY_TOKEN" }, dryRun: true });
    expect(cfg.auth.type).toBe("bearer");
    expect(cfg.auth.envVar).toBe("MY_TOKEN");
  });

  it("merges mcp config from overrides", async () => {
    const cfg = await resolveConfig({ mcp: { port: 8080 }, dryRun: true });
    expect(cfg.mcp?.port).toBe(8080);
  });
});

describe("resolveConfig — config file loading", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync("swagen-cfg-");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loads JSON config file", async () => {
    writeFileSync(
      join(tmpDir, "swagen.config.json"),
      JSON.stringify({ dryRun: true, runner: "bun", aiProvider: "faux", aiModel: "test" }),
    );
    const cfg = await resolveConfig({ aiProvider: "faux", aiModel: "test" }, tmpDir);
    expect(cfg.dryRun).toBe(true);
    expect(cfg.runner).toBe("bun");
  });

  it("skips malformed JSON and continues", async () => {
    writeFileSync(join(tmpDir, "swagen.config.json"), "not valid json");
    const cfg = await resolveConfig(
      { dryRun: true, runner: "vitest", aiProvider: "faux", aiModel: "test" },
      tmpDir,
    );
    expect(cfg.dryRun).toBe(true);
    expect(cfg.runner).toBe("vitest");
  });

  it("falls back to overrides when no config files exist", async () => {
    const cfg = await resolveConfig({ aiProvider: "faux", aiModel: "test", dryRun: true }, tmpDir);
    expect(cfg.dryRun).toBe(true);
    expect(cfg.aiProvider).toBe("faux");
  });

  it("handles TS config file that throws on import", async () => {
    writeFileSync(join(tmpDir, "swagen.config.ts"), `export default { invalid syntax !!! }`);
    const cfg = await resolveConfig(
      { dryRun: true, runner: "bun", aiProvider: "faux", aiModel: "test" },
      tmpDir,
    );
    expect(cfg.dryRun).toBe(true);
    expect(cfg.runner).toBe("bun");
  });
});

describe("starterConfig", () => {
  it("returns a valid TypeScript config string", () => {
    const cfg = starterConfig();
    expect(cfg).toContain("SwagenConfig");
    expect(cfg).toContain("bearer");
    expect(cfg).toContain("bun");
  });

  it("includes aiProvider and aiModel as comments", () => {
    const cfg = starterConfig();
    expect(cfg).toContain("aiProvider");
    expect(cfg).toContain("aiModel");
  });
});
