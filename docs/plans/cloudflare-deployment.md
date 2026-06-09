# Cloudflare CI/CD Deployment Plan

## Overview

This document outlines the automated deployment strategy for the `swagen-agentic` Cloudflare Worker using GitHub Actions with API Token authentication.

---

## Architecture

```sh
┌─────────────────────────────────────────────────────────────────┐
│                        GitHub Actions                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  push to main ──→ deploy-cloudflare.yml ──→ Production Worker   │
│                                                                 │
│  PR open/sync ──→ deploy-cloudflare-preview.yml                 │
│       │              │                                          │
│       │              └──→ Preview Worker ──→ Comment on PR     │
│       │                                                          │
│  PR close ────→ deploy-cloudflare-preview.yml                   │
│       │              │                                          │
│       │              └──→ Cleanup Preview Worker                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare Workers                          │
├─────────────────────────────────────────────────────────────────┤
│  Production: swagen-agentic.<domain>.workers.dev                │
│  Preview:    swagen-agentic-preview.<domain>.workers.dev        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Current State Analysis

### Cloudflare Worker (`src/bot/cloudflare.ts`)

| Feature                       | Status                  |
| ----------------------------- | ----------------------- |
| Webhook handler               | ✅ Implemented          |
| HMAC signature verification   | ✅ Using Web Crypto API |
| Event routing (push/PR)       | ✅ Implemented          |
| Workflow dispatch             | ✅ Implemented          |
| External service dependencies | ❌ None (pure HTTP)     |

### Dependencies

- **HTTP Client**: Native `fetch()` (Web Crypto API)
- **No database**: Stateless worker
- **No storage**: No R2/D1/KV usage
- **No queues**: No Queue API usage
- **No AI**: No Workers AI usage

### Conclusion

The Cloudflare Worker is **platform agnostic** - it uses only standard Web APIs and does not require any Cloudflare-specific services (D1, R2, KV, Queues, etc.).

---

## Prerequisites (One-time Cloudflare Dashboard Setup)

### 1. Create Cloudflare API Token

1. Navigate to: **Cloudflare Dashboard** → **My Profile** → **API Tokens** → **Create Token**
2. Use the **"Edit Cloudflare Workers"** template (or create custom token with:
   - `Workers Scripts: Edit`
   - `Workers Routes: Edit`
   - `Account Settings: Read`)
3. Under **Account Resources**, select your account
4. Click **Continue to summary** → **Create Token**
5. Copy the token immediately (it won't be shown again)

### 2. Get Cloudflare Account ID

1. Navigate to: **Cloudflare Dashboard** → **Workers & Pages** → **Overview**
2. Your **Account ID** is displayed in the right sidebar
3. Copy the Account ID (format: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

### 3. Configure Custom Domains (Recommended)

1. **Production Domain**: `swagen-agentic.<your-domain>.workers.dev`
   - Workers & Pages → Settings → Custom Domains → Add domain

2. **Preview Domain**: `swagen-agentic-preview.<your-domain>.workers.dev`
   - Same process as above

---

## Required GitHub Repository Secrets

| Secret                  | Description                                        | How to Obtain                                     |
| ----------------------- | -------------------------------------------------- | ------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Cloudflare API token with Workers edit permissions | Cloudflare Dashboard → API Tokens → Create Token  |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID                         | Cloudflare Dashboard → Workers & Pages → Overview |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for webhook verification               | Generate: `openssl rand -hex 32`                  |
| `GITHUB_TOKEN`          | GitHub PAT with `repo` scope                       | GitHub → Settings → Developer Settings → Tokens   |

---

## Updated Configuration Files

### `wrangler.toml` (Actual)

```toml
name = "swagen-agentic"
main = "src/bot/cloudflare.ts"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]

[vars]
# These should be set via wrangler secret:
# GITHUB_WEBHOOK_SECRET — GitHub App webhook secret
# GITHUB_TOKEN — GitHub token with repo scope for dispatching workflows

[env.production]
name = "swagen-agentic"

