# Codebase-Aware Test Generation — Extension Plan

## Overview

Extend swagen-agentic to support test generation for existing codebases by introducing code discovery and analysis capabilities. This is a parallel mode to the existing spec-centric pipeline.

---

## Mode Design

Two distinct modes, toggled by CLI flag:

- **`--spec <path>`** (default): Current spec-centric pipeline — unchanged
- **`--existing`**: New codebase pipeline — discover, analyze, augment

A third combo track (`--spec + --existing`) is a future possibility but out of scope.

---

## Scope

- **Parsing**: Regex-based extraction first (matches project style, zero deps); TypeScript compiler API as future option
- **Test types**: Unit + API integration tests
- **Augmentation**: Smart merge — match by resource/function name, insert into existing describe blocks, create new blocks for uncovered entities
- **Dependencies**: Zero new runtime dependencies (Bun built-ins, node:fs, node:path, existing interfaces)

---

## Architecture

### Module layout

```sh
src/
  discovery/          — Code discovery pipeline (Phase 2)
    index.ts           — discoverCodebase(): walk → classify → extract → return CodebaseAnalysis
    walker.ts          — Recursive scan with skip rules
    extractor.ts       — Regex-based extraction of functions, classes, exports, decorators
    framework.ts       — Detect Express/Fastify/NestJS/Hono from source patterns
    exporter.ts        — Format discovery for agent prompt consumption (formatDiscoveryPrompt, formatEntitySummary)
  coverage/           — Coverage detection pipeline (Phase 4)
    index.ts           — analyzeCoverage(), generateCoverageReport(), enrichAnalysisWithCoverage()
    scanner.ts         — Scan test files for references to source entities
    reporter.ts        — Build/format coverage reports, group gaps by file
  core/
    augmenter.ts       — Test generation + smart merge engine (Phase 5)
    types.ts           — All domain types (Phase 1)
    prompts.ts         — Codebase-specific prompts
  tools/
    index.ts           — 16 AgentTools (11 existing + 5 codebase: discover_code, analyze_entity, check_coverage, read_existing_tests, augment_tests)
  skills/
    codebase.ts        — Codebase skill with system prompt for codebase mode
  cli.ts               — 14 commands (+ discover, coverage, analyze; generate --existing)
  context.ts           — API framework + module system detection
  indexer.ts           — Entity/endpoint storage in index
tests/
  unit/                — 14 unit test files
  integration/         — augment-existing.test.ts (end-to-end pipeline test)
```

### New types (`src/core/types.ts`)

| Type               | Purpose                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| `SourceEntity`     | Function/class/method/export metadata (name, file, line, signature, async, exported, decorated, jsDoc) |
| `CodeDependency`   | Import relationship between files (source → target)                                                    |
| `CoverageGap`      | Entity + coverage level (`none`/`partial`/`low`/`full`) + description + existing test refs             |
| `CodebaseAnalysis` | Aggregate of entities, dependencies, gaps, entry points, API handlers                                  |
| `AugmentOptions`   | Strategy (smart-merge/append/separate), preserve-existing, convention-matching                         |

### Extended types

- `SwagenConfig.mode: "spec" | "codebase"`, `discoveryPath`, `augment`, `coverageThreshold`, `augmentStrategy`
- `ProjectContext.apiFrameworks`, `moduleSystem: "esm" | "cjs"`, `sourceEntityCount`
- `SkillContext.codebaseAnalysis?: CodebaseAnalysis`

---

## CLI Commands

| Command               | Args       | Description                                   |
| --------------------- | ---------- | --------------------------------------------- |
| `discover`            | `[dir]`    | Print project structure (entities, framework) |
| `coverage`            | `[dir]`    | Print coverage gap report                     |
| `analyze`             | `<entity>` | Deep analysis of specific entity              |
| `generate --existing` | —          | Switch to codebase mode                       |

---

## Agent Tools (5 additions)

