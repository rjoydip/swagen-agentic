# Agent Skills — Cross-Editor Guide

Standalone `SKILL.md` files that work with any AI coding agent (Cursor, Claude Code, opencode, Gemini, Copilot, Cline, Codex).

## Quick reference

| Skill       | File                      |
| ----------- | ------------------------- |
| REST API    | `skills/rest/SKILL.md`    |
| GraphQL API | `skills/graphql/SKILL.md` |
| gRPC API    | `skills/grpc/SKILL.md`    |
| SOAP API    | `skills/soap/SKILL.md`    |

## Tool-specific setup

### Cursor

Copy to `.cursor/rules/` as `.mdc`:

```bash
cp skills/rest/SKILL.md .cursor/rules/rest-api.mdc
cp skills/graphql/SKILL.md .cursor/rules/graphql-api.mdc
cp skills/grpc/SKILL.md .cursor/rules/grpc-api.mdc
cp skills/soap/SKILL.md .cursor/rules/soap-api.mdc
```

### Claude Code

Reference in `CLAUDE.md`:

```markdown
## Skills

See skills/rest/SKILL.md for REST API testing rules.
See skills/graphql/SKILL.md for GraphQL testing rules.
See skills/grpc/SKILL.md for gRPC testing rules.
See skills/soap/SKILL.md for SOAP testing rules.
```

### opencode

Place in `.opencode/skills/`:

```bash
cp skills/rest/SKILL.md .opencode/skills/rest-api.md
cp skills/graphql/SKILL.md .opencode/skills/graphql-api.md
cp skills/grpc/SKILL.md .opencode/skills/grpc-api.md
cp skills/soap/SKILL.md .opencode/skills/soap-api.md
```

### Gemini Code Assist

```bash
cp skills/rest/SKILL.md .gemini/rest-api.md
cp skills/graphql/SKILL.md .gemini/graphql-api.md
cp skills/grpc/SKILL.md .gemini/grpc-api.md
cp skills/soap/SKILL.md .gemini/soap-api.md
```

### GitHub Copilot / Cline / Codex

Reference in `.github/copilot-instructions.md` or `CLINE.md`:

```markdown
See skills/rest/SKILL.md for REST API testing rules.
See skills/graphql/SKILL.md for GraphQL testing rules.
```

## swagen integration (`src/skills/*.ts`)

Each skill also has a module for swagen's built-in skill system. These self-activate when `SkillManager.resolve()` detects matching endpoint metadata. System prompts live in [`src/core/prompts.ts`](../../src/core/prompts.ts) shared across all skills.

| Skill   | Swagen module           |
| ------- | ----------------------- |
| REST    | `src/skills/rest.ts`    |
| GraphQL | `src/skills/graphql.ts` |
| gRPC    | `src/skills/grpc.ts`    |
| SOAP    | `src/skills/soap.ts`    |

See [docs/skills.md](skills.md) for the full swagen skill system documentation.
