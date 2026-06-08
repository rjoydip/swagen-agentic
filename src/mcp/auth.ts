export function generateBearerToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function verifyBearerToken(token: string | null, expected: string | undefined): boolean {
  if (!expected) return true;
  if (!token) return false;
  if (!token.startsWith("Bearer ")) return false;
  return token.slice(7) === expected;
}

export function unauthorizedResponse(): Response {
  return new Response("Unauthorized", {
    status: 401,
    headers: { "WWW-Authenticate": "Bearer" },
  });
}
