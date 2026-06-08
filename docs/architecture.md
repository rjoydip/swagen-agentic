# swagen — Architecture

## Overview

swagen is an **agentic application**: an LLM agent driven by `@earendil-works/pi-agent-core`'s `agentLoop` reasons over your OpenAPI spec, decides what to generate, calls a set of typed tools, and produces a summary. It is not a template engine with an LLM tacked on.

---

## Layer diagram

```sh
┌────────────────────────────────────────────────────────────┐
│                     Entry points                           │
│  CLI (src/cli)   Programmatic (src/index)   Bot (src/bot)  │
└────────────────────────┬───────────────────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│                   SwagenHarness                            │
│  src/harness/index.ts                                      │
│                                                            │
│  • Owns Agent (via agentLoop from pi-agent-core)           │
│  • Owns IStorage → session + message history               │
│  • Owns ICache   → tool result cache                       │
│  • Manages session lifecycle (create / resume / persist)   │
│  • Exposes async generator: run(options) → AgentEvent      │
└───────────┬──────────────────────────┬─────────────────────┘
            │                          │
     ┌──────▼──────┐           ┌───────▼───────┐
     │  IStorage   │           │   ICache      │
     │             │           │               │
     │ MemoryStorage│          │ MemoryCache   │
     │ FileStorage  │          │ FileCache     │
     │ RedisStorage │          │ NoopCache     │
     └─────────────┘           └───────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────────────────┐
│              agentLoop (pi-agent-core)                     │
│                                                            │
│  model ← getModel(provider, modelId)  [pi-ai]              │
│  sessionId → provider-side prompt caching                  │
│  toolExecution: "sequential"                               │
│  beforeToolCall / afterToolCall hooks                      │
└────────────────────────┬───────────────────────────────────┘
                         │  calls
                         ▼
┌────────────────────────────────────────────────────────────┐
│               AgentTools (src/tools)       MCP Tools       │
│                  │                            │            │
│                  │     ┌──────────────────────┘            │
│                  │     │  src/mcp/tools.ts                  │
│                  ▼     ▼                                   │
│         ┌──────────────────────────┐                       │
│         │  src/shared/             │                       │
│         │  tool-helpers.ts         │                       │
│         │                          │                       │
│         │  runTestRunner()         │  writeGeneratedFiles()│
│         │  parseTestOutput()       │  mapEndpointsToSumm() │
│         │  searchProjectFiles()    │  filterEntitiesByNam()│
│         │  discoverAndEnrich()     │  generateAndMergeTst()│
│         │  getTestFilePaths()      │  isFileProtected()    │
│         │  ensureDirForFile()      │  PROTECTED_FILES      │
│         └──────────────────────────┘                       │
│                                                            │
│  validate_spec       — loadSpec() + validate               │
│  load_spec           — loadSpec() + cache                  │
│  analyze_endpoints   — analyzeSpec() + cache               │
│  generate_tests      — generateTestFiles() + cache         │
│  write_files         — writeGeneratedFiles()               │
│  run_tests           — runTestRunner()                     │
│  search_files        — searchProjectFiles()                │
│  get_run_history     — listRunRecords()                    │
│  discover_code       — discoverCodebase() + cache          │
│  check_coverage      — discoverAndEnrich()                 │
│  augment_tests       — generateAndMergeTests()             │
└───────────┬──────────────────────────┬─────────────────────┘
            │                          │
   ┌────────▼────────┐       ┌─────────▼──────────┐
   │  src/core/spec  │       │  src/core/codegen   │
   │                 │       │                     │
   │  loadSpec()     │       │  generateTestFiles()│
   │  analyzeSpec()  │       │  renderTagFile()     │
   └─────────────────┘       └─────────────────────┘
            │                          │
            │                          ▼
            │              ┌──────────────────────────┐
            │              │  src/core/augmenter       │
            │              │                           │
            │              │  parseTestStructure()     │
            │              │  generateUnitTests()      │
            │              │  mergeTestFiles()         │
            │              └──────────────────────────┘
            │
            ▼
   ┌──────────────────┐
   │  src/discovery/   │
   │                   │
   │  discoverCodebase │
   │  extractEntities  │
   │  detectFramework  │
   └──────────────────┘
```

---

## Data flow for a `generate` run