[env.preview]
name = "swagen-agentic-preview"
```

---

## GitHub Actions Workflows

### Workflow 1: Production Deployment (Implemented)

**File**: `.github/workflows/deploy-cloudflare.yml`

```yaml
name: Deploy to Cloudflare Workers (Production)

on:
  push:
    branches: [main]
    paths:
      - "src/bot/cloudflare.ts"
      - "wrangler.toml"
      - "package.json"
      - "bun.lock"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
      - uses: ./.github/actions/setup-env
      - name: Typecheck
        run: bun tsc --noEmit
      - name: Lint
        run: bun run lint
      - name: Set Worker Secrets
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          echo "${{ secrets.GITHUB_WEBHOOK_SECRET }}" | bunx wrangler secret put GITHUB_WEBHOOK_SECRET --env production --name swagen-agentic
          echo "${{ secrets.GITHUB_TOKEN }}" | bunx wrangler secret put GITHUB_TOKEN --env production --name swagen-agentic
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@3ac3834196d070785a60c8572ea4f50430d75334 # v3.14.0
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          environment: production
          workingDirectory: "."
```

### Workflow 2: PR Preview Deployment (Implemented)

**File**: `.github/workflows/deploy-cloudflare-preview.yml`

```yaml
name: Deploy Preview to Cloudflare Workers

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - "src/bot/cloudflare.ts"
      - "wrangler.toml"
      - "package.json"
      - "bun.lock"

permissions:
  contents: read
  pull-requests: write

jobs:
  deploy-preview:
    name: Deploy Preview
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6.0.3
      - uses: ./.github/actions/setup-env
      - name: Typecheck
        run: bun tsc --noEmit
      - name: Lint
        run: bun run lint
      - name: Set Worker Secrets
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          echo "${{ secrets.GITHUB_WEBHOOK_SECRET }}" | bunx wrangler secret put GITHUB_WEBHOOK_SECRET --env preview --name swagen-agentic-preview
          echo "${{ secrets.GITHUB_TOKEN }}" | bunx wrangler secret put GITHUB_TOKEN --env preview --name swagen-agentic-preview
      - name: Deploy Preview
        id: deploy
        uses: cloudflare/wrangler-action@3ac3834196d070785a60c8572ea4f50430d75334 # v3.14.0
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          environment: preview
          workingDirectory: "."
      - name: Comment Preview URL on PR
        uses: actions/github-script@60a0d83039c74a4aee543508d2ffcb1c3799cdea # v7.0.1
        with:
          script: |
            const url = `https://${{ steps.deploy.outputs.workers-url }}`;
            const body = `🚀 **Preview Deployment Ready**\n\nWorker URL: ${url}\n\n_Deployed from commit ${context.sha.slice(0,7)}_`;

            // Find existing comment
            const { data: comments } = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.payload.pull_request.number,
            });
            const existing = comments.find(c => c.body.includes('🚀 **Preview Deployment Ready**'));

            if (existing) {
              await github.rest.issues.updateComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                comment_id: existing.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.payload.pull_request.number,
                body,
              });
            }
