# Tool Design

## Architecture

Each tool is an `AgentTool<any, any>` from `@earendil-works/pi-agent-core`:

```typescript
interface AgentTool<TParams, TDetails> {
  name: string;
  label: string;
  description: string;
  parameters: TSchema; // TypeBox schema
  execute: (id: string, params: TParams, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>;
}
```

## Tool Categories

### Read-only (no side effects)

- `validate_spec` — validates spec without caching
- `load_spec` — loads/dereferences spec, cached
- `analyze_endpoints` — extracts endpoints from loaded spec, cached
- `read_file` — reads any file
- `get_run_history` — lists previous runs
- `cache_stats` — reports cache metrics
- `search_files` — regex search across project files

### Mutating

- `generate_tests` — generates test source (idempotent, cached)
- `write_files` — writes files to disk (with dry-run support)
- `run_tests` — spawns test runner process
- `replace_in_files` — find-and-replace (dry-run by default)

## Caching Strategy

Expensive tools use `withCache()`:

- `load_spec` — cached with TTL (default 5 min)
- `analyze_endpoints` — manual cache key via SHA-256 of args
- `generate_tests` — manual cache key of runner + operation IDs

The cache backend supports `memory` (LRU), `file` (JSON files), or `none`.

## Return Format

All tools return JSON via `ok()`:

```typescript
{ content: [{ type: "text", text: JSON.stringify({ ok: true, ...data }) }], details: {} }
```

Errors are thrown as `Error` — pi-agent-core catches them and reports to the LLM.

## Adding a New Tool

1. Define the tool object with TypeBox schema for parameters
2. Add `label` (required by AgentTool interface)
3. Implement `execute` with `params as { ... }` cast
4. Add to the return array in `createTools()`
5. Update `BASE_SYSTEM_PROMPT` in harness
6. Write unit tests in `tests/unit/tools.test.ts`