```sh
1. User: swagen generate openapi.yaml

2. CLI parses args → builds prompt string → creates SwagenHarness

3. Harness:
   a. Loads or creates a Session in IStorage
   b. Restores message history from session.messages
   c. Creates AgentTools with shared RunState + ICache
   d. Calls agentLoop([userMessage], context, loopConfig)

4. agentLoop (LLM):
   a. Sends system prompt + message history + user message to model
   b. Model responds with tool_use blocks

5. Tool execution (sequential):
   load_spec("openapi.yaml")
     → cache miss → SwaggerParser.dereference() → cache set
     → returns { pathCount: 18, title: "Pet Store API" }

   analyze_endpoints({ excludeTags: ["internal"] })
     → cache miss → analyzeSpec() → cache set
     → returns 16 endpoints, 2 skipped

   generate_tests({ runner: "bun", notes: "Skipping deprecated GET /pet/{id}" })
     → cache miss → generateTestFiles() → cache set
     → returns 4 files, 16 tests total

   write_files({ dryRun: false })
     → writes __tests__/api/pets.test.ts etc.
     → skips existing setup.ts (protected)
     → returns { written: [...], skipped: ["setup.ts"] }

6. LLM produces final assistant message summarising the run

7. Harness:
   a. Persists updated messages → session.messages
   b. Appends RunRecord to session.runs
   c. Saves RunRecord to .swagen/runs/<id>.json

8. CLI prints summary + cache stats
```

---

## Session model

```typescript
interface Session {
  id: string; // 12-char UUID prefix
  createdAt: string; // ISO timestamp
  updatedAt: string;
  specSource: string; // path or URL passed to the agent
  config: Partial<SwagenConfig>;
  messages: AgentMessage[]; // full agent conversation history
  runs: RunRecord[];
}
```

Sessions are stored in the configured `IStorage`. The `messages` array is the complete `AgentMessage[]` from `pi-agent-core` — restoring it gives the agent full context of past tool calls and results when resuming.

---

## Cache model

The `ICache` wraps expensive operations:

| Operation           | Cache key input                                 | Default TTL |
| ------------------- | ----------------------------------------------- | ----------- |
| `load_spec`         | `load_spec:<source>`                            | 5 min       |
| `analyze_endpoints` | `analyze_endpoints:<args>`                      | 5 min       |
| `generate_tests`    | `generate_tests:<runner>:<sorted-operationIds>` | 5 min       |

Cache keys are SHA-256 hashes of `toolName + JSON.stringify(args)`, computed via Web Crypto (no external deps).

The `MemoryCache` is an LRU with configurable `maxEntries`. The `FileCache` stores JSON entries under `.swagen/cache/`. Both check `expiresAt` on every read.

---

## Tool design principles

- **Throw on failure.** `pi-agent-core` catches thrown errors and sends them to the LLM as tool failure messages. Returning error strings would confuse the agent.
- **Shared RunState per agent turn.** Tools share a `state: { spec, endpoints, generatedFiles }` closure so data loaded in one tool is available to the next without re-fetching.
- **TypeBox schemas.** Every tool's parameters are defined with `Type.Object(...)` from `@earendil-works/pi-ai`. The agent framework validates arguments before calling `execute`.
- **Protected files.** `write_files` never overwrites `setup.ts` or `fixtures.ts` — those are user-customisable scaffolds.
- **`terminate: true` is not used.** The agent decides when to stop based on its system prompt, keeping the tool implementations clean.

---

---

---

## MCP server

