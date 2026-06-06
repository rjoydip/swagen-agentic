/**
 * swagen — core domain types.
 * No third-party imports. All types are plain TypeScript.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { OpenAPI } from "openapi-types";
import type { ProjectContext } from "../context.ts";

// ─── Codebase mode types ──────────────────────────────────────────────────────

export type GenerateMode = "spec" | "codebase";

export type ApiFramework =
  | "express"
  | "fastify"
  | "nestjs"
  | "hono"
  | "nextjs"
  | "koa"
  | "elysia"
  | "node:http"
  | "unknown";

export type CoverageLevel = "none" | "partial" | "low" | "full";

export type AugmentStrategy = "smart-merge" | "append" | "separate";

export interface SourceEntity {
  type: "function" | "class" | "method" | "export" | "type" | "interface" | "variable";
  entityKind: "declaration" | "arrow" | "anonymous" | "expression";
  name: string;
  file: string;
  line: number;
  column: number;
  signature?: string;
  visibility?: "public" | "private" | "protected" | "exported" | "default";
  isAsync: boolean;
  isExported: boolean;
  decorators?: string[];
  jsDoc?: string;
}

export interface CodeDependency {
  source: string;
  target: string;
  imports: string[];
  isExternal: boolean;
}

export interface CoverageGap {
  entity: SourceEntity;
  coverage: CoverageLevel;
  gapDescription: string;
  existingTests: string[];
}

export interface CodebaseAnalysis {
  entities: SourceEntity[];
  dependencies: CodeDependency[];
  coverageGaps: CoverageGap[];
  entryPoints: string[];
  apiEndpoints: SourceEntity[];
  framework: ApiFramework;
  testFilePaths?: string[];
}

export interface AugmentOptions {
  strategy: AugmentStrategy;
  preserveExisting: boolean;
  respectConventions: boolean;
}

// ─── Spec source ──────────────────────────────────────────────────────────────

export type SpecSource =
  | { kind: "file"; path: string }
  | { kind: "url"; url: string }
  | { kind: "inline"; doc: OpenAPI.Document };

// ─── Endpoint model ───────────────────────────────────────────────────────────

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

export interface EndpointParam {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required: boolean;
  schema: unknown;
  example?: unknown;
}

export interface EndpointBody {
  required: boolean;
  contentType: string;
  schema: unknown;
  example?: unknown;
}

export interface EndpointResponse {
  statusCode: number | "default";
  contentType: string | undefined;
  schema: unknown;
  description: string | undefined;
}

export interface ResolvedEndpoint {
  path: string;
  method: HttpMethod;
  operationId: string;
  summary: string | undefined;
  tags: string[];
  params: EndpointParam[];
  body: EndpointBody | undefined;
  responses: EndpointResponse[];
  security: string[][];
  deprecated: boolean;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export type TestRunner = "bun" | "vitest";

export type AuthType = "none" | "bearer" | "apiKey" | "basic";

export interface AuthConfig {
  type: AuthType;
  /** Environment variable that holds the credential */
  envVar?: string;
  /** For apiKey: header or query param name */
  headerName?: string;
}

export type StorageBackend = "memory" | "file" | "redis" | "custom";

export interface StorageConfig {
  backend: StorageBackend;
  /** For file backend: directory to persist sessions */
  dir?: string;
  /** For redis backend: connection URL */
  redisUrl?: string;
}

export type CacheStrategy = "none" | "memory" | "file";

export interface CacheConfig {
  strategy: CacheStrategy;
  /** TTL in milliseconds. Default: 5 minutes */
  ttlMs?: number;
  /** For file cache: directory to store cache entries */
  dir?: string;
  /** Max entries before LRU eviction (memory cache only) */
  maxEntries?: number;
}

export interface SkillContext {
  config: SwagenConfig;
  endpoints: ResolvedEndpoint[];
  projectContext: ProjectContext;
  codebaseAnalysis?: CodebaseAnalysis;
}

