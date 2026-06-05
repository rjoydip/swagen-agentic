---
name: swagen-grpc
description: gRPC API testing rules — unary/streaming calls, error code assertions, deadline/metadata, oneof/map/bytes fields
trigger: gRPC service definitions detected
---

# gRPC API Skill

Activates when the spec contains gRPC path/tag patterns.

## Detection

- Endpoint paths containing: `grpc`, `rpc`, `proto`, `protobuf`, `service`
- Tags: `grpc`, `protobuf`, `proto`, `rpc`, `envoy`, `connect`, `buf.build`

## Rules

1. **Call types** — Identify as unary, server-streaming, client-streaming, or bidirectional.
2. **Unary** — Test valid message, missing required fields, wrong types, deadline exceeded.
3. **Server-streaming** — Iterate messages, assert schema, test mid-stream cancellation.
4. **Client-streaming** — Send batch, single message, empty batch; assert response.
5. **Bidirectional** — Simulate conversation; test concurrent messages.
6. **Error codes** — Assert specific codes: `OK=0`, `InvalidArgument=3`, `DeadlineExceeded=4`, `NotFound=5`, `Unauthenticated=16`.
7. **Metadata** — Test custom headers, auth tokens, tracing IDs, deadlines.
8. **Bytes fields** — Test empty, short, and binary payloads.
9. **Map fields** — Test empty map, single entry, multiple entries.
10. **Oneof fields** — Test each variant; verify others are null.
11. **Health check** — Test `grpc.health.v1/Check` first; skip if unavailable.
12. **No dead code** — Avoid duplicate tests and unused imports; they are stripped automatically after generation.
