import type { Finding, Severity } from "./rules/types.js";
import { type Score, type Delta, countBySeverity, SEVERITIES } from "./score.js";

// Renders the PR-comment scorecard as Markdown. Leads with a sticky marker so
// the GitHub Action can find-and-update one comment instead of spamming a new
// one per push. The band is the headline; the delta is the accountability line;
// coverage is the trust caveat.

export const STICKY_MARKER = "<!-- factory-kit-check:scorecard -->";

const BAND_HEADLINE: Record<Score["band"], string> = {
  pass: "✅ Pass",
  warn: "⚠️ Warn",
  fail: "❌ Fail",
};

const SEV_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`; // U+2212 minus, renders cleanly on GitHub
  return "0";
}

// Net per-severity change: additions raise the count, fixes lower it.
function deltaCounts(d: Delta): Record<Severity, number> {
  const added = countBySeverity(d.added);
  const fixed = countBySeverity(d.fixed);
  const net = {} as Record<Severity, number>;
  for (const sev of SEVERITIES) net[sev] = added[sev] - fixed[sev];
  return net;
}

function prSummaryLine(d: Delta): string {
  const net = deltaCounts(d);
  const crit = d.newCritical > 0 ? `❌ ${d.newCritical} new critical` : "✅ no new criticals";
  const parts = [crit];
  for (const sev of ["high", "medium", "low"] as Severity[]) {
    if (net[sev] !== 0) parts.push(`${signed(net[sev])} ${sev}`);
  }
  return parts.join(" · ");
}

function findingLine(f: Finding): string {
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  return `- **${SEV_LABEL[f.severity]}** · ${f.message} · \`${loc}\` · ${f.skillRef}`;
}

export function renderScorecard(score: Score, delta?: Delta): string {
  const lines: string[] = [];
  lines.push(STICKY_MARKER);
  lines.push(`## 🏭 Factory conformance — ${BAND_HEADLINE[score.band]}`);
  lines.push("");

  if (delta) {
    lines.push(`This PR: ${prSummaryLine(delta)}`);
    lines.push("");
  }

  // Severity table — repo absolute, plus the PR delta column when we have a base.
  const net = delta ? deltaCounts(delta) : null;
  lines.push(net ? "| Severity | Repo | This PR |" : "| Severity | Repo |");
  lines.push(net ? "|----------|------|---------|" : "|----------|------|");
  for (const sev of SEVERITIES) {
    const row = net
      ? `| ${SEV_LABEL[sev]} | ${score.counts[sev]} | ${signed(net[sev])} |`
      : `| ${SEV_LABEL[sev]} | ${score.counts[sev]} |`;
    lines.push(row);
  }
  lines.push("");

  // Itemise only what's newly introduced — that's what the reviewer must act on.
  if (delta && delta.added.length > 0) {
    lines.push("**New this PR**");
    const order: Severity[] = ["critical", "high", "medium", "low"];
    const sorted = [...delta.added].sort(
      (a, b) => order.indexOf(a.severity) - order.indexOf(b.severity)
    );
    for (const f of sorted) lines.push(findingLine(f));
    lines.push("");
  }

  // Coverage — the trust caveat. A green band under thin coverage is not "all clear".
  const denom = score.coverage.activeRules + score.coverage.uncovered;
  const pct = Math.round(score.coverage.pct * 100);
  lines.push(
    `Coverage: ${score.coverage.activeRules}/${denom} pitfalls machine-checked (${pct}%).`
  );
  if (score.coverage.criticalUncovered.length > 0) {
    const ids = score.coverage.criticalUncovered.map((p) => `\`${p.id}\``).join(", ");
    lines.push(
      `> ⚠️ ${score.coverage.criticalUncovered.length} critical-class pitfalls are **not** machine-checked — ` +
        `a passing grade does not clear them: ${ids}.`
    );
  }

  return lines.join("\n");
}
