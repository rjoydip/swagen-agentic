# Cloudflare OIDC Setup for GitHub Actions

This guide walks through configuring Cloudflare OIDC (OpenID Connect) for keyless authentication between GitHub Actions and Cloudflare Workers.

## Prerequisites

- Cloudflare account with Workers enabled
- GitHub repository admin access

---

## Step 1: Get Your Cloudflare Account ID

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click on your account name (top-right corner)
3. **Account ID** is displayed in the sidebar under "API"
4. Copy the Account ID (format: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)

---

## Step 2: Configure OIDC Token in Cloudflare

1. Navigate to **Workers & Pages** → **Settings** → **OIDC Tokens**
2. Click **Add OIDC Token**
3. Fill in the configuration:

| Field          | Value                                         |
| -------------- | --------------------------------------------- |
| **Name**       | `github-actions-swagen`                       |
| **Issuer URL** | `https://token.actions.githubusercontent.com` |
| **Audience**   | Your Cloudflare **Account ID** (from Step 1)  |

4. Configure the **Subject** claim to control which repos/branches can authenticate:

   | Use Case             | Subject Value                                     |
   | -------------------- | ------------------------------------------------- |
   | All branches in repo | `repo:rjoydip/swagen-agentic:*`                   |
   | Main branch only     | `repo:rjoydip/swagen-agentic:ref:refs/heads/main` |
   | PRs only             | `repo:rjoydip/swagen-agentic:pull_request`        |

5. Click **Save**

---

## Step 3: Add GitHub Repository Secrets

Go to your GitHub repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:

| Secret Name             | Value                        | Description                          |
| ----------------------- | ---------------------------- | ------------------------------------ |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare Account ID   | From Step 1                          |
| `WEBHOOK_SECRET`        | `openssl rand -hex 32`       | HMAC secret for webhook verification |
| `GH_TOKEN`              | GitHub PAT with `repo` scope | For dispatching workflows            |

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

## Step 4: Verify Setup

1. Push to `main` → should trigger `.github/workflows/deploy-cloudflare.yml`
2. Open a PR → should trigger `.github/workflows/deploy-cloudflare-preview.yml`

---

## Troubleshooting

### "Unauthorized" error during deploy

- Verify `CLOUDFLARE_ACCOUNT_ID` is correct
- Check OIDC token's **Subject** matches your repo/branch pattern
- Ensure `id-token: write` permission is set in workflow

### "Account not found" error

- Confirm Account ID in GitHub secret matches Cloudflare dashboard
- Check you're using the correct Cloudflare account (not a sub-account)

---

_Created: 2025-06-09_
