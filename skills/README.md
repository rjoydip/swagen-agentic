# Agent Skills

Standalone `SKILL.md` files for AI coding agents. Copy or reference these from any AI tool:

| Skill    | File                                                 | Activates On                                                 |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| REST API | [swagen-rest/SKILL.md](./swagen-rest/SKILL.md)       | RESTful endpoints, auth schemes, pagination, 4xx errors      |
| GraphQL  | [swagen-graphql/SKILL.md](./swagen-graphql/SKILL.md) | `/swagen-graphql` paths, graphql tags, query/mutation params |
| gRPC     | [swagen-grpc/SKILL.md](./swagen-grpc/SKILL.md)       | gRPC/RPC paths, proto tags, service patterns                 |
| SOAP     | [swagen-soap/SKILL.md](./swagen-soap/SKILL.md)       | SOAP/WSDL paths, XML content types, wsdl tags                |

## Install via `npx skills`

The [open agent skills CLI](https://npmx.dev/package/skills) (`vercel-skills`) installs these skills into **70+ coding agents** automatically:

```bash
# Install all swagen skills (interactive agent selection)
npx skills add rjoydip/swagen-agentic --all

# Install to specific agents
npx skills add rjoydip/swagen-agentic --all -a claude-code -a opencode -a cursor

# Install specific skills to all agents
npx skills add rjoydip/swagen-agentic --skill rest-api --skill graphql-api --agent '*'

# List available skills before installing
npx skills add rjoydip/swagen-agentic --list

# Project scope (default) — committed with repo, shared with team
npx skills add rjoydip/swagen-agentic --skill rest-api -a claude-code

# Global scope — available across all projects
npx skills add rjoydip/swagen-agentic --skill rest-api -g -a claude-code

# Non-interactive (CI/CD friendly)
npx skills add rjoydip/swagen-agentic --skill rest-api -g -a claude-code -y
```

Supported agents include: OpenCode, Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Cline, Roo Code, Windsurf, Trae, and [60+ more](https://npmx.dev/package/skills).

## Manual Integration

**Cursor**: `cp skills/*/SKILL.md .cursor/rules/*.mdc`  
**Claude Code**: Reference in `CLAUDE.md`  
**opencode**: `cp skills/*/SKILL.md .opencode/skills/`  
**Gemini**: `cp skills/*/SKILL.md .gemini/`  
**Copilot**: Reference in `.github/copilot-instructions.md`

Files follow the `SKILL.md` convention with YAML frontmatter — compatible with all major AI coding tools.
