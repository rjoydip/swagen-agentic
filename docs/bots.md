# Bot Deployment

swagen has two bot modes for automated API test generation:

- **GitHub Actions Bot** — runs as a CI step triggered by spec changes
- **Cloudflare Worker** — webhook receiver that dispatches CI workflows

---

## GitHub Actions Bot

The Actions bot (`src/bot/github.ts`) runs inside `.github/workflows/swagen.yml`.
It activates on push/PR to spec files and can also be triggered via
`workflow_dispatch` or `repository_dispatch`.

### Setup

1. Add the required secrets to your GitHub repository:

   | Secret              | Required | Description            |
   | ------------------- | -------- | ---------------------- |
   | `ANTHROPIC_API_KEY` | Yes      | LLM provider key       |
   | `GITHUB_TOKEN`      | Auto     | Provided by Actions    |
   | `API_BASE_URL`      | No       | Base URL for API tests |

2. The workflow already lives at `.github/workflows/swagen.yml`. It:
   - Runs `lint-test` (typecheck + unit tests) first
   - Then runs the swagen agent to generate test files
   - Optionally runs the generated tests
   - Posts a PR comment with a summary
   - Uploads the generated tests as a CI artifact

### Manual trigger

```bash
gh workflow run swagen.yml -f spec_path=openapi.yaml -f dry_run=true
```

---

## Cloudflare Worker (`swagen bot`)

The Cloudflare Worker (`src/bot/cloudflare.ts`) receives GitHub App webhooks
and dispatches `repository_dispatch` events to trigger the existing
GitHub Actions workflow.

### Architecture

```sh
GitHub (push/PR)  ──►  Cloudflare Worker  ──►  GitHub API
                          (verify HMAC)          (repository_dispatch)
                                                    │
                                              ┌─────┘
                                              ▼
                                        GitHub Actions
                                        (swagen.yml)
```

The worker **does not** run the agent itself — it only verifies webhook
signatures and triggers the CI pipeline. The actual generation happens
in GitHub Actions via the existing `.github/workflows/swagen.yml`.

### Prerequisites

- Cloudflare account (free tier works)
- `wrangler` CLI (`bunx wrangler`)
- GitHub App with webhook configured (or a Personal Access Token)

### Setup

1. **Create a GitHub Personal Access Token** (classic, `repo` scope)
   or configure a GitHub App.

2. **Set worker secrets:**

```bash
bunx wrangler secret put GITHUB_WEBHOOK_SECRET
# Paste your webhook secret

bunx wrangler secret put GITHUB_TOKEN
# Paste your GitHub token (repo scope)
```

3. **Configure the webhook URL** in your GitHub repo/org settings:

   ```sh
   https://swagen-bot.your-username.workers.dev/webhook
   ```

   Set the content type to `application/json` and select these events:
   - **Push** (triggered on spec file changes)
   - **Pull requests** (opened / synchronize)

4. **Deploy:**

```bash
bunx wrangler deploy
```

### Local development

```bash
# Start a local dev server on port 8787
bunx wrangler dev

# In another terminal, forward GitHub webhooks to localhost:
# (requires a tool like ngrok or cloudflared tunnel)
cloudflared tunnel --url http://localhost:8787
```

### Environment Variables (configured via `wrangler secret`)

| Variable                | Required | Description                    |
| ----------------------- | -------- | ------------------------------ |
| `GITHUB_WEBHOOK_SECRET` | Yes      | GitHub App webhook secret      |
| `GITHUB_TOKEN`          | Yes      | GitHub token with `repo` scope |

### How it works

1. GitHub sends a webhook `POST` to `/webhook`
2. Worker verifies the HMAC-SHA256 signature using Web Crypto API
3. For push events: checks if spec files changed → dispatches `swagen-generate`
4. For PR events: dispatches `swagen-generate` with auto-commit and test run
5. Returns `200 OK` immediately — the actual work happens in GitHub Actions

### Production deployment

```bash
# Deploy to production environment
bunx wrangler deploy --env production

# View logs
bunx wrangler tail
```

---

## Running bots locally (standalone)

The bot file can also run as a standalone Node.js/Bun server for testing:

```bash
# Run as webhook server (listens on :3000)
APP_MODE=webhook GITHUB_WEBHOOK_SECRET=mysecret bun run src/bot/github.ts
```

### Testing the webhook server locally

