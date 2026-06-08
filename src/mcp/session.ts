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
const sessionTimestamps = new Map<string, number>();
const SESSION_TTL_MS = 30 * 60 * 1000;

function evictExpired(): void {
  const now = Date.now();
  for (const [id, ts] of sessionTimestamps) {
    if (now - ts > SESSION_TTL_MS) {
      sessions.delete(id);
      sessionTimestamps.delete(id);
    }
  }
}

export function getOrCreateSession(id: string): McpSession {
  evictExpired();
  let session = sessions.get(id);
  if (!session) {
    session = { id, spec: null, endpoints: null, generatedFiles: null, codebaseAnalysis: null };
    sessions.set(id, session);
  }
  sessionTimestamps.set(id, Date.now());
  return session;
}

export function clearSession(id: string): void {
  sessions.delete(id);
  sessionTimestamps.delete(id);
}

export function clearAllSessions(): void {
  sessions.clear();
  sessionTimestamps.clear();
}
