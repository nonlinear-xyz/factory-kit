import type { RepoConfig, Ticket, Verdict } from "./types.js";

export function prepPrompt(t: Ticket): string {
  return `Run the factory-prep skill for Linear ticket ${t.identifier} ("${t.title}", ${t.url}).
This is an unattended autopilot run: nobody will answer questions. Write the working doc exactly as the skill says. Do not edit code.
End your final message with one line \`VERDICT: <Ready | Split | Blocked | Needs decision>\`. If the verdict is not Ready, add one line \`REASON: <one sentence>\`.`;
}

export function parseVerdict(text: string): { verdict: Verdict | null; reason: string } {
  const all = [...text.matchAll(/VERDICT:\s*\**\s*(Ready|Split|Blocked|Needs decision)/gi)];
  const raw = all.at(-1)?.[1]?.toLowerCase();
  const verdict: Verdict | null =
    raw === "ready" ? "Ready" : raw === "split" ? "Split" : raw === "blocked" ? "Blocked" : raw === "needs decision" ? "Needs decision" : null;
  const reason = [...text.matchAll(/REASON:\s*(.+)/gi)].at(-1)?.[1]?.trim() ?? "";
  return { verdict, reason };
}

export function buildPrompt(t: Ticket, cfg: RepoConfig, dir: string, branch: string): string {
  const deny = cfg.autopilot.denyPaths.length ? cfg.autopilot.denyPaths.map((p) => `  - ${p}`).join("\n") : "  (none)";
  return `Implement Linear ticket ${t.identifier}: "${t.title}" (${t.url}). Follow the factory-autopilot skill.
The ticket's working doc (## Prep, ## Codebase, ## State model) was just written by prep: read it and treat it as the plan.

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
