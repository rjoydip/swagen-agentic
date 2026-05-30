import { describe, it, expect } from "bun:test";
import { findChangedSpecs } from "../../src/bot/specs.ts";

// ─── Fixtures: realistic GitHub webhook push payload commits ──────────────────

function singleCommitPush(...changedSpecs: string[]) {
  return [
    {
      added: changedSpecs.filter((f) => f.endsWith(".yaml") || f.endsWith(".json")),
      modified: [] as string[],
    },
  ];
}

function multiCommitPush() {
  return [
    {
      added: ["openapi.yaml", "README.md"],
      modified: [] as string[],
    },
    {
      added: [] as string[],
      modified: ["openapi.yaml"],
    },
    {
      added: ["swagger.json"],
      modified: ["openapi.yaml"],
    },
  ];
}

function pushWithNoSpecChanges() {
  return [
    {
      added: ["CONTRIBUTING.md"],
      modified: ["README.md", "LICENSE"],
    },
  ];
}

// ─── findChangedSpecs ─────────────────────────────────────────────────────────

describe("findChangedSpecs", () => {
  it("detects spec files in a single commit push", () => {
    const commits = singleCommitPush("openapi.yaml");
    expect(findChangedSpecs(commits)).toEqual(["openapi.yaml"]);
  });

  it("detects multiple spec files in a single commit", () => {
    const commits = singleCommitPush("openapi.yaml", "swagger.json");
    expect(findChangedSpecs(commits)).toEqual(["openapi.yaml", "swagger.json"]);
  });

  it("detects spec files across multiple commits", () => {
    const commits = multiCommitPush();
    expect(findChangedSpecs(commits)).toEqual([
      "openapi.yaml",
      "openapi.yaml",
      "swagger.json",
      "openapi.yaml",
    ]);
  });

  it("returns empty array when no spec files changed", () => {
    const commits = pushWithNoSpecChanges();
    expect(findChangedSpecs(commits)).toEqual([]);
  });

  it("returns empty array for empty commits", () => {
    expect(findChangedSpecs([])).toEqual([]);
  });

  it("handles commits without added or modified fields", () => {
    const commits: Array<{ added?: string[]; modified?: string[] }> = [{}, {}];
    expect(findChangedSpecs(commits)).toEqual([]);
  });

  it("recognizes all spec file extensions", () => {
    const commits = [
      {
        added: ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"],
        modified: [],
      },
    ];
    expect(findChangedSpecs(commits)).toEqual([
      "openapi.yaml",
      "openapi.json",
      "swagger.yaml",
      "swagger.json",
    ]);
  });

  it("ignores non-spec files mixed with spec changes", () => {
    const commits = [
      {
        added: ["openapi.yaml", "src/index.ts", "package.json"],
        modified: ["swagger.json", "README.md"],
      },
    ];
    expect(findChangedSpecs(commits)).toEqual(["openapi.yaml", "swagger.json"]);
  });
});
