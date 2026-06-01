# swagen-agentic

[![License](https://img.shields.io/github/license/rjoydip/tsse-elysia)](https://github.com/rjoydip/tsse-elysia/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0+-blue)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3+-green)](https://bun.sh)
[![Fallow Health](.swagen/fallow-badge.svg)](https://docs.fallow.tools/)
[![codecov](https://codecov.io/gh/rjoydip/swagen-agentic/graph/badge.svg?token=OLT5ONIBWJ)](https://codecov.io/gh/rjoydip/swagen-agentic)
[![Pull Requests Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat)](http://makeapullrequest.com)

**Agentic API test generation** from Swagger / OpenAPI specs.

Built on [`@earendil-works/pi-ai`](https://github.com/earendil-works/pi/tree/main/packages/ai) and [`@earendil-works/pi-agent-core`](https://github.com/earendil-works/pi/tree/main/packages/agent) — an LLM agent reasons over your spec, decides what to generate, calls tools, and reports back. Every run is sessionised, cached, and auditable.

---

## Features

| Feature                 | Details                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **Agentic loop**        | `agentLoop` from `pi-agent-core` — the LLM calls tools, not a script                       |
| **Skills system**       | Pluggable modules that self-activate based on spec context, inject prompts + tools + hooks |
| **Hook pipeline**       | `beforeGenerate` / `afterGenerate` hooks for programmatic orchestration                    |
| **OAS 2 + 3**           | Full OpenAPI 2 (Swagger) and 3.x support via `@apidevtools/swagger-parser`                 |
| **Bun test + Vitest**   | Emits either test runner's syntax                                                          |
| **Session persistence** | Memory, file, or Redis (Upstash-compatible REST)                                           |
| **Tool caching**        | Memory LRU or file cache — spec loads and analysis are cached                              |
| **Resume sessions**     | Pick up a previous agent conversation with full message history                            |
| **GitHub Actions bot**  | Post durable PR comments, optional auto-commit                                             |
| **GitHub App server**   | Webhook-driven, real-time, multi-repo, improved error handling                             |
| **Zero bloat**          | No chalk, commander, dedent, ora — all replaced by native Bun/Node utilities               |
| **Audit trail**         | Every run persisted in `.swagen/runs/`                                                     |
| **Full test suite**     | 303 unit + integration tests with `bun test`                                               |

---

## Project structure

```sh
swagen/
├── src/
│   ├── core/
│   │   ├── types.ts        — all domain types (no imports)
│   │   ├── spec.ts         — spec loader + route analyzer
│   │   ├── codegen.ts      — Bun/Vitest test file generator
│   │   ├── config.ts       — config file loader
│   │   ├── schema.ts       — Zod config validation
│   │   ├── prompts.ts      — LLM prompt templates
│   │   └── postprocess.ts  — output cleanup (dedup, strip imports)
│   ├── tools/
│   │   ├── index.ts        — 12 AgentTools with TypeBox schemas + cache
│   │   └── state.ts        — run record persistence (.swagen/runs/)
│   ├── skills/             — swagen plugin modules (TypeScript)
│   │   ├── manager.ts      — SkillManager: register, resolve, compose
│   │   ├── rest.ts         — REST plugin
│   │   ├── graphql.ts      — GraphQL plugin
│   │   ├── grpc.ts         — gRPC plugin
│   │   └── soap.ts         — SOAP plugin
│   ├── harness.ts          — SwagenHarness: owns Agent, Skills, Storage, Cache
│   ├── storage.ts          — IStorage: MemoryStorage, FileStorage, RedisStorage
│   ├── cache.ts            — ICache: MemoryCache (LRU), FileCache, NoopCache
│   ├── context.ts          — project context detection
│   ├── indexer.ts          — codebase indexing
│   ├── orchestrator.ts     — parallel agent execution
│   ├── utils/
│   │   ├── fmt.ts          — ANSI colour, spinner, parseArgs, dedent (no deps)
│   │   └── errors.ts       — error helpers
│   ├── cli.ts              — CLI: 11 commands (generate, run, validate, …)
│   ├── bot/
│   │   ├── cloudflare.ts   — Cloudflare bot
│   │   ├── github.ts       — GitHub Actions bot + GitHub App webhook server
│   │   └── specs.ts        — spec-file detection utility
│   └── index.ts            — public API surface
├── skills/                 — standalone SKILL.md files for AI coding agents
│   ├── README.md
│   ├── rest/SKILL.md
│   ├── graphql/SKILL.md
│   ├── grpc/SKILL.md
│   └── soap/SKILL.md
├── tests/
│   ├── unit/
│   │   ├── cache.test.ts   — FileCache, factory edge cases
│   │   ├── cli.test.ts     — CLI helpers, config validation, error helpers
│   │   ├── context.test.ts — detectContext
│   │   ├── indexer.test.ts — buildIndex, searchIndex
│   │   ├── orchestrator.test.ts — runParallel, splitAndGenerate
│   │   ├── postprocess.test.ts — dedup, strip unused imports
│   │   ├── prompts.test.ts — prompt templates
│   │   ├── skills.test.ts  — SkillManager, built-in skills
│   │   ├── spec.test.ts    — analyzeSpec, generateTestFiles
│   │   ├── state.test.ts   — saveRunRecord, listRunRecords, getLastRun
│   │   ├── storage.test.ts — MemoryStorage, FileStorage, RedisStorage
│   │   ├── tools.test.ts   — createTools shape + execution
│   │   └── utils.test.ts   — parseArgs, MemoryCache, cacheKey, withCache
│   └── integration/
│       └── harness.test.ts — SwagenHarness session lifecycle + full pipeline
├── docs/
│   ├── github-app.md       — GitHub App registration + configuration guide
│   ├── architecture.md     — Architecture overview
│   ├── bots.md             — Bot deployment (Actions, Cloudflare, local testing)
│   └── skills.md           — Skills & hooks extension system
├── examples/
│   ├── generate.ts         — Minimal harness → runToCompletion
│   ├── programmatic.ts     — Streaming agent events
│   ├── custom-tools.ts     — Extending with custom AgentTools
│   ├── session-resume.ts   — Session lifecycle (create, resume, list)
│   ├── orchestrator.ts     — Parallel multi-agent execution
│   ├── storage.ts          — Storage backends (memory, file)
│   ├── hooks.ts            — Hook pipeline (before/after generate)
│   └── cache.ts            — Cache backends and statistics
├── .github/
│   ├── workflows/
│   │   ├── ci.yml          — CI: lint, typecheck, test, agentic gen
│   │   ├── autofix.yml     — automated lint fixes
│   │   ├── fallow.yml      — dead-code analysis
│   │   ├── pr-review.yml   — PR review bot
│   │   └── publish.yml     — npm publish
│   └── apps/
│       └── manifest.json   — GitHub App manifest for one-click install
├── swagen.config.ts        — Example config file
├── package.json
└── tsconfig.json
```

---

## Installation

```bash
# Add to a project
bun add swagen

# Global CLI
bun add -g swagen

# From source
git clone https://github.com/rjoydip/swagen
cd swagen
bun install
```

Set your AI provider key (must match `aiProvider` in config):

```bash
# For provider "anthropic":
export ANTHROPIC_API_KEY=sk-ant-...
# For provider "opencode":
export OPENCODE_API_KEY=sk-...
# For provider "openai":
export OPENAI_API_KEY=sk-...
```

---

## Quick start

```bash
# 1. Create config
swagen init

# 2. Generate tests from a local spec
swagen generate openapi.yaml

# 3. Generate from a URL
swagen generate https://petstore3.swagger.io/api/v3/openapi.json

# 4. Preview without writing anything
swagen generate openapi.yaml --dry-run

# 5. Generate + immediately run tests
swagen run openapi.yaml

# 6. Validate a spec without generating
swagen validate openapi.yaml

# 7. Check last run summary
swagen status

# 8. List stored sessions
swagen sessions

# 9. Resume a session (continue agent conversation)
swagen resume <session-id> --prompt "Also generate tests for the /admin endpoints"

# 10. Cache management
swagen cache          # show stats
swagen cache clear    # clear all cached entries
```

---

## CLI reference

```sh
swagen generate <spec>      Agentic test generation
  --out-dir, -o <dir>         Output directory        [default: __tests__/api]
  --runner, -r <bun|vitest>   Test runner             [default: bun]
  --base-url <url>            API base URL
  --include-tags <tags>       Comma-separated tags to include
  --exclude-tags <tags>       Comma-separated tags to exclude
  --skip <ids>                Comma-separated operationIds to skip
  --dry-run                   Print without writing
  --provider <name>           AI provider             [required]
  --model <id>                Model id                [required]
  --storage <backend>         memory|file|redis
  --verbose                   Stream all agent events

swagen run <spec>            Generate + run tests
swagen validate <spec>       Validate spec only
swagen resume <id>           Resume a session
  --prompt, -p <text>         Follow-up instruction (required)

swagen sessions              List stored sessions
swagen status                Last run summary
swagen cache [clear]         Cache stats or clear
swagen init                  Create swagen.config.ts
swagen help                  Show this help
```

---

## Examples

Each example in [`examples/`](examples/) is self-contained and demonstrates one distinct feature. Run any with `bun run examples/<name>.ts`.

| Example                                           | What it shows                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| [`generate.ts`](examples/generate.ts)             | Minimal harness setup → `runToCompletion` — the Hello World of swagen    |
| [`programmatic.ts`](examples/programmatic.ts)     | Streaming agent events (tool calls, text deltas) via async generator     |
| [`custom-tools.ts`](examples/custom-tools.ts)     | Extending swagen with a custom `AgentTool` + direct `Agent` usage        |
| [`session-resume.ts`](examples/session-resume.ts) | Session lifecycle: create, persist, resume, list, delete                 |
| [`orchestrator.ts`](examples/orchestrator.ts)     | Parallel multi-agent execution with `runParallel` and `splitAndGenerate` |
| [`storage.ts`](examples/storage.ts)               | Storage backends: `MemoryStorage`, `FileStorage`, session CRUD           |
| [`hooks.ts`](examples/hooks.ts)                   | Hook pipeline: `applyBeforeGenerateHooks` / `applyAfterGenerateHooks`    |
| [`cache.ts`](examples/cache.ts)                   | Cache backends (memory, file, noop), key generation, `withCache` wrapper |

### Quick reference

```typescript
import {
  SwagenHarness, // orchestrator, owns agent + storage + cache
  resolveConfig, // merge defaults with overrides
  createTools, // build toolset for direct Agent usage
  MemoryStorage, // in-memory session store
  FileStorage, // disk-backed session store
  MemoryCache, // LRU cache (in-memory)
  FileCache, // disk-backed cache
  NoopCache, // no-op cache
  newSession, // create a Session object
  loadSpec, // load + dereference an OpenAPI spec
  analyzeSpec, // extract filtered endpoints from spec
  generateTestFiles, // emit Bun/Vitest test source
  runParallel, // run multiple agent tasks concurrently
  splitAndGenerate, // split spec endpoints across N agents
  detectContext, // detect project context (runner, deps, files)
  buildIndex, // build a searchable codebase index
  searchIndex, // search indexed files
} from "swagen";
```

---

## Configuration (`swagen.config.ts`)

```typescript
import type { SwagenConfig } from "swagen";

const config: Partial<SwagenConfig> = {
  // API base URL — can reference env vars
  baseUrl: `process.env.API_BASE_URL ?? "http://localhost:3000"`,

  // Test runner
  runner: "bun", // 'bun' | 'vitest'

  // Output
  outDir: "__tests__/api",

  // Auth
  auth: {
    type: "bearer", // 'none' | 'bearer' | 'apiKey' | 'basic'
    envVar: "API_TOKEN",
  },

  // Filtering
  includeTags: [],
  excludeTags: ["internal", "deprecated"],
  skipOperations: [],

  // Scaffolding
  emitFixtures: true,
  emitSetup: true,

  // Assertions
  assertStatusCodes: true,
  assertSchemas: false,

  testTimeoutMs: 10_000,
  dryRun: false,

  // REQUIRED: set your AI provider and model
  aiProvider: "opencode",
  aiModel: "big-pickle",

  // Session storage
  storage: {
    backend: "file", // 'memory' | 'file' | 'redis'
    dir: ".swagen/sessions", // file backend
    // redisUrl: 'https://...', // redis backend
  },

  // Tool result caching
  cache: {
    strategy: "memory", // 'none' | 'memory' | 'file'
    ttlMs: 300_000, // 5 minutes
    maxEntries: 256, // memory LRU limit
  },

  // User-defined skills (optional)
  skills: [{ from: "./skills/my-custom-skill.ts" }],
};

export default config;
```

---

## Agent tools

| Tool                | Cached | Description                               |
| ------------------- | ------ | ----------------------------------------- |
| `validate_spec`     | no     | Validate spec, report errors              |
| `load_spec`         | ✓      | Dereference spec from file or URL         |
| `analyze_endpoints` | ✓      | Extract + filter endpoint list            |
| `generate_tests`    | ✓      | Build Bun/Vitest test source              |
| `write_files`       | no     | Write to disk (protected files safe)      |
| `run_tests`         | no     | Execute tests, return pass/fail           |
| `read_file`         | no     | Read any file for context                 |
| `search_files`      | no     | Regex search across project files         |
| `replace_in_files`  | no     | String/regex replace (dry-run by default) |
| `get_run_history`   | no     | Audit trail from `.swagen/runs/`          |
| `cache_stats`       | no     | Hit/miss statistics                       |
| `task_complete`     | no     | Signal agent completion with summary      |

Active skills can register **additional tools** at runtime — see [`docs/skills.md`](docs/skills.md).

---

## Testing

```bash
# All tests
bun test

# Unit only (no LLM needed)
bun test:unit

# Integration (requires ANTHROPIC_API_KEY)
bun test:int

# Watch mode
bun test:watch
```

Integration tests that require a real LLM key are automatically skipped when `ANTHROPIC_API_KEY` is not set.

---

## GitHub integration

See [`docs/github-app.md`](docs/github-app.md) for:

- GitHub Actions bot setup (no App registration needed)
- GitHub App registration (for webhook-driven automation)
- PR comment format
- Auto-commit configuration
- Security notes

## Bot deployment

See [`docs/bots.md`](docs/bots.md) for:

- **GitHub Actions bot** — CI-integrated auto generation on spec changes
- **Cloudflare Worker** — serverless webhook receiver that dispatches GitHub Actions
- Local bot testing with `APP_MODE`

---

## Architecture

```sh
CLI / programmatic call
        │
        ▼
  SwagenHarness
  ├── SkillManager             — resolves active skills at run start
  │     active skills → system prompt fragments appended to BASE
  │                  → extra tools merged with core tools
  │                  → hooks available for programmatic pipeline
  ├── IStorage (memory / file / redis)   — session + message history
  ├── ICache   (memory LRU / file)       — tool result cache
  └── agentLoop (@earendil-works/pi-agent-core)
        ├── model via getModel() (@earendil-works/pi-ai)
        ├── sessionId → provider-side caching
        └── AgentTools (TypeBox-validated)
              ├── validate_spec  → swagger-parser
              ├── load_spec      → swagger-parser + cache
              ├── analyze_endpoints → analyzeSpec() + cache
              ├── generate_tests → generateTestFiles() + cache
              ├── write_files    → Bun.write()
              ├── run_tests      → Bun.spawn()
              ├── read_file      → Bun.file()
              ├── search_files   → regex scan
              ├── replace_in_files → string/regex replace
              ├── get_run_history → .swagen/runs/
              └── cache_stats    → ICache.stats()
```

Built-in and user skills add prompt fragments, tools, and hooks — see [`docs/skills.md`](docs/skills.md).

---

## License

MIT
