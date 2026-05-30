/**
 * bot/specs.ts — Spec-file detection utilities (zero side-effects).
 */

export function findChangedSpecs(
  commits: Array<{ added?: string[]; modified?: string[] }>,
): string[] {
  const specFiles = ["openapi.yaml", "openapi.json", "swagger.yaml", "swagger.json"];
  return commits
    .flatMap((c) => [...(c.added ?? []), ...(c.modified ?? [])])
    .filter((f: string) => specFiles.includes(f));
}
