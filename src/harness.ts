/**
 * harness/index.ts — SwagenHarness
 *
 * The harness is the top-level object that owns:
 *   - Agent instance (@earendil-works/pi-agent-core)
 *   - Storage backend (memory / file / redis)
 *   - Cache backend (memory / file)
 *   - Session lifecycle (create, resume, persist)
 *   - Event streaming to multiple subscribers
 *
 * Usage:
 *   const harness = await SwagenHarness.create(config);
 *   const session = await harness.newSession("./openapi.yaml");
 *   for await (const event of harness.run(session.id, "generate tests")) { ... }
 *   await harness.saveSession(session.id);
 */

import {
  agentLoop,
  type AgentEvent,
  type AgentMessage,
  type AgentContext,
  type AgentLoopConfig,
} from "@earendil-works/pi-agent-core";
import { getModel, type Model } from "@earendil-works/pi-ai";

import { createStorage, newSession as makeSession } from "./storage.ts";
import { createCache } from "./cache.ts";
import { createTools } from "./tools/index.ts";
import { saveRunRecord } from "./tools/state.ts";
import { detectContext, contextPrompt } from "./context.ts";
import { SkillManager } from "./skills/manager.ts";
import {
  BASE_SYSTEM_PROMPT,
  CODEBASE_SYSTEM_PROMPT,
  buildSkillSystemPrompt,
} from "./core/prompts.ts";
import type { IStorage } from "./storage.ts";
import type { ICache } from "./cache.ts";
import type { Session, SwagenConfig, RunRecord, SkillHook, SkillContext } from "./core/types.ts";
import type { ResolvedEndpoint, GeneratedFile } from "./core/types.ts";
import { checkApiKey } from "./utils/errors.ts";
import { logger } from "./utils/logger.ts";

// ─── Harness ──────────────────────────────────────────────────────────────────

export interface HarnessRunOptions {
  /** The user's instruction */
  prompt: string;
  /** Resume an existing session by id (loads its message history) */
  sessionId?: string;
  /** Stream every AgentEvent to this callback */
  onEvent?: ((event: AgentEvent) => void) | undefined;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Whether to auto-save the session after the run */
  persist?: boolean;
  /** Optional pre-built model override (bypasses getModel + checkApiKey). Used in tests. */
  model?: Model<any>;
}

export interface HarnessRunResult {
  sessionId: string;
  agentSummary: string;
  messages: AgentMessage[];
  endpointCount: number;
  writtenFiles: string[];
  generatedFileContents: Array<{ path: string; tests: number; content: string }>;
}

export class SwagenHarness {
  readonly config: SwagenConfig;
  readonly storage: IStorage;
  readonly cache: ICache;
  readonly skillManager: SkillManager | null;

  activeHooks: SkillHook[] = [];

  constructor(
    config: SwagenConfig,
    storage: IStorage,
    cache: ICache,
    skillManager: SkillManager | null = null,
  ) {
    this.config = config;
    this.storage = storage;
    this.cache = cache;
    this.skillManager = skillManager;
  }

  static async create(config: SwagenConfig): Promise<SwagenHarness> {
    const storage = createStorage(config.storage);
    const cache = createCache(config.cache);

    const skillManager = new SkillManager();
    await skillManager.registerBuiltins();
    await skillManager.loadUserSkills(config);

    return new SwagenHarness(config, storage, cache, skillManager);
  }

  // ── Session management ───────────────────────────────────────────────────

  async newSession(specSource: string): Promise<Session> {
    const session = makeSession(specSource, this.config);
    await this.storage.putSession(session);
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    return this.storage.getSession(id);
  }

  async listSessions(): Promise<string[]> {
    return this.storage.listSessions();
  }

  async deleteSession(id: string): Promise<void> {
    return this.storage.deleteSession(id);
  }

  // ── Agent run ────────────────────────────────────────────────────────────

