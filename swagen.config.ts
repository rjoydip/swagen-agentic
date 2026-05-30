import type { SwagenConfig } from "./src/core/types.ts";

const SWAGEN_DIR = ".swagen";
const RUNNER = (process.env.SWAGEN_RUNNER as SwagenConfig["runner"]) ?? "vitest"; // "bun" | "vitest"

const config: Partial<SwagenConfig> = {
  // ─── API ─────────────────────────────────────────────────────────────────
  baseUrl: process.env.API_BASE_URL ?? "http://petstore3.swagger.io/api/v3",

  // ─── Test runner ──────────────────────────────────────────────────────────
  runner: RUNNER,

  // ─── Output ───────────────────────────────────────────────────────────────
  outDir: `${SWAGEN_DIR}/tests/${RUNNER}_api`,

  // ─── Auth ─────────────────────────────────────────────────────────────────
  auth: {
    type: "bearer", // "none" | "bearer" | "apiKey" | "basic"
    envVar: "API_TOKEN",
  },

  // ─── Endpoint filtering ───────────────────────────────────────────────────
  includeTags: [],
  excludeTags: ["internal", "deprecated"],
  skipOperations: [],

  // ─── Scaffold helpers ─────────────────────────────────────────────────────
  emitFixtures: true,
  emitSetup: true,

  // ─── Assertions ───────────────────────────────────────────────────────────
  assertStatusCodes: true,
  assertSchemas: false, // set true to add zod schema validation stubs
  testTimeoutMs: 10_000,

  // ─── Dry run ──────────────────────────────────────────────────────────────
  dryRun: false,

  // ─── AI ───────────────────────────────────────────────────────────────────
  aiProvider: "opencode",
  aiModel: "big-pickle",

  // ─── Session storage ──────────────────────────────────────────────────────
  storage: {
    backend: "file", // "memory" | "file" | "redis"
    dir: `${SWAGEN_DIR}/sessions`, // for "file" backend
    // redisUrl: "https://your-upstash.upstash.io", // for "redis" backend
  },

  // ─── Tool result caching ──────────────────────────────────────────────────
  cache: {
    strategy: "memory", // "none" | "memory" | "file"
    ttlMs: 5 * 60_000, // 5 minutes
    maxEntries: 256, // LRU eviction limit (memory only)
    // dir: `${SWAGEN_DIR}/cache`,  // for "file" strategy
  },
};

export default config;
