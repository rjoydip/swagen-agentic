# Test Strategy

## Test Structure

```sh
tests/
  unit/           — pure unit tests (no network, no LLM)
  integration/    — tests that exercise real subsystems
```

## Unit Tests (300+ tests across 14 files)

| File                   | What it tests                                                                                                          | Run without API key? |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `utils.test.ts`        | parseArgs, dedent, slugify, formatDuration, MemoryCache, cacheKey                                                      | ✅                   |
| `spec.test.ts`         | analyzeSpec, generateTestFiles (inline fixtures)                                                                       | ✅                   |
| `storage.test.ts`      | MemoryStorage, FileStorage, newSession                                                                                 | ✅                   |
| `tools.test.ts`        | Tool factory, tool shape, uniqueness, cache_stats                                                                      | ✅                   |
| `context.test.ts`      | Project context detection, contextPrompt                                                                               | ✅                   |
| `indexer.test.ts`      | Codebase indexing, search, test name extraction                                                                        | ✅                   |
| `orchestrator.test.ts` | runParallel task execution                                                                                             | ✅                   |
| `cli.test.ts`          | parseArgs, starterConfig, config resolution                                                                            | ✅                   |
| `discovery.test.ts`    | extractEntities, detectFramework (all 8 frameworks), detectRoutePatterns                                               | ✅                   |
| `coverage.test.ts`     | scanCoverage, buildCoverageReport, formatCoverageReport, groupGapsByFile                                               | ✅                   |
| `augmenter.test.ts`    | parseTestStructure (runner/assertion/async detection), generateUnitTests, mergeTestFiles (smart-merge/append/separate) | ✅                   |

## Integration Tests

| File                       | What it tests                                               | Run without API key? |
| -------------------------- | ----------------------------------------------------------- | -------------------- |
| `harness.test.ts`          | Session CRUD, cache operations                              | ✅ (unit-level)      |
| `harness.test.ts`          | Full pipeline (LLM required)                                | ❌ (skipped)         |
| `augment-existing.test.ts` | Full pipeline: discover → coverage → generate → smart-merge | ✅                   |

## Running Tests

```bash
bun test              # all tests (308 total)
bun test tests/unit/  # unit only
bun test tests/integration/  # integration only
bun test:watch        # watch mode
bun test --coverage   # with coverage
```

## Principles

1. **No network in unit tests** — all fixtures are inline or generated
2. **No LLM in unit tests** — mock or skip tests that need real AI providers
3. **Deterministic** — avoid Date.now(), random UUIDs where possible
4. **Fast** — unit tests complete in < 2s
5. **Isolated** — each test file cleans up after itself
