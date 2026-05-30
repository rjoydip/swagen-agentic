# swagen — AI Development Context

## Project Structure

```sh
src/
  index.ts              — Public API barrel exports
  cli.ts                — CLI entry point (11 commands)
  harness.ts            — SwagenHarness orchestrator
  cache.ts              — MemoryCache, FileCache, NoopCache
  storage.ts            — MemoryStorage, FileStorage, RedisStorage
  context.ts            — Project context detection
  indexer.ts            — Codebase indexing
  orchestrator.ts       — Parallel agent execution
  core/                 — spec, codegen, config, types, schema, prompts, postprocess
  skills/               — manager, rest, graphql, grpc, soap (flat .ts files)
  tools/                — index (11 AgentTools), state (run records)
  bot/                  — cloudflare, github, specs
  utils/                — errors, fmt
tests/                  — 13 test files, 243 tests
```

## Key Conventions

- TypeScript strict mode (exactOptionalPropertyTypes, noUncheckedIndexedAccess)
- Zero external CLI deps (native ANSI, spinner, arg parser)
- AgentTool uses `any` generics with runtime param casting
- All tools return `ok({...})` JSON or throw Error
- No `node_modules/` or `.swagen/` in indexing

## Build & Test

```bash
bun tsc --noEmit   # typecheck
bun test           # 243 tests
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
