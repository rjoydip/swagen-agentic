import type { OpenAPI, OpenAPIV2, OpenAPIV3 } from "openapi-types";
import type {
  EndpointBody,
  EndpointParam,
  EndpointResponse,
  HttpMethod,
  ResolvedEndpoint,
  SpecSource,
  SwagenConfig,
} from "./types.ts";

// ─── Loader ───────────────────────────────────────────────────────────────────

export class SpecLoadError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SpecLoadError";
  }
}

async function getParser(): Promise<typeof import("@apidevtools/swagger-parser")> {
  return import("@apidevtools/swagger-parser") as unknown as Promise<
    typeof import("@apidevtools/swagger-parser")
  >;
}

export async function loadSpec(source: SpecSource): Promise<OpenAPI.Document> {
  try {
    const SwaggerParser = await getParser();
    if (source.kind === "file") {
      return (await SwaggerParser.dereference(source.path)) as OpenAPI.Document;
    }
    if (source.kind === "url") {
      const res = await fetch(source.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new SpecLoadError(`HTTP ${res.status} fetching ${source.url}`);
      const text = await res.text();
      const trimmed = text.trimStart();
      const parsed =
        trimmed.startsWith("{") || trimmed.startsWith("[")
          ? (JSON.parse(text) as unknown)
          : ((await import("yaml")).parse(text) as unknown);
      return (await SwaggerParser.dereference(parsed as never)) as OpenAPI.Document;
    }
    return (await SwaggerParser.dereference(source.doc as never)) as OpenAPI.Document;
  } catch (err) {
    if (err instanceof SpecLoadError) throw err;
    throw new SpecLoadError(`Failed to load spec: ${String(err)}`, err);
  }
}

// ─── Analyzer ─────────────────────────────────────────────────────────────────

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete", "head", "options"];

export function analyzeSpec(
  doc: OpenAPI.Document,
  config: Pick<SwagenConfig, "includeTags" | "excludeTags" | "skipOperations">,
): { endpoints: ResolvedEndpoint[]; skipped: string[] } {
  const endpoints: ResolvedEndpoint[] = [];
  const skipped: string[] = [];

  for (const [path, pathItem] of Object.entries(doc.paths ?? {})) {
    if (!pathItem) continue;
    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!op) continue;

      const operationId = op.operationId ?? `${method}_${sanitizePath(path)}`;
      const tags = (op.tags ?? []) as string[];

      if (config.skipOperations.includes(operationId)) {
        skipped.push(operationId);
        continue;
      }
      if (config.includeTags.length > 0 && !tags.some((t) => config.includeTags.includes(t))) {
        skipped.push(operationId);
        continue;
      }
      if (config.excludeTags.some((t) => tags.includes(t))) {
        skipped.push(operationId);
        continue;
      }

      endpoints.push({
        path,
        method,
        operationId,
        summary: op.summary,
        tags,
        params: extractParams(op, pathItem as Record<string, unknown>),
        body: extractBody(op),
        responses: extractResponses(op),
        security: extractSecurity(op),
        deprecated: op.deprecated ?? false,
      } satisfies ResolvedEndpoint);
    }
  }

  return { endpoints, skipped };
}

function extractParams(
  op: OpenAPIV3.OperationObject,
  pathItem: Record<string, unknown>,
): EndpointParam[] {
  const merged = new Map<string, unknown>();
  for (const p of [
    ...((pathItem["parameters"] ?? []) as unknown[]),
    ...((op.parameters ?? []) as unknown[]),
  ]) {
    const c = p as Record<string, unknown>;
    merged.set(`${c["in"]}:${c["name"]}`, p);
  }
  return [...merged.values()]
    .filter((p): p is OpenAPIV3.ParameterObject => {
      const c = p as Record<string, unknown>;
      return typeof c["in"] === "string" && typeof c["name"] === "string";
    })
    .map((p) => ({
      name: p.name,
      in: p.in as EndpointParam["in"],
      required: p.required ?? p.in === "path",
      schema: p.schema ?? { type: "string" },
      example: p.example,
    }));
}

function extractBody(op: OpenAPIV3.OperationObject): EndpointBody | undefined {
  if (op.requestBody) {
    const rb = op.requestBody as OpenAPIV3.RequestBodyObject;
    const [ct, media] = Object.entries(rb.content ?? {})[0] ?? [];
    if (!ct) return undefined;
    return {
      required: rb.required ?? false,
      contentType: ct,
      schema: (media as OpenAPIV3.MediaTypeObject)?.schema ?? {},
      example: (media as OpenAPIV3.MediaTypeObject)?.example,
    };
  }
  const bp = ((op as OpenAPIV2.OperationObject).parameters ?? []).find(
    (p) => (p as Record<string, unknown>)["in"] === "body",
  ) as OpenAPIV2.InBodyParameterObject | undefined;
  return bp
    ? { required: bp.required ?? false, contentType: "application/json", schema: bp.schema ?? {} }
    : undefined;
}

function extractResponses(op: OpenAPIV3.OperationObject): EndpointResponse[] {
  return Object.entries(op.responses ?? {}).map(([s, r]) => {
    const resp = r as OpenAPIV3.ResponseObject;
    const [ct, media] = Object.entries(resp?.content ?? {})[0] ?? [];
    return {
      statusCode: s === "default" ? "default" : parseInt(s, 10),
      contentType: ct,
      schema: (media as OpenAPIV3.MediaTypeObject)?.schema,
      description: resp?.description,
    };
  });
}

function extractSecurity(op: OpenAPIV3.OperationObject): string[][] {
  return ((op.security ?? []) as Array<Record<string, string[]>>).map((s) => Object.keys(s));
}

function sanitizePath(p: string): string {
  return p
    .replace(/^\//, "")
    .replace(/\//g, "_")
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9_]/g, "_");
}