```

---

## Deployment Flow

| Event            | Workflow                        | Environment  | Action                      |
| ---------------- | ------------------------------- | ------------ | --------------------------- |
| Push to `main`   | `deploy-cloudflare.yml`         | `production` | Deploy to production        |
| PR opened/synced | `deploy-cloudflare-preview.yml` | `preview`    | Deploy preview, comment URL |
| PR closed/merged | `deploy-cloudflare-preview.yml` | `preview`    | Delete preview deployment   |

---

## Platform Agnosticism Analysis

### Cloudflare Services Used

| Service         | Status      | Notes                           |
| --------------- | ----------- | ------------------------------- |
| Workers         | ✅ Required | Core platform                   |
| D1              | ❌ Not used | No database needed              |
| R2              | ❌ Not used | No object storage needed        |
| KV              | ❌ Not used | No key-value storage needed     |
| Queues          | ❌ Not used | No async processing needed      |
| Durable Objects | ❌ Not used | No stateful coordination needed |
| Workers AI      | ❌ Not used | No ML inference needed          |
| Vectorize       | ❌ Not used | No vector search needed         |

### Web APIs Used

| API                       | Platform Support                        |
| ------------------------- | --------------------------------------- |
| `fetch()`                 | Universal (Node.js, Bun, Deno, Workers) |
| `crypto.subtle`           | Universal (Web Crypto API)              |
| `TextEncoder/TextDecoder` | Universal                               |

### Conclusion

The Cloudflare Worker is **100% platform agnostic**. It can run on:

- Cloudflare Workers
- Node.js (with `--experimental-global-webcrypto`)
- Bun
- Deno
- Any Web API-compatible runtime

No Cloudflare-specific services need to be created beyond the Worker itself.

---

## Detailed Cloudflare Service Dependency Analysis

### Executive Summary

The swagen-agentic codebase has **minimal Cloudflare dependency**. There is a single Cloudflare Worker entry point (`src/bot/cloudflare.ts`) that acts as a thin webhook relay. The rest of the codebase is entirely platform-agnostic, running on Bun with file-system and in-memory backends. **None** of the seven Cloudflare services (D1, R2, KV, Queues, Durable Objects, Workers AI, Vectorize) are currently used or referenced anywhere in the code.

---

### 1. Cloudflare Worker Entry Point

**File:** `src/bot/cloudflare.ts` (lines 1-137)

| Aspect                   | Detail                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Service used**         | Cloudflare Workers (compute only)                                                                                                                                                                       |
| **Cloudflare-specific?** | Yes -- standard `export default { fetch() }` Worker module                                                                                                                                              |
| **What it does**         | Receives GitHub App webhooks (`POST /webhook`), verifies HMAC signatures via Web Crypto API, and dispatches `repository_dispatch` events to the GitHub API to trigger existing GitHub Actions workflows |
| **Bindings**             | `env.WEBHOOK_SECRET` and `env.GH_TOKEN` -- both plain `string` secrets, not Cloudflare resource bindings                                                                                                |
| **Duration**             | Stateless, single-fetch handler. No Durable Objects, no scheduled events                                                                                                                                |

Key observations from the `Env` interface (line 10-13):

```typescript
interface Env {
  WEBHOOK_SECRET: string;
  GH_TOKEN: string;
}
```

These are **secrets only** (set via `wrangler secret`), not Cloudflare resource bindings.

---

### 2. wrangler.toml Configuration

**File:** `wrangler.toml` (lines 1-15)

```toml
name = "swagen-agentic"
main = "src/bot/cloudflare.ts"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]

[vars]
# These should be set via wrangler secret:
# WEBHOOK_SECRET — GitHub App webhook secret
# GH_TOKEN — GitHub token with repo scope for dispatching workflows

[env.production]
name = "swagen-agentic"

