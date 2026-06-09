# Environment Variables Reference

Complete reference of all environment variables used in swagen-agentic, organized by category.

---

## Cloudflare Worker Secrets

Secrets bound to the Cloudflare Worker via `wrangler secret put`. These are **not** in `wrangler.toml` `[vars]` section (which is for non-sensitive config only).

| Variable                | Required | Description                                            | How to Set                                  |
| ----------------------- | -------- | ------------------------------------------------------ | ------------------------------------------- |
| `GITHUB_WEBHOOK_SECRET` | Yes      | HMAC secret for verifying GitHub webhook signatures    | `wrangler secret put GITHUB_WEBHOOK_SECRET` |
| `GITHUB_TOKEN`          | Yes      | GitHub PAT with `repo` scope for dispatching workflows | `wrangler secret put GITHUB_TOKEN`          |

### Cloudflare Worker Environment Interface

```typescript
interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
}
```

---

## GitHub Actions Configuration

Variables used in GitHub Actions workflows (`.github/workflows/*.yml`). These are set as **repository secrets** in GitHub.

### Deployment Secrets

| Variable                | Required | Description                                        | Where to Obtain                                   |
| ----------------------- | -------- | -------------------------------------------------- | ------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | Yes      | Cloudflare API token with Workers edit permissions | Cloudflare Dashboard → API Tokens                 |
| `CLOUDFLARE_ACCOUNT_ID` | Yes      | Cloudflare account ID                              | Cloudflare Dashboard → Workers & Pages → Overview |
| `GITHUB_WEBHOOK_SECRET` | Yes      | HMAC secret for webhook verification               | Generate: `openssl rand -hex 32`                  |
| `GITHUB_TOKEN`          | Yes      | GitHub PAT with `repo` scope                       | GitHub → Settings → Developer Settings → Tokens   |
| `CODECOV_TOKEN`         | No       | Codecov upload token                               | Codecov dashboard                                 |
| `OPENCODE_API_KEY`      | No       | API key for OpenCode AI provider                   | OpenCode dashboard                                |
| `NPM_TOKEN`             | No       | npm publish token (for releases)                   | npm → Access Tokens                               |

### Workflow Variables

| Variable            | Source | Description                                      |
| ------------------- | ------ | ------------------------------------------------ |
| `GITHUB_REPOSITORY` | Auto   | Repository name (e.g., `rjoydip/swagen-agentic`) |
| `GITHUB_EVENT_NAME` | Auto   | Event type (`push`, `pull_request`, etc.)        |
| `GITHUB_REF_NAME`   | Auto   | Branch or tag name                               |
| `GITHUB_OUTPUT`     | Auto   | Path to GitHub Actions output file               |

---

## Swagen Configuration

Variables that control swagen's behavior and output.

### Core Configuration

| Variable             | Default        | Description                          |
| -------------------- | -------------- | ------------------------------------ |
| `SWAGEN_SPEC_PATH`   | `openapi.yaml` | Path to OpenAPI/Swagger spec file    |
| `SWAGEN_OUT_DIR`     | `tests/api`    | Output directory for generated tests |
| `SWAGEN_RUNNER`      | `bun`          | Test runner (`bun` or `vitest`)      |
| `SWAGEN_DRY_RUN`     | `false`        | Run without writing files            |
| `SWAGEN_AUTO_COMMIT` | `false`        | Auto-commit generated files          |
| `SWAGEN_RUN_TESTS`   | `false`        | Run generated tests after generation |

### AI Provider Configuration

| Variable             | Default      | Description                                           |
| -------------------- | ------------ | ----------------------------------------------------- |
| `SWAGEN_AI_PROVIDER` | (required)   | AI provider (`opencode`, `anthropic`, `openai`, etc.) |
| `SWAGEN_AI_MODEL`    | `big-pickle` | AI model to use for test generation                   |

### API Configuration

| Variable       | Default                 | Description                      |
| -------------- | ----------------------- | -------------------------------- |
| `API_BASE_URL` | `http://localhost:3000` | Base URL of the API to test      |
| `API_TOKEN`    | (none)                  | Authentication token for the API |

---

## Runtime Configuration

Variables that control runtime behavior across the application.

### Server Configuration

| Variable           | Default   | Description                               |
| ------------------ | --------- | ----------------------------------------- |
| `PORT`             | `3000`    | Port for the webhook server (Bun mode)    |
| `MOCK_SERVER_PORT` | `3000`    | Port for the mock test server             |
| `APP_MODE`         | `actions` | Application mode (`actions` or `webhook`) |

