# swagen — AI Development Context

## Project Structure

```sh
src/
  index.ts              — Public API barrel exports
  cli.ts                — CLI entry point (14 commands: discover, coverage, analyze, generate --existing)
  harness.ts            — SwagenHarness orchestrator
  cache.ts              — MemoryCache, FileCache, NoopCache
  storage.ts            — MemoryStorage, FileStorage, RedisStorage
  context.ts            — Project context detection (API frameworks, module system)
  indexer.ts            — Codebase indexing (entity/endpoint storage)
  orchestrator.ts       — Parallel agent execution
  core/                 — spec, codegen, config, types, schema, prompts, postprocess, augmenter
  discovery/            — walker, extractor, framework detector, exporter
  coverage/             — scanner, reporter
  skills/               — manager, rest, graphql, grpc, soap, codebase (flat .ts files)
  tools/                — index (16 AgentTools), state (run records)
  bot/                  — cloudflare, github, specs
  utils/                — errors, fmt
tests/                  — 17 test files, 308 tests (unit + integration)
```

## Key Conventions

- TypeScript strict mode (exactOptionalPropertyTypes, noUncheckedIndexedAccess)
- Zero external CLI deps (native ANSI, spinner, arg parser)
- AgentTool uses `any` generics with runtime param casting
- All tools return `ok({...})` JSON or throw Error
- No `node_modules/` or `.swagen/` in indexing

## Build & Test

```bash
bun tsc --noEmit   # typecheck (zero errors)
bun test           # 308 tests
bunx oxlint src/   # lint
```

## Scripts

| Script              | Purpose            |
| ------------------- | ------------------ |
| `bun start`         | Run CLI            |
| `bun test`          | All tests          |
| `bun run lint`      | Oxlint             |
| `bun run typecheck` | tsc                |
| `bun run bot`       | GitHub Actions bot |
| `bun run changelog` | Generate changelog |
