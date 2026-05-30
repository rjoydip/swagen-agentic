import type { Skill } from "../core/types.ts";
import { GRPC_SKILL_PROMPT } from "../core/prompts.ts";

export const skill: Skill = {
  name: "grpc",
  version: "1.0.0",
  description:
    "Adds gRPC API testing best practices: unary/streaming call coverage, message validation, error code assertions, deadline propagation, and bidirectional stream testing.",

  activation: (ctx) => {
    const eps = ctx.endpoints;

    const hasGrpcPath = eps.some((e) => /(rpc|grpc|proto|protobuf|service)\//i.test(e.path));

    const hasGrpcTag = eps.some((e) =>
      e.tags.some((t) =>
        /grpc|protobuf|proto|rpc|gRPC|servicemesh|envoy|connect|buf.build/i.test(t),
      ),
    );

    const hasGrpcMethod = eps.some((e) => e.method === "post" && e.path.includes(":"));

    return hasGrpcPath || hasGrpcTag || hasGrpcMethod;
  },

  systemPrompt: GRPC_SKILL_PROMPT,
};

export default skill;