[env.preview]
name = "swagen-agentic-preview"
```

| Aspect                | Detail                                                              |
| --------------------- | ------------------------------------------------------------------- |
| **D1 databases**      | None declared (`[[d1_databases]]` absent)                           |
| **R2 buckets**        | None declared (`[[r2_buckets]]` absent)                             |
| **KV namespaces**     | None declared (`[[kv_namespaces]]` absent)                          |
| **Queues**            | None declared (`[[queues]]` absent)                                 |
| **Durable Objects**   | None declared (`[[durable_objects]]` or `[durable_objects]` absent) |
| **AI bindings**       | None declared (`[ai]` absent)                                       |
| **Vectorize indexes** | None declared (`[[vectorize]]` absent)                              |
| **Node.js compat**    | Enabled via `nodejs_compat` compatibility flag                      |

---

### 3. Storage Module -- Platform Agnostic

**File:** `src/storage.ts` (lines 1-211)

| Backend                        | Implementation                                                                   | Platform                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `MemoryStorage` (lines 32-59)  | In-process `Map<string, Session>`                                                | Agnostic (any JS runtime)                                         |
| `FileStorage` (lines 63-112)   | JSON files under `.swagen/sessions/` using `Bun.file`, `Bun.write`, `Bun.Glob`   | **Bun-specific** (not Cloudflare Workers compatible)              |
| `RedisStorage` (lines 117-179) | HTTP REST API calls via `fetch()` to a Redis-compatible endpoint (e.g., Upstash) | Agnostic (works anywhere `fetch` is available, including Workers) |

The `StorageConfig` type (defined in `src/core/types.ts`, line 134-142) supports `memory`, `file`, `redis`, and `custom` backends. There is no `d1` or `kv` backend option.

---

### 4. Cache Module -- Platform Agnostic

**File:** `src/cache.ts` (lines 1-237)

| Backend                      | Implementation                                                              | Platform                                             |
| ---------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `NoopCache` (lines 46-56)    | Always returns null                                                         | Agnostic                                             |
| `MemoryCache` (lines 60-127) | In-process LRU `Map` with TTL                                               | Agnostic                                             |
| `FileCache` (lines 131-203)  | JSON files under `.swagen/cache/` using `Bun.file`, `Bun.write`, `Bun.Glob` | **Bun-specific** (not Cloudflare Workers compatible) |

The `CacheConfig` type (defined in `src/core/types.ts`, line 144-154) supports `none`, `memory`, and `file` strategies. There is no `kv` strategy option.

---

### 5. Run State Storage -- Platform Agnostic (Bun-specific)

**File:** `src/tools/state.ts` (lines 1-30)

Persists `RunRecord` objects as JSON files under `.swagen/runs/` using `Bun.write`, `Bun.file`, and `Bun.Glob`. This is **Bun-specific** and would not run in a Cloudflare Worker environment.

---

### 6. GitHub Bot -- Platform Agnostic (Bun-specific)

**File:** `src/bot/github.ts` (lines 1-323)

Uses `Bun.serve()` (line 184), `Bun.file()` (line 283), `Bun.write()` (line 321) for the webhook server and file operations. This is **Bun-specific** and entirely separate from the Cloudflare Worker entry point. It runs in GitHub Actions or as a standalone Bun server.

---

### 7. Harness -- Platform Agnostic

**File:** `src/harness.ts` (lines 1-363)

The `SwagenHarness` orchestrator uses `IStorage` and `ICache` interfaces (abstract). It is platform-agnostic by design, but the default backends configured in `src/core/config.ts` point to memory or file-based strategies.

---

### 8. AI/ML Inference

No Cloudflare Workers AI or Vectorize usage was found. The AI inference is handled entirely through the `@earendil-works/pi-ai` library (line 25 of `harness.ts`), which calls external AI provider APIs (Anthropic, OpenAI, etc.) via HTTP. No `ai.run()`, `models.run()`, embedding generation, or vector search code exists anywhere in the codebase.

---

### 9. Database / SQL

No D1, SQLite, or any SQL-related code exists. No `.execute()`, `.prepare()`, `.bind()`, or SQL query strings were found outside of test framework patterns (which are HTTP method detection regexes, not database queries).

---

### 10. File Storage (R2)

No R2 references exist. All file I/O goes through `Bun.file()`, `Bun.write()`, and `Bun.Glob`, targeting the local filesystem.

---

### 11. Key-Value Storage (KV)

No `KVNamespace` or KV-related code exists. The `RedisStorage` class in `storage.ts` uses HTTP REST calls to a Redis-compatible endpoint, which is cloud-agnostic.

---

### 12. Queues

No Queue, QueueProducer, or QueueConsumer references exist.

---

### 13. Durable Objects

No DurableObject, DurableObjectState, or DurableObjectStorage references exist.

---

### 14. Package Dependencies

**File:** `package.json` (lines 64-87)

| Dependency                   | Cloudflare-related?                          |
| ---------------------------- | -------------------------------------------- |
| `wrangler` (devDep, line 86) | Yes -- Cloudflare Workers CLI for deployment |
| All other deps               | No -- standard Node.js/Bun libraries         |

There is **no** `@cloudflare/workers-types`, `@cloudflare/unenv`, `@cloudflare/kv-asset-handler`, or any other `@cloudflare/*` package in the dependency tree.

---

### Summary Table

| Cloudflare Service      | Used?   | Where?                                   | Would it need to be created for deployment?     |
| ----------------------- | ------- | ---------------------------------------- | ----------------------------------------------- |
| **Workers** (compute)   | **Yes** | `src/bot/cloudflare.ts`, `wrangler.toml` | Already exists                                  |
| **D1** (SQL database)   | No      | --                                       | No (current storage is memory/file/Redis)       |
| **R2** (object storage) | No      | --                                       | No (current file I/O is local filesystem)       |
| **KV** (key-value)      | No      | --                                       | No (current caching is memory/file LRU)         |
| **Queues**              | No      | --                                       | No (no async job processing)                    |
| **Durable Objects**     | No      | --                                       | No (stateless webhook relay)                    |
| **Workers AI**          | No      | --                                       | No (AI calls go to external providers via HTTP) |
| **Vectorize**           | No      | --                                       | No (no vector search/embedding functionality)   |

---

### Key Architectural Insight

The `src/bot/cloudflare.ts` Worker is designed as a **stateless webhook relay only**. It:

1. Receives a GitHub webhook
2. Verifies the HMAC signature (Web Crypto API)
3. Makes an outbound `fetch()` call to the GitHub API to trigger a `repository_dispatch`
4. Returns a 200 OK

It carries **zero state** between requests. All the actual agent orchestration, storage, caching, and AI inference happens in the GitHub Actions workflow that gets triggered by the Worker's dispatch call. The Worker never touches sessions, cache, specs, or generated files.

---

### Future Cloudflare Service Recommendations (If Needed)

If the project were to move from "webhook relay + GitHub Actions" to "full agent execution on Cloudflare Workers," the following services would need to be created:

| Service                                 | Purpose                                                       | Migration Path                                              |
| --------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| **D1**                                  | Replace `MemoryStorage`/`FileStorage` for session persistence | Add `[[d1_databases]]` binding, implement `D1Storage` class |
| **KV**                                  | Replace `MemoryCache`/`FileCache` for tool result caching     | Add `[[kv_namespaces]]` binding, implement `KVCache` class  |
| **Workers AI** or external AI API calls | Already works via HTTP                                        | No changes needed                                           |

The `node:fs` operations in `FileStorage`/`FileCache`/`state.ts` would need to be replaced with D1 or KV equivalents.

---

## Open Questions / Decisions

1. **Custom domains**: Want custom domain setup included, or stick with `*.workers.dev` subdomains?
2. **PR preview scope**: Current plan deploys preview on any PR touching worker files. Should it deploy on all PRs?
3. **Environment protection**: Add required reviewers for `production` environment in GitHub settings?
4. **Notifications**: Add Slack/Discord notifications on deploy success/failure?

---

## Implementation Checklist

- [x] Save this plan to markdown file
- [x] Analyze codebase for Cloudflare services (D1/R2/etc)
- [x] Update `wrangler.toml` with preview environment
- [x] Create `.github/workflows/deploy-cloudflare.yml`
- [x] Create `.github/workflows/deploy-cloudflare-preview.yml`
- [ ] Add `CLOUDFLARE_API_TOKEN` to GitHub secrets
- [ ] Add `CLOUDFLARE_ACCOUNT_ID` to GitHub secrets
- [ ] Verify `GITHUB_WEBHOOK_SECRET` and `GITHUB_TOKEN` secrets exist
- [ ] Set Worker secrets via `wrangler secret put`
- [ ] Test deployment on next PR

---

_Plan created: 2025-06-09_
_Last updated: 2025-06-09_
_Analysis: Cloudflare service dependency deep-dive_
_Status: Implementation complete, pending secrets configuration_
