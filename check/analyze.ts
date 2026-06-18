import { walk } from "./walk.js";
import { loadConfig } from "./config.js";
import { rules } from "./rules/index.js";
import { score, delta as computeDelta, deltaBlocks, type Score, type Delta } from "./score.js";
import { refExists, filesAtRef } from "./git.js";
import type { Finding, RepoFile } from "./rules/types.js";

// The pure analysis core: files/git in, structured verdict out. No console, no
// process.exit — that lives in runner.ts (the CLI). This is the unit the MCP
// server and the observatory SaaS import; both want the VALUE, not printed text.

/**
 * Run the active rule set over already-walked files, routed by language tag.
 * Pure — no I/O, no printing. The seam the rule suite exercises directly.
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

export interface AnalyzeOptions {
  targetDir: string;
  /** Ref to diff against. Enables the delta and the new-critical gate. */
  base?: string;
}

// Walk-level tallies the human report wants. Grouped so the core verdict
// (score/delta/blocking/findings) stays clean for programmatic consumers.
export interface AnalysisStats {
  scanned: number;
  skipped: number;
  activeRules: number;
  disabledRules: number;
}

export interface Analysis {
  score: Score;
  /** Non-null only when `base` was given AND resolvable. */
  delta: Delta | null;
  /** New-critical delta gate when `delta` present, else the whole-repo gate. */
  blocking: boolean;
  /** Full head findings (not scoped to changed files). */
  findings: Finding[];
  stats: AnalysisStats;
}

/**
 * Config → walk → collect → (optionally diff a base ref) → score → gate.
 * Read-only throughout the target working tree. The score/coverage and the gate
 * are always computed on the FULL head set — display scoping is the caller's job.
 */
export async function analyze(opts: AnalyzeOptions): Promise<Analysis> {
  // Config first — its ignorePaths shape the walk, and must apply identically to
  // the head walk and the base-ref walk so the delta stays symmetric.
  const config = await loadConfig(opts.targetDir);
  const { files, scanned, skipped } = await walk(opts.targetDir, config.ignorePaths);
  const activeRules = rules.length - config.disabledRules.size;

  const findings = collectFindings(files, config.disabledRules);

  let delta: Delta | null = null;
  if (opts.base && (await refExists(opts.targetDir, opts.base))) {
    const baseFiles = await filesAtRef(opts.targetDir, opts.base, config.ignorePaths);
    const baseFindings = collectFindings(baseFiles, config.disabledRules);
    delta = computeDelta(baseFindings, findings);
  }

  const blocking = delta ? hasBlockingDelta(delta, config.gateOnHigh) : hasBlocking(findings);

  return {
    score: score(findings, activeRules),
    delta,
    blocking,
    findings,
    stats: { scanned, skipped, activeRules, disabledRules: config.disabledRules.size },
  };
}
