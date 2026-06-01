/**
 * bot/github.ts — GitHub Actions bot + GitHub App webhook handler.
 *
 * Modes:
 *   1. GitHub Actions (GITHUB_ACTIONS=true) — reads env vars, runs agent, posts PR comment
 *   2. GitHub App server (APP_MODE=webhook) — listens for push/PR webhooks over HTTP
 *
 * Zero external CLI deps. Uses @octokit/rest and @octokit/webhooks.
 * Agent runs via SwagenHarness → agentLoop.
 */

import { Webhooks } from "@octokit/webhooks";
import { Octokit } from "@octokit/rest";
import { SwagenHarness } from "../harness.ts";
import { resolveConfig } from "../core/config.ts";
import {
  buildActionsBotPrompt,
  buildPushWebhookPrompt,
  buildPrWebhookPrompt,
} from "../core/prompts.ts";
import { ansi } from "../utils/fmt.ts";
import type { SwagenConfig } from "../core/types.ts";

const COMMENT_MARKER = "<!-- swagen:generated -->";

// ─── Entry ────────────────────────────────────────────────────────────────────

const APP_MODE = process.env["APP_MODE"] ?? "actions";

if (APP_MODE === "webhook") {
  await runWebhookServer();
} else {
  await runActionsBot();
}

// ─── GitHub Actions bot ───────────────────────────────────────────────────────

async function runActionsBot() {
  const GH_TOKEN = process.env["GITHUB_TOKEN"] ?? "";
  const REPO = process.env["GITHUB_REPOSITORY"] ?? "";
  const EVENT = process.env["GITHUB_EVENT_NAME"] ?? "";
  const PR_NUMBER = process.env["PR_NUMBER"] ? parseInt(process.env["PR_NUMBER"]!, 10) : undefined;
  const REF_NAME = process.env["GITHUB_REF_NAME"] ?? "main";
  const SPEC_PATH = process.env["SWAGEN_SPEC_PATH"] ?? "openapi.yaml";
  const AUTO_COMMIT = process.env["SWAGEN_AUTO_COMMIT"] === "true";
  const DRY_RUN = process.env["SWAGEN_DRY_RUN"] === "true";
  const AND_RUN = process.env["SWAGEN_RUN_TESTS"] === "true";

  process.stderr.write(ansi.cyan(`[swagen-bot] event=${EVENT} repo=${REPO}\n`));

  const [owner, repo] = REPO.split("/");
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: ${REPO}`);

  const octokit = new Octokit({ auth: GH_TOKEN });

  const config = await resolveConfig({
    outDir: process.env["SWAGEN_OUT_DIR"] ?? "tests/api",
    runner: (process.env["SWAGEN_RUNNER"] ?? "bun") as SwagenConfig["runner"],
    baseUrl: `process.env.API_BASE_URL || "http://petstore3.swagger.io/api/v3"`,
    dryRun: DRY_RUN,
    aiProvider: process.env["SWAGEN_AI_PROVIDER"] ?? "",
    aiModel: process.env["SWAGEN_AI_MODEL"] ?? "",
    storage: { backend: "file" },
  });

  const harness = await SwagenHarness.create(config);

  const prompt = buildActionsBotPrompt({
    event: EVENT,
    repo: REPO,
    prNumber: PR_NUMBER,
    specPath: SPEC_PATH,
    andRun: AND_RUN,
    dryRun: DRY_RUN,
  });

  process.stderr.write(ansi.cyan("[swagen-bot] Starting agent loop...\n"));

  const result = await harness.runToCompletion({
    prompt,
    onEvent: (e) => {
      if (e.type === "tool_execution_start") {
        const ev = e as Record<string, unknown>;
        process.stderr.write(ansi.gray(`  → ${ev["toolName"]}\n`));
      }
    },
  });

  process.stderr.write(ansi.green("[swagen-bot] Agent finished.\n"));

  if (PR_NUMBER) {
    await upsertPrComment(octokit, owner, repo, PR_NUMBER, result.agentSummary, {
      endpointCount: result.endpointCount,
      writtenFiles: result.writtenFiles,
      dryRun: DRY_RUN,
      specPath: SPEC_PATH,
    });
  }

  if (AUTO_COMMIT && !DRY_RUN && result.writtenFiles.length > 0) {
    await commitFiles(octokit, owner, repo, REF_NAME, result.writtenFiles);
  }

  setOutput("endpoint_count", String(result.endpointCount));
  setOutput("file_count", String(result.writtenFiles.length));
  setOutput("session_id", result.sessionId);
  setOutput("agent_summary", result.agentSummary.slice(0, 500));
}

// ─── Spec file detection (zero-side-effect utility) ───────────────────────

import { findChangedSpecs } from "./specs.ts";
export { findChangedSpecs };

// ─── GitHub App webhook server ────────────────────────────────────────────────

async function runWebhookServer() {
  const secret = process.env["GITHUB_WEBHOOK_SECRET"] ?? "";
  const port = parseInt(process.env["PORT"] ?? "3000", 10);

  const webhooks = new Webhooks({ secret });

  // Handle push events on spec files
  webhooks.on("push", async ({ payload }) => {
    const changedSpecs = findChangedSpecs(payload.commits);

    if (changedSpecs.length === 0) return;

    const [owner, repo] = payload.repository.full_name.split("/");
    if (!owner || !repo) return;

    process.stderr.write(
      ansi.cyan(`[swagen-app] push: specs changed: ${changedSpecs.join(", ")}\n`),
    );

    const config = await resolveConfig({ storage: { backend: "file" } });
    const harness = await SwagenHarness.create(config);

    await Promise.all(
      changedSpecs.map(async (specPath: string) => {
        await harness.runToCompletion({
          prompt: buildPushWebhookPrompt(specPath, payload.repository.full_name),
        });
      }),
    );
  });

  // Handle PR events
  webhooks.on("pull_request.opened", async ({ payload }) => {
    const [owner, repo] = payload.repository.full_name.split("/");
    if (!owner || !repo) return;

    const config = await resolveConfig({ storage: { backend: "file" } });
    const harness = await SwagenHarness.create(config);

    const result = await harness.runToCompletion({
      prompt: buildPrWebhookPrompt(payload.pull_request.number, payload.repository.full_name),
    });

    const ghToken = process.env["GITHUB_TOKEN"];
    if (ghToken) {
      const octokit = new Octokit({ auth: ghToken });
      await upsertPrComment(
        octokit,
        owner,
        repo,
        payload.pull_request.number,
        result.agentSummary,
        {
          endpointCount: result.endpointCount,
          writtenFiles: result.writtenFiles,
          dryRun: false,
          specPath: "openapi.yaml",
        },
      );
    } else {
      process.stderr.write(
        ansi.yellow("[swagen-app] GITHUB_TOKEN not set — skipping PR comment\n"),
      );
      process.stderr.write(`  summary: ${result.agentSummary.slice(0, 120)}...\n`);
    }
  });

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method !== "POST" || url.pathname !== "/webhook") {
        return new Response("Not found", { status: 404 });
      }
      const signature = req.headers.get("x-hub-signature-256") ?? "";
      const body = await req.text();
      const id = req.headers.get("x-github-delivery") ?? "";
      const name = req.headers.get("x-github-event") ?? "";
      try {
        await webhooks.verifyAndReceive({ id, name, signature, payload: body });
        return new Response("OK", { status: 200 });
      } catch (err) {
        const msg = String(err);
        if (msg.includes("signature does not match")) {
          process.stderr.write(ansi.red(`[swagen-app] Invalid signature\n`));
          return new Response("Unauthorized", { status: 401 });
        }
        process.stderr.write(ansi.red(`[swagen-app] Handler error: ${msg}\n`));
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });

  process.stderr.write(ansi.green(`[swagen-app] Webhook server listening on :${port}\n`));
  process.stderr.write(ansi.gray("  POST /webhook — GitHub App webhook endpoint\n"));
}

// ─── PR comment helpers ───────────────────────────────────────────────────────

async function upsertPrComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  agentSummary: string,
  meta: { endpointCount: number; writtenFiles: string[]; dryRun: boolean; specPath: string },
) {
  const body = buildCommentBody(agentSummary, meta);
  const { data: comments } = await octokit.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });
  const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));

  if (existing) {
    await octokit.issues.updateComment({ owner, repo, comment_id: existing.id, body });
    process.stderr.write(ansi.green(`[swagen-bot] Updated PR comment #${existing.id}\n`));
  } else {
    await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body });
    process.stderr.write(ansi.green("[swagen-bot] Created PR comment\n"));
  }
}

