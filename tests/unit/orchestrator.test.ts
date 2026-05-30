import { describe, it, expect } from "bun:test";
import { runParallel } from "../../src/orchestrator.ts";

describe("runParallel", () => {
  it("returns empty for no tasks", async () => {
    const results = await runParallel([]);
    expect(results).toEqual([]);
  });

  it("runs a single task", async () => {
    const results = await runParallel([
      {
        id: "test1",
        prompt: "Say hello and nothing else.",
        config: { aiProvider: "anthropic", aiModel: "claude-opus-4-5-20251101" },
      },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("test1");
  });

  it("runs multiple tasks", async () => {
    const results = await runParallel([
      {
        id: "a",
        prompt: "Say hello.",
        config: { aiProvider: "anthropic", aiModel: "claude-opus-4-5-20251101" },
      },
      {
        id: "b",
        prompt: "Say goodbye.",
        config: { aiProvider: "anthropic", aiModel: "claude-opus-4-5-20251101" },
      },
    ]);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.id).sort();
    expect(ids).toEqual(["a", "b"]);
  });
});
