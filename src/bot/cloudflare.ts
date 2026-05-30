/**
 * bot/cloudflare.ts — Cloudflare Worker entry point.
 *
 * Deploy with `wrangler deploy src/bot/cloudflare.ts`
 * Receives GitHub App webhooks, verifies signatures,
 * and dispatches repository_dispatch events to trigger
 * the existing swagen GitHub Actions workflow.
 */

interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GITHUB_TOKEN: string;
}

const SPEC_FILES = ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
        .filter((f: string) => SPEC_FILES.includes(f));

      if (changed.length === 0) return new Response("OK", { status: 200 });

      const repo = getRepoFullName(payload);
      if (!repo) return new Response("OK", { status: 200 });

      await dispatchWorkflow(env.GITHUB_TOKEN, repo, "swagen-generate", {
        spec_path: changed[0],
      });
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

      await dispatchWorkflow(env.GITHUB_TOKEN, repo, "swagen-generate", {
        spec_path: "openapi.yaml",
        auto_commit: "true",
        run_tests: "true",
      });
    }

    return new Response("OK", { status: 200 });
  },
};

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
  // Constant-time comparison to prevent timing attacks
  const a = encoder.encode(expected);
  const b = encoder.encode(signature);
  if (a.byteLength !== b.byteLength) return false;
  const dv1 = new Uint8Array(a);
  const dv2 = new Uint8Array(b);
  let result = 0;
  for (let i = 0; i < dv1.length; i++) result |= (dv1[i] ?? 0) ^ (dv2[i] ?? 0);
  return result === 0;
}

async function dispatchWorkflow(
  token: string,
  repo: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) return;

  const res = await fetch(`https://api.github.com/repos/${owner}/${repoName}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "swagen-cloudflare",
    },
    body: JSON.stringify({
      event_type: eventType,
      client_payload: payload,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`dispatchWorkflow error (${res.status}): ${text}`);
  }
}
