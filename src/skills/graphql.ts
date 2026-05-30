import type { Skill } from "../core/types.ts";
import { GRAPHQL_SKILL_PROMPT } from "../core/prompts.ts";

export const skill: Skill = {
  name: "graphql",
  version: "1.0.0",
  description:
    "Adds GraphQL API testing best practices: query/mutation coverage, variable edge cases, fragment reuse, subscription testing, error handling, and schema validation.",

  activation: (ctx) => {
    const eps = ctx.endpoints;

    const hasGraphQLEndpoint = eps.some((e) => {
      const p = e.path.toLowerCase();
      return p.includes("/graphql") || p.includes("/gql") || p.endsWith("/graphql");
    });

    const hasGraphQLMethod = eps.some((e) => e.method === "post");

    const hasQueryParams = eps.some((e) =>
      e.params.some((p) =>
        ["query", "mutation", "subscription", "variables", "operationName"].includes(p.name),
      ),
    );

    const hasGraphQLTag = eps.some((e) =>
      e.tags.some((t) => /graphql|gql|hasura|apollo|relay|typegraphql|nexus/i.test(t)),
    );

    return hasGraphQLEndpoint || (hasGraphQLMethod && hasQueryParams) || hasGraphQLTag;
  },

  systemPrompt: GRAPHQL_SKILL_PROMPT,
};

export default skill;