function buildCommentBody(
  agentSummary: string,
  meta: { endpointCount: number; writtenFiles: string[]; dryRun: boolean; specPath: string },
): string {
  const fileList = meta.writtenFiles.map((f) => `- \`${f}\``).join("\n") || "_No files written_";
  return `${COMMENT_MARKER}
## 🧪 swagen — API test generation

${agentSummary}

| Endpoints | Files | Dry run |
|-----------|-------|---------|
| ${meta.endpointCount} | ${meta.writtenFiles.length} | ${meta.dryRun ? "yes ✓" : "no"} |

**Generated files:**
${fileList}

<details><summary>Re-generate locally</summary>

\`\`\`bash
swagen generate ${meta.specPath}
\`\`\`
</details>

_swagen · ${new Date().toISOString()}_
`;
}

// ─── Auto-commit ──────────────────────────────────────────────────────────────

async function commitFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  filePaths: string[],
) {
  const { data: ref } = await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const { data: base } = await octokit.git.getCommit({ owner, repo, commit_sha: ref.object.sha });

  const blobs = await Promise.all(
    filePaths.map(async (path) => {
      const content = await Bun.file(path)
        .text()
        .catch(() => "");
      const { data } = await octokit.git.createBlob({
        owner,
        repo,
        content: btoa(content),
        encoding: "base64",
      });
      return { path, sha: data.sha };
    }),
  );

  const { data: tree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: base.tree.sha,
    tree: blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
  });

  const { data: commit } = await octokit.git.createCommit({
    owner,
    repo,
    message: "chore: regenerate API tests [skip ci]",
    tree: tree.sha,
    parents: [ref.object.sha],
  });

  await octokit.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha: commit.sha });
  process.stderr.write(
    ansi.green(`[swagen-bot] Committed ${filePaths.length} files: ${commit.sha.slice(0, 7)}\n`),
  );
}

// ─── GitHub output ────────────────────────────────────────────────────────────

function setOutput(name: string, value: string) {
  const f = process.env["GITHUB_OUTPUT"];
  if (f) Bun.write(f, `${name}=${value}\n`, { append: true } as never);
  else process.stdout.write(`::set-output name=${name}::${value}\n`);
}
