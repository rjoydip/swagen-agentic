import { SwagenHarness } from "./harness.ts";
import type { HarnessRunOptions } from "./harness.ts";
import { resolveConfig } from "./core/config.ts";
import { loadSpec, analyzeSpec } from "./core/spec.ts";
import { buildOrchestratorGeneratePrompt, buildParallelAgentPrompt } from "./core/prompts.ts";
import type { SwagenConfig } from "./core/types.ts";

export interface ParallelTask {
  id: string;
  prompt: string;
  specSource?: string;
  sessionId?: string;
  config?: Partial<SwagenConfig>;
}

export interface ParallelTaskResult {
  id: string;
  sessionId: string;
  writtenFiles: string[];
  endpointCount: number;
  agentSummary: string;
  error?: string;
}

export interface OrchestratorOptions {
  concurrency?: number;
}

const DEFAULT_OPTIONS: OrchestratorOptions = {
  concurrency: 3,
};

/**
 * Runs multiple agent tasks concurrently with a controlled concurrency limit.
 */
export async function runParallel(
  tasks: ParallelTask[],
  options: OrchestratorOptions = {},
): Promise<ParallelTaskResult[]> {
  const { concurrency = 3 } = { ...DEFAULT_OPTIONS, ...options };
  const results: ParallelTaskResult[] = [];

  const pool = [...tasks];
  let running = 0;
  let idx = 0;

  return new Promise<ParallelTaskResult[]>((resolve) => {
    function next() {
      if (pool.length === 0 && running === 0) {
        resolve(results);
        return;
      }

      while (running < concurrency && pool.length > 0) {
        const task = pool.shift()!;
        const taskIdx = idx++;
        running++;

        runTask(task, taskIdx)
          .then((result) => {
            results.push(result);
            running--;
            next();
          })
          .catch((err: Error) => {
            results.push({
              id: task.id,
              sessionId: "",
              writtenFiles: [],
              endpointCount: 0,
              agentSummary: "",
              error: err.message,
            });
            running--;
            next();
          });
      }
    }

    next();
  });
}

async function runTask(task: ParallelTask, _idx: number): Promise<ParallelTaskResult> {
  const config = await resolveConfig(task.config);
  const harness = await SwagenHarness.create(config);

  try {
    const runOptions: HarnessRunOptions & Record<string, unknown> = {
      prompt: task.prompt,
      persist: !config.dryRun,
    };
    if (task.sessionId) runOptions.sessionId = task.sessionId;
    const result = await harness.runToCompletion(runOptions as HarnessRunOptions);

    return {
      id: task.id,
      sessionId: result.sessionId,
      writtenFiles: result.writtenFiles,
      endpointCount: result.endpointCount,
      agentSummary: result.agentSummary,
    };
  } finally {
    await harness.clearCache();
  }
}

/**
 * Splits a spec's endpoints across multiple agent tasks and runs them in parallel.
 * Each agent generates tests for a subset of the endpoints.
 */
export async function splitAndGenerate(
  specPath: string,
  numAgents: number,
  configOverride: Partial<SwagenConfig> = {},
  options: OrchestratorOptions = {},
): Promise<{
  results: ParallelTaskResult[];
  totalEndpoints: number;
  totalFiles: string[];
}> {
  const config = await resolveConfig(configOverride);
  const specSource = specPath.startsWith("http")
    ? { kind: "url" as const, url: specPath }
    : { kind: "file" as const, path: specPath };

  const doc = await loadSpec(specSource);
  const { endpoints } = analyzeSpec(doc, config);

  if (endpoints.length === 0) {
    return { results: [], totalEndpoints: 0, totalFiles: [] };
  }

  if (numAgents <= 1) {
    const harness = await SwagenHarness.create(config);
    const result = await harness.runToCompletion({
      prompt: buildOrchestratorGeneratePrompt({ specPath, config }),
      persist: !config.dryRun,
    });

    return {
      results: [
        {
          id: "all",
          sessionId: result.sessionId,
          writtenFiles: result.writtenFiles,
          endpointCount: result.endpointCount,
          agentSummary: result.agentSummary,
        },
      ],
      totalEndpoints: result.endpointCount,
      totalFiles: result.writtenFiles,
    };
  }

  // Split endpoints into chunks
  const tags = [...new Set(endpoints.flatMap((ep) => ep.tags))];
  const chunkSize = Math.ceil(tags.length / numAgents);
  const tagChunks: string[][] = [];
  for (let i = 0; i < tags.length; i += chunkSize) {
    tagChunks.push(tags.slice(i, i + chunkSize));
  }

  const tasks: ParallelTask[] = tagChunks.map((tagGroup, i) => ({
    id: `agent-${i + 1}`,
    prompt: buildParallelAgentPrompt({
      agentIndex: i,
      totalAgents: tagChunks.length,
      tags: tagGroup,
      specPath,
      config,
    }),
  }));

  const results = await runParallel(tasks, options);

  const totalEndpoints = results.reduce((s, r) => s + r.endpointCount, 0);
  const totalFiles = [...new Set(results.flatMap((r) => r.writtenFiles))];

  return { results, totalEndpoints, totalFiles };
}
