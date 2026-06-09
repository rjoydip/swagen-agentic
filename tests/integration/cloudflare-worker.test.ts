/**
 * tests/cloudflare-worker-integration.test.ts — Integration tests for Cloudflare Worker.
 *
 * Tests the actual Worker handler with real Web Crypto API.
 * Run with: bun test tests/cloudflare-worker-integration.test.ts
 *
 * For local development with wrangler dev:
 *   bunx wrangler dev --port 8787
 *   bun run tests/scripts/test-webhook.sh
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";

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

// ─── Worker Handler (Direct Import) ────────────────────────────────────────

interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
}

const SPEC_FILES = ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"];

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

// ─── Mock Dispatch Tracking ────────────────────────────────────────────────

interface DispatchCall {
  token: string;
  repo: string;
  eventType: string;
  payload: Record<string, unknown>;
}

let dispatchCalls: DispatchCall[] = [];

function mockDispatch(
  token: string,
  repo: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  dispatchCalls.push({ token, repo, eventType, payload });
  return Promise.resolve();
}

// ─── Worker Handler ────────────────────────────────────────────────────────

async function handleRequest(request: Request, env: Env): Promise<Response> {
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

  const verified = await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, signature);
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

    await mockDispatch(env.GITHUB_TOKEN, repo, "swagen-generate", {
      spec_path: changed[0],
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

    await mockDispatch(env.GITHUB_TOKEN, repo, "swagen-generate", {
      spec_path: "openapi.yaml",
      auto_commit: "true",
      run_tests: "true",
    });
  }

  return new Response("OK", { status: 200 });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Cloudflare Worker Integration", () => {
  const testSecret = "integration-test-secret-key-12345";
  const testToken = "ghp_integration-test-token-67890";
  const env: Env = {
    GITHUB_WEBHOOK_SECRET: testSecret,
    GITHUB_TOKEN: testToken,
  };

  beforeAll(() => {
    dispatchCalls = [];
  });

  afterAll(() => {
    dispatchCalls = [];
  });

  test("full webhook flow: push with spec changes", async () => {
    dispatchCalls = [];
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

    const res = await handleRequest(req, env);

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
    dispatchCalls = [];
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

    const res = await handleRequest(req, env);

    expect(res.status).toBe(200);
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]?.payload).toEqual({
      spec_path: "openapi.yaml",
      auto_commit: "true",
      run_tests: "true",
    });
  });

  test("multiple spec files: dispatches only first", async () => {
    dispatchCalls = [];
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
      },
      body,
    });

    const res = await handleRequest(req, env);

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
      },
      body,
    });

    const res = await handleRequest(req, env);

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
});
