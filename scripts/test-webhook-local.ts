/**
 * scripts/test-webhook-local.ts — Test Cloudflare Worker webhook handler locally.
 *
 * This script tests the webhook handler directly without wrangler dev,
 * using Bun's built-in support for Web Crypto API.
 *
 * Usage:
 *   WEBHOOK_SECRET=xxx GH_TOKEN=xxx bun run scripts/test-webhook-local.ts
 */

import worker from "../src/bot/cloudflare";
import { type Env, createSignature } from "../src/bot/shared";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const GH_TOKEN = process.env.GH_TOKEN;

if (!WEBHOOK_SECRET || !GH_TOKEN) {
  console.error("Error: WEBHOOK_SECRET and GH_TOKEN environment variables are required.");
  console.error("Usage: WEBHOOK_SECRET=xxx GH_TOKEN=xxx bun run scripts/test-webhook-local.ts");
  process.exit(1);
}

// ─── Colors ────────────────────────────────────────────────────────────────

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

// ─── Mock Fetch ────────────────────────────────────────────────────────────

interface DispatchCall {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

let dispatchCalls: DispatchCall[] = [];
const originalFetch = globalThis.fetch;

function setupMockFetch(): void {
  dispatchCalls = [];
  globalThis.fetch = Object.assign(
    ((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes("/dispatches") && init?.method === "POST") {
        dispatchCalls.push({
          url: urlStr,
          method: init.method,
          body: JSON.parse(init.body as string),
        });
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch,
    { preconnect: originalFetch.preconnect },
  );
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ─── Test Runner ───────────────────────────────────────────────────────────

const env: Env = {
  GITHUB_WEBHOOK_SECRET: WEBHOOK_SECRET,
  GH_TOKEN,
};

async function runTests(): Promise<void> {
  console.log(`${YELLOW}=== Cloudflare Worker Local Tests ===${NC}`);
  console.log();

  let passed = 0;
  let failed = 0;

  // Test 1: Reject non-POST
  console.log(`${YELLOW}Test 1: Reject GET request${NC}`);
  {
    const req = new Request("http://localhost:8787/webhook", { method: "GET" });
    const res = await worker.fetch(req, env);
    if (res.status === 405) {
      console.log(`${GREEN}✓ Correctly rejected GET request (405)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Expected 405, got ${res.status}${NC}`);
      failed++;
    }
  }
  console.log();

  // Test 2: Reject non-webhook path
  console.log(`${YELLOW}Test 2: Reject non-webhook path${NC}`);
  {
    const req = new Request("http://localhost:8787/other", { method: "POST" });
    const res = await worker.fetch(req, env);
    if (res.status === 404) {
      console.log(`${GREEN}✓ Correctly rejected non-webhook path (404)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Expected 404, got ${res.status}${NC}`);
      failed++;
    }
  }
  console.log();

  // Test 3: Reject invalid signature
  console.log(`${YELLOW}Test 3: Reject invalid signature${NC}`);
  {
    const body = JSON.stringify({ repository: { full_name: "owner/repo" }, commits: [] });
    const req = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=invalidsignature",
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    if (res.status === 401) {
      console.log(`${GREEN}✓ Correctly rejected invalid signature (401)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Expected 401, got ${res.status}${NC}`);
      failed++;
    }
  }
  console.log();

  // Test 4: Reject non-JSON content-type
  console.log(`${YELLOW}Test 4: Reject non-JSON content-type${NC}`);
  {
    const req = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-hub-signature-256": "sha256=invalid",
        "x-github-event": "push",
      },
      body: "plain text",
    });
    const res = await worker.fetch(req, env);
    if (res.status === 415) {
      console.log(`${GREEN}✓ Correctly rejected non-JSON content-type (415)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Expected 415, got ${res.status}${NC}`);
      failed++;
    }
  }
  console.log();

  // Test 5: Push event with spec changes
  console.log(`${YELLOW}Test 5: Push event with spec changes${NC}`);
  {
    setupMockFetch();
    const body = JSON.stringify({
      repository: { full_name: "rjoydip/swagen-agentic" },
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const sig = await createSignature(WEBHOOK_SECRET, body);
    const req = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    if (res.status === 200 && dispatchCalls.length === 1) {
      console.log(`${GREEN}✓ Success - workflow dispatched${NC}`);
      console.log(`  Repo: ${dispatchCalls[0].body.client_payload}`);
      console.log(`  Spec: ${(dispatchCalls[0].body.client_payload as Record<string, unknown>).spec_path}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${res.status}, dispatches: ${dispatchCalls.length})${NC}`);
      failed++;
    }
    restoreFetch();
  }
  console.log();

  // Test 6: PR opened event
  console.log(`${YELLOW}Test 6: PR opened event${NC}`);
  {
    setupMockFetch();
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "rjoydip/swagen-agentic" },
      pull_request: { number: 42 },
    });
    const sig = await createSignature(WEBHOOK_SECRET, body);
    const req = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    if (res.status === 200 && dispatchCalls.length === 1) {
      console.log(`${GREEN}✓ Success - workflow dispatched${NC}`);
      console.log(`  Repo: ${dispatchCalls[0].body.client_payload}`);
      console.log(`  Auto-commit: ${(dispatchCalls[0].body.client_payload as Record<string, unknown>).auto_commit}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${res.status}, dispatches: ${dispatchCalls.length})${NC}`);
      failed++;
    }
    restoreFetch();
  }
  console.log();

  // Test 7: Push without spec changes (no dispatch)
  console.log(`${YELLOW}Test 7: Push without spec changes${NC}`);
  {
    setupMockFetch();
    const body = JSON.stringify({
      repository: { full_name: "rjoydip/swagen-agentic" },
      commits: [{ added: ["README.md"], modified: ["src/index.ts"] }],
    });
    const sig = await createSignature(WEBHOOK_SECRET, body);
    const req = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    if (res.status === 200 && dispatchCalls.length === 0) {
      console.log(`${GREEN}✓ Success - no dispatch (as expected)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (expected 0 dispatches, got ${dispatchCalls.length})${NC}`);
      failed++;
    }
    restoreFetch();
  }
  console.log();

  // Summary
  console.log(`${YELLOW}=== Tests Complete ===${NC}`);
  console.log(`${GREEN}Passed: ${passed}${NC}`);
  console.log(`${failed > 0 ? RED : GREEN}Failed: ${failed}${NC}`);
  console.log();

  if (failed > 0) {
    process.exit(1);
  }
}

// ─── Run ───────────────────────────────────────────────────────────────────

runTests().catch((err) => {
  console.error(`${RED}Fatal error: ${err}${NC}`);
  process.exit(1);
});
