import pc from "picocolors";
import type { Finding, Severity, UncoveredPitfall } from "./rules/types.js";
import { score, type Band } from "./score.js";

export interface ReportMeta {
  rulesRun: number;
  rulesDisabled: number;
  filesScanned: number;
  filesSkipped: number;
  // The eval backlog — known pitfalls with no rule yet. Surfaced so the tool
  // never implies full coverage (no silent caps).
  uncovered: UncoveredPitfall[];
}

const ORDER: Severity[] = ["critical", "high", "medium", "low"];

function badge(sev: Severity): string {
  switch (sev) {
    case "critical":
      return pc.bgRed(pc.white(" CRIT "));
    case "high":
      return pc.red(" HIGH ");
    case "medium":
      return pc.yellow(" MED  ");
    case "low":
      return pc.dim(" LOW  ");
  }
}

function bandHeader(band: Band): string {
  switch (band) {
    case "fail":
      return pc.bgRed(pc.white(" FAIL ")) + pc.red(" — critical findings present");
    case "warn":
      return pc.bgYellow(pc.black(" WARN ")) + pc.yellow(" — high-severity findings present");
    case "pass":
      return pc.bgGreen(pc.black(" PASS ")) + pc.green(" — no critical or high findings");
  }
}

function loc(f: Finding): string {
  return f.line ? `${f.file}:${f.line}` : f.file;
}

export function report(findings: Finding[], meta: ReportMeta): void {
  const s = score(findings, meta.rulesRun);

  console.log("");
  console.log(pc.bold("factory-kit-check") + pc.dim("  · read-only · we read and judge, we never write"));
  console.log("");

  // Verdict first — the band is the quick-guidance product; the findings are the
  // detail under it.
  console.log("  " + bandHeader(s.band));
  console.log("");

  if (findings.length === 0) {
    console.log(pc.green("  ✓ no findings"));
  } else {
    for (const sev of ORDER) {
      const group = findings.filter((f) => f.severity === sev);
      if (group.length === 0) continue;
      console.log(`${badge(sev)} ${pc.bold(String(group.length))} ${sev}`);
      for (const f of group) {
        console.log(`    ${pc.cyan(loc(f))}  ${f.message}`);
        console.log(`        ${pc.dim("→ " + f.skillRef)} ${pc.dim("[" + f.ruleId + "]")}`);
      }
      console.log("");
    }
  }

  // Footer — counts, the disabled-rule signal, and honest coverage.
  const counts = ORDER.map((sev) => `${s.counts[sev]} ${sev}`).join("  ");
  console.log(pc.dim("─".repeat(60)));
  console.log(`  ${counts}`);
  console.log(
    pc.dim(
      `  ${meta.rulesRun} rules run · ${meta.filesScanned} files scanned · ${meta.filesSkipped} skipped`
    )
  );
  if (meta.rulesDisabled > 0) {
    const warn = meta.rulesDisabled > 4 ? pc.yellow : pc.dim;
    console.log(
      warn(
        `  ${meta.rulesDisabled} rule(s) disabled` +
          (meta.rulesDisabled > 4 ? " — >4 disabled suggests the rule design is wrong, not the repo" : "")
      )
    );
  }

  // Coverage — how much to trust the band above.
  const pct = Math.round(s.coverage.pct * 100);
  console.log(
    pc.dim(
      `  coverage: ${s.coverage.activeRules}/${s.coverage.activeRules + s.coverage.uncovered} pitfalls machine-checked (${pct}%)`
    )
  );
  if (s.coverage.criticalUncovered.length > 0) {
    console.log(
      pc.yellow(
        `  ⚠ ${s.coverage.criticalUncovered.length} critical-class pitfalls are NOT machine-checked — ` +
          `a passing grade does not clear them`
      )
    );
  }
  console.log("");
}
