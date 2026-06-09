# Changelog

## [0.0.0] — 2026-05-29

### New

- **Skills system** — pluggable modules with `Skill`, `SkillContext`, `SkillHook` interfaces
- **SkillManager** — register, resolve, compose system prompts, collect tools and hooks
- **Built-in `rest-advanced` skill** — self-activates on specs with auth/pagination/4xx, injects targeted testing rules
- **Hook pipeline** — `applyBeforeGenerateHooks` / `applyAfterGenerateHooks` on `SwagenHarness` for programmatic orchestration
- **`search_files` tool** — regex search across project files
- **`replace_in_files` tool** — string/regex replace with dry-run default
- **SwagenHarness** — top-level harness owning Agent, Storage, and Cache
- **Session persistence** — memory, file, and Redis (Upstash REST) backends
- **Tool result caching** — memory LRU and file cache with configurable TTL
- **Session resumption** — `swagen resume <id> --prompt "..."` continues agent conversation
- **GitHub App webhook server** — `APP_MODE=webhook` for real-time multi-repo automation
- **`cache_stats` tool** — agent can report hit/miss rates
- **`swagen sessions`** and **`swagen cache`** CLI commands
- Full unit + integration test suite (`bun test`)
- Architecture and GitHub App documentation
- Full agentic rewrite using `@earendil-works/pi-agent-core` `agentLoop`
- 8 typed `AgentTool<T>` definitions with TypeBox schemas (`@earendil-works/pi-ai`)
- `beforeToolCall` / `afterToolCall` hooks for logging
- `sessionId` passed to `agentLoop` for provider-side caching
- Initial release — pipeline-based codegen (no agent loop)

### Changed

- **Webhook server error handling** — distinguishes signature errors (`401`) from handler errors (`500`)
- **PR handler** — skips comment posting when `GH_TOKEN` is not set (no longer crashes)
- `SwagenHarness.run()` logs active/inactive skills at startup
- Removed `chalk`, `commander`, `dedent`, `ora` — replaced with native ANSI + arg parser in `src/utils/fmt.ts`
- Moved all agent logic into `SwagenHarness` (previously split across `SwagenAgent` + `runAgentOnce`)
- Tools now throw on failure (pi-agent-core pattern) rather than returning error content

### Docs

- Added `docs/skills.md` — full skills, hooks, and programmatic pipeline documentation
- Updated `docs/architecture.md` — skills layer in architecture diagram
- Updated `docs/bots.md` — realistic webhook test payloads

### Fixed

- Cache key collisions when different tools receive structurally identical args
- Protected file guard now correctly checks basename, not full path