| Tool                  | Cached | Description                                                  |
| --------------------- | ------ | ------------------------------------------------------------ |
| `discover_code`       | Yes    | Walk project, return entity summary                          |
| `analyze_entity`      | Yes    | Deep-dive on a function/class: body, deps, callers, coverage |
| `check_coverage`      | Yes    | Return `CoverageGap[]`                                       |
| `read_existing_tests` | No     | Parse and return existing test structure                     |
| `augment_tests`       | Yes    | Generate + smart-merge test cases into existing files        |

---

## Key Design Decisions

1. **Regex-based extraction first**: matches existing project style, zero deps, works for ~90% of cases
2. **`path.join` + absolute paths on Windows**: Bun's `path.join` concatenates absolute paths (POSIX behavior). `isAbsolute()` check added to `mergeTestFiles()` and `discoverCodebase()` for correctness
3. **Smart-merge as default augmentation strategy**: matches test blocks by normalized name, inserts new cases, creates new describe blocks for uncovered entities
4. **Coverage scanner only returns non-fully-covered entities**: Entities with `coverage: "full"` are excluded from gap reporting

## Framework Detection

| Framework     | Import Patterns                                | Code Patterns                                                    |
| ------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **express**   | `from "express"`, `require("express")`         | `app.get/post/put/patch/delete/use(`, `Router()`                 |
| **fastify**   | `from "fastify"`, `require("fastify")`         | `fastify.get/post/put/patch/delete(`                             |
| **nestjs**    | `from "@nestjs/common"`, `from "@nestjs/core"` | `@Controller(`, `@Module(`, `@Injectable()`                      |
| **hono**      | `from "hono"`, `from "hono/..."`               | `new Hono()`, `app.get/post/put/patch/delete(`                   |
| **nextjs**    | `from "next/..."`                              | `export function GET/POST/PUT/PATCH/DELETE`                      |
| **koa**       | `from "koa"`, `require("koa")`                 | `new Koa()`, `.use(`, `ctx.body/status/request/response`         |
| **elysia**    | `from "elysia"`, `require("elysia")`           | `new Elysia()`, `app.get/post/put/patch/delete/listen(`          |
| **node:http** | `from "node:http"`, `from "http"`              | `createServer(`, `.listen(`, `IncomingMessage`, `ServerResponse` |

Scoring: imports = 2 points, code patterns = 3 points. Highest score wins.

## Test Runner Detection

`parseTestStructure()` detects conventions from test file content:

| Convention         | Detection                                                                     |
| ------------------ | ----------------------------------------------------------------------------- |
| **runner**         | `from "vitest"` / `from 'vitest'` → `"vitest"`, otherwise defaults to `"bun"` |
| **assertionStyle** | `assert.` present → `"assert"`, otherwise `"expect"`                          |
| **usesDescribe**   | any `describe(` block found                                                   |
| **usesAsyncAwait** | `async ` or `await ` present in content                                       |

## Route Detection Patterns

| Pattern                     | Example                                                       |
| --------------------------- | ------------------------------------------------------------- |
| Express/Fastify/Hono/Elysia | `app.get("/path", ...)`, `router.get(...)`, `server.get(...)` |
| NestJS decorators           | `@Get("/path")`, `@Post("/path")`                             |
| Next.js handlers            | `export async function GET(req)`                              |
| node:http inline            | `if (req.method === "GET")`                                   |

---

## Dead Code Removed

The following modules/functions were removed during cleanup:

- **`src/analysis/`** (entire module): dependency graph, complexity metrics, API handler mapping — never imported anywhere
- **`src/coverage/instrument.ts`**: `findCoverageOutput`, `parseLcov`, `tryInstrumentCoverage` — never called
- **`discoverCodebaseCached()`**: wrapper that duplicated `discoverCodebase` — never called
- **`formatCoverageGaps()`**: never imported outside definition site
