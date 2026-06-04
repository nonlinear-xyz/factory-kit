import type { Finding, Severity, UncoveredPitfall } from "./rules/types.js";
import { UNCOVERED } from "./rules/index.js";

// The score model. Pure — no I/O, no printing. This is the unit the tests
// exercise and the data the scorecard renders. Design thesis: the precision of
// the verdict must match the precision of the instrument. v0 detection is
// regex/line-heuristic, so the verdict is a BAND (pass/warn/fail), never a
// false-precision number. One critical is disqualifying; you cannot average a
// data-loss bug away with clean cosmetics.

export type Band = "pass" | "warn" | "fail";

export type SeverityCounts = Record<Severity, number>;

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];

export interface Coverage {
  activeRules: number;
  uncovered: number;
  /** activeRules / (activeRules + uncovered), in [0,1]. */
  pct: number;
  /** Critical-class pitfalls with no rule — the green-grade caveat. */
  criticalUncovered: UncoveredPitfall[];
}

export interface Score {
  band: Band;
  counts: SeverityCounts;
  total: number;
  coverage: Coverage;
}

export interface Delta {
  added: Finding[];
  fixed: Finding[];
  newCritical: number;
  newHigh: number;
}

export function countBySeverity(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

// Severity-gated banding. Critical → fail (one is too many); high → warn; else
// pass. Medium/low never flip the band — they show in the counts, not the gate.
// Deliberately threshold-free: a tunable "N mediums = warn" knob would be a
// number we'd have to defend, and the instrument isn't precise enough to earn it.
export function bandFor(counts: SeverityCounts): Band {
  if (counts.critical > 0) return "fail";
  if (counts.high > 0) return "warn";
  return "pass";
}

export function coverageFor(activeRules: number, uncovered: UncoveredPitfall[] = UNCOVERED): Coverage {
  const total = activeRules + uncovered.length;
  return {
    activeRules,
    uncovered: uncovered.length,
    pct: total === 0 ? 1 : activeRules / total,
    criticalUncovered: uncovered.filter((p) => p.severityClass === "critical"),
  };
}

export function score(findings: Finding[], activeRules: number): Score {
  const counts = countBySeverity(findings);
  return {
    band: bandFor(counts),
    counts,
    total: findings.length,
    coverage: coverageFor(activeRules),
  };
}

// Finding identity for delta. A finding is "the same" across base and head if it
// has the same rule, file, and line. (No line ⇒ repo-level finding, keyed by
// rule+file.) This is what lets the PR gate fire on NEW criticals only — the
// non-disruptive contract: pre-existing debt never blocks, regressions do.
function key(f: Finding): string {
  return `${f.ruleId}::${f.file}::${f.line ?? ""}`;
}

export function delta(base: Finding[], head: Finding[]): Delta {
  const baseKeys = new Set(base.map(key));
  const headKeys = new Set(head.map(key));
  const added = head.filter((f) => !baseKeys.has(key(f)));
  const fixed = base.filter((f) => !headKeys.has(key(f)));
  return {
    added,
    fixed,
    newCritical: added.filter((f) => f.severity === "critical").length,
    newHigh: added.filter((f) => f.severity === "high").length,
  };
}

// The delta gate. Default: a PR blocks only when it introduces a new critical.
// `gateOnHigh` (from .factory-check.json) tightens it to new-high as well. This
// is the single knob that decides "guardrail" vs "disruption".
export function deltaBlocks(d: Delta, gateOnHigh = false): boolean {
  return d.newCritical > 0 || (gateOnHigh && d.newHigh > 0);
}

export { SEVERITIES };
