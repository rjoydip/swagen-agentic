/**
 * tests/unit/cloudflare-worker.test.ts — Unit tests for Cloudflare Worker webhook handler.
 *
 * Tests HMAC signature verification, event routing, and workflow dispatch.
 */

import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import worker from "../../src/bot/cloudflare";
import { type Env, SPEC_FILES, createSignature } from "../../src/bot/shared";

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("Cloudflare Worker", () => {
  const testSecret = "test-webhook-secret-12345";
  const testToken = "ghp_test-token-12345";
  const env: Env = {
    GITHUB_WEBHOOK_SECRET: testSecret,
    GH_TOKEN: testToken,
  };

  // Mock fetch for dispatchWorkflow tests
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof mock>;

  beforeEach(() => {
    fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })));
    globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });
  });

  // Restore after tests
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("rejects non-POST requests", async () => {
    const req = new Request("https://example.com/webhook", { method: "GET" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(405);
  });

  test("rejects non-webhook paths", async () => {
    const req = new Request("https://example.com/other", { method: "POST" });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  test("rejects non-JSON content-type", async () => {
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "test",
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(415);
  });

  test("rejects invalid signature", async () => {
    const body = JSON.stringify({ action: "push" });
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": "sha256=invalid",
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(401);
  });

  test("accepts valid signature", async () => {
    const body = JSON.stringify({ repository: { full_name: "owner/repo" }, commits: [] });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
  });

  test("dispatches workflow on push with spec file changes", async () => {
    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: `Bearer ${testToken}`,
        }),
      }),
    );
  });

  test("does not dispatch on push without spec file changes", async () => {
    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
      commits: [{ added: ["README.md"], modified: ["src/index.ts"] }],
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("dispatches workflow on PR opened", async () => {
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "owner/repo" },
      pull_request: { number: 1 },
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("dispatches workflow on PR synchronize", async () => {
    const body = JSON.stringify({
      action: "synchronize",
      repository: { full_name: "owner/repo" },
      pull_request: { number: 1 },
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("does not dispatch on PR closed", async () => {
    const body = JSON.stringify({
      action: "closed",
      repository: { full_name: "owner/repo" },
      pull_request: { number: 1 },
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "pull_request",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("handles missing repository gracefully", async () => {
    const body = JSON.stringify({
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("handles missing commits gracefully", async () => {
    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("returns 502 when dispatch fails", async () => {
    fetchMock = mock(() => Promise.resolve(new Response("Bad Gateway", { status: 502 })));
    globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });

    const body = JSON.stringify({
      repository: { full_name: "owner/repo" },
      commits: [{ added: ["openapi.yaml"], modified: [] }],
    });
    const sig = await createSignature(testSecret, body);
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": sig,
        "x-github-event": "push",
      },
      body,
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(502);
  });

  test("supports all spec file types", async () => {
    const testCases = await Promise.all(
      SPEC_FILES.map(async (specFile) => {
        const body = JSON.stringify({
          repository: { full_name: "owner/repo" },
          commits: [{ added: [specFile], modified: [] }],
        });
        const sig = await createSignature(testSecret, body);
        return { body, sig };
      }),
    );

    // Test each spec file sequentially to avoid shared mock state
    const runTest = async (index: number): Promise<boolean> => {
      if (index >= testCases.length) return true;
      const { body, sig } = testCases[index]!;
      fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })));
      globalThis.fetch = Object.assign(fetchMock, { preconnect: originalFetch.preconnect });
      const req = new Request("https://example.com/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sig,
          "x-github-event": "push",
        },
        body,
      });
      const res = await worker.fetch(req, env);
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      return runTest(index + 1);
    };

    await runTest(0);
  });
});
