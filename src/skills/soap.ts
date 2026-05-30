import type { Skill } from "../core/types.ts";
import { SOAP_SKILL_PROMPT } from "../core/prompts.ts";

export const skill: Skill = {
  name: "soap",
  version: "1.0.0",
  description:
    "Adds SOAP/XML-based API testing best practices: envelope structure, WSDL validation, XPath assertions, WS-Security, and fault handling.",

  activation: (ctx) => {
    const eps = ctx.endpoints;

    const hasSoapPath = eps.some((e) => {
      const p = e.path.toLowerCase();
      return p.includes("soap") || p.includes("wsdl") || p.includes("xmlrpc") || p.includes(".svc");
    });

    const hasSoapTag = eps.some((e) =>
      e.tags.some((t) =>
        /soap|wsdl|xmlrpc|wcf|xml\s*api|enterprise\s*service|ws-|wse|wcf/i.test(t),
      ),
    );

    const hasXmlContent = eps.some((e) =>
      e.responses.some(
        (r) => r.contentType && /xml|soap|application\/soap\+xml|text\/xml/i.test(r.contentType),
      ),
    );

    return hasSoapPath || hasSoapTag || hasXmlContent;
  },

  systemPrompt: SOAP_SKILL_PROMPT,
};

export default skill;
