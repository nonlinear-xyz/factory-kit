import { describe, it, expect } from "vitest";
import {
  bandFor,
  coverageFor,
  countBySeverity,
  score,
  delta,
  deltaBlocks,
} from "../score.js";
import { UNCOVERED } from "../rules/index.js";
import type { Finding, Severity } from "../rules/types.js";

const finding = (severity: Severity, file: string, line?: number): Finding => ({
  ruleId: `rule-${severity}`,
  severity,
  file,
  line,
  message: `${severity} finding`,
  skillRef: "factory-test.md §x",
});

describe("bandFor — severity-gated, threshold-free", () => {
  it("one critical ⇒ fail, even amid otherwise-clean code", () => {
    expect(bandFor({ critical: 1, high: 0, medium: 0, low: 0 })).toBe("fail");
  });

  it("critical dominates — cannot be averaged away by clean cosmetics", () => {
    expect(bandFor({ critical: 1, high: 0, medium: 0, low: 99 })).toBe("fail");
  });

  it("high (no critical) ⇒ warn", () => {
    expect(bandFor({ critical: 0, high: 1, medium: 5, low: 5 })).toBe("warn");
  });

  it("medium/low only ⇒ pass (they inform, they do not gate)", () => {
    expect(bandFor({ critical: 0, high: 0, medium: 12, low: 7 })).toBe("pass");
  });

  it("clean ⇒ pass", () => {
    expect(bandFor({ critical: 0, high: 0, medium: 0, low: 0 })).toBe("pass");
  });
});

describe("countBySeverity", () => {
  it("tallies each severity", () => {
    const counts = countBySeverity([
      finding("critical", "a.ts", 1),
      finding("high", "b.ts", 2),
      finding("high", "c.ts", 3),
      finding("low", "d.ts", 4),
    ]);
    expect(counts).toEqual({ critical: 1, high: 2, medium: 0, low: 1 });
  });
});

describe("coverageFor — honest denominator", () => {
  it("pct = activeRules / (activeRules + uncovered)", () => {
    const cov = coverageFor(6, UNCOVERED);
    expect(cov.activeRules).toBe(6);
    expect(cov.uncovered).toBe(UNCOVERED.length);
    expect(cov.pct).toBeCloseTo(6 / (6 + UNCOVERED.length));
  });

  it("discloses critical-class pitfalls that have no rule", () => {
    const cov = coverageFor(6, UNCOVERED);
    expect(cov.criticalUncovered.length).toBeGreaterThan(0);
    expect(cov.criticalUncovered.every((p) => p.severityClass === "critical")).toBe(true);
    // a known critical-class backlog item is present
    expect(cov.criticalUncovered.map((p) => p.id)).toContain("phi-in-email-no-baa-check");
  });

  it("100% coverage when nothing is uncovered", () => {
    expect(coverageFor(6, []).pct).toBe(1);
  });
});

describe("score — composes counts, band, coverage", () => {
  it("a critical finding yields a failing score with its coverage caveat intact", () => {
    const s = score([finding("critical", "auth.ts", 10)], 6);
    expect(s.band).toBe("fail");
    expect(s.total).toBe(1);
    expect(s.counts.critical).toBe(1);
    expect(s.coverage.criticalUncovered.length).toBeGreaterThan(0);
  });
});

describe("delta — identity by (rule, file, line)", () => {
  const base = [finding("high", "a.ts", 5), finding("medium", "b.ts", 9)];

  it("new finding on a touched line is `added`", () => {
    const head = [...base, finding("critical", "c.ts", 3)];
    const d = delta(base, head);
    expect(d.added.map((f) => f.file)).toEqual(["c.ts"]);
    expect(d.newCritical).toBe(1);
    expect(d.fixed).toEqual([]);
  });

  it("a removed finding is `fixed`", () => {
    const head = [finding("high", "a.ts", 5)];
    const d = delta(base, head);
    expect(d.fixed.map((f) => f.file)).toEqual(["b.ts"]);
    expect(d.added).toEqual([]);
  });

  it("same rule on a different line counts as new", () => {
    const head = [finding("high", "a.ts", 5), finding("high", "a.ts", 42)];
    const d = delta(base, head);
    expect(d.newHigh).toBe(1);
    expect(d.added[0]?.line).toBe(42);
  });

  it("identical sets ⇒ no delta", () => {
    expect(delta(base, base)).toMatchObject({ added: [], fixed: [], newCritical: 0, newHigh: 0 });
  });
});

describe("deltaBlocks — the guardrail knob", () => {
  it("blocks on a new critical by default", () => {
    expect(deltaBlocks({ added: [], fixed: [], newCritical: 1, newHigh: 0 })).toBe(true);
  });

  it("does NOT block on a new high by default (pre-existing debt never blocks; new high warns)", () => {
    expect(deltaBlocks({ added: [], fixed: [], newCritical: 0, newHigh: 3 })).toBe(false);
  });

  it("blocks on a new high when gateOnHigh is set", () => {
    expect(deltaBlocks({ added: [], fixed: [], newCritical: 0, newHigh: 1 }, true)).toBe(true);
  });

  it("clean delta never blocks", () => {
    expect(deltaBlocks({ added: [], fixed: [], newCritical: 0, newHigh: 0 }, true)).toBe(false);
  });
});
