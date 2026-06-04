import { describe, it, expect } from "vitest";
import { renderScorecard, STICKY_MARKER } from "../scorecard.js";
import { score, delta } from "../score.js";
import type { Finding, Severity } from "../rules/types.js";

const finding = (severity: Severity, file: string, line: number): Finding => ({
  ruleId: `rule-${severity}`,
  severity,
  file,
  line,
  message: `${severity} thing`,
  skillRef: "factory-security.md §x",
});

describe("renderScorecard", () => {
  it("leads with the sticky marker so the Action updates one comment", () => {
    const md = renderScorecard(score([], 6));
    expect(md.startsWith(STICKY_MARKER)).toBe(true);
  });

  it("headlines the band", () => {
    expect(renderScorecard(score([finding("critical", "a.ts", 1)], 6))).toContain("❌ Fail");
    expect(renderScorecard(score([finding("high", "a.ts", 1)], 6))).toContain("⚠️ Warn");
    expect(renderScorecard(score([], 6))).toContain("✅ Pass");
  });

  it("omits the delta column when there is no base", () => {
    const md = renderScorecard(score([], 6));
    expect(md).toContain("| Severity | Repo |");
    expect(md).not.toContain("This PR");
  });

  it("shows the PR delta line and column when a base is supplied", () => {
    const base = [finding("medium", "b.ts", 2)];
    const head = [finding("high", "a.ts", 1)]; // +1 high, -1 medium
    const d = delta(base, head);
    const md = renderScorecard(score(head, 6), d);
    expect(md).toContain("This PR");
    expect(md).toContain("✅ no new criticals");
    expect(md).toContain("| Severity | Repo | This PR |");
    expect(md).toContain("**New this PR**");
    expect(md).toContain("`a.ts:1`");
  });

  it("flags new criticals in the summary line", () => {
    const d = delta([], [finding("critical", "auth.ts", 9)]);
    const md = renderScorecard(score([finding("critical", "auth.ts", 9)], 6), d);
    expect(md).toContain("1 new critical");
  });

  it("always discloses critical-class coverage gaps", () => {
    const md = renderScorecard(score([], 6));
    expect(md).toContain("critical-class pitfalls are **not** machine-checked");
  });
});
