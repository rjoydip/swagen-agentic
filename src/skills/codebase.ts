import type { Skill } from "../core/types.ts";

export const CODEBASE_SKILL_PROMPT = `
CODEBASE ANALYSIS RULES (active):
- This is an existing codebase, not a fresh API spec. Use discover_code to find functions, classes, and APIs.
- Use check_coverage to find untested or under-tested code before generating.
- Use read_existing_tests to understand the existing test conventions before writing.
- When augmenting, use augment_tests with smart-merge strategy to insert into existing test files.
- Match the existing project's test style: describe/it naming patterns, assertion style, mock setup.
- For each gap found: generate tests that cover the entity directly by importing and calling the source.
- Include both happy-path and error-case tests for each function or class.
- When generating integration tests for API handlers, use the same patterns as existing tests.
- Respect existing code conventions and file structure. Do not duplicate existing tests.
`;

export const skill: Skill = {
  name: "codebase",
  version: "1.0.0",
  description:
    "Analyzes existing codebases for test generation: discovers entities, detects coverage gaps, and augments existing test suites.",

  activation: (ctx) => {
    return ctx.config.mode === "codebase";
  },

  systemPrompt: CODEBASE_SKILL_PROMPT,
};

export default skill;
