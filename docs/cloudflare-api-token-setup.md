# Cloudflare API Token Setup for GitHub Actions

This guide walks through configuring Cloudflare API Token authentication for GitHub Actions to deploy Workers.

> **Note**: Cloudflare does not yet support OIDC for GitHub Actions. API Token is the standard authentication method. See [workers-sdk discussion #11434](https://github.com/cloudflare/workers-sdk/discussions/11434) for OIDC feature request.

## Prerequisites

- Cloudflare account with Workers enabled
- GitHub repository admin access

---

## Step 1: Create Cloudflare API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click on your profile icon (top-right) → **My Profile**
3. Navigate to **API Tokens** → **Create Token**
4. Select **"Edit Cloudflare Workers"** template (recommended)
5. Under **Account Resources**, select your account
6. Click **Continue to summary** → **Create Token**
7. **Copy the token immediately** (it won't be shown again)

### Custom Token Permissions (if not using template)

| Permission       | Access Level |
| ---------------- | ------------ |
| Workers Scripts  | Edit         |
| Workers Routes   | Edit         |
| Account Settings | Read         |

---

## Step 2: Get Cloudflare Account ID

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click on your account name (top-right corner)
3. **Account ID** is displayed in the sidebar under "API"
4. Copy the Account ID (format: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

---

## Step 3: Add GitHub Repository Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret Name             | Value                        | Description                          |
| ----------------------- | ---------------------------- | ------------------------------------ |
| `CLOUDFLARE_API_TOKEN`  | Your API token from Step 1   | Cloudflare authentication            |
| `CLOUDFLARE_ACCOUNT_ID` | Your Account ID from Step 2  | Cloudflare account identifier        |
| `GITHUB_WEBHOOK_SECRET` | `openssl rand -hex 32`       | HMAC secret for webhook verification |
| `GITHUB_TOKEN`          | GitHub PAT with `repo` scope | For dispatching workflows            |

### Generate Webhook Secret

```bash
openssl rand -hex 32
```

### Generate GitHub PAT

1. Go to GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. Click **Generate new token**
3. Select scope: **repo** (full control)
4. Copy the token

---

## Step 4: Set Worker Secrets (Automatic in CI)

Worker secrets (`GITHUB_WEBHOOK_SECRET` and `GITHUB_TOKEN`) are automatically configured during deployment via the GitHub Actions workflows. The workflows include a "Set Worker Secrets" step that uses `wrangler secret put` to sync GitHub secrets to Cloudflare Worker secrets.

### Manual Setup (Optional)

If you need to set secrets manually before the first deployment:

```bash
# Set webhook secret for production
echo "your-webhook-secret" | wrangler secret put GITHUB_WEBHOOK_SECRET --env production --name swagen-agentic

# Set GitHub token for production
echo "your-github-token" | wrangler secret put GITHUB_TOKEN --env production --name swagen-agentic

# Set webhook secret for preview
echo "your-webhook-secret" | wrangler secret put GITHUB_WEBHOOK_SECRET --env preview --name swagen-agentic-preview

# Set GitHub token for preview
echo "your-github-token" | wrangler secret put GITHUB_TOKEN --env preview --name swagen-agentic-preview
```

### How CI Syncs Secrets

The workflows automatically sync secrets on each deployment:

```yaml
- name: Set Worker Secrets
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  run: |
    echo "${{ secrets.GITHUB_WEBHOOK_SECRET }}" | bunx wrangler secret put GITHUB_WEBHOOK_SECRET --env production --name swagen-agentic
    echo "${{ secrets.GITHUB_TOKEN }}" | bunx wrangler secret put GITHUB_TOKEN --env production --name swagen-agentic
```

This ensures Worker secrets stay in sync with GitHub repository secrets.

---

## Step 5: Verify Setup

1. Push to `main` → should trigger `.github/workflows/deploy-cloudflare.yml`
2. Open a PR → should trigger `.github/workflows/deploy-cloudflare-preview.yml`

---

## Troubleshooting

### "Authentication error [code: 10000]"

- Verify `CLOUDFLARE_API_TOKEN` is correct (no trailing whitespace)
- Check token has **Edit** permissions for Workers (not just Read)
- Confirm `CLOUDFLARE_ACCOUNT_ID` matches your Cloudflare account

### "Account not found" error

- Confirm Account ID in GitHub secret matches Cloudflare dashboard
- Check you're using the correct Cloudflare account (not a sub-account)

### Token permissions error

- Ensure token uses **"Edit Cloudflare Workers"** template (not "Read All Resources")
- Custom tokens need: `Workers Scripts: Edit`, `Workers Routes: Edit`

---

## Security Notes

- **API Token is the actual key** - protect it like a password
- **Account ID is not a secret** - it's visible in your dashboard URL
- **Rotate token** if you suspect it's been compromised
- **Never commit** tokens to source control

---

_Created: 2025-06-09_
_Updated: 2025-06-09 (switched from OIDC to API Token)_
