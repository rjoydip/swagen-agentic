# Skills — Agentic Test Generation Extensions

Skills are pluggable modules that extend swagen's agentic behavior. A skill can:

- Inject domain-specific rules into the agent's **system prompt**
- Register **custom tools** available to the agent
- Hook into the **generation pipeline** (before/after generate)
- **Self-activate** based on the spec or project context — no manual toggling

---

## How skills work

```sh
SwagenHarness.create(config)
  └─ SkillManager
       ├─ registerBuiltins()   ── ships with swagen
       ├─ loadUserSkills()     ── from config.skills[]
       └─ resolve(ctx)         ── runs activation() on each

SwagenHarness.run(options)
  ├─ detectContext()
  ├─ SkillManager.resolve()
  │     active skills → system prompt fragments appended to BASE
  │                  → extra tools merged with core tools
  └─ agentLoop(systemPrompt, tools)
```

Skills are resolved once per run, before the agent loop starts. Active skills inject extra guidance into the system prompt and register additional tools automatically.

> **Also see [`skills/`](../skills/README.md) — standalone `SKILL.md` files** for REST, GraphQL, gRPC, and SOAP that work with any AI coding agent (Cursor, Claude Code, opencode, Gemini, Copilot). These are the canonical skill definitions; `src/skills/*.ts` are the swagen plugin modules.

---

## Built-in skills

| Skill     | Activates when                                                  | What it adds                                                                                 |
| --------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `rest`    | RESTful methods, auth schemes, pagination params, or 4xx errors | Status code coverage, auth flow tests, pagination, CRUD lifecycle, negative testing          |
| `graphql` | `/graphql` paths, `graphql` tag, query/mutation params          | Query/mutation/subscription coverage, variable edge cases, fragment reuse, error assertions  |
| `grpc`    | `grpc`/`rpc`/`proto` path patterns, `grpc` tag, post with `:`   | Unary/streaming call tests, error code assertions, deadline/metadata, oneof/map/bytes fields |

### grpc

Activates when the spec contains gRPC path patterns (e.g. `/rpc/Service/Method`), `grpc` tag, or post endpoints with colon-separated method paths. Injects rules for all four call types (unary, server-streaming, client-streaming, bidirectional), gRPC status code assertions, metadata propagation, and oneof/map/bytes field testing.

### soap

Activates when the spec contains SOAP-related paths (`/soap`, `/wsdl`), tags, or returns XML content types. Injects rules for SOAP envelope structure, WS-Security, fault handling, XPath assertions, and multiple binding generation.

---

## Writing a custom skill

A skill is a TypeScript module that exports a `Skill` object (named export `skill` or default export).

```ts
// skills/my-custom-skill.ts
import type { Skill } from "swagen";

export const skill: Skill = {
  name: "my-custom-skill",
  version: "1.0.0",
  description: "Adds custom testing rules for my API patterns",

  // Self-activation — runs against the current context
  activation: (ctx) => {
    return ctx.endpoints.some((ep) => ep.tags.includes("payments"));
  },

  // Injected into the agent's system prompt when active
  systemPrompt: `
MY CUSTOM RULES:
- For payment endpoints, always generate a test with an invalid card number
- Expect 402 Payment Required responses
`,

  // Optional: extra tools registered when active
  tools: [],

  // Optional: pipeline hooks
  hooks: {
    beforeGenerate: async (endpoints, ctx) => {
      // Filter or transform endpoints before generation
      return endpoints;
    },
    afterGenerate: async (files, result, ctx) => {
      // Transform generated files before writing
      return files;
    },
  },
};
```

### Loading a custom skill

Add it to your `swagen.config.ts`:

```ts
import type { SwagenConfig } from "swagen";

const config: Partial<SwagenConfig> = {
  // ... your config ...

  skills: [
    { from: "./skills/my-custom-skill.ts" },
    // Or from an npm package:
    { from: "@swagen/skill-pulumi" },
  ],
};

export default config;
```

### Skill interface

