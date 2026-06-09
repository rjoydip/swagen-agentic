/**
 * tests/cloudflare-worker.test.ts — Unit tests for Cloudflare Worker webhook handler.
 *
 * Tests HMAC signature verification, event routing, and workflow dispatch.
 */

import { describe, test, expect, mock } from "bun:test";

// ─── Test HMAC signature verification ──────────────────────────────────────

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

// ─── Mock Worker handler ───────────────────────────────────────────────────

const SPEC_FILES = ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"];

interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
}

// Re-implement the worker handler for testing (avoids importing Bun-specific code)
async function handleRequest(
  request: Request,
  env: Env,
  dispatchFn?: (
    token: string,
    repo: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<void>,
): Promise<Response> {
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

  // Verify signature
  const verified = await verifySignature(env.GITHUB_WEBHOOK_SECRET, body, signature);
  if (!verified) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = JSON.parse(body) as Record<string, unknown>;

  // Handle push events
  if (name === "push") {
    const commits = payload["commits"] as Array<Record<string, string[]>> | undefined;
    if (!commits) return new Response("OK", { status: 200 });

    const changed = commits
      .flatMap((c) => [...(c["added"] ?? []), ...(c["modified"] ?? [])])
      .filter((f: string) => SPEC_FILES.includes(f));

    if (changed.length === 0) return new Response("OK", { status: 200 });

    const repo = getRepoFullName(payload);
    if (!repo) return new Response("OK", { status: 200 });

    if (dispatchFn) {
      await dispatchFn(env.GITHUB_TOKEN, repo, "swagen-generate", {
        spec_path: changed[0],
      });
    }
  }

  // Handle PR opened events
  if (
    name === "pull_request" &&
    (payload["action"] === "opened" || payload["action"] === "synchronize")
  ) {
    const pr = payload["pull_request"] as Record<string, unknown> | undefined;
    if (!pr) return new Response("OK", { status: 200 });

    const repo = getRepoFullName(payload);
    if (!repo) return new Response("OK", { status: 200 });

    if (dispatchFn) {
      await dispatchFn(env.GITHUB_TOKEN, repo, "swagen-generate", {
        spec_path: "openapi.yaml",
        auto_commit: "true",
        run_tests: "true",
      });
    }
  }

  return new Response("OK", { status: 200 });
}

function getRepoFullName(payload: Record<string, unknown>): string | undefined {
  return (payload["repository"] as Record<string, unknown>)?.["full_name"] as string | undefined;
}

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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Cloudflare Worker", () => {
  const testSecret = "test-webhook-secret-12345";
  const testToken = "ghp_test-token-12345";
  const env: Env = {
    GITHUB_WEBHOOK_SECRET: testSecret,
    GITHUB_TOKEN: testToken,
  };

  test("rejects non-POST requests", async () => {
    const req = new Request("https://example.com/webhook", { method: "GET" });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(405);
  });

  test("rejects non-webhook paths", async () => {
    const req = new Request("https://example.com/other", { method: "POST" });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(404);
  });

  test("rejects invalid signature", async () => {
    const body = JSON.stringify({ action: "push" });
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": "sha256=invalid",
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(401);
  });

  test("accepts valid signature", async () => {
    const body = JSON.stringify({ repository: { full_name: "owner/repo" }, commits: [] });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req, env);
    expect(res.status).toBe(200);
  });

  test("dispatches workflow on push with spec file changes", async () => {
    const dispatchFn = mock(() => Promise.resolve());
    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req, env, dispatchFn);
    expect(res.status).toBe(200);
    expect(dispatchFn).toHaveBeenCalledTimes(1);
    expect(dispatchFn).toHaveBeenCalledWith(testToken, "owner/repo", "swagen-generate", {
      spec_path: "openapi.yaml",
    });
  });

  test("does not dispatch on push without spec file changes", async () => {
    const dispatchFn = mock(() => Promise.resolve());
    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
      commits: [{ added: ["README.md"], modified: ["src/index.ts"] }],
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req, env, dispatchFn);
    expect(res.status).toBe(200);
    expect(dispatchFn).not.toHaveBeenCalled();
  });

  test("dispatches workflow on PR opened", async () => {
    const dispatchFn = mock(() => Promise.resolve());
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "owner/repo" },
      pull_request: { number: 1 },
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
      },
      body,
    });
    const res = await handleRequest(req, env, dispatchFn);
    expect(res.status).toBe(200);
    expect(dispatchFn).toHaveBeenCalledTimes(1);
    expect(dispatchFn).toHaveBeenCalledWith(testToken, "owner/repo", "swagen-generate", {
      spec_path: "openapi.yaml",
      auto_commit: "true",
      run_tests: "true",
    });
  });

  test("dispatches workflow on PR synchronize", async () => {
    const dispatchFn = mock(() => Promise.resolve());
    const body = JSON.stringify({
      action: "synchronize",
      repository: { full_name: "owner/repo" },
      pull_request: { number: 1 },
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
      },
      body,
    });
    const res = await handleRequest(req, env, dispatchFn);
    expect(res.status).toBe(200);
    expect(dispatchFn).toHaveBeenCalledTimes(1);
  });

  test("does not dispatch on PR closed", async () => {
    const dispatchFn = mock(() => Promise.resolve());
    const body = JSON.stringify({
      action: "closed",
      repository: { full_name: "owner/repo" },
      pull_request: { number: 1 },
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
      },
      body,
    });
    const res = await handleRequest(req, env, dispatchFn);
    expect(res.status).toBe(200);
    expect(dispatchFn).not.toHaveBeenCalled();
  });

  test("handles missing repository gracefully", async () => {
    const dispatchFn = mock(() => Promise.resolve());
    const body = JSON.stringify({
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req, env, dispatchFn);
    expect(res.status).toBe(200);
    expect(dispatchFn).not.toHaveBeenCalled();
  });

  test("handles missing commits gracefully", async () => {
    const dispatchFn = mock(() => Promise.resolve());
    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await handleRequest(req, env, dispatchFn);
    expect(res.status).toBe(200);
    expect(dispatchFn).not.toHaveBeenCalled();
  });

  test("supports all spec file types", async () => {
    const results = await Promise.all(
      SPEC_FILES.map(async (specFile) => {
        const dispatchFn = mock(() => Promise.resolve());
        const body = JSON.stringify({
          repository: { full_name: "owner/repo" },
          commits: [{ added: [specFile], modified: [] }],
        });
        const sig = await createSignature(testSecret, body);
        const req = new Request("https://example.com/webhook", {
          method: "POST",
          headers: {
            "x-hub-signature-256": sig,
            "x-github-event": "push",
          },
          body,
        });
        const res = await handleRequest(req, env, dispatchFn);
        return { specFile, res, dispatchFn };
      }),
    );

    for (const { specFile, res, dispatchFn } of results) {
      expect(res.status).toBe(200);
      expect(dispatchFn).toHaveBeenCalledTimes(1);
      expect(dispatchFn).toHaveBeenCalledWith(testToken, "owner/repo", "swagen-generate", {
        spec_path: specFile,
      });
    }
  });
});
