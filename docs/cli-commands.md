# CLI Commands Reference

Complete reference for all `swagen` CLI commands.

## Usage

```bash
swagen <command> [arguments] [options]
```

## Global Options

| Option            | Description             |
| ----------------- | ----------------------- |
| `--version`, `-v` | Show version number     |
| `--help`, `-h`    | Show help for a command |

---

## Commands

### `generate`

Agentic test generation from a spec file or URL.

```bash
swagen generate <spec> [options]
```

**Arguments:**

| Argument | Required | Description                                                            |
| -------- | -------- | ---------------------------------------------------------------------- |
| `<spec>` | Yes\*    | Path or URL to OpenAPI/Swagger spec (\*not required with `--existing`) |

**Options:**

| Flag                     | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `--existing`             | Enable codebase mode (discover existing code instead of spec) |
| `--provider <name>`      | AI provider (e.g. anthropic, openai, opencode)                |
| `--model <id>`           | AI model id                                                   |
| `--out-dir, -o <dir>`    | Output directory for generated tests                          |
| `--runner, -r <name>`    | Test runner (`bun` or `vitest`)                               |
| `--dry-run`              | Preview generated files without writing them                  |
| `--parallel <N>`         | Run N parallel agents                                         |
| `--verbose`              | Stream all agent events                                       |
| `--augment`              | Augment existing test files                                   |
| `--augment-strategy <s>` | Augmentation strategy (`smart-merge`, `append`, `separate`)   |

**Examples:**

```bash
# Generate tests from OpenAPI spec
swagen generate openapi.yaml

# Generate tests from URL
swagen generate https://api.example.com/swagger.json

# Generate tests for existing codebase
swagen generate --existing src/

# Generate tests with specific provider and model
swagen generate openapi.yaml --provider anthropic --model claude-sonnet-4-20250514

# Dry run (preview without writing)
swagen generate openapi.yaml --dry-run

# Parallel generation
swagen generate openapi.yaml --parallel 4
```

---

### `run`

Generate and then execute tests in a single pass.

```bash
swagen run <spec> [options]
```

Accepts the same flags as `generate`.

**Examples:**

```bash
# Generate and run tests
swagen run openapi.yaml

# Generate and run with codebase mode
swagen run --existing src/
```

---

### `validate`

Validate an OpenAPI spec without generating tests.

```bash
swagen validate <spec>
```

**Examples:**

```bash
swagen validate openapi.yaml
swagen validate https://api.example.com/swagger.json
```

---

### `resume`

Resume a previous session with a follow-up prompt.

```bash
swagen resume <id> --prompt <text> [options]
```

**Arguments:**

| Argument | Required | Description          |
| -------- | -------- | -------------------- |
| `<id>`   | Yes      | Session ID to resume |

**Options:**

| Flag                  | Description                      |
| --------------------- | -------------------------------- |
| `--prompt, -p <text>` | Follow-up instruction (required) |
| `--provider <name>`   | AI provider                      |
| `--model <id>`        | Model id                         |

**Examples:**

```bash
swagen resume sess_abc123 --prompt "Add tests for admin endpoints"
swagen resume sess_abc123 -p "Cover error cases" --model claude-sonnet-4-20250514
```

---

### `sessions`

List stored agent sessions.

```bash
swagen sessions
```

**Output:**

```
Sessions (3):
  sess_abc123  2025-06-09T10:30:00Z  openapi.yaml
  sess_def456  2025-06-08T15:45:00Z  swagger.json
  sess_ghi789  2025-06-07T09:15:00Z  codebase
```

---

### `status`

Show last generation run summary.

```bash
swagen status
```

**Output:**

```
Last run:
  ID:        run_xyz789
  Timestamp: 2025-06-09T10:30:00Z
  Endpoints: 12
  Files:     4

Agent summary:
  Generated tests for 12 endpoints across 4 files...
```

---

### `cache`

Show cache stats or clear the cache.

```bash
swagen cache [clear]
```

**Subcommands:**

| Command              | Description               |
| -------------------- | ------------------------- |
| `swagen cache`       | Show cache hit/miss stats |
| `swagen cache clear` | Clear all cached entries  |

**Output:**

```
Cache stats:
  Entries:   45
  Hits:      120
  Misses:    15
  Evictions: 2
```

---

### `index`

Build or refresh the codebase index.

