# Troubleshooting

## Common Issues

### "Unknown model: anthropic/claude-opus-4-5-20251101"

The `ANTHROPIC_API_KEY` environment variable is not set.

**Fix:**

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
# Or create a .env file:
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env
```

### "Failed to load spec" errors

The OpenAPI spec file may be invalid or contain broken `$ref` references.

**Fix:**

```bash
# Validate first:
swagen validate ./openapi.yaml
```

### Tests fail on Windows

Some file paths use Unix conventions (`/tmp/`). The test suite has been fixed for
Windows compatibility — use `os.tmpdir()` instead of hardcoded `/tmp/`.

### "Session not found" when resuming

The session may have been stored with a different storage backend.

**Fix:** Ensure `storage.backend` is consistent between the original run and the resume.

### Webhook server not receiving events

The GitHub App webhook endpoint is `POST /webhook`. Ensure:

1. The webhook URL is configured correctly in GitHub App settings
2. The secret matches `GITHUB_WEBHOOK_SECRET` env var
3. The server is publicly accessible (use ngrok for local dev)

## Debugging

```bash
# Run with verbose output:
swagen generate openapi.yaml --verbose

# Check cache stats:
swagen cache

# List stored sessions:
swagen sessions

# Clear cache:
swagen cache clear

# View last run summary:
swagen status
```
