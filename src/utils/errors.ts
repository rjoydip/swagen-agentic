import { ansi } from "./fmt.ts";

const PROVIDER_ENV_MAP: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  bedrock: ["AWS_ACCESS_KEY_ID"],
  faux: [],
};

export class MissingApiKeyError extends Error {
  constructor(provider: string) {
    const keys = PROVIDER_ENV_MAP[provider] ?? [`${provider.toUpperCase()}_API_KEY`];
    super(`Missing API key for "${provider}". Set the ${keys.join(" or ")} environment variable.`);
    this.name = "MissingApiKeyError";
  }
}

export class NetworkError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Network error during ${operation}: ${String(cause)}`);
    this.name = "NetworkError";
  }
}

export function checkApiKey(provider: string): void {
  const keys = PROVIDER_ENV_MAP[provider] ?? [`${provider.toUpperCase()}_API_KEY`];
  if (keys.length === 0) return;
  const found = keys.some((k) => {
    const val = typeof process !== "undefined" ? process.env[k] : undefined;
    return val && val.length > 0 && val !== "your-api-key-here";
  });
  if (!found) throw new MissingApiKeyError(provider);
}

export function friendlyError(err: unknown): string {
  if (err instanceof MissingApiKeyError) {
    return (
      ansi.yellow(err.message) +
      "\n" +
      ansi.gray("  Tip: create a .env file or set the variable in your shell.")
    );
  }
  if (err && (err as Record<string, unknown>).name === "SpecLoadError") {
    return ansi.red(`Spec error: ${(err as Error).message}`);
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("fetch") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("network")
  ) {
    return ansi.red(`Network error: ${msg}`);
  }
  return ansi.red(String(err));
}