swagen can run as an [MCP server](https://modelcontextprotocol.io) exposing 13 tools over stdio or HTTP/SSE. The MCP tools share logic with the AgentTools through `src/shared/tool-helpers.ts` — a set of 12 pure functions extracted from duplicate code across both tool implementations.

### Architecture

```sh
MCP Client (Claude Desktop, Cursor, ChatGPT, etc.)
       │
       ├── stdio ──► StdioServerTransport
       │                  │
       └── HTTP/SSE ──► WebStandardStreamableHTTPServerTransport
                              │
                        Bun.serve() :port
                              │
                        Bearer auth (optional)
                              │
                              ▼
                    ┌─────────────────────┐
                    │ src/mcp/server.ts   │
                    │ (MCP Server wrapper)│
                    └────────┬────────────┘
                             │
                    ┌────────┴────────┐
                    │ src/mcp/        │
                    │ tools.ts        │
                    │ session.ts      │
                    │ transport.ts    │
                    │ auth.ts         │
                    └────────┬────────┘
                             │ calls
                             ▼
                    ┌─────────────────────┐
                    │ src/shared/         │
                    │ tool-helpers.ts     │
                    └────────┬────────────┘
                             │
                    ┌────────┴────────┐
                    │ src/core/       │
                    │ (spec, codegen, │
                    │  augmenter, …)  │
                    └─────────────────┘
```

### Shared helpers

`src/shared/tool-helpers.ts` provides 12 exported functions that eliminate duplication between `src/tools/index.ts` (AgentTools) and `src/mcp/tools.ts` (MCP tools):

| Helper                  | Eliminates duplicate from | Purpose                                   |
| ----------------------- | ------------------------- | ----------------------------------------- |
| `mapEndpointsToSummary` | both files (9 lines)      | Transform endpoints to summary format     |
| `parseTestOutput`       | both files (21 lines)     | Parse test runner stdout/stderr           |
| `runTestRunner`         | both files (21 lines)     | Spawn Bun/Vitest, return parsed output    |
| `writeGeneratedFiles`   | both files (8 lines)      | Write files with protected file guard     |
| `generateAndMergeTests` | both files (17 lines)     | Generate + merge unit test files          |
| `filterEntitiesByNames` | both files (9 lines)      | Filter entities by name list              |
| `searchProjectFiles`    | both files (9 lines)      | Scan project files with regex             |
| `discoverAndEnrich`     | mcp internal (10 lines)   | Discover code + enrich with test coverage |
| `getTestFilePaths`      | mcp internal              | Walk project for test file paths          |
| `isFileProtected`       | both files (8 lines)      | Check if file is protected (setup.ts etc) |
| `ensureDirForFile`      | both files                | Create parent directories for a file      |

See [`docs/mcp.md`](mcp.md) for full MCP documentation.

## Skills system

Skills are pluggable modules that extend the agent's behavior. See [docs/skills.md](skills.md) for full documentation.

Standalone `SKILL.md` files for AI coding agents live in [`skills/`](../skills/README.md). These are the canonical skill definitions; `src/skills/*.ts` are the swagen plugin modules.

```sh
SwagenHarness.create(config)
  └─ SkillManager
       ├─ registerBuiltins()   ── ships with swagen (rest, graphql, grpc, soap)
       ├─ loadUserSkills()     ── from config.skills[]
       └─ resolve(ctx)         ── runs activation() on each

SwagenHarness.run(options)
  ├─ detectContext()
  ├─ SkillManager.resolve()
  │     active skills → system prompt fragments appended to BASE
  │                  → extra tools merged with core tools
  └─ agentLoop(systemPrompt, tools)
```

### Layer diagram (updated)

```sh
                   ┌──────────────────────┐
                   │    SkillManager       │
                   │                      │
                   │  registerBuiltins()   │
                   │  loadUserSkills()     │
                   │  resolve()            │
                   │  buildSystemPrompt()  │
                   │  collectTools()       │
                   └──────┬───────────────┘
                          │ provides prompt fragments + tools
                          ▼
┌────────────────────────────────────────────────────────────┐
│                  SwagenHarness                              │
│  src/harness/index.ts                                       │
│                                                             │
│  • Owns SkillManager → active skills at run time            │
│  • Resolves skills → composes system prompt + merges tools  │
│  • Owns Agent (via agentLoop from pi-agent-core)            │
│  • Owns IStorage → session + message history                │
│  • Owns ICache   → tool result cache                        │
│  • Manages session lifecycle (create / resume / persist)    │
│  • Exposes async generator: run(options) → AgentEvent       │
└─────────────────────────────────────────────────────────────┘
```

## Extending swagen

### Add a custom tool

```typescript
import { createTools } from "swagen";
import { Agent } from "@earendil-works/pi-agent-core";
import { getModel, Type } from "@earendil-works/pi-ai";

const myTool = {
  name: "seed_test_database",
  description: "Seed a test database before running API tests.",
  parameters: Type.Object({
    dsn: Type.String({ description: "Database DSN." }),
  }),
  async execute(_id, { dsn }) {
    // ... seed logic ...
    return { content: [{ type: "text", text: '{"ok":true,"rows":42}' }], details: {} };
  },
};

const tools = [...createTools(config, cache), myTool];
```

### Custom storage backend

```typescript
import type { IStorage } from "swagen";

class MyStorage implements IStorage {
  async getSession(id) {
    /* ... */
  }
  async putSession(session) {
    /* ... */
  }
  async deleteSession(id) {
    /* ... */
  }
  async listSessions() {
    /* ... */
  }
  async appendRun(sessionId, run) {
    /* ... */
  }
}
```

Pass it via the `SwagenHarness` constructor (advanced) or use the `"custom"` backend pattern.