### Storage Configuration

| Variable      | Default | Description                                     |
| ------------- | ------- | ----------------------------------------------- |
| `REDIS_TOKEN` | (none)  | Redis authentication token (for `RedisStorage`) |

### Logging Configuration

| Variable      | Default | Description                          |
| ------------- | ------- | ------------------------------------ |
| `LOG_FORMAT`  | `text`  | Log output format (`text` or `json`) |
| `NO_COLOR`    | (none)  | Disable colored output (any value)   |
| `FORCE_COLOR` | (none)  | Force colored output (any value)     |

---

## GitHub Bot Mode Variables

Variables used when running the GitHub bot in different modes.

### Actions Mode (CI)

Set automatically by GitHub Actions when running in CI:

| Variable            | Source | Description                           |
| ------------------- | ------ | ------------------------------------- |
| `GITHUB_ACTIONS`    | Auto   | `true` when running in GitHub Actions |
| `GITHUB_REPOSITORY` | Auto   | Repository full name                  |
| `GITHUB_EVENT_NAME` | Auto   | Event type                            |
| `GITHUB_REF_NAME`   | Auto   | Branch name                           |
| `PR_NUMBER`         | Manual | Pull request number (for PR comments) |

### Webhook Mode (Self-hosted)

Variables for running the bot as a standalone server:

| Variable         | Default    | Description                          |
| ---------------- | ---------- | ------------------------------------ |
| `WEBHOOK_SECRET` | (required) | HMAC secret for webhook verification |
| `PORT`           | `3000`     | Server listen port                   |

---

## Testing Variables

Variables used in test suites.

| Variable      | Description                        |
| ------------- | ---------------------------------- |
| `NO_COLOR`    | Disable ANSI colors in test output |
| `FORCE_COLOR` | Force ANSI colors in test output   |
| `LOG_FORMAT`  | Test log format (`text` or `json`) |

---

## Environment Files

### `.env` (Local Development)

```env
# API Configuration
API_BASE_URL=http://localhost:3000
API_TOKEN=your-api-token

# Swagen Configuration
SWAGEN_SPEC_PATH=openapi.yaml
SWAGEN_OUT_DIR=tests/api
SWAGEN_RUNNER=bun

# AI Provider
SWAGEN_AI_PROVIDER=opencode
SWAGEN_AI_MODEL=big-pickle

# Logging
LOG_FORMAT=text
```

### `.env.production` (Production)

```env
# API Configuration
API_BASE_URL=https://api.production.com

# Swagen Configuration
SWAGEN_RUN_TESTS=true
```

---

## Secret Management

### Local Development

Use `.env` file (gitignored) or export directly:

```bash
export API_BASE_URL=http://localhost:3000
export SWAGEN_AI_PROVIDER=opencode
```

### GitHub Actions

Set in repository secrets (Settings → Secrets and variables → Actions):

```yaml
env:
  API_BASE_URL: ${{ secrets.API_BASE_URL }}
  SWAGEN_AI_PROVIDER: opencode
```

### Cloudflare Workers

Set via Wrangler CLI:

```bash
# Set individual secret
echo "value" | wrangler secret put SECRET_NAME --env production

# Set multiple secrets
echo "value" | wrangler secret put GITHUB_WEBHOOK_SECRET --env production
echo "value" | wrangler secret put GITHUB_TOKEN --env production
```

### CI/CD Sync

Worker secrets are automatically synced from GitHub secrets in the deployment workflows:

```yaml
- name: Set Worker Secrets
  run: |
    echo "${{ secrets.GITHUB_WEBHOOK_SECRET }}" | bunx wrangler secret put GITHUB_WEBHOOK_SECRET --env production
    echo "${{ secrets.GITHUB_TOKEN }}" | bunx wrangler secret put GITHUB_TOKEN --env production
```

---

## Security Notes

- **Never commit** `.env` files or secrets to source control
- **Rotate tokens** if you suspect they've been compromised
- **Use minimal permissions** for API tokens (e.g., "Edit Cloudflare Workers" not "All Access")
- **Account ID is not a secret** - it's visible in your Cloudflare dashboard URL
- **API Token is the actual key** - protect it like a password

---

_Created: 2025-06-09_
_Last updated: 2025-06-09_
