/**
 * bot/shared.ts — Shared helpers for Cloudflare Worker and tests.
 *
 * Contains common logic for webhook signature verification,
 * GitHub API dispatch, and spec file detection.
 */

export interface Env {
  GITHUB_WEBHOOK_SECRET: string;
  GH_TOKEN: string;
}

export const SPEC_FILES = ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"];

export function getRepoFullName(payload: Record<string, unknown>): string | undefined {
  return (payload["repository"] as Record<string, unknown>)?.["full_name"] as string | undefined;
}

export async function createSignature(secret: string, body: string): Promise<string> {
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

export async function verifySignature(
  secret: string,
  body: string,
  signature: string,
): Promise<boolean> {
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

export interface DispatchResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export async function dispatchWorkflow(
  token: string,
  repo: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<DispatchResult> {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) return { ok: false, error: "Invalid repo format" };

  try {
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
      return { ok: false, status: res.status, error: text };
    }

    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`dispatchWorkflow network error: ${error}`);
    return { ok: false, error };
  }
}
