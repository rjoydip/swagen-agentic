/**
 * scripts/test-webhook.ts — Test Cloudflare Worker webhook endpoint.
 *
 * Usage:
 *   bun run scripts/test-webhook.ts [WORKER_URL]
 *
 * Examples:
 *   bun run scripts/test-webhook.ts  # Uses default local wrangler dev URL
 *   bun run scripts/test-webhook.ts https://swagen-agentic.workers.dev
 *
 * Prerequisites:
 *   - Webhook secret must match the one set in Cloudflare Worker
 *   - For local testing: npx wrangler dev --port 8787 (use Node.js, not Bun)
 */

const WORKER_URL = process.argv[2] || "http://localhost:8787";
const WEBHOOK_PATH = "/webhook";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  console.error("Error: WEBHOOK_SECRET environment variable is required.");
  console.error("Usage: WEBHOOK_SECRET=xxx bun run scripts/test-webhook.ts [WORKER_URL]");
  process.exit(1);
}

// ─── Colors ────────────────────────────────────────────────────────────────

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const NC = "\x1b[0m";

// ─── Helper Functions ──────────────────────────────────────────────────────

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

async function sendWebhook(
  eventType: string,
  payload: string,
): Promise<{ status: number; body: string }> {
  const signature = await createSignature(WEBHOOK_SECRET, payload);

  console.log(`${YELLOW}Sending ${eventType} webhook...${NC}`);
  console.log(`URL: ${WORKER_URL}${WEBHOOK_PATH}`);
  console.log(`Signature: sha256=${signature}`);
  console.log(`Payload: ${payload.slice(0, 200)}${payload.length > 200 ? "..." : ""}`);
  console.log();

  try {
    const res = await fetch(`${WORKER_URL}${WEBHOOK_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-hub-signature-256": signature,
        "x-github-event": eventType,
        "x-github-delivery": `test-${Date.now()}`,
      },
      body: payload,
    });

    const body = await res.text();
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: String(err) };
  }
}

// ─── Test Cases ────────────────────────────────────────────────────────────

async function runTests(): Promise<void> {
  console.log(`${YELLOW}=== Cloudflare Worker Webhook Tests ===${NC}`);
  console.log(`Worker URL: ${WORKER_URL}`);
  console.log();

  let passed = 0;
  let failed = 0;

  // Test 1: Reject non-POST
  console.log(`${YELLOW}Test 1: Reject GET request${NC}`);
  try {
    const res = await fetch(`${WORKER_URL}${WEBHOOK_PATH}`);
    if (res.status === 405) {
      console.log(`${GREEN}✓ Correctly rejected GET request (405)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Expected 405, got ${res.status}${NC}`);
      failed++;
    }
  } catch (err) {
    console.log(`${RED}✗ Connection failed: ${err}${NC}`);
    failed++;
  }
  console.log();

  // Test 2: Reject non-webhook path
  console.log(`${YELLOW}Test 2: Reject non-webhook path${NC}`);
  try {
    const res = await fetch(`${WORKER_URL}/other`, { method: "POST" });
    if (res.status === 404) {
      console.log(`${GREEN}✓ Correctly rejected non-webhook path (404)${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Expected 404, got ${res.status}${NC}`);
      failed++;
    }
  } catch (err) {
    console.log(`${RED}✗ Connection failed: ${err}${NC}`);
    failed++;
  }
  console.log();

  // Test 3: Reject invalid signature
  console.log(`${YELLOW}Test 3: Reject invalid signature${NC}`);
  {
    const payload = JSON.stringify({ repository: { full_name: "owner/repo" }, commits: [] });
    try {
      const res = await fetch(`${WORKER_URL}${WEBHOOK_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=invalidsignature",
          "x-github-event": "push",
        },
        body: payload,
      });
      if (res.status === 401) {
        console.log(`${GREEN}✓ Correctly rejected invalid signature (401)${NC}`);
        passed++;
      } else {
        console.log(`${RED}✗ Expected 401, got ${res.status}${NC}`);
        failed++;
      }
    } catch (err) {
      console.log(`${RED}✗ Connection failed: ${err}${NC}`);
      failed++;
    }
  }
  console.log();

  // Test 4: Push event without spec changes
  console.log(`${YELLOW}Test 4: Push event without spec changes${NC}`);
  {
    const payload = JSON.stringify({
      repository: { full_name: "owner/repo" },
      commits: [{ added: ["README.md"], modified: ["src/index.ts"] }],
    });
    const { status, body } = await sendWebhook("push", payload);
    if (status === 200) {
      console.log(`${GREEN}✓ Success (HTTP ${status})${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${status})${NC}`);
      failed++;
    }
    console.log(`Response: ${body}`);
  }
  console.log();

  // Test 5: Push event with spec changes
  console.log(`${YELLOW}Test 5: Push event with spec changes${NC}`);
  {
    const payload = JSON.stringify({
      repository: { full_name: "rjoydip/swagen-agentic" },
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const { status, body } = await sendWebhook("push", payload);
    if (status === 200) {
      console.log(`${GREEN}✓ Success (HTTP ${status})${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${status})${NC}`);
      failed++;
    }
    console.log(`Response: ${body}`);
  }
  console.log();

  // Test 6: PR opened event
  console.log(`${YELLOW}Test 6: PR opened event${NC}`);
  {
    const payload = JSON.stringify({
      action: "opened",
      repository: { full_name: "rjoydip/swagen-agentic" },
      pull_request: { number: 42 },
    });
    const { status, body } = await sendWebhook("pull_request", payload);
    if (status === 200) {
      console.log(`${GREEN}✓ Success (HTTP ${status})${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${status})${NC}`);
      failed++;
    }
    console.log(`Response: ${body}`);
  }
  console.log();

  // Test 7: PR synchronize event
  console.log(`${YELLOW}Test 7: PR synchronize event${NC}`);
  {
    const payload = JSON.stringify({
      action: "synchronize",
      repository: { full_name: "rjoydip/swagen-agentic" },
      pull_request: { number: 42 },
    });
    const { status, body } = await sendWebhook("pull_request", payload);
    if (status === 200) {
      console.log(`${GREEN}✓ Success (HTTP ${status})${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${status})${NC}`);
      failed++;
    }
    console.log(`Response: ${body}`);
  }
  console.log();

  // Test 8: PR closed event (should not dispatch)
  console.log(`${YELLOW}Test 8: PR closed event (should not dispatch)${NC}`);
  {
    const payload = JSON.stringify({
      action: "closed",
      repository: { full_name: "rjoydip/swagen-agentic" },
      pull_request: { number: 42 },
    });
    const { status, body } = await sendWebhook("pull_request", payload);
    if (status === 200) {
      console.log(`${GREEN}✓ Success (HTTP ${status})${NC}`);
      passed++;
    } else {
      console.log(`${RED}✗ Failed (HTTP ${status})${NC}`);
      failed++;
    }
    console.log(`Response: ${body}`);
  }
  console.log();

  // Summary
  console.log(`${YELLOW}=== Tests Complete ===${NC}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
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
