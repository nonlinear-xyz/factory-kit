import { walk } from "./walk.js";
import { loadConfig } from "./config.js";
import { report } from "./report.js";
import { rules, UNCOVERED } from "./rules/index.js";
import { score, delta as computeDelta, deltaBlocks, type Delta } from "./score.js";
import { renderScorecard } from "./scorecard.js";
import { refExists, changedFiles, filesAtRef } from "./git.js";
import type { Finding, RepoFile } from "./rules/types.js";

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
 * Pure core: run the active rule set over already-walked files, routed by
 * language tag. No I/O, no printing — this is the unit the tests exercise.
 */
export function collectFindings(files: RepoFile[], disabled: Set<string> = new Set()): Finding[] {
  const active = rules.filter((r) => !disabled.has(r.id));
  const findings: Finding[] = [];

  for (const rule of active) {
    const applicable = (f: RepoFile) => rule.languages.includes(f.lang);

    if (rule.detectFile) {
      for (const file of files) {
        if (!applicable(file)) continue;
        findings.push(...rule.detectFile(file));
      }
    }
    if (rule.detectRepo) {
      findings.push(...rule.detectRepo(files.filter(applicable)));
    }
  }
  return findings;
}

/** True if any finding gates merge (critical/high) — the whole-repo gate. */
export function hasBlocking(findings: Finding[]): boolean {
  return findings.some((f) => f.severity === "critical" || f.severity === "high");
}

/**
 * The PR gate: blocks only on a NEW critical (or new high when `gateOnHigh`).
 * Pre-existing debt never blocks — that is the non-disruptive contract.
 */
export function hasBlockingDelta(d: Delta, gateOnHigh = false): boolean {
  return deltaBlocks(d, gateOnHigh);
}

/**
 * Walk → collect → (optionally diff a base ref) → report/score → exit code.
 * Default behaviour is unchanged: full scan, human report, exit 1 on any
 * critical/high. With `base`, the exit code follows the new-critical delta gate.
 * Read-only throughout the target working tree.
 */
export async function run(opts: RunOptions): Promise<number> {
  // Config first — its ignorePaths shape the walk, and must apply identically
  // to the head walk and the base-ref walk so the delta stays symmetric.
  const config = await loadConfig(opts.targetDir);
  const { files, scanned, skipped } = await walk(opts.targetDir, config.ignorePaths);
  const activeRuleCount = rules.length - config.disabledRules.size;

  const headFindings = collectFindings(files, config.disabledRules);

  // Delta path — only when a base ref is given and actually resolvable.
  let d: Delta | undefined;
  let baseUsable = false;
  if (opts.base && (await refExists(opts.targetDir, opts.base))) {
    baseUsable = true;
    const baseFiles = await filesAtRef(opts.targetDir, opts.base, config.ignorePaths);
    const baseFindings = collectFindings(baseFiles, config.disabledRules);
    d = computeDelta(baseFindings, headFindings);
  }

  // What we *display* (may be scoped to changed files); the score/coverage and
  // the gate are always computed on the full head set.
  let shown = headFindings;
  if (opts.diffOnly && baseUsable) {
    const changed = new Set(await changedFiles(opts.targetDir, opts.base!));
    shown = headFindings.filter((f) => changed.has(f.file));
  }

  const headScore = score(headFindings, activeRuleCount);
  const gate = d ? hasBlockingDelta(d, config.gateOnHigh) : hasBlocking(headFindings);

  const format = opts.format ?? "term";
  if (format === "json") {
    console.log(JSON.stringify({ score: headScore, delta: d ?? null, blocking: gate }, null, 2));
  } else if (format === "md") {
    console.log(renderScorecard(headScore, d));
  } else {
    report(shown, {
      rulesRun: activeRuleCount,
      rulesDisabled: config.disabledRules.size,
      filesScanned: scanned,
      filesSkipped: skipped,
      uncovered: UNCOVERED,
    });
  }

  return gate ? 1 : 0;
}
