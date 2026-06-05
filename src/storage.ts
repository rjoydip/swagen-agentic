/**
 * storage/index.ts — persistent session + context storage.
 *
 * Backends:
 *   memory — Map<> in process, cleared on exit
 *   file   — JSON files under .swagen/sessions/ (Bun.file)
 *   redis  — via native fetch to Redis HTTP proxy or ioredis-free REST
 *   custom — plug in your own IStorage implementation
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Session, RunRecord, StorageConfig } from "./core/types.ts";

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IStorage {
  /** Load a session by id. Returns null if not found. */
  getSession(id: string): Promise<Session | null>;
  /** Persist a session. */
  putSession(session: Session): Promise<void>;
  /** Delete a session. */
  deleteSession(id: string): Promise<void>;
  /** List all session ids, newest first. */
  listSessions(): Promise<string[]>;
  /** Append a run record to an existing session. */
  appendRun(sessionId: string, run: RunRecord): Promise<void>;
}

// ─── Memory backend ───────────────────────────────────────────────────────────

export class MemoryStorage implements IStorage {
  private readonly store = new Map<string, Session>();

  async getSession(id: string): Promise<Session | null> {
    return this.store.get(id) ?? null;
  }

  async putSession(session: Session): Promise<void> {
    this.store.set(session.id, structuredClone(session));
  }

  async deleteSession(id: string): Promise<void> {
    this.store.delete(id);
  }

  async listSessions(): Promise<string[]> {
    return [...this.store.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => s.id);
  }

  async appendRun(sessionId: string, run: RunRecord): Promise<void> {
    const session = this.store.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.runs.push(run);
    session.updatedAt = new Date().toISOString();
  }
}

// ─── File backend ─────────────────────────────────────────────────────────────

export class FileStorage implements IStorage {
  private readonly dir: string;

  constructor(dir = ".swagen/sessions") {
    this.dir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  private path(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  async getSession(id: string): Promise<Session | null> {
    const p = this.path(id);
    if (!existsSync(p)) return null;
    return JSON.parse(await Bun.file(p).text()) as Session;
  }

  async putSession(session: Session): Promise<void> {
    await Bun.write(this.path(session.id), JSON.stringify(session, null, 2));
  }

  async deleteSession(id: string): Promise<void> {
    const p = this.path(id);
    if (existsSync(p)) {
      rmSync(p, { force: true });
    }
  }

  async listSessions(): Promise<string[]> {
    if (!existsSync(this.dir)) return [];
    const glob = new Bun.Glob("*.json");
    const items: Array<{ id: string; updatedAt: string }> = [];
    for await (const file of glob.scan(this.dir)) {
      try {
        const sess = JSON.parse(await Bun.file(join(this.dir, file)).text()) as Session;
        items.push({ id: sess.id, updatedAt: sess.updatedAt });
      } catch {}
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((i) => i.id);
  }

  async appendRun(sessionId: string, run: RunRecord): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.runs.push(run);
    session.updatedAt = new Date().toISOString();
    await this.putSession(session);
  }
}

// ─── Redis backend (via native fetch, no ioredis) ─────────────────────────────
// Uses Redis HTTP REST API (e.g. Upstash, Vercel KV, or redis-stack's REST mode)

export class RedisStorage implements IStorage {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(redisUrl: string, token = process.env.REDIS_TOKEN ?? "") {
    this.baseUrl = redisUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Redis REST error: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async getSession(id: string): Promise<Session | null> {
    try {
      const data = (await this.req("GET", `/get/swagen:session:${id}`)) as {
        result: string | null;
      };
      if (!data.result) return null;
      return JSON.parse(data.result) as Session;
    } catch {
      return null;
    }
  }

  async putSession(session: Session): Promise<void> {
    await this.req("POST", `/set/swagen:session:${session.id}`, { value: JSON.stringify(session) });
    // Maintain a sorted set for listing
    await this.req("POST", `/zadd/swagen:sessions`, {
      score: new Date(session.updatedAt).getTime(),
      member: session.id,
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.req("GET", `/del/swagen:session:${id}`);
    await this.req("POST", `/zrem/swagen:sessions`, { member: id });
  }

  async listSessions(): Promise<string[]> {
    const data = (await this.req("GET", "/zrange/swagen:sessions/0/-1/REV")) as {
      result: string[];
    };
    return data.result ?? [];
  }

  async appendRun(sessionId: string, run: RunRecord): Promise<void> {
    const session = await this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    session.runs.push(run);
    session.updatedAt = new Date().toISOString();
    await this.putSession(session);
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createStorage(config: StorageConfig): IStorage {
  switch (config.backend) {
    case "memory":
      return new MemoryStorage();
    case "file":
      return new FileStorage(config.dir ?? ".swagen/sessions");
    case "redis": {
      if (!config.redisUrl) throw new Error("storage.redisUrl is required for redis backend");
      return new RedisStorage(config.redisUrl);
    }
    default:
      throw new Error(`Unknown storage backend: ${config.backend as string}`);
  }
}

// ─── Session helpers ──────────────────────────────────────────────────────────

export function newSession(specSource: string, config: unknown): Session {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID().slice(0, 12),
    createdAt: now,
    updatedAt: now,
    specSource,
    config: config as Record<string, unknown>,
    messages: [],
    runs: [],
  };
}
