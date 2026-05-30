# GitHub App Configuration

swagen supports two GitHub integration modes:

1. **GitHub Actions bot** — runs in a workflow, triggered by spec file changes or PRs
2. **GitHub App server** — a persistent webhook server for real-time automation

---

## Mode 1 — GitHub Actions bot

No GitHub App registration needed. Uses `GITHUB_TOKEN` provided by Actions.

### Setup

- Copy `.github/workflows/swagen.yml` into your repo.
- Add secrets in **Settings → Secrets and variables → Actions**:

| Secret              | Description                               |
| ------------------- | ----------------------------------------- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key                    |
| `API_BASE_URL`      | Base URL of the API under test (optional) |
| `API_TOKEN`         | Bearer token for test requests (optional) |

- The workflow triggers automatically when `openapi.yaml` (or `openapi.json`) changes.

### Environment variables

| Variable             | Default         | Description                          |
| -------------------- | --------------- | ------------------------------------ |
| `SWAGEN_SPEC_PATH`   | `openapi.yaml`  | Path to the spec file                |
| `SWAGEN_OUT_DIR`     | `__tests__/api` | Output directory for tests           |
| `SWAGEN_RUNNER`      | `bun`           | `bun` or `vitest`                    |
| `SWAGEN_DRY_RUN`     | `false`         | Print only, don't write files        |
| `SWAGEN_AUTO_COMMIT` | `false`         | Auto-commit generated files          |
| `SWAGEN_RUN_TESTS`   | `false`         | Run tests after generating           |
| `SWAGEN_AI_PROVIDER` | _(required)_    | AI provider                          |
| `SWAGEN_AI_MODEL`    | _(required)_    | Model id                             |
| `APP_MODE`           | `actions`       | Set to `webhook` for App server mode |

---

## Mode 2 — GitHub App (webhook server)

Use this for:

- Instant response to spec changes (no per-minute polling)
- Self-hosted or cloud-hosted automation
- Multi-repo installations
- Custom routing and access control

### Step 1: Register a GitHub App

1. Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**
2. Fill in:
   - **Name:** `swagen` (or your org name)
   - **Homepage URL:** your repo URL
   - **Webhook URL:** `https://your-server.example.com/webhook`
   - **Webhook secret:** generate a strong random string and save it
3. Permissions needed:
   - Repository: **Contents** (read + write) — for auto-commit
   - Repository: **Pull requests** (read + write) — for PR comments
   - Repository: **Issues** (read + write) — for issue comments
4. Events to subscribe:
   - `push`
   - `pull_request`
5. Click **Create GitHub App** and note the **App ID**
6. Generate and download a **private key** (.pem file)

### Step 2: Install the App on your repo(s)

Settings → GitHub Apps → swagen → Install → choose repositories.

### Step 3: Run the webhook server

```bash
export GITHUB_TOKEN=<your-installation-access-token>
export GITHUB_WEBHOOK_SECRET=<the-secret-from-step-1>
export ANTHROPIC_API_KEY=<your-key>
export APP_MODE=webhook
export PORT=3000

bun run src/bot/github.ts
```

Or with Docker:

```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install
ENV APP_MODE=webhook
CMD ["bun", "run", "src/bot/github.ts"]
```

### Step 4: Verify

Send a test ping from the GitHub App settings page. You should see:

```sh
[swagen-app] Webhook server listening on :3000
  POST /webhook — GitHub App webhook endpoint
```

---

## GitHub App manifest (for one-click install)

Save as `github-app-manifest.json` and POST to `https://api.github.com/app-manifests`:

```json
{
  "name": "swagen",
  "url": "https://github.com/rjoydip/swagen",
  "hook_attributes": {
    "url": "https://your-server.example.com/webhook"
  },
  "redirect_url": "https://your-server.example.com/github-app-callback",
  "description": "Agentic API test generation from OpenAPI specs",
  "public": false,
  "default_events": ["push", "pull_request"],
  "default_permissions": {
    "contents": "write",
    "pull_requests": "write",
    "issues": "write"
  }
}
```

---

## PR comment format

swagen posts a single durable comment per PR (edits it on re-runs — no spam):

```sh
🧪 swagen — API test generation

[agent summary]

| Endpoints | Files | Dry run |
|-----------|-------|---------|
| 18        | 4     | no      |

Generated files:
- `__tests__/api/pets.test.ts`
- `__tests__/api/store.test.ts`
```

---

## Error handling

The webhook server distinguishes between two failure modes:

| Scenario                                    | HTTP status                 | Meaning                                         |
| ------------------------------------------- | --------------------------- | ----------------------------------------------- |
| Invalid HMAC signature                      | `401 Unauthorized`          | Webhook secret mismatch or tampered payload     |
| Handler error (e.g. missing `GITHUB_TOKEN`) | `500 Internal Server Error` | The webhook was verified but the handler failed |

If `GITHUB_TOKEN` is not set, the PR handler runs the agent but **skips posting the PR comment** — useful for local testing or read-only deployments.

---

## Security notes

- The webhook secret is verified via HMAC-SHA256 on every request.
- `GITHUB_TOKEN` should be scoped to the minimum required permissions.
- For multi-tenant installations, use a GitHub App private key to generate per-installation tokens.
- Set `SWAGEN_AUTO_COMMIT=false` unless you trust the generated output — review in dry-run mode first.
