---
name: swagen-rest
description: REST API testing rules — status code coverage, auth flows, pagination, CRUD lifecycle, negative testing
trigger: RESTful endpoints detected in spec
---

# REST API Skill

Activates when the spec contains standard REST methods, security definitions, pagination params, or 4xx response definitions.

## Detection

- Endpoints using RESTful methods: `get`, `post`, `put`, `patch`, `delete`
- Security requirements on any endpoint
- Pagination params: `page`, `per_page`, `limit`, `offset`, `cursor`, `size`, `page_token`
- 4xx response definitions present
- Tags matching: `auth`, `security`, `login`, `token`, `bearer`

## Rules

1. **Status code coverage** — Test every defined status code for each endpoint.
2. **Auth/security** — For protected endpoints, test missing, expired, and invalid credentials.
3. **Pagination** — Test default page, explicit page, and out-of-range values.
4. **Filtering/Sorting** — Test each filter parameter with edge cases.
5. **CRUD lifecycle** — Full lifecycle test when GET/POST/PUT/PATCH/DELETE exist for the same resource.
6. **Negative testing** — For every 4xx response, write a test that triggers that status.
7. **Request body validation** — Test valid payload, missing required fields, wrong types, extra fields.
8. **Headers** — Include all defined headers; add a test with an invalid header value.
9. **No dead code** — Avoid duplicate tests and unused imports; they are stripped automatically after generation.

## Secrets

- Use environment variable references: `process.env.API_KEY`, `process.env.AUTH_TOKEN`
- Never hardcode credentials.
