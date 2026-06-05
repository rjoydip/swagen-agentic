import type { SourceEntity, CoverageGap, CodebaseAnalysis } from "../core/types.ts";
import { scanCoverage } from "./scanner.ts";
import { buildCoverageReport, formatCoverageReport } from "./reporter.ts";

export interface CoverageOptions {
  sourceEntities: SourceEntity[];
  testFiles: string[];
  baseDir: string;
}

export function analyzeCoverage(options: CoverageOptions): CoverageGap[] {
  return scanCoverage({
    sourceEntities: options.sourceEntities,
    testFiles: options.testFiles,
    baseDir: options.baseDir,
  });
}

export function generateCoverageReport(
  analysis: CodebaseAnalysis,
  testFiles: string[],
  baseDir: string,
): string {
  const gaps = scanCoverage({
    sourceEntities: analysis.entities,
    testFiles,
    baseDir,
  });
  const report = buildCoverageReport(gaps, analysis.entities.length);
  return formatCoverageReport(report);
}

export function enrichAnalysisWithCoverage(
  analysis: CodebaseAnalysis,
  testFiles: string[],
  baseDir: string,
): CodebaseAnalysis {
  const gaps = scanCoverage({
    sourceEntities: analysis.entities,
    testFiles,
    baseDir,
  });
  return { ...analysis, coverageGaps: gaps };
}

export { scanCoverage } from "./scanner.ts";
export { buildCoverageReport, formatCoverageReport, groupGapsByFile } from "./reporter.ts";
export type { CoverageReport } from "./reporter.ts";
