import type { CodebaseAnalysis, SourceEntity } from "../core/types.ts";

export function formatDiscoveryPrompt(analysis: CodebaseAnalysis): string {
  const lines: string[] = [
    "## Codebase Discovery Results",
    `- Framework: ${analysis.framework}`,
    `- Total entities found: ${analysis.entities.length}`,
    `- Functions: ${analysis.entities.filter((e) => e.type === "function").length}`,
    `- Classes: ${analysis.entities.filter((e) => e.type === "class").length}`,
    `- Exports: ${analysis.entities.filter((e) => e.isExported).length}`,
    `- API endpoints detected: ${analysis.apiEndpoints.length}`,
    `- Entry points: ${analysis.entryPoints.join(", ")}`,
  ];

  if (analysis.coverageGaps.length > 0) {
    lines.push("", "### Coverage Gaps");
    for (const gap of analysis.coverageGaps.slice(0, 20)) {
      lines.push(`- ${gap.entity.name} (${gap.entity.file}:${gap.entity.line}) — ${gap.coverage}`);
    }
    if (analysis.coverageGaps.length > 20) {
      lines.push(`  ... and ${analysis.coverageGaps.length - 20} more`);
    }
  }

  return lines.join("\n");
}

export function formatEntitySummary(entities: SourceEntity[], limit = 50): string {
  const lines = entities
    .slice(0, limit)
    .map(
      (e) =>
        `  ${e.type} ${e.name}${e.isExported ? " (exported)" : ""}${e.isAsync ? " async" : ""} — ${e.file}:${e.line}`,
    );
  return lines.join("\n");
}
