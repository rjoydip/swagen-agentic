/**
 * utils/fmt.ts — terminal formatting using ANSI escape codes.
 * No chalk, no external dependency.
 */

// ─── ANSI codes ───────────────────────────────────────────────────────────────

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

export const ansi = {
  reset: (s: string) => `${ESC}0m${s}${RESET}`,
  bold: (s: string) => `${ESC}1m${s}${RESET}`,
  dim: (s: string) => `${ESC}2m${s}${RESET}`,
  underline: (s: string) => `${ESC}4m${s}${RESET}`,
  // Foreground colours
  red: (s: string) => `${ESC}31m${s}${RESET}`,
  green: (s: string) => `${ESC}32m${s}${RESET}`,
  yellow: (s: string) => `${ESC}33m${s}${RESET}`,
  blue: (s: string) => `${ESC}34m${s}${RESET}`,
  magenta: (s: string) => `${ESC}35m${s}${RESET}`,
  cyan: (s: string) => `${ESC}36m${s}${RESET}`,
  white: (s: string) => `${ESC}37m${s}${RESET}`,
  gray: (s: string) => `${ESC}90m${s}${RESET}`,
  boldGreen: (s: string) => `${ESC}1;32m${s}${RESET}`,
  boldCyan: (s: string) => `${ESC}1;36m${s}${RESET}`,
  boldRed: (s: string) => `${ESC}1;31m${s}${RESET}`,
  boldYellow: (s: string) => `${ESC}1;33m${s}${RESET}`,
};

/** Strips ANSI escape codes from a string (for plain-text output). */
export function stripAnsi(s: string): string {
  return s.replace(new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g"), "");
}

/** Whether the current terminal supports colour. */
export function supportsColor(): boolean {
  const noColor = process.env["NO_COLOR"] != null;
  const forceColor = process.env["FORCE_COLOR"] != null;
  if (noColor) return false;
  if (forceColor) return true;
  return process.stdout.isTTY === true;
}

// ─── Spinner (no ora) ─────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  text: string;
  succeed(msg?: string): void;
  fail(msg?: string): void;
  stop(): void;
}

export function createSpinner(initial: string): Spinner {
  let frame = 0;
  let active = true;
  let current = initial;

  if (!supportsColor()) {
    process.stdout.write(current + "\n");
    return {
      get text() {
        return current;
      },
      set text(v: string) {
        current = v;
        process.stdout.write(v + "\n");
      },
      succeed(msg?: string) {
        process.stdout.write((msg ?? current) + "\n");
        active = false;
      },
      fail(msg?: string) {
        process.stdout.write("x " + (msg ?? current) + "\n");
        active = false;
      },
      stop() {
        active = false;
      },
    };
  }

  const interval = setInterval(() => {
    if (!active) return;
    const f = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "⠋";
    process.stdout.write(`\r${ESC}2K${ansi.cyan(f)} ${current}`);
    frame++;
  }, 80);

  const stop = () => {
    clearInterval(interval);
    active = false;
    process.stdout.write(`\r${ESC}2K`);
  };

  return {
    get text() {
      return current;
    },
    set text(v: string) {
      current = v;
    },
    succeed(msg?: string) {
      stop();
      process.stdout.write(ansi.boldGreen("✓") + " " + (msg ?? current) + "\n");
    },
    fail(msg?: string) {
      stop();
      process.stdout.write(ansi.boldRed("✗") + " " + (msg ?? current) + "\n");
    },
    stop,
  };
}

// ─── dedent — strips leading indent from template literals ───────────────────

/**
 * Removes common leading whitespace from all lines of a template literal.
 * Replaces the `dedent` package.
 */
export function dedent(strings: TemplateStringsArray, ...values: unknown[]): string {
  // Re-assemble the template
  let raw = "";
  for (let i = 0; i < strings.length; i++) {
    raw += strings[i] ?? "";
    if (i < values.length) raw += String(values[i]);
  }

  const lines = raw.split("\n");

  // Strip leading blank line (from opening backtick on its own line)
  if (lines[0]?.trim() === "") lines.shift();
  // Strip trailing blank line
  if (lines[lines.length - 1]?.trim() === "") lines.pop();

  // Find minimum non-zero indent across non-blank lines
  const indents = lines
    .filter((l) => l.trim().length > 0)
    .map((l) => l.match(/^(\s*)/)?.[1]?.length ?? 0);

  const minIndent = indents.length > 0 ? Math.min(...indents) : 0;

  return lines.map((l) => l.slice(minIndent)).join("\n");
}

// ─── Simple CLI arg parser (replaces commander) ───────────────────────────────

export interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Minimal arg parser. Handles:
 *   --flag          → { flag: true }
 *   --flag value    → { flag: "value" }
 *   --flag=value    → { flag: "value" }
 *   --no-flag       → { flag: false }
 *   -f value        → { f: "value" }
 */
/** Returns the next index to process after consuming the flag at argv[i]. */
function consumeFlag(
  argv: string[],
  i: number,
  arg: string,
  flags: Record<string, string | boolean>,
): number {
  // --key=value: value embedded in current arg, advance by 1
  const eqIdx = arg.indexOf("=");
  if (eqIdx !== -1) {
    const key = arg.startsWith("--") ? arg.slice(2, eqIdx) : arg.slice(1, eqIdx);
    flags[key] = arg.slice(eqIdx + 1);
    return i + 1;
  }
  // --key value: value is the next argv element, advance by 2
  const prefixLen = arg.startsWith("--") ? 2 : 1;
  const key = arg.slice(prefixLen);
  const next = argv[i + 1];
  if (next !== undefined && !next.startsWith("-")) {
    flags[key] = next;
    return i + 2;
  }
  // Boolean flag: no value consumed, advance by 1
  flags[key] = true;
  return i + 1;
}

export function parseArgs(argv: string[] = process.argv.slice(2)): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i] ?? "";

    if (arg.startsWith("--no-")) {
      flags[arg.slice(5)] = false;
      i++;
    } else if (arg.startsWith("--")) {
      i = consumeFlag(argv, i, arg, flags);
    } else if (arg.startsWith("-") && arg.length === 2) {
      i = consumeFlag(argv, i, arg, flags);
    } else {
      positionals.push(arg);
      i++;
    }
  }

  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    flags,
  };
}

// ─── Help printer ─────────────────────────────────────────────────────────────

export interface CommandDef {
  name: string;
  args?: string;
  description: string;
  flags?: Array<{ flag: string; description: string }>;
  examples?: Array<{ cmd: string; desc: string }>;
}

export function printHelp(commands: CommandDef[], version = "0.3.0"): void {
  const w = (s: string, n: number) => s.padEnd(n);
  process.stdout.write(`
${ansi.boldCyan("swagen")} ${ansi.gray(`v${version}`)} — Agentic API test generation from Swagger/OpenAPI specs

${ansi.bold("USAGE")}
  swagen <command> [options]

${ansi.bold("COMMANDS")}
${commands.map((c) => `  ${ansi.cyan(w(c.name + (c.args ? " " + c.args : ""), 28))}${c.description}`).join("\n")}

${ansi.bold("GLOBAL FLAGS")}
  ${ansi.cyan(w("--provider <name>", 28))}AI provider (required)
  ${ansi.cyan(w("--model <id>", 28))}  Model id (required)
  ${ansi.cyan(w("--parallel <N>", 28))}Split endpoints across N agents in parallel
  ${ansi.cyan(w("--dry-run", 28))}     Print without writing files
  ${ansi.cyan(w("--verbose", 28))}     Stream all agent events
  ${ansi.cyan(w("--help, -h", 28))}    Show help for any command

${ansi.gray("Run 'swagen help <command>' for detailed help")}
${ansi.gray("Docs: https://github.com/rjoydip/swagen")}
`);
}

export function printCommandHelp(cmd: CommandDef, version: string): void {
  const w = (s: string, n: number) => s.padEnd(n);
  process.stdout.write(`
${ansi.boldCyan("swagen " + cmd.name)} ${ansi.gray(`v${version}`)} — ${cmd.description}

${ansi.bold("USAGE")}
  swagen ${cmd.name}${cmd.args ? " " + cmd.args : ""}

${ansi.bold("DESCRIPTION")}
  ${cmd.description}
${
  cmd.flags?.length
    ? `
${ansi.bold("FLAGS")}
${cmd.flags.map((f) => `  ${ansi.cyan(w(f.flag, 28))}${f.description}`).join("\n")}`
    : ""
}
${
  cmd.examples?.length
    ? `
${ansi.bold("EXAMPLES")}
${cmd.examples.map((e) => `  ${ansi.gray("# " + e.desc)}\n  ${ansi.green("$")} ${e.cmd}`).join("\n\n")}`
    : ""
}

${ansi.gray("Docs: https://github.com/rjoydip/swagen")}
`);
}

// ─── Misc text utils ──────────────────────────────────────────────────────────

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + "...";
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function hr(char = "─", width = 64): string {
  return char.repeat(width);
}

export function countNewlines(s: string, upTo: number): number {
  let count = 0;
  for (let i = 0; i < upTo && i < s.length; i++) {
    if (s[i] === "\n") count++;
  }
  return count;
}
