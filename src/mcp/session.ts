import type { OpenAPI } from "openapi-types";
import type { ResolvedEndpoint, GeneratedFile, CodebaseAnalysis } from "../core/types.ts";

export interface McpSession {
  id: string;
  spec: OpenAPI.Document | null;
  endpoints: ResolvedEndpoint[] | null;
  generatedFiles: GeneratedFile[] | null;
  codebaseAnalysis: CodebaseAnalysis | null;
}

const sessions = new Map<string, McpSession>();

export function getOrCreateSession(id: string): McpSession {
  let session = sessions.get(id);
  if (!session) {
    session = { id, spec: null, endpoints: null, generatedFiles: null, codebaseAnalysis: null };
    sessions.set(id, session);
  }
  return session;
}

export function clearSession(id: string): void {
  sessions.delete(id);
}

export function clearAllSessions(): void {
  sessions.clear();
}
