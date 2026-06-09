# Cloudflare Worker Testing

Tests for the Cloudflare Worker webhook handler.

## Test Files

| File                                          | Description                                |
| --------------------------------------------- | ------------------------------------------ |
| `tests/cloudflare-worker.test.ts`             | Unit tests for webhook handler             |
| `tests/cloudflare-worker-integration.test.ts` | Integration tests with real Web Crypto API |
| `scripts/test-webhook.sh`                     | Shell script for manual webhook testing    |

## Running Tests

### Unit Tests

```bash
bun test tests/cloudflare-worker.test.ts
```

### Integration Tests

```bash
bun test tests/cloudflare-worker-integration.test.ts
```

### All Worker Tests

```bash
bun test tests/cloudflare-worker
```

## Local Development Testing

### 1. Start Wrangler Dev Server

```bash
# Set test secrets
export WEBHOOK_SECRET="test-webhook-secret-12345"
export GH_TOKEN="ghp_test-token-12345"

# Start local development server
bunx wrangler dev --port 8787
```

### 2. Run Webhook Test Script

```bash
# Run all tests
./scripts/test-webhook.sh

# Test against specific URL
./scripts/test-webhook.sh https://your-worker.workers.dev
```

### 3. Manual Testing with curl

```bash
# Generate signature
PAYLOAD='{"repository":{"full_name":"owner/repo"},"commits":[{"added":["openapi.yaml"],"modified":[]}]}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "test-webhook-secret-12345" | sed 's/^.* //')

# Send webhook
curl -X POST http://localhost:8787/webhook \
  -H "Content-Type: application/json" \
  -H "x-hub-signature-256: sha256=$SIGNATURE" \
  -H "x-github-event: push" \
  -d "$PAYLOAD"
```

## Production Testing

### 1. Set Environment Variables

```bash
export WEBHOOK_SECRET="your-production-webhook-secret"
export WORKER_URL="https://swagen-agentic.workers.dev"
```

### 2. Run Test Script

```bash
./scripts/test-webhook.sh $WORKER_URL
```

### 3. Test via GitHub

1. Push a change to `openapi.yaml` in your repository
2. Check Cloudflare Worker logs for incoming webhook
3. Verify workflow is triggered in GitHub Actions

## Test Coverage

The tests cover:

- HTTP method validation (POST only)
- Path validation (`/webhook` only)
- HMAC signature verification
- Push event handling (spec file detection)
- PR event handling (opened/synchronize)
- Workflow dispatch
- Edge cases (missing repository, missing commits)

## Debugging

### Check Worker Logs

```bash
# Local development
bunx wrangler dev --port 8787 --log-level debug

# Production (if you have access)
bunx wrangler tail --env production
```

### Verify Signature Generation

```bash
# Test signature generation
echo -n '{"test":true}' | openssl dgst -sha256 -hmac "your-secret"
```

---

_Created: 2025-06-09_
