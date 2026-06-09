/**
 * bot/cloudflare.ts — Cloudflare Worker entry point.
 *
 * Deploy with `wrangler deploy src/bot/cloudflare.ts`
 * Receives GitHub App webhooks, verifies signatures,
 * and dispatches repository_dispatch events to trigger
 * the existing swagen GitHub Actions workflow.
 */

import { type Env, SPEC_FILES, getRepoFullName, verifySignature, dispatchWorkflow } from "./shared";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return new Response("Unsupported content type", { status: 415 });
    }

    const signature = request.headers.get("x-hub-signature-256") ?? "";
    const name = request.headers.get("x-github-event") ?? "";
    const body = await request.text();

    // Verify signature using Web Crypto API
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
        .filter((f: string) => SPEC_FILES.some((s) => f.endsWith(s)));

      if (changed.length === 0) return new Response("OK", { status: 200 });

      const repo = getRepoFullName(payload);
      if (!repo) return new Response("OK", { status: 200 });

      const result = await dispatchWorkflow(env.GH_TOKEN, repo, "swagen-generate", {
        spec_path: changed[0],
      });
      if (!result.ok) {
        return new Response(`Dispatch failed: ${result.error}`, { status: 502 });
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

      const result = await dispatchWorkflow(env.GH_TOKEN, repo, "swagen-generate", {
        spec_path: "openapi.yaml",
        auto_commit: "true",
        run_tests: "true",
      });
      if (!result.ok) {
        return new Response(`Dispatch failed: ${result.error}`, { status: 502 });
      }
    }

    return new Response("OK", { status: 200 });
  },
};
