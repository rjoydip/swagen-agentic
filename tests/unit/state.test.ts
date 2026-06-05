/**
 * tests/unit/state.test.ts
 * Unit tests for tools/state.ts — RunRecord persistence.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { saveRunRecord, listRunRecords, getLastRun } from "../../src/tools/state.ts";
import type { RunRecord } from "../../src/core/types.ts";

const DIR = ".swagen/runs";

function makeRecord(id: string): RunRecord {
  return {
    id,
    timestamp: new Date().toISOString(),
    endpointCount: 3,
    generatedFiles: ["tests/api/pets.test.ts"],
  };
}

describe("state — saveRunRecord", () => {
  beforeEach(() => {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
  });

  it("creates the runs directory and writes a JSON file", async () => {
    await saveRunRecord(makeRecord("rec1"));
    expect(existsSync(DIR)).toBe(true);
    const file = Bun.file(`${DIR}/rec1.json`);
    expect(await file.exists()).toBe(true);
    const content = JSON.parse(await file.text()) as RunRecord;
    expect(content.id).toBe("rec1");
  });

  it("overwrites existing record with same id", async () => {
    await saveRunRecord(makeRecord("dup"));
    await saveRunRecord({ ...makeRecord("dup"), endpointCount: 99 });
    const records = await listRunRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.endpointCount).toBe(99);
  });
});

describe("state — listRunRecords", () => {
  beforeEach(() => {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
  });

  it("returns empty array when runs directory does not exist", async () => {
    expect(await listRunRecords()).toEqual([]);
  });

  it("returns records sorted newest first", async () => {
    const old = makeRecord("old");
    old.timestamp = "2025-01-01T00:00:00.000Z";
    const recent = makeRecord("recent");
    recent.timestamp = "2026-06-01T00:00:00.000Z";
    await saveRunRecord(old);
    await saveRunRecord(recent);
    const records = await listRunRecords();
    expect(records).toHaveLength(2);
    expect(records[0]?.id).toBe("recent");
    expect(records[1]?.id).toBe("old");
  });

  it("skips corrupted JSON files silently", async () => {
    await saveRunRecord(makeRecord("good"));
    await Bun.write(`${DIR}/bad.json`, "not-json");
    const records = await listRunRecords();
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe("good");
  });
});

describe("state — getLastRun", () => {
  beforeEach(() => {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
  });

  afterEach(() => {
    if (existsSync(DIR)) rmSync(DIR, { recursive: true, force: true });
  });

  it("returns null when no records exist", async () => {
    expect(await getLastRun()).toBeNull();
  });

  it("returns the most recent record", async () => {
    await saveRunRecord(makeRecord("first"));
    await Bun.sleep(1);
    await saveRunRecord(makeRecord("second"));
    const last = await getLastRun();
    expect(last?.id).toBe("second");
  });
});