Start the server in one terminal, then send a test push event from another:

```bash
# Terminal 1: start server
APP_MODE=webhook GITHUB_WEBHOOK_SECRET=mysecret bun run src/bot/github.ts
```

<details>
<summary>Terminal 2: send test events</summary>

Each command is self-contained — run them individually in a second terminal:

```bash
# --- 1. Single commit adding openapi.yaml ---
bun -e "
const secret = 'mysecret';
async function sign(body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function main() {
  const body = JSON.stringify({
    ref: 'refs/heads/main',
    before: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    after: 'e5a7b8c9d0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5',
    commits: [{id:'e5a7b8c9d0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5', message:'feat: add user management endpoints', timestamp:'2025-05-28T10:30:00Z', author:{name:'Jane Doe', email:'jane@example.com', username:'jane-doe'}, added:['openapi.yaml'], modified:[], removed:[]}],
    repository: {full_name:'my-org/my-api', name:'my-api', owner:{login:'my-org'}, html_url:'https://github.com/my-org/my-api'},
    sender: {login:'jane-doe'},
  });
  const sig = await sign(body);
  const res = await fetch('http://localhost:3000/webhook', {method:'POST', headers:{'content-type':'application/json','x-github-event':'push','x-github-delivery':'push-001','x-hub-signature-256':sig}, body});
  console.log('Single commit push:', res.status, await res.text());
}
main();
"

# --- 2. Multiple commits, some modifying spec files ---
bun -e "
const secret = 'mysecret';
async function sign(body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function main() {
  const body = JSON.stringify({
    ref: 'refs/heads/main',
    before: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    after: 'c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    commits: [
      {id:'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0', message:'chore: initial spec setup', timestamp:'2025-05-28T09:00:00Z', author:{name:'John Doe', email:'john@example.com', username:'john-doe'}, added:['openapi.yaml','README.md'], modified:[], removed:[]},
      {id:'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1', message:'feat: add pets endpoints', timestamp:'2025-05-28T09:15:00Z', author:{name:'John Doe', email:'john@example.com', username:'john-doe'}, added:[], modified:['openapi.yaml'], removed:[]},
    ],
    repository: {full_name:'my-org/my-api', name:'my-api', owner:{login:'my-org'}, html_url:'https://github.com/my-org/my-api'},
    sender: {login:'john-doe'},
  });
  const sig = await sign(body);
  const res = await fetch('http://localhost:3000/webhook', {method:'POST', headers:{'content-type':'application/json','x-github-event':'push','x-github-delivery':'push-002','x-hub-signature-256':sig}, body});
  console.log('Multi-commit push:', res.status, await res.text());
}
main();
"

# --- 3. PR opened event ---
bun -e "
const secret = 'mysecret';
async function sign(body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,'0')).join('');
}
async function main() {
  const body = JSON.stringify({
    action: 'opened',
    number: 42,
    pull_request: {
      number: 42,
      title: 'feat: add user management endpoints',
      body: 'Adds CRUD operations for /users endpoint',
      head: {ref:'feature/users', sha:'e5a7b8c9d0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5'},
      base: {ref:'main', sha:'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'},
      user: {login:'jane-doe'},
      html_url: 'https://github.com/my-org/my-api/pull/42',
    },
    repository: {full_name:'my-org/my-api', name:'my-api', owner:{login:'my-org'}, html_url:'https://github.com/my-org/my-api'},
    sender: {login:'jane-doe'},
  });
  const sig = await sign(body);
  const res = await fetch('http://localhost:3000/webhook', {method:'POST', headers:{'content-type':'application/json','x-github-event':'pull_request','x-github-delivery':'pr-001','x-hub-signature-256':sig}, body});
  console.log('PR opened:', res.status, await res.text());
}
main();
"
```

</details>

Expected output in the server terminal:

```log
[swagen-app] Webhook server listening on :3000
[swagen-app] push: specs changed: openapi.yaml
[swagen-app] push: specs changed: openapi.yaml
```

The server verifies the HMAC-SHA256 signature before processing, so the script must compute it with the same secret used when starting the server. Events without a valid signature receive a `401 Unauthorized` response.

> **Note**: GitHub webhook push payloads do not include the actual file contents — only the list of changed file paths. The bot uses `findChangedSpecs()` to detect spec files added or modified in commits, then delegates to the agent to fetch and process the spec content via the GitHub API.