  /**
   * Run the agent for a single prompt turn.
   * Yields AgentEvent objects as they stream.
   */
  async *run(options: HarnessRunOptions): AsyncGenerator<AgentEvent, HarnessRunResult> {
    const { prompt, signal, onEvent, persist = true } = options;

    // Load or create session
    let session: Session;
    if (options.sessionId) {
      const existing = await this.storage.getSession(options.sessionId);
      if (!existing) throw new Error(`Session not found: ${options.sessionId}`);
      session = existing;
    } else {
      session = makeSession(prompt, this.config);
      await this.storage.putSession(session);
    }

    const model =
      options.model ??
      (() => {
        checkApiKey(this.config.aiProvider);
        return (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
          this.config.aiProvider,
          this.config.aiModel,
        );
      })();
    if (!model) throw new Error(`Unknown model: ${this.config.aiProvider}/${this.config.aiModel}`);

    // Build system prompt with project context and active skills
    const projectCtx = await detectContext();
    const skillCtx = {
      config: this.config,
      endpoints: [],
      projectContext: projectCtx,
    };

    let tools = createTools(this.config, this.cache);
    let baseSystem = this.config.mode === "codebase" ? CODEBASE_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;

    if (this.skillManager) {
      const { active, inactive } = this.skillManager.resolve(skillCtx);
      this.activeHooks = this.skillManager.collectHooks(active);

      if (active.length > 0) {
        logger.info("skills", `Active: ${active.map((s) => s.name).join(", ")}`);
        baseSystem = buildSkillSystemPrompt(
          baseSystem,
          active.map((s) => s.systemPrompt).filter(Boolean) as string[],
        );
        const skillTools = this.skillManager.collectTools(active);
        if (skillTools.length > 0) {
          logger.info("skills", `${skillTools.length} skill tool(s) registered`);
        }
        tools = [...tools, ...skillTools];
      }
      if (inactive.length > 0) {
        logger.debug("skills", `Inactive: ${inactive.map((s) => s.name).join(", ")}`);
      }
    }

    const ctxStr = contextPrompt(projectCtx);
    const systemPrompt = baseSystem + "\n\n" + ctxStr;

    const context: AgentContext = {
      systemPrompt,
      messages: session.messages as AgentMessage[],
      tools: tools as any,
    };

    const loopConfig: AgentLoopConfig = {
      model,
      sessionId: session.id, // enables provider-side caching
      convertToLlm: (msgs) =>
        msgs.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult"),
      toolExecution: "sequential",
      beforeToolCall: async ({ toolCall, context: _ctx }) => {
        logger.debug("agent", `→ ${toolCall.name}`);
        return undefined;
      },
      afterToolCall: async ({ toolCall, isError }) => {
        if (isError) logger.warn("agent", `✗ ${toolCall.name} errored`);
        return undefined;
      },
    };

    const userMessage: AgentMessage = {
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };

    // Extract stats from tool results as they arrive
    let endpointCount = 0;
    let writtenFiles: string[] = [];
    let generatedFileContents: Array<{ path: string; tests: number; content: string }> = [];

    for await (const event of agentLoop([userMessage], context, loopConfig, signal)) {
      onEvent?.(event);
      yield event;

      // Mine tool_execution_end events for stats
      if (event.type === "tool_execution_end") {
        const e = event as Record<string, unknown>;
        try {
          const resultContent = (
            (e["result"] as Record<string, unknown>)?.["content"] as Array<Record<string, unknown>>
          )?.[0];
          if (resultContent?.["type"] === "text") {
            const parsed = JSON.parse(String(resultContent["text"]));
            if (parsed?.endpointCount) endpointCount = parsed.endpointCount;
            if (parsed?.written) writtenFiles = parsed.written as string[];
            if (parsed?.files)
              generatedFileContents = parsed.files as Array<{
                path: string;
                tests: number;
                content: string;
              }>;
          }
        } catch {}
      }
    }

    // Persist updated messages back to session
    session.messages = context.messages as unknown[];
    session.updatedAt = new Date().toISOString();

    // Get the agent's final assistant message as summary
    const lastAssistant = [...context.messages].reverse().find((m) => m.role === "assistant");
    const agentSummary =
      typeof lastAssistant?.content === "string" ? lastAssistant.content : "(no summary)";

    if (persist) {
      await this.storage.putSession(session);

      // Persist a run record
      const run: RunRecord = {
        id: crypto.randomUUID().slice(0, 8),
        timestamp: new Date().toISOString(),
        endpointCount,
        generatedFiles: writtenFiles,
        agentSummary,
      };
      await this.storage.appendRun(session.id, run);
      await saveRunRecord(run);
    }

    return {
      sessionId: session.id,
      agentSummary,
      messages: context.messages,
      endpointCount,
      writtenFiles,
      generatedFileContents,
    };
  }

  // ── Convenience: run to completion and return result ──────────────────────

  async runToCompletion(options: HarnessRunOptions): Promise<HarnessRunResult> {
    const gen = this.run(options);
    let result: IteratorResult<AgentEvent, HarnessRunResult>;
    do {
      // eslint-disable-line no-await-in-loop
      result = await gen.next(); // eslint-disable-line no-await-in-loop
    } while (!result.done);
    return result.value;
  }

  // ── Hook pipeline (programmatic use) ────────────────────────────────────

  /**
   * Build a SkillContext from current config and detected project context.
   * Useful when calling hooks programmatically outside the agent loop.
   */
  async buildSkillContext(endpoints: ResolvedEndpoint[]): Promise<SkillContext> {
    const projectContext = await detectContext();
    return {
      config: this.config,
      endpoints,
      projectContext,
    };
  }

  /**
   * Run `beforeGenerate` hooks over a list of endpoints.
   * Each hook receives the current endpoints and may return a modified list.
   */
  async applyBeforeGenerateHooks(endpoints: ResolvedEndpoint[]): Promise<ResolvedEndpoint[]> {
    let current = endpoints;
    for (const hook of this.activeHooks) {
      if (hook.beforeGenerate) {
        const ctx = await this.buildSkillContext(current); // eslint-disable-line no-await-in-loop
        current = await hook.beforeGenerate(current, ctx); // eslint-disable-line no-await-in-loop
      }
    }
    return current;
  }

  /**
   * Run `afterGenerate` hooks over generated files.
   * Each hook receives the files and result metadata and may return modified files.
   */
  async applyAfterGenerateHooks(
    files: GeneratedFile[],
    meta: { endpointCount: number; skippedCount: number },
  ): Promise<GeneratedFile[]> {
    let current = files;
    for (const hook of this.activeHooks) {
      if (hook.afterGenerate) {
        const ctx = await this.buildSkillContext([]); // eslint-disable-line no-await-in-loop
        current = await hook.afterGenerate(current, meta, ctx); // eslint-disable-line no-await-in-loop
      }
    }
    return current;
  }

  // ── Cache management ─────────────────────────────────────────────────────

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  cacheStats() {
    return this.cache.stats();
  }
}
