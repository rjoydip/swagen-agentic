/**
 * tests/unit/storage.test.ts
 * Unit tests for MemoryStorage and FileStorage.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import { MemoryStorage, FileStorage, RedisStorage, newSession, createStorage } from "../../src/storage.ts";
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

  it("throws for redis without url", () => {
    expect(() => createStorage({ backend: "redis" })).toThrow("redisUrl is required");
  });

  it("throws for unknown backend", () => {
    expect(() => createStorage({ backend: "postgres" as "memory" })).toThrow(
      "Unknown storage backend",
    );
  });
});

// ─── RedisStorage ─────────────────────────────────────────────────────────────

describe("RedisStorage", () => {
  const originalFetch = globalThis.fetch;
  let store: ReturnType<typeof createStorage>;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: unknown, ok = true) {
    const fn: any = async () => new Response(JSON.stringify(response), { status: ok ? 200 : 500 });
    globalThis.fetch = fn;
  }

  it("getSession returns null when key not found", async () => {
    mockFetch({ result: null });
    store = new RedisStorage("https://mock-redis.example.com", "tok");
    expect(await store.getSession("nope")).toBeNull();
  });

  it("getSession returns parsed session", async () => {
    const session = { id: "abc", specSource: "test.yaml", messages: [], runs: [] };
    mockFetch({ result: JSON.stringify(session) });
    store = new RedisStorage("https://mock-redis.example.com", "tok");
    const got = await store.getSession("abc");
    expect(got?.id).toBe("abc");
    expect(got?.specSource).toBe("test.yaml");
  });

  it("getSession returns null on network error", async () => {
    const fn: any = async () => {
      throw new Error("ECONNREFUSED");
    };
    globalThis.fetch = fn;
    const { RedisStorage } = await import("../../src/storage.ts");
    store = new RedisStorage("https://mock-redis.example.com", "tok");
    expect(await store.getSession("fail")).toBeNull();
  });

  it("putSession sends SET and ZADD", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fn: any = async (url: string, opts: RequestInit) => {
      calls.push({ url: url.toString(), method: (opts.method ?? "GET") as string });
      return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
    };
    globalThis.fetch = fn;
    const { RedisStorage } = await import("../../src/storage.ts");
    store = new RedisStorage("https://redis.example.com", "tok");
    await store.putSession({
      id: "s1",
      specSource: "spec.yaml",
      config: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [],
      runs: [],
    });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.url).toContain("/set/swagen:session:s1");
  });

  it("deleteSession sends DEL and ZREM", async () => {
    const calls: string[] = [];
    const fn: any = async (url: string) => {
      calls.push(url.toString());
      return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
    };
    globalThis.fetch = fn;
    const { RedisStorage } = await import("../../src/storage.ts");
    store = new RedisStorage("https://redis.example.com", "tok");
    await store.deleteSession("del-me");
    expect(calls.some((u) => u.includes("/del/swagen:session:del-me"))).toBe(true);
    expect(calls.some((u) => u.includes("/zrem/swagen:sessions"))).toBe(true);
  });

  it("listSessions returns empty array when no results", async () => {
    mockFetch({ result: [] });
    const { RedisStorage } = await import("../../src/storage.ts");
    store = new RedisStorage("https://redis.example.com", "tok");
    expect(await store.listSessions()).toEqual([]);
  });

  it("listSessions returns session ids", async () => {
    mockFetch({ result: ["s1", "s2"] });
    const { RedisStorage } = await import("../../src/storage.ts");
    store = new RedisStorage("https://redis.example.com", "tok");
    const ids = await store.listSessions();
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("appendRun fetches session, pushes run, and saves", async () => {
    let callCount = 0;
    const fn: any = async (url: string) => {
      callCount++;
      if (url.includes("/get/")) {
        const session = {
          id: "session-a",
          specSource: "spec.yaml",
          config: {},
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          messages: [],
          runs: [],
        };
        return new Response(JSON.stringify({ result: JSON.stringify(session) }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: "OK" }), { status: 200 });
    };
    globalThis.fetch = fn;
    const { RedisStorage } = await import("../../src/storage.ts");
    store = new RedisStorage("https://redis.example.com", "tok");
    await store.appendRun("session-a", {
      id: "run1",
      timestamp: "2026-06-01T00:00:00.000Z",
      endpointCount: 5,
      generatedFiles: ["tests.test.ts"],
    });
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("appendRun throws for missing session", async () => {
    mockFetch({ result: null });
    const { RedisStorage } = await import("../../src/storage.ts");
    store = new RedisStorage("https://redis.example.com", "tok");
    await expect(
      store.appendRun("does-not-exist", {
        id: "r1",
        timestamp: "2026-01-01T00:00:00.000Z",
        endpointCount: 0,
        generatedFiles: [],
      }),
    ).rejects.toThrow("Session not found");
  });

  it("strips trailing slash from base URL", async () => {
    let calledUrl = "";
    const fn: any = async (url: string) => {
      calledUrl = url.toString();
      return new Response(JSON.stringify({ result: null }), { status: 200 });
    };
    globalThis.fetch = fn;
    const { RedisStorage } = await import("../../src/storage.ts");
    store = new RedisStorage("https://redis.example.com/", "tok");
    await store.getSession("test");
    expect(calledUrl).not.toContain("//get");
  });
});