export interface SkillHook {
  /** Transform endpoints before test generation */
  beforeGenerate?: (
    endpoints: ResolvedEndpoint[],
    ctx: SkillContext,
  ) => Promise<ResolvedEndpoint[]>;
  /** Transform generated files before writing */
  afterGenerate?: (
    files: GeneratedFile[],
    result: { endpointCount: number; skippedCount: number },
    ctx: SkillContext,
  ) => Promise<GeneratedFile[]>;
  /** Transform codebase analysis before generation */
  beforeCodebaseGenerate?: (
    analysis: CodebaseAnalysis,
    ctx: SkillContext,
  ) => Promise<CodebaseAnalysis>;
}

export interface Skill {
  name: string;
  version: string;
  description: string;
  /** Determines if this skill should activate given the current context */
  activation: (ctx: SkillContext) => boolean;
  /** Extra system prompt lines injected when active */
  systemPrompt?: string;
  /** Extra tools registered when active */
  tools?: AgentTool<any, any>[];
  /** Pipeline hooks */
  hooks?: SkillHook;
}

export interface SkillConfigItem {
  /** Path to a .ts file that exports a Skill, or an npm package name */
  from: string;
}

export interface SwagenConfig {
  baseUrl: string;
  runner: TestRunner;
  outDir: string;
  auth: AuthConfig;
  includeTags: string[];
  excludeTags: string[];
  skipOperations: string[];
  emitFixtures: boolean;
  emitSetup: boolean;
  assertStatusCodes: boolean;
  assertSchemas: boolean;
  testTimeoutMs: number;
  dryRun: boolean;
  /** @earendil-works/pi-ai provider id, e.g. "anthropic" */
  aiProvider: string;
  /** Model id, e.g. "claude-opus-4-5-20251101" */
  aiModel: string;
  /** Storage configuration for agent sessions */
  storage: StorageConfig;
  /** Tool result caching */
  cache: CacheConfig;
  /** User-defined skills to load */
  skills?: SkillConfigItem[];
  /** Generation mode: spec-based or codebase-based */
  mode: GenerateMode;
  /** Root path for codebase discovery */
  discoveryPath: string;
  /** Whether to augment existing test files */
  augment: boolean;
  /** Minimum coverage threshold (0-1) */
  coverageThreshold: number;
  /** Strategy for augmenting existing tests */
  augmentStrategy: AugmentStrategy;
}

export const DEFAULT_CONFIG: Partial<SwagenConfig> = {
  baseUrl: process.env.API_BASE_URL ?? "http://localhost:3000",
  runner: "bun",
  outDir: "tests/api",
  auth: { type: "none" },
  includeTags: [],
  excludeTags: [],
  skipOperations: [],
  emitFixtures: true,
  emitSetup: true,
  assertStatusCodes: true,
  assertSchemas: false,
  testTimeoutMs: 10_000,
  dryRun: false,
  mode: "spec",
  discoveryPath: "src",
  augment: false,
  coverageThreshold: 0.7,
  augmentStrategy: "smart-merge",
  storage: { backend: "memory" },
  cache: { strategy: "memory", ttlMs: 5 * 60_000, maxEntries: 256 },
};

// ─── Generated output ─────────────────────────────────────────────────────────

export interface GeneratedFile {
  relativePath: string;
  content: string;
  testCount: number;
}

export interface GenerateResult {
  files: GeneratedFile[];
  endpointCount: number;
  skippedCount: number;
  durationMs: number;
  agentSummary?: string;
  sessionId: string;
}

export interface TestRunResult {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  output: string;
  exitCode: number;
}

// ─── Session / audit ──────────────────────────────────────────────────────────

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  specSource: string;
  config: Partial<SwagenConfig>;
  /** Serialised AgentMessage[] for context resumption */
  messages: unknown[];
  runs: RunRecord[];
}

export interface RunRecord {
  id: string;
  timestamp: string;
  endpointCount: number;
  generatedFiles: string[];
  agentSummary?: string;
  run?: TestRunResult;
}

// ─── Cache entry ──────────────────────────────────────────────────────────────

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  createdAt: number;
  expiresAt: number;
  hits: number;
}