```bash
swagen index [dir]
```

**Arguments:**

| Argument | Required | Description                                        |
| -------- | -------- | -------------------------------------------------- |
| `<dir>`  | No       | Directory to index (defaults to current directory) |

**Examples:**

```bash
swagen index          # Index current directory
swagen index src/     # Index specific directory
```

**Output:**

```
Indexed 156 files (23 tests, 2 specs)
```

---

### `init`

Create a starter `swagen.config.ts`.

```bash
swagen init
```

Creates a `swagen.config.ts` file in the current directory with default configuration.

---

### `bench`

Benchmark spec loading, analysis, and codegen (no agent call).

```bash
swagen bench <spec> [options]
```

**Arguments:**

| Argument | Required | Description                         |
| -------- | -------- | ----------------------------------- |
| `<spec>` | Yes      | Path or URL to OpenAPI/Swagger spec |

**Options:**

| Flag               | Description                           |
| ------------------ | ------------------------------------- |
| `--iterations <N>` | Number of benchmark runs (default: 3) |

**Examples:**

```bash
swagen bench openapi.yaml
swagen bench openapi.yaml --iterations 10
```

**Output:**

```
Benchmarking openapi.yaml
Iterations: 3

  Load spec:    45.2ms (min 42.1ms / max 48.3ms)
  Analyze:      12.8ms (min 11.5ms / max 14.2ms)
  Codegen:      28.4ms (min 26.1ms / max 30.7ms)

  Paths: 8, Endpoints: 24
  (Benchmarks load, analysis, and codegen only — no agent call)
```

---

### `mcp`

Start the MCP server (stdio or HTTP mode).

```bash
swagen mcp [options]
```

**Options:**

| Flag               | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `--stdio`          | Use stdio transport (default)                          |
| `--port <number>`  | HTTP port (default: 3000)                              |
| `--token <value>`  | Bearer token for HTTP auth (auto-generated if omitted) |
| `--generate-token` | Generate a bearer token and exit                       |

**Examples:**

```bash
# Start stdio MCP server for local clients
swagen mcp --stdio

# Start HTTP MCP server with auth
swagen mcp --port 3000 --token sk-secret

# Generate a new bearer token
swagen mcp --generate-token
```

---

### `discover`

Discover and display project code structure.

```bash
swagen discover [dir]
```

**Arguments:**

| Argument | Required | Description                                           |
| -------- | -------- | ----------------------------------------------------- |
| `<dir>`  | No       | Directory to discover (defaults to current directory) |

**Examples:**

```bash
swagen discover          # Discover current directory
swagen discover src/     # Discover specific directory
```

---

### `coverage`

Show existing test coverage gaps.

```bash
swagen coverage [dir]
```

**Arguments:**

| Argument | Required | Description                                          |
| -------- | -------- | ---------------------------------------------------- |
| `<dir>`  | No       | Directory to analyze (defaults to current directory) |

**Examples:**

```bash
swagen coverage          # Analyze current directory
swagen coverage src/     # Analyze specific directory
```

---

### `analyze`

Deep analysis of a code entity.

```bash
swagen analyze <entity>
```

**Arguments:**

| Argument   | Required | Description                   |
| ---------- | -------- | ----------------------------- |
| `<entity>` | Yes      | Name of the entity to analyze |

**Examples:**

```bash
swagen analyze UserService
swagen analyze authenticate
```

**Output:**

```
function: authenticate
  File:     src/auth.ts:42
  Exported: yes
  Async:    yes
  Signature: (req: Request, res: Response) => Promise<void>
  Coverage: partial — missing error case tests
  Tests referencing: auth.test.ts, integration.test.ts
```

---

### `help`

Show help information.

```bash
swagen help              # Show general help
swagen help <command>    # Show help for specific command
```

**Examples:**

```bash
swagen help generate
swagen help mcp
```

---

## Configuration File

Create a `swagen.config.ts` in your project root:

```typescript
import { defineConfig } from "swagen";

export default defineConfig({
  outDir: "tests/api",
  runner: "bun",
  baseUrl: "http://localhost:3000",
  dryRun: false,
  aiProvider: "opencode",
  aiModel: "big-pickle",
});
```

## Environment Variables

See [environment-variables.md](./environment-variables.md) for complete reference.

---

_Created: 2025-06-09_
