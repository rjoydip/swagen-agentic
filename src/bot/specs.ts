/**
 * bot/specs.ts — Spec-file detection utilities (zero side-effects).
 */

import { SPEC_FILES } from "./shared";

export function findChangedSpecs(
  commits: Array<{ added?: string[]; modified?: string[] }>,
): string[] {
  return commits
    .flatMap((c) => [...(c.added ?? []), ...(c.modified ?? [])])
    .filter((f: string) => SPEC_FILES.some((s) => f.endsWith(s)));
}
