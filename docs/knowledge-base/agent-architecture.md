# Agent Architecture

## Overview

swagen uses `@earendil-works/pi-agent-core` for its agent loop. The agent receives a
system prompt describing the task and tools, then iteratively decides which tools to call,
processes results, and continues until the task is complete.

## Layers

```sh
CLI (src/cli/index.ts)
  └─ SwagenHarness (src/harness/index.ts)
       ├─ Agent (pi-agent-core)
       ├─ Tools (src/tools/index.ts)
       ├─ Storage (src/storage/index.ts)
       └─ Cache (src/cache/index.ts)
```

### SwagenHarness

The top-level orchestrator. Owns the agent instance, storage backend, and cache backend.
Manages session lifecycle (create, resume, persist). Streams agent events to the caller.

### Agent Loop (`agentLoop`)

The core loop from pi-agent-core. Takes:

- Messages (conversation history + new prompt)
- Context (system prompt + tools)
- Loop config (model, callbacks, execution mode)

Returns an `AsyncGenerator<AgentEvent, ...>` that yields events as the agent thinks
and calls tools.

### Tools

11 tools are registered with the agent. They share an in-memory `RunState` object
that tracks the loaded spec, analyzed endpoints, and generated files across
tool calls within a single run.

## System Prompt Construction

All prompts live in a single shared file at `src/core/prompts.ts`:

| Prompt                              | Used by                  | Description                                                 |
| ----------------------------------- | ------------------------ | ----------------------------------------------------------- |
| `BASE_SYSTEM_PROMPT`                | `SwagenHarness`          | Core system prompt — agent identity, tools, workflow, rules |
| `buildGeneratePrompt()`             | CLI `generate`/`run`     | User prompt with runner, tags, output dir                   |
| `buildValidatePrompt()`             | CLI `validate`           | User prompt for spec validation                             |
| `buildActionsBotPrompt()`           | GitHub Actions bot       | Bot identity + event context                                |
| `buildPushWebhookPrompt()`          | Webhook push handler     | Spec path + repo name                                       |
| `buildPrWebhookPrompt()`            | Webhook PR handler       | PR number + repo name                                       |
| `buildOrchestratorGeneratePrompt()` | Parallel orchestrator    | Single-agent fallback                                       |
| `buildParallelAgentPrompt()`        | Parallel orchestrator    | Per-agent tag assignment                                    |
| `buildSkillSystemPrompt()`          | `SkillManager` / harness | Assembles `BASE` + active skill prompts                     |

The system prompt is assembled at run time:

```sh
                            ┌─ built-in skill prompts
                            │
buildSkillSystemPrompt(BASE, [...skillPrompts])
                            │
                            ▼
                composed system prompt
                            +
         contextPrompt(detectedContext)
                            │
                            ▼
                     agentLoop()
```

The `contextPrompt()` function (from `src/context/index.ts`) adds project-specific
information: test runner, package manager, existing test files, env vars, and
conventions detected from scanning the project.

## Session Resumption

Sessions store the full message history. When resuming (`resume <id> --prompt ...`),
the stored messages are loaded and appended to, enabling multi-turn conversations
with the agent.
