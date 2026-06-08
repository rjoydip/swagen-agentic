# MCP server

swagen implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io) to expose its test-generation capabilities to AI assistants. The MCP server can run over **stdio** (for local tools like Claude Desktop, Cursor, VS Code) or **HTTP with SSE** (for remote clients).

## Quick start

```bash
# stdio (for Claude Desktop, Cursor, VS Code)
bun run src/cli.ts mcp --stdio

# HTTP with auto-generated token (printed to stderr on startup)
bun run src/cli.ts mcp --port 3000

# HTTP with explicit Bearer token
bun run src/cli.ts mcp --port 3000 --token sk-abc123

# Generate a token without starting the server
bun run src/cli.ts mcp --generate-token
```

## 13 MCP tools

### Fine-grained tools

| Tool                   | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `validate_spec`        | Validate an OpenAPI/Swagger spec without generating tests            |
| `analyze_spec`         | Load + analyze an OpenAPI spec, return full endpoint metadata        |
| `generate_tests`       | Generate test source code for analyzed endpoints                     |
| `write_test_files`     | Write generated test files to disk (protected files are safe)        |
| `run_tests`            | Execute generated tests via Bun test or Vitest                       |
| `read_source_file`     | Read any file for context or review                                  |
| `search_project_files` | Search file contents using a regex pattern                           |
| `analyze_codebase`     | Walk the project source and discover entities, exports, API handlers |
| `check_test_coverage`  | Scan existing tests against discovered source entities               |

### High-level convenience tools

| Tool                 | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `generate_from_spec` | Full pipeline: load spec → analyze → generate tests → write → run tests |
| `augment_tests`      | Discover code → analyze coverage → generate + merge new test cases      |
| `coverage_report`    | Discover code → scan tests → produce coverage report with gaps          |

### Utility tool

| Tool              | Description                                      |
| ----------------- | ------------------------------------------------ |
| `get_run_history` | List recent swagen run records for audit context |

## Transport modes

### stdio (default)

Use for local tools like Claude Desktop, Cursor, VS Code, or any MCP client that supports subprocess spawning.

```json
{
  "mcpServers": {
    "swagen": {
      "command": "bun",
      "args": ["run", "src/cli.ts", "mcp", "--stdio"]
    }
  }
}
```

### HTTP with SSE

Use for remote clients or when you need to run the MCP server as a long-lived service.

```bash
swagen mcp --port 3000 --token sk-abc123
```

Bearer token authentication is applied to all HTTP requests. The server uses `Bun.serve()` with `WebStandardStreamableHTTPServerTransport` — no Express or Node.js dependencies.

## Session model

MCP tool calls are scoped to an in-memory session keyed by conversation ID (`sessionId`). The session holds:

- **spec** — the loaded OpenAPI document
- **endpoints** — analyzed endpoint metadata
- **generatedFiles** — test files produced by `generate_tests` or `augment_tests`
- **codebaseAnalysis** — discovered source entities and coverage data

Sessions are created lazily on first tool call and are **not persisted** — MCP is designed for stateless per-call interactions.

## Architecture

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
                     MCP Server (src/mcp/server.ts)
                              │
                    ┌─────────┴──────────┐
                    │                    │
          src/mcp/tools.ts      src/mcp/session.ts
               │                     (in-memory state)
         ┌──────┴──────┐
         │             │
   src/shared/     src/core/
   tool-helpers.ts (spec, codegen,
   (shared logic)  augmenter, etc.)
         │
   src/tools/index.ts
   (AgentTools for
    agent loop)
```

Logic shared between MCP tools and AgentTools lives in `src/shared/tool-helpers.ts`:

| Helper                  | Used by                   | Purpose                                   |
| ----------------------- | ------------------------- | ----------------------------------------- |
| `mapEndpointsToSummary` | analyze_spec MCP + Agent  | Transform endpoints to summary format     |
| `parseTestOutput`       | run_tests MCP + Agent     | Parse test runner stdout/stderr           |
| `runTestRunner`         | run_tests MCP + Agent     | Spawn test runner, return parsed output   |
| `writeGeneratedFiles`   | write_files MCP + Agent   | Write files with protected file guard     |
| `generateAndMergeTests` | augment_tests MCP + Agent | Generate + merge unit test files          |
| `filterEntitiesByNames` | augment_tests MCP + Agent | Filter entities by name list              |
| `searchProjectFiles`    | search_files MCP + Agent  | Scan project files with regex             |
| `discoverAndEnrich`     | coverage MCP + Agent      | Discover code + enrich with test coverage |
| `getTestFilePaths`      | coverage MCP + Agent      | Walk project for test file paths          |
| `isFileProtected`       | write_files MCP + Agent   | Check if file is protected (setup.ts etc) |
| `ensureDirForFile`      | write_files MCP + Agent   | Create parent directories for a file      |
| `PROTECTED_FILES`       | —                         | Set of protected filenames                |

## Configuration

Add `mcp` to your `swagen.config.ts`:

```typescript
const config: Partial<SwagenConfig> = {
  // ... other config ...
  mcp: {
    port: 3000,
    authToken: "sk-my-secret", // optional Bearer token for HTTP transport
  },
};
```

## Running

```bash
# From the swagen directory
bun run src/cli.ts mcp --stdio
bun run src/cli.ts mcp --port 3000 --token sk-abc123

# Or globally installed
swagen mcp --stdio
swagen mcp --port 3000 --token sk-abc123
```

## Testing

```bash
# Unit tests (30 tests — session, auth, tools, server, pipeline)
bun test tests/unit/mcp.test.ts

# Integration tests (12 tests — spawns MCP server over stdio)
bun test tests/integration/mcp.test.ts
```

MCP integration tests spawn the server as a subprocess, send JSON-RPC messages over stdin, and validate responses — no LLM key required.
