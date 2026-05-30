import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RunRecord } from "../core/types.ts";

const DIR = ".swagen/runs";

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

export async function saveRunRecord(record: RunRecord): Promise<void> {
  ensureDir();
  await Bun.write(join(DIR, `${record.id}.json`), JSON.stringify(record, null, 2));
}

export async function listRunRecords(): Promise<RunRecord[]> {
  if (!existsSync(DIR)) return [];
  const glob = new Bun.Glob("*.json");
  const records: RunRecord[] = [];
  for await (const file of glob.scan(DIR)) {
    try {
      records.push(JSON.parse(await Bun.file(join(DIR, file)).text()));
    } catch {}
  }
  return records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export async function getLastRun(): Promise<RunRecord | null> {
  return (await listRunRecords())[0] ?? null;
}