```ts
interface Skill {
  name: string;
  version: string;
  description: string;
  /** Determines if this skill activates for the current context */
  activation: (ctx: SkillContext) => boolean;
  /** Extra system prompt lines — appended when active */
  systemPrompt?: string;
  /** Extra tools — merged with core tools when active */
  tools?: AgentTool<any, any>[];
  /** Pipeline hooks */
  hooks?: SkillHook;
}

interface SkillContext {
  config: SwagenConfig;
  endpoints: ResolvedEndpoint[];
  projectContext: ProjectContext;
}

interface SkillHook {
  beforeGenerate?: (
    endpoints: ResolvedEndpoint[],
    ctx: SkillContext,
  ) => Promise<ResolvedEndpoint[]>;
  afterGenerate?: (
    files: GeneratedFile[],
    result: { endpointCount: number; skippedCount: number },
    ctx: SkillContext,
  ) => Promise<GeneratedFile[]>;
}
```

---

## Activation rules

- `activation()` is called **once per run** with the current context
- Return `true` to activate, `false` to deactivate
- If the function throws, the skill is treated as **inactive** (logged to stderr)
- Skills activate based on **endpoint metadata** and **project context** — not config toggles

---

## Tool merging

When a skill provides extra tools, they are **appended** after the core tool list. If a skill tool has the same `name` as a core tool, the core tool takes precedence (no override).

```ts
tools = [...coreTools, ...skillTools];
```

---

## Hook pipeline

Hooks run outside the agent loop — they transform data before/after generation:

```sh
beforeGenerate(endpoints, ctx) → modified endpoints
                     ↓
              agent generates files
                     ↓
afterGenerate(files, result, ctx) → modified files
                     ↓
              write_files writes to disk
```

### Using hooks programmatically

The harness exposes two methods to invoke hooks outside the agent loop. This is useful when you control the pipeline directly (e.g. in a CI script or orchestrator).

```ts
import { SwagenHarness } from "swagen";

const harness = await SwagenHarness.create(config);

// 1. Load and analyze a spec
import { loadSpec, analyzeSpec } from "swagen";
const spec = await loadSpec("openapi.yaml");
const { endpoints } = analyzeSpec(spec, config);

// 2. Apply beforeGenerate hooks — transform endpoints before generation
const modifiedEndpoints = await harness.applyBeforeGenerateHooks(endpoints);
// e.g. a "skip-deprecated" skill could filter them out here

// 3. Generate test files from the modified endpoints
import { generateTestFiles } from "swagen";
const files = generateTestFiles(modifiedEndpoints, config);

// 4. Apply afterGenerate hooks — transform files before writing
const modifiedFiles = await harness.applyAfterGenerateHooks(files, {
  endpointCount: modifiedEndpoints.length,
  skippedCount: endpoints.length - modifiedEndpoints.length,
});
// e.g. a "license-header" skill could prepend copyright headers

// 5. Write the final files to disk
for (const file of modifiedFiles) {
  Bun.write(file.relativePath, file.content);
}
```

### What hooks can do

| Hook             | Receives                                                | Returns              | Use case                                                               |
| ---------------- | ------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| `beforeGenerate` | `endpoints: ResolvedEndpoint[]`, `ctx: SkillContext`    | `ResolvedEndpoint[]` | Filter deprecated endpoints, inject auth fixtures, reorder by priority |
| `afterGenerate`  | `files: GeneratedFile[]`, `result`, `ctx: SkillContext` | `GeneratedFile[]`    | Add license headers, inject setup imports, suppress certain tests      |

### Hook chain order

Hooks run in **registration order** — the same order skills were registered. Each hook feeds its output into the next:

```sh
endpoints → hook1.beforeGenerate → hook2.beforeGenerate → ... → modified endpoints
files     → hook1.afterGenerate  → hook2.afterGenerate  → ... → modified files
```

The harness stores active hooks in `harness.activeHooks[]` for direct access when you need custom chaining.

---

## SkillManager API

```ts
import { SkillManager } from "swagen";

const mgr = new SkillManager();

// Register a skill programmatically
mgr.register(skill);

// Load built-in skills from swagen
await mgr.registerBuiltins();

// Load user skills from config
await mgr.loadUserSkills(config);

// Resolve active/inactive skills
const { active, inactive } = mgr.resolve(skillContext);

// Build the system prompt from active skills
const prompt = mgr.buildSystemPrompt(active, basePrompt);

// Collect tools from active skills
const tools = mgr.collectTools(active);

// Collect hooks from active skills
const hooks = mgr.collectHooks(active);
```
