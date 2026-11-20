import { exec, must } from "./exec.js";
import type { AgentName, RepoConfig, Ticket } from "./types.js";
import { assertTicketBranch } from "./worktree.js";

export interface HandoffInput {
  cfg: RepoConfig;
  ticket: Ticket;
  dir: string;
  branch: string;
  agent: AgentName;
  summary: string;
  changedFiles: string[];
}

/** Commit, push the ticket branch and open a draft PR. Returns the PR URL. */
export function publish(h: HandoffInput): string {
  assertTicketBranch(h.branch, h.ticket.identifier);
  must("git", ["-C", h.dir, "add", "-A"]);
  must("git", ["-C", h.dir, "commit", "-m", `${h.cfg.autopilot.commitType}: ${h.ticket.title}`, "-m", `Refs: ${h.ticket.identifier}\n\nAutopilot run (agent: ${h.agent}).`]);
  must("git", ["-C", h.dir, "push", "-u", "origin", `${h.branch}:${h.branch}`], { timeoutMs: 180_000 });
  const pr = exec("gh", ["pr", "create", "--draft", "--base", h.cfg.autopilot.baseBranch, "--head", h.branch, "--title", `${h.ticket.identifier}: ${h.ticket.title}`, "--body", prBody(h)], { cwd: h.dir, timeoutMs: 60_000 });
  if (pr.status !== 0) throw new Error(`gh pr create failed: ${pr.stderr.trim()}`);
  return pr.stdout.trim().split("\n").at(-1) ?? "";
}

export function prBody(h: HandoffInput): string {
  return `${h.summary.trim()}

---
Linear: ${h.ticket.url}
Autopilot · agent: ${h.agent} · gate: \`${h.cfg.autopilot.verifyCmd}\` passed
Draft until a human reviews it. Autopilot never merges.`;
}

export function handoffComment(h: HandoffInput, prUrl: string, resumed: boolean): string {
  return `## Handoff

**Status:** draft PR open; the runner's gate passed${resumed ? " after one fix round" : ""}.
**PR:** ${prUrl}
**Agent:** ${h.agent} (autopilot)
**Checks:** \`${h.cfg.autopilot.verifyCmd}\` passed in the worktree.
**Next:** review the PR, mark it ready (CI and e2e run), merge, then close.

**Summary**
${h.summary.trim()}

+++ Agent notes

Branch \`${h.branch}\` · worktree \`${h.dir}\`
Changed files:
${h.changedFiles.map((f) => `- ${f}`).join("\n")}

+++`;
}

export function bounceComment(stage: string, reason: string, dir: string | null): string {
  return `## Autopilot bounced

**Stage:** ${stage}
**Reason:** ${reason}
**Next:** answer or rescope, then re-add the label to queue it again.${dir ? `\n\nWorktree kept for inspection: \`${dir}\`` : ""}`;
}
