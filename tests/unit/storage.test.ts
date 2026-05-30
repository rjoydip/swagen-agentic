/**
 * tests/unit/storage.test.ts
 * Unit tests for MemoryStorage and FileStorage.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import { MemoryStorage, FileStorage, newSession, createStorage } from "../../src/storage.ts";
import type { Session } from "../../src/core/types.ts";

function makeSession(id: string): Session {
  const now = new Date().toISOString();
  return {
    id,
    createdAt: now,
    updatedAt: now,
    specSource: "test.yaml",
    config: {},
    messages: [],
    runs: [],
  };
}

// ─── MemoryStorage ────────────────────────────────────────────────────────────

describe("MemoryStorage", () => {
  let store: MemoryStorage;
  beforeEach(() => {
    store = new MemoryStorage();
  });

  it("returns null for missing session", async () => {
    expect(await store.getSession("missing")).toBeNull();
  });

  it("stores and retrieves sessions", async () => {
    const s = makeSession("abc");
    await store.putSession(s);
    const got = await store.getSession("abc");
    expect(got?.id).toBe("abc");
  });

  it("lists sessions newest first", async () => {
    const s1 = { ...makeSession("a"), updatedAt: "2026-01-01T00:00:00.000Z" };
    const s2 = { ...makeSession("b"), updatedAt: "2026-06-01T00:00:00.000Z" };
    await store.putSession(s1);
    await store.putSession(s2);
    const ids = await store.listSessions();
    expect(ids[0]).toBe("b");
  });

  it("deletes sessions", async () => {
    await store.putSession(makeSession("del"));
    await store.deleteSession("del");
    expect(await store.getSession("del")).toBeNull();
  });

  it("appends run records", async () => {
    await store.putSession(makeSession("r1"));
    const run = {
      id: "run1",
      timestamp: new Date().toISOString(),
      endpointCount: 5,
      generatedFiles: ["__tests__/api/pets.test.ts"],
    };
    await store.appendRun("r1", run);
    const session = await store.getSession("r1");
    expect(session?.runs).toHaveLength(1);
    expect(session?.runs[0]?.id).toBe("run1");
  });
});

// ─── FileStorage ──────────────────────────────────────────────────────────────

const TEST_DIR = ".swagen/test-sessions";

describe("FileStorage", () => {
  let store: FileStorage;

  beforeEach(() => {
    store = new FileStorage(TEST_DIR);
  });
  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("persists sessions to disk", async () => {
    const s = makeSession("file1");
    await store.putSession(s);
    // Re-create storage pointing to same dir
    const store2 = new FileStorage(TEST_DIR);
    const got = await store2.getSession("file1");
    expect(got?.id).toBe("file1");
  });

  it("returns null for non-existent file", async () => {
    expect(await store.getSession("nope")).toBeNull();
  });

  it("lists sessions", async () => {
    await store.putSession(makeSession("x1"));
    await store.putSession(makeSession("x2"));
    const ids = await store.listSessions();
    expect(ids.length).toBe(2);
  });
});

// ─── newSession helper ────────────────────────────────────────────────────────

describe("newSession", () => {
  it("creates a session with a unique id", () => {
    const s1 = newSession("a.yaml", {});
    const s2 = newSession("b.yaml", {});
    expect(s1.id).not.toBe(s2.id);
  });

  it("sets specSource and timestamps", () => {
    const s = newSession("openapi.yaml", {});
    expect(s.specSource).toBe("openapi.yaml");
    expect(s.createdAt).toBeTruthy();
    expect(s.updatedAt).toBeTruthy();
  });
});

describe("createStorage", () => {
  it("returns MemoryStorage for memory backend", () => {
    const s = createStorage({ backend: "memory" });
    expect(s).toBeInstanceOf(MemoryStorage);
  });

  it("returns FileStorage for file backend", () => {
    const s = createStorage({ backend: "file", dir: ".swagen/test-sessions" });
    expect(s).toBeInstanceOf(FileStorage);
  });
});
