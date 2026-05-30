import { z } from "zod";
import type { SwagenConfig } from "./types.ts";

const TestRunner = z.enum(["bun", "vitest"]);
const AuthType = z.enum(["none", "bearer", "apiKey", "basic"]);
const StorageBackend = z.enum(["memory", "file", "redis", "custom"]);
const CacheStrategy = z.enum(["none", "memory", "file"]);

const AuthConfig = z.object({
  type: AuthType,
  envVar: z.string().optional(),
  headerName: z.string().optional(),
});

const StorageConfig = z.object({
  backend: StorageBackend,
  dir: z.string().optional(),
  redisUrl: z.string().optional(),
});

const CacheConfig = z.object({
  strategy: CacheStrategy,
  ttlMs: z.number().positive().optional(),
  dir: z.string().optional(),
  maxEntries: z.number().int().positive().optional(),
});

const SkillConfigItem = z.object({
  from: z.string().min(1),
});

export const SwagenConfigSchema = z.object({
  baseUrl: z.string().min(1),
  runner: TestRunner,
  outDir: z.string().min(1),
  auth: AuthConfig,
  includeTags: z.array(z.string()),
  excludeTags: z.array(z.string()),
  skipOperations: z.array(z.string()),
  emitFixtures: z.boolean(),
  emitSetup: z.boolean(),
  assertStatusCodes: z.boolean(),
  assertSchemas: z.boolean(),
  testTimeoutMs: z.number().int().positive(),
  dryRun: z.boolean(),
  aiProvider: z.string().min(1),
  aiModel: z.string().min(1),
  storage: StorageConfig,
  cache: CacheConfig,
  skills: z.array(SkillConfigItem).optional(),
});

export class ConfigValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super(`Config validation failed: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "ConfigValidationError";
  }
}

export function validateConfig(config: Partial<SwagenConfig>): SwagenConfig {
  const result = SwagenConfigSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    throw new ConfigValidationError(issues);
  }
  return result.data as SwagenConfig;
}
