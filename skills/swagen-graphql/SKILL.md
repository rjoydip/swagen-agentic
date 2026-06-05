---
name: swagen-graphql
description: GraphQL API testing rules — query/mutation/subscription coverage, variable edge cases, fragment reuse
trigger: GraphQL endpoints or schemas detected
---

# GraphQL API Skill

Activates when the spec contains GraphQL-related endpoints or tags.

## Detection

- Endpoint paths containing: `/graphql`, `/gql`
- Tags: `graphql`, `gql`, `hasura`, `apollo`, `relay`, `typegraphql`, `nexus`
- Parameters: `query`, `mutation`, `subscription`, `variables`, `operationName`

## Rules

1. **Operation types** — Structure tests by operation: query, mutation, subscription.
2. **Field selection** — Test with different field selections (scalar, nested, with fragments).
3. **Mutation validation** — Test success, input error, and authorization failure.
4. **Variables** — Always use a variables object; never hardcode inline.
5. **Nullable fields** — Omit optional args, pass null, empty string, max-length values.
6. **List fields** — Test empty array, single element, and multiple elements.
7. **Enums** — Test every value plus an invalid value (expect error).
8. **Subscriptions** — Test connect, receive, disconnect, reconnect.
9. **Error structure** — Assert `message` and `locations`/`extensions`.
10. **Fragments** — Share field selections across tests for the same type.
11. **No dead code** — Avoid duplicate tests and unused imports; they are stripped automatically after generation.
