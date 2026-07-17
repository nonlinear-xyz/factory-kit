import { report } from "./report.js";
import { UNCOVERED } from "./rules/index.js";
import { renderScorecard } from "./scorecard.js";
import { changedFiles } from "./git.js";
import { analyze } from "./analyze.js";

// Pure core lives in analyze.ts. Re-exported here so existing importers
// (engine.test.ts, the bin shim's neighbours) keep their import path.
export { collectFindings, hasBlocking, hasBlockingDelta, analyze } from "./analyze.js";
export type { Analysis, AnalysisStats, AnalyzeOptions } from "./analyze.js";

export type OutputFormat = "term" | "json" | "md";

export interface RunOptions {
  targetDir: string;
  /** Ref to diff against. Enables the delta column and the new-critical gate. */
  base?: string;
  /** Scope reported findings to files changed vs `base`. No-op without `base`. */
  diffOnly?: boolean;
  /** term (default) prints the human report; json/md print machine output. */
  format?: OutputFormat;
}

/**
 * The CLI surface: analyze → print per format → exit code. All computation is
 * delegated to analyze() (pure); this function owns only I/O. Default behaviour
 * is unchanged: full scan, human report, exit 1 on any critical/high. With
 * `base`, the exit code follows the new-critical delta gate. Read-only throughout.
 */
export async function run(opts: RunOptions): Promise<number> {
  const { score, delta, blocking, findings, stats } = await analyze({
    targetDir: opts.targetDir,
    base: opts.base,
  });

  // What we *display* may be scoped to changed files; the score/coverage and the
  // gate were already computed on the full head set inside analyze().
  let shown = findings;
  if (opts.diffOnly && delta && opts.base) {
    const changed = new Set(await changedFiles(opts.targetDir, opts.base));
    shown = findings.filter((f) => changed.has(f.file));
  }

  const format = opts.format ?? "term";
  if (format === "json") {
    console.log(JSON.stringify({ score, delta, blocking }, null, 2));
  } else if (format === "md") {
    console.log(renderScorecard(score, delta ?? undefined));
  } else {
    report(shown, {
      rulesRun: stats.activeRules,
      rulesDisabled: stats.disabledRules,
      filesScanned: stats.scanned,
      filesSkipped: stats.skipped,
      uncovered: UNCOVERED,
    });
  }

  return blocking ? 1 : 0;
}
