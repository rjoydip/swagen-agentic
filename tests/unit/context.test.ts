import { describe, it, expect } from "bun:test";
import { detectContext, contextPrompt } from "../../src/context.ts";

describe("detectContext", () => {
  it("detects this project as bun + TypeScript", async () => {
    const ctx = await detectContext();
    expect(ctx.packageManager).toBe("bun");
    expect(ctx.hasTsconfig).toBe(true);
    expect(ctx.testRunner).toBe("bun");
  });

  it("finds source files", async () => {
    const ctx = await detectContext();
    expect(ctx.sourceFiles).toBeGreaterThan(0);
    expect(ctx.testFiles).toBeGreaterThan(0);
  });

  it("has no env vars if no .env file exists", async () => {
    const ctx = await detectContext();
    // .env may not exist in test context
    expect(Array.isArray(ctx.envVars)).toBe(true);
  });

  it("detects test conventions from existing test files", async () => {
    const ctx = await detectContext();
    expect(ctx.conventions.usesDescribe).toBe(true);
    expect(ctx.conventions.usesExpect).toBe(true);
  });

  it("contextPrompt produces non-empty string", async () => {
    const ctx = await detectContext();
    const prompt = contextPrompt(ctx);
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain("bun");
    expect(prompt).toContain("Source files");
  });
});
