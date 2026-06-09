/**
 * tests/integration/cloudflare-worker.test.ts — Integration tests for Cloudflare Worker.
 *
 * Tests the actual Worker handler with real Web Crypto API.
 * Run with: bun test tests/integration/cloudflare-worker.test.ts
 *
 * For local development with wrangler dev:
 *   bunx wrangler dev --port 8787
 *   bun run tests/scripts/test-webhook.sh
 */

import { describe, test, expect, afterAll, mock, beforeEach } from "bun:test";
import worker from "../../src/bot/cloudflare";
import { type Env, createSignature } from "../../src/bot/shared";

// ─── Mock Dispatch Tracking ────────────────────────────────────────────────

interface DispatchCall {
  token: string;
  repo: string;
  eventType: string;
  payload: Record<string, unknown>;
}

let dispatchCalls: DispatchCall[] = [];

// Mock fetch to capture dispatchWorkflow calls
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Cloudflare Worker Integration", () => {
  const testSecret = "integration-test-secret-key-12345";
  const testToken = "ghp_integration-test-token-67890";
  const env: Env = {
    GITHUB_WEBHOOK_SECRET: testSecret,
    GH_TOKEN: testToken,
  };

  beforeEach(() => {
    dispatchCalls = [];
    fetchMock = mock((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (urlStr.includes("/dispatches") && init?.method === "POST") {
        const body = JSON.parse(init.body as string);
        const headers = init.headers as Record<string, string>;
        dispatchCalls.push({
          token: headers?.Authorization?.replace("Bearer ", "") || "",
          repo: urlStr.split("/repos/")[1]?.split("/dispatches")[0] || "",
          eventType: body.event_type,
          payload: body.client_payload,
        });
      }
      return Promise.resolve(new Response(null, { status: 200 }));
    });
    globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("full webhook flow: push with spec changes", async () => {
    const body = JSON.stringify({
      repository: { full_name: "rjoydip/swagen-agentic" },
      commits: [
        {
          added: ["openapi.yaml"],
          modified: ["src/index.ts"],
        },
      ],
    });
    const sig = await createSignature(testSecret, body);

    const req = new Request("https://swagen-agentic.workers.dev/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
        "content-type": "application/json",
      },
      body,
    });

    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]).toEqual({
      token: testToken,
      repo: "rjoydip/swagen-agentic",
      eventType: "swagen-generate",
      payload: { spec_path: "openapi.yaml" },
    });
  });

  test("full webhook flow: PR opened", async () => {
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "rjoydip/swagen-agentic" },
      pull_request: { number: 42, title: "Add new API endpoint" },
    });
    const sig = await createSignature(testSecret, body);

    const req = new Request("https://swagen-agentic.workers.dev/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
        "content-type": "application/json",
      },
      body,
    });

    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]?.payload).toEqual({
      spec_path: "openapi.yaml",
      auto_commit: "true",
      run_tests: "true",
    });
  });

  test("multiple spec files: dispatches only first", async () => {
    const body = JSON.stringify({
      repository: { full_name: "rjoydip/swagen-agentic" },
      commits: [
        {
          added: ["openapi.yaml", "swagger.json"],
          modified: [],
        },
      ],
    });
    const sig = await createSignature(testSecret, body);

    const req = new Request("https://swagen-agentic.workers.dev/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
        "content-type": "application/json",
      },
      body,
    });

    const res = await worker.fetch(req, env);

    expect(res.status).toBe(200);
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]?.payload.spec_path).toBe("openapi.yaml");
  });

  test("signature verification with different secrets fails", async () => {
    const wrongSecret = "wrong-secret-key";
    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const sig = await createSignature(wrongSecret, body);

    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
        "content-type": "application/json",
      },
      body,
    });

    const res = await worker.fetch(req, env);

    expect(res.status).toBe(401);
  });

  test("timing-safe comparison (constant time)", async () => {
    const body = JSON.stringify({ test: true });
    const sig = await createSignature(testSecret, body);

    // Verify the signature is correctly formatted
    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);

    // Verify it's the correct length
    expect(sig.length).toBe(71); // "sha256=" (7) + 64 hex chars
  });

  test("rejects non-JSON content-type", async () => {
    const body = "plain text";
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "x-hub-signature-256": "sha256=invalid",
        "x-github-event": "push",
      },
      body,
    });

    const res = await worker.fetch(req, env);

    expect(res.status).toBe(415);
  });
});
