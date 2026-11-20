import type { RepoConfig, Ticket, Verdict } from "./types.js";

export function prepPrompt(t: Ticket, writeDoc: boolean): string {
  const doc = writeDoc
    ? "Write the working doc exactly as the skill says."
    : "This is a DRY RUN: do not write anything to Linear (no working doc, labels or comments). Print the ## Prep, ## Codebase and ## State model sections in your reply instead.";
  return `Run the factory-prep skill for Linear ticket ${t.identifier} ("${t.title}", ${t.url}).
This is an unattended autopilot run: nobody will answer questions. ${doc} Do not edit code.
End your final message with one line \`VERDICT: <Ready | Split | Blocked | Needs decision | Shipped | Duplicate>\`. If the verdict is not Ready, add one line \`REASON: <one sentence>\`.
For Shipped, add \`EVIDENCE: <commit sha on the default branch>\`. For Duplicate, add \`DUPLICATE_OF: <issue id>\`. The runner checks these before closing the ticket, so cite exactly.`;
}

const VERDICTS: Verdict[] = ["Ready", "Split", "Blocked", "Needs decision", "Shipped", "Duplicate"];

const last = (text: string, re: RegExp) => [...text.matchAll(re)].at(-1)?.[1]?.trim() ?? null;

export function parseVerdict(text: string): { verdict: Verdict | null; reason: string; evidence: string | null; duplicateOf: string | null } {
  const raw = last(text, /VERDICT:\s*\**\s*(Ready|Split|Blocked|Needs decision|Shipped|Duplicate)/gi)?.toLowerCase();
  return {
    verdict: VERDICTS.find((v) => v.toLowerCase() === raw) ?? null,
    reason: last(text, /REASON:\s*(.+)/gi) ?? "",
    evidence: last(text, /EVIDENCE:\s*`?([0-9a-f]{7,40})\b/gi),
    duplicateOf: last(text, /DUPLICATE_OF:\s*`?([A-Z][A-Z0-9]*-\d+)\b/gi)?.toUpperCase() ?? null,
  };
}

export function buildPrompt(t: Ticket, cfg: RepoConfig, dir: string, branch: string, prepNotes: string | null): string {
  const deny = cfg.autopilot.denyPaths.length ? cfg.autopilot.denyPaths.map((p) => `  - ${p}`).join("\n") : "  (none)";
  return `Implement Linear ticket ${t.identifier}: "${t.title}" (${t.url}). Follow the factory-autopilot skill.
${prepNotes ? `Prep's notes (dry run; treat them as the plan, and do not write to Linear):\n${prepNotes}\n` : "The ticket's working doc (## Prep, ## Codebase, ## State model) was just written by prep: read it and treat it as the plan."}

- Worktree: ${dir} (branch ${branch}). Work only here. Read AGENTS.md / CLAUDE.md first.
- Do not commit, push, open a PR or change the branch; the runner does that after its own checks.
- Never change these paths; a change there bounces the ticket:
${deny}
- Keep the change to what the ticket asks. No drive-by refactors.
- Before finishing, run \`${cfg.autopilot.verifyCmd}\` and fix everything it reports.

Your final message becomes the PR description: 3–8 lines on what changed, why, and how it was verified. Lead with "## State changes" if types or state changed.`;
}

export function fixPrompt(failures: string, verifyCmd: string): string {
  return `The runner's gate failed after your last turn. Fix these and run \`${verifyCmd}\` again. Same rules as before; do not commit or push.

${failures}

End with an updated PR description (3–8 lines).`;
}
