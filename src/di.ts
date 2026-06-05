import { Container } from "@inferdi/inferdi";
import type { OpenAPI } from "openapi-types";
import { createStorage } from "./storage.ts";
import { createCache } from "./cache.ts";
import { createTools } from "./tools/index.ts";
import { SkillManager } from "./skills/manager.ts";
import type {
  SwagenConfig,
  ResolvedEndpoint,
  GeneratedFile,
  CodebaseAnalysis,
} from "./core/types.ts";

// ─── RunState ────────────────────────────────────────────────────────────────

export interface RunState {
  spec?: OpenAPI.Document;
  endpoints?: ResolvedEndpoint[];
  generatedFiles?: GeneratedFile[];
  codebaseAnalysis?: CodebaseAnalysis;
  testFilePaths?: string[];
}

// ─── Container builder ─────────────────────────────────────────────────────────

export async function buildContainer(config: SwagenConfig): Promise<Container<any>> {
  const storage = createStorage(config.storage);
  const cache = createCache(config.cache);

  const skillManager = new SkillManager();
  await skillManager.registerBuiltins();
  await skillManager.loadUserSkills(config);

  const runState: RunState = {};
  const container = new Container({ strict: true })
    .registerValue("config", config)
    .registerValue("storage", storage)
    .registerValue("cache", cache)
    .registerValue("skillManager", skillManager)
    .registerValue("runState", runState)
    .registerFactory("tools", (ctx) =>
      createTools(ctx.get("config"), ctx.get("cache"), ctx.get("runState")),
    );
  return container;
}
