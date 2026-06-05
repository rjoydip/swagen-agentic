import type { CoverageGap } from "../core/types.ts";

export interface CoverageReport {
  totalEntities: number;
  covered: number;
  partial: number;
  uncovered: number;
  low: number;
  coveragePct: number;
  gaps: CoverageGap[];
}

export function buildCoverageReport(gaps: CoverageGap[], totalEntities: number): CoverageReport {
  // scanCoverage pre-filters to only non-"full" gaps, so "covered" is inferred
  const partial = gaps.filter((g) => g.coverage === "partial").length;
  const low = gaps.filter((g) => g.coverage === "low").length;
  const uncovered = gaps.filter((g) => g.coverage === "none").length;
  const covered = totalEntities - partial - low - uncovered;

  const tracked = totalEntities;
  const coveragePct = tracked > 0 ? (covered / tracked) * 100 : 0;

  return {
    totalEntities,
    covered,
    partial,
    uncovered,
    low,
    coveragePct,
    gaps,
  };
}

export function formatCoverageReport(
  report: CoverageReport,
  options: { showGaps?: boolean; gapLimit?: number } = {},
): string {
  const { showGaps = true, gapLimit = 20 } = options;
  const lines: string[] = [
    "## Coverage Report",
    `- Total entities: ${report.totalEntities}`,
    `- Fully covered: ${report.covered}`,
    `- Partially covered: ${report.partial}`,
    `- Low coverage: ${report.low}`,
    `- Uncovered: ${report.uncovered}`,
    `- Coverage: ${report.coveragePct.toFixed(1)}%`,
  ];

  if (showGaps && report.gaps.length > 0) {
    const priorityGaps = report.gaps.filter((g) => g.coverage !== "full");
    if (priorityGaps.length > 0) {
      lines.push("", "### Priority Gaps (uncovered or low)");
      for (const gap of priorityGaps.slice(0, gapLimit)) {
        lines.push(
          `- ${gap.entity.name} (${gap.entity.file}:${gap.entity.line}) — ${gap.gapDescription}`,
        );
      }
      if (priorityGaps.length > gapLimit) {
        lines.push(`  ... and ${priorityGaps.length - gapLimit} more`);
      }
    }
  }

  return lines.join("\n");
}

export function groupGapsByFile(gaps: CoverageGap[]): Map<string, CoverageGap[]> {
  const byFile = new Map<string, CoverageGap[]>();
  for (const gap of gaps) {
    const file = gap.entity.file;
    const existing = byFile.get(file) ?? [];
    existing.push(gap);
    byFile.set(file, existing);
  }
  return byFile;
}
