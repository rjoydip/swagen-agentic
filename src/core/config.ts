import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SwagenConfig } from "./types.ts";
import { DEFAULT_CONFIG } from "./types.ts";
import { validateConfig } from "./schema.ts";
import { logger } from "../utils/logger.ts";

const CONFIG_FILENAMES = ["swagen.config.ts", "swagen.config.js", "swagen.config.json"];

export async function resolveConfig(
  overrides: Partial<SwagenConfig> = {},
  cwd = process.cwd(),
): Promise<SwagenConfig> {
  const merged = { ...DEFAULT_CONFIG, ...(await loadConfigFile(cwd)), ...overrides };
  return validateConfig(merged);
}

async function loadConfigFile(cwd: string): Promise<Partial<SwagenConfig>> {
  for (const name of CONFIG_FILENAMES) {
    // eslint-disable-next-line no-await-in-loop
    const abs = join(cwd, name);
    if (!existsSync(abs)) continue;
    if (name.endsWith(".json")) {
      try {
        return JSON.parse(await Bun.file(abs).text()) as Partial<SwagenConfig>; // eslint-disable-line no-await-in-loop
      } catch {
        continue;
      }
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const mod = await import(abs);
      const exp = mod.default ?? mod;
      // eslint-disable-next-line no-await-in-loop
      return (typeof exp === "function" ? await exp() : exp) as Partial<SwagenConfig>;
    } catch (err) {
      logger.warn("config", `Could not load ${name}: ${err}`);
    }
  }
  return {};
}

export function starterConfig(): string {
  return `import type { SwagenConfig } from "swagen";

const config: Partial<SwagenConfig> = {
  baseUrl: \`process.env.API_BASE_URL ?? "http://localhost:3000"\`,
  runner: "bun",
  outDir: "tests/api",
  auth: { type: "bearer", envVar: "API_TOKEN" },
  includeTags: [],
  excludeTags: ["internal"],
  skipOperations: [],
  emitFixtures: true,
  emitSetup: true,
  assertStatusCodes: true,
  assertSchemas: false,
  testTimeoutMs: 10_000,
  dryRun: false,
  // REQUIRED: set your AI provider and model
  // aiProvider: "anthropic",
  // aiModel: "claude-opus-4-5-20251101",
  storage: { backend: "file" },
  cache: { strategy: "memory", ttlMs: 300_000 },
};

export default config;
`;
}
