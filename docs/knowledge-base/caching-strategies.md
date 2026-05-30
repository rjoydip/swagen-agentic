# Caching Strategies

## Overview

swagen uses a two-tier caching system:

- **Spec loading** — cached to avoid re-parsing the same spec
- **Analysis results** — cached to avoid re-extracting endpoints
- **Generated files** — cached to avoid re-generating test content

## Cache Backends

| Backend  | Storage            | Eviction          | Best for                        |
| -------- | ------------------ | ----------------- | ------------------------------- |
| `memory` | In-process Map     | LRU by maxEntries | CLI sessions, ephemeral runs    |
| `file`   | JSON files on disk | TTL-based         | Long-running agents, GitHub bot |
| `none`   | No-op              | —                 | Debugging, CI with no caching   |

## Configuration

```typescript
cache: {
  strategy: "memory",   // "memory" | "file" | "none"
  ttlMs: 300_000,       // 5 minutes default
  maxEntries: 256,      // LRU limit (memory only)
  dir: ".swagen/cache", // file cache directory
}
```

## Cache Keys

Keys are SHA-256 hashes of `toolName + JSON.stringify(args)`:

```typescript
cacheKey("load_spec", { source: "./openapi.yaml" });
// → "a1b2c3d4e5f6..."
```

## TTL Design

- `load_spec`: 5 min — spec may change during development
- `analyze_endpoints`: 5 min — depends on spec
- `generate_tests`: 5 min — depends on endpoints + config

Longer TTLs are safe because the user can always clear with `swagen cache clear`.
