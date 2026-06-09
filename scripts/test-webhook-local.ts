/**
 * scripts/test-webhook-local.ts — Test Cloudflare Worker webhook handler locally.
 *
 * This script tests the webhook handler directly without wrangler dev,
 * using Bun's built-in support for Web Crypto API.
 *
 * Usage:
 *   bun run scripts/test-webhook-local.ts
 */

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "test-webhook-secret-12345";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "ghp_test-token-12345";

// ─── Colors ────────────────────────────────────────────────────────────────

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

// ─── HMAC Signature Helper ─────────────────────────────────────────────────

async function createSignature(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return (
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

// ─── Worker Handler (Inline) ───────────────────────────────────────────────

const SPEC_FILES = ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"];

interface DispatchCall {
  token: string;
  repo: string;
  eventType: string;
  payload: Record<string, unknown>;
}

const dispatchCalls: DispatchCall[] = [];

async function verifySignature(secret: string, body: string, signature: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  const a = encoder.encode(expected);
  const b = encoder.encode(signature);
  if (a.byteLength !== b.byteLength) return false;
  const dv1 = new Uint8Array(a);
  const dv2 = new Uint8Array(b);
  let result = 0;
  for (let i = 0; i < dv1.length; i++) result |= (dv1[i] ?? 0) ^ (dv2[i] ?? 0);
  return result === 0;
}

function getRepoFullName(payload: Record<string, unknown>): string | undefined {
  return (payload["repository"] as Record<string, unknown>)?.["full_name"] as string | undefined;
}

async function handleRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = new URL(request.url);
  if (url.pathname !== "/webhook") {
    return new Response("Not found", { status: 404 });
  }

  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const name = request.headers.get("x-github-event") ?? "";
  const body = await request.text();

  const verified = await verifySignature(WEBHOOK_SECRET, body, signature);
  if (!verified) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(body) as Record<string, unknown>;

  if (name === "push") {
    const commits = payload["commits"] as Array<Record<string, string[]>> | undefined;
    if (!commits) return new Response("OK", { status: 200 });

    const changed = commits
      .flatMap((c) => [...(c["added"] ?? []), ...(c["modified"] ?? [])])
      .filter((f: string) => SPEC_FILES.includes(f));

    if (changed.length === 0) return new Response("OK", { status: 200 });

    const repo = getRepoFullName(payload);
    if (!repo) return new Response("OK", { status: 200 });

    dispatchCalls.push({
      token: GITHUB_TOKEN,
      repo,
      eventType: "swagen-generate",
      payload: { spec_path: changed[0] },
    });
  }

  if (
    name === "pull_request" &&
    (payload["action"] === "opened" || payload["action"] === "synchronize")
  ) {
    const pr = payload["pull_request"] as Record<string, unknown> | undefined;
    if (!pr) return new Response("OK", { status: 200 });

    const repo = getRepoFullName(payload);
    if (!repo) return new Response("OK", { status: 200 });

    dispatchCalls.push({
      token: GITHUB_TOKEN,
      repo,
      eventType: "swagen-generate",
      payload: {
        spec_path: "openapi.yaml",
        auto_commit: "true",
        run_tests: "true",
      },
    });
  }

  return new Response("OK", { status: 200 });
}

// ─── Test Runner ───────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log(`${YELLOW}=== Cloudflare Worker Local Tests ===${NC}`);
  console.log();

  let passed = 0;
  let failed = 0;

  // Test 1: Reject non-POST
  console.log(`${YELLOW}Test 1: Reject GET request${NC}`);
  {
    const req = new Request("http://localhost:8787/webhook", { method: "GET" });
    const res = await handleRequest(req);
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
    const res = await handleRequest(req);
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
        "x-hub-signature-256": "sha256=invalidsignature",
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req);
    if (res.status === 401) {
      console.log(`${GREEN}✓ Correctly rejected invalid signature (401)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Expected 401, got ${res.status}${NC}`);
      failed++;
    }
  }
  console.log();

  // Test 4: Push event with spec changes
  console.log(`${YELLOW}Test 4: Push event with spec changes${NC}`);
  {
    dispatchCalls.length = 0;
    const body = JSON.stringify({
      repository: { full_name: "rjoydip/swagen-agentic" },
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const sig = await createSignature(WEBHOOK_SECRET, body);
    const req = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req);
    if (res.status === 200 && dispatchCalls.length === 1) {
      console.log(`${GREEN}✓ Success - workflow dispatched${NC}`);
      console.log(`  Repo: ${dispatchCalls[0].repo}`);
      console.log(`  Spec: ${dispatchCalls[0].payload.spec_path}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${res.status}, dispatches: ${dispatchCalls.length})${NC}`);
      failed++;
    }
  }
  console.log();

  // Test 5: PR opened event
  console.log(`${YELLOW}Test 5: PR opened event${NC}`);
  {
    dispatchCalls.length = 0;
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "rjoydip/swagen-agentic" },
      pull_request: { number: 42 },
    });
    const sig = await createSignature(WEBHOOK_SECRET, body);
    const req = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
      },
      body,
    });
    const res = await handleRequest(req);
    if (res.status === 200 && dispatchCalls.length === 1) {
      console.log(`${GREEN}✓ Success - workflow dispatched${NC}`);
      console.log(`  Repo: ${dispatchCalls[0].repo}`);
      console.log(`  Auto-commit: ${dispatchCalls[0].payload.auto_commit}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${res.status}, dispatches: ${dispatchCalls.length})${NC}`);
      failed++;
    }
  }
  console.log();

  // Test 6: Push without spec changes (no dispatch)
  console.log(`${YELLOW}Test 6: Push without spec changes${NC}`);
  {
    dispatchCalls.length = 0;
    const body = JSON.stringify({
      repository: { full_name: "rjoydip/swagen-agentic" },
      commits: [{ added: ["README.md"], modified: ["src/index.ts"] }],
    });
    const sig = await createSignature(WEBHOOK_SECRET, body);
    const req = new Request("http://localhost:8787/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req);
    if (res.status === 200 && dispatchCalls.length === 0) {
      console.log(`${GREEN}✓ Success - no dispatch (as expected)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (expected 0 dispatches, got ${dispatchCalls.length})${NC}`);
      failed++;
    }
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
