# Agent Skills

Standalone `SKILL.md` files for AI coding agents. Copy or reference these from any AI tool:

| Skill    | File                                   | Activates On                                            |
| -------- | -------------------------------------- | ------------------------------------------------------- |
| REST API | [rest/SKILL.md](./rest/SKILL.md)       | RESTful endpoints, auth schemes, pagination, 4xx errors |
| GraphQL  | [graphql/SKILL.md](./graphql/SKILL.md) | `/graphql` paths, graphql tags, query/mutation params   |
| gRPC     | [grpc/SKILL.md](./grpc/SKILL.md)       | gRPC/RPC paths, proto tags, service patterns            |
| SOAP     | [soap/SKILL.md](./soap/SKILL.md)       | SOAP/WSDL paths, XML content types, wsdl tags           |

## Integration

**Cursor**: `cp skills/*/SKILL.md .cursor/rules/*.mdc`  
**Claude Code**: Reference in `CLAUDE.md`  
**opencode**: `cp skills/*/SKILL.md .opencode/skills/`  
**Gemini**: `cp skills/*/SKILL.md .gemini/`  
**Copilot**: Reference in `.github/copilot-instructions.md`

Files follow the `SKILL.md` convention with YAML frontmatter — compatible with all major AI coding tools.
