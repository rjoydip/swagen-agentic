/**
 * swagen — public API
 *
 * import { SwagenHarness } from 'swagen';
 * import { MemoryStorage, FileStorage, RedisStorage } from 'swagen/storage';
 * import { MemoryCache, FileCache, withCache } from 'swagen/cache';
 */

// ─── Harness (primary API) ────────────────────────────────────────────────────
export { SwagenHarness } from "./harness.ts";
export type { HarnessRunOptions, HarnessRunResult } from "./harness.ts";

// ─── Storage ──────────────────────────────────────────────────────────────────
export { MemoryStorage, FileStorage, RedisStorage, createStorage, newSession } from "./storage.ts";
export type { IStorage } from "./storage.ts";

// ─── Cache ────────────────────────────────────────────────────────────────────
export { MemoryCache, FileCache, NoopCache, createCache, withCache, cacheKey } from "./cache.ts";
export type { ICache, CacheStats } from "./cache.ts";

// ─── Core ─────────────────────────────────────────────────────────────────────
export { resolveConfig, starterConfig } from "./core/config.ts";
export { loadSpec, analyzeSpec } from "./core/spec.ts";
export { generateTestFiles } from "./core/codegen.ts";
export { DEFAULT_CONFIG } from "./core/types.ts";
export { validateConfig, ConfigValidationError } from "./core/schema.ts";
export type {
  SwagenConfig,
  GenerateResult,
  GeneratedFile,
  ResolvedEndpoint,
  SpecSource,
  TestRunner,
  Session,
  RunRecord,
  StorageConfig,
  CacheConfig,
} from "./core/types.ts";

// ─── Orchestrator ─────────────────────────────────────────────────────────────
export { runParallel, splitAndGenerate } from "./orchestrator.ts";
export type { ParallelTask, ParallelTaskResult, OrchestratorOptions } from "./orchestrator.ts";

// ─── Context ──────────────────────────────────────────────────────────────────
export { detectContext, contextPrompt } from "./context.ts";
export type { ProjectContext } from "./context.ts";

// ─── Indexer ──────────────────────────────────────────────────────────────────
export { buildIndex, loadIndex, getIndex, searchIndex, searchTests } from "./indexer.ts";
export type { CodebaseIndex, IndexEntry } from "./indexer.ts";

// ─── Tools ────────────────────────────────────────────────────────────────────
export { createTools } from "./tools/index.ts";
export { listRunRecords, getLastRun, saveRunRecord } from "./tools/state.ts";

// ─── Skills ───────────────────────────────────────────────────────────────────
export { SkillManager } from "./skills/manager.ts";
export type { Skill, SkillContext, SkillHook, SkillConfigItem } from "./core/types.ts";

// ─── Post-processing ──────────────────────────────────────────────────────────
export { postProcessGeneratedFiles } from "./core/postprocess.ts";
