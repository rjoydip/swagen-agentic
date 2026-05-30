import type { Skill } from "../core/types.ts";
import { REST_SKILL_PROMPT } from "../core/prompts.ts";

export const skill: Skill = {
  name: "rest",
  version: "1.0.0",
  description:
    "Adds REST API testing best practices: status code validation, pagination coverage, auth flow tests, negative/error-scenario tests, header validation, and CRUD lifecycle testing.",

  activation: (ctx) => {
    const eps = ctx.endpoints;
    if (eps.length === 0) return false;

    const hasSecurity = eps.some((e) => e.security.length > 0);
    const hasPagination = eps.some((e) =>
      e.params.some((p) =>
        ["page", "per_page", "limit", "offset", "cursor", "size", "page_token"].includes(p.name),
      ),
    );
    const hasErrorResponses = eps.some((e) =>
      e.responses.some(
        (r) => typeof r.statusCode === "number" && r.statusCode >= 400 && r.statusCode < 500,
      ),
    );
    const hasAuthTag = eps.some((e) =>
      e.tags.some((t) => /auth|security|login|token|bearer/i.test(t)),
    );
    const hasRestfulMethod = eps.some((e) =>
      ["get", "post", "put", "patch", "delete"].includes(e.method),
    );

    return hasRestfulMethod || hasSecurity || hasPagination || hasErrorResponses || hasAuthTag;
  },

  systemPrompt: REST_SKILL_PROMPT,
};

export default skill;
