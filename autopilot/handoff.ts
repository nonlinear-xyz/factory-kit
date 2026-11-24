import { existsSync } from "node:fs";
import path from "node:path";
import { exec, must } from "./exec.js";
import { containsSecret, redact, sanitizeForPublish } from "./redact.js";
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
  /** HEAD before the agent ran; nothing but the runner's own commit may sit on top of it. */
  startSha: string;
  /** The independent reviewer's non-blocking notes, shown to the human reviewer. */
  reviewNotes: string[];
}

/** A publish that failed part-way, with the exact state it left behind. */
export class PublishError extends Error {
  constructor(message: string, readonly pushed: boolean) {
    super(message);
  }
}

// Git hooks live in the worktree, where the agent could have written them.
// The runner's own git calls never run them.
const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];
const LITERAL = { ...process.env, GIT_LITERAL_PATHSPECS: "1" };

/** Refuse to publish text that looks like it carries a credential. */
export function assertPublishable(h: HandoffInput): void {
  const diff = exec("git", ["-C", h.dir, "diff", "--cached", "--no-color", "--no-ext-diff"]).stdout;
  if (containsSecret(diff)) throw new PublishError("The diff contains something shaped like a credential. Nothing was published; inspect the worktree.", false);
  if (containsSecret(h.summary)) throw new PublishError("The agent's summary contains something shaped like a credential. Nothing was published.", false);
}

/**
 * Commit exactly the gated files, push the ticket branch and open a draft PR.
 * Before the push succeeds, any failure undoes the commit (the changes stay in
 * the worktree, unstaged). After the push, an existing PR is reused, and a
 * failure says so plainly: the branch is on GitHub but has no PR.
 */
export function publish(h: HandoffInput): string {
  assertTicketBranch(h.branch, h.ticket.identifier);
  if (must("git", ["-C", h.dir, "rev-parse", "HEAD"]) !== h.startSha) throw new PublishError("HEAD moved since the gate ran. Nothing was published.", false);
  const undo = () => exec("git", ["-C", h.dir, "reset", "-q", "--mixed", h.startSha]);
  try {
    // Paths are literal (Next.js routes like [id] are not globs). A path absent from both
    // the worktree and the index is an already-staged deletion: passing it to add would fail.
    const indexed = new Set(must("git", ["-C", h.dir, "ls-files", "-z", "--", ...h.changedFiles], { env: LITERAL }).split("\0").filter(Boolean));
    const toAdd = h.changedFiles.filter((f) => indexed.has(f) || existsSync(path.join(h.dir, f)));
    if (toAdd.length) must("git", ["-C", h.dir, "add", "-A", "--", ...toAdd], { env: LITERAL });
    const staged = must("git", ["-C", h.dir, "diff", "--cached", "--name-only", "-z"]).split("\0").filter(Boolean);
    const unexpected = staged.filter((f) => !h.changedFiles.includes(f));
    if (unexpected.length) throw new PublishError(`Refusing to commit files the gate didn't check: ${unexpected.join(", ")}`, false);
    assertPublishable(h);
    must("git", ["-C", h.dir, ...NO_HOOKS, "commit", "--no-verify", "-q", "-m", `${h.cfg.autopilot.commitType}: ${h.ticket.title}`, "-m", `Refs: ${h.ticket.identifier}\n\nAutopilot run (agent: ${h.agent}).`]);
    must("git", ["-C", h.dir, ...NO_HOOKS, "push", "--no-verify", "-u", "origin", `refs/heads/${h.branch}:refs/heads/${h.branch}`], { timeoutMs: 180_000 });
  } catch (err) {
    undo();
    const msg = err instanceof Error ? err.message : String(err);
    throw err instanceof PublishError ? err : new PublishError(`${redact(msg)}\nNothing was published; the changes are left uncommitted in the worktree.`, false);
  }
  const existing = exec("gh", ["pr", "view", h.branch, "--json", "url", "--jq", ".url"], { cwd: h.dir, timeoutMs: 60_000 });
  if (existing.status === 0 && existing.stdout.trim()) return existing.stdout.trim();
  const pr = exec("gh", ["pr", "create", "--draft", "--base", h.cfg.autopilot.baseBranch, "--head", h.branch, "--title", `${h.ticket.identifier}: ${h.ticket.title}`, "--body", prBody(h)], { cwd: h.dir, timeoutMs: 60_000 });
  if (pr.status !== 0) throw new PublishError(`Branch ${h.branch} was pushed, but opening the PR failed: ${redact(pr.stderr.trim())}\nOpen it by hand: gh pr create --draft --head ${h.branch}`, true);
  return pr.stdout.trim().split("\n").at(-1) ?? "";
}

function notesBlock(h: HandoffInput): string {
  return h.reviewNotes.length ? `\n\n**Autopilot review notes (non-blocking)**\n${h.reviewNotes.map((n) => `- ${sanitizeForPublish(n, 300)}`).join("\n")}` : "";
}

export function prBody(h: HandoffInput): string {
  return `${sanitizeForPublish(h.summary)}${notesBlock(h)}

---
Linear: ${h.ticket.url}
Autopilot · agent: ${h.agent} · gate: \`${h.cfg.autopilot.verifyCmd}\` passed · independent review: approved
Draft until a human reviews it. Autopilot never merges.`;
}

export function handoffComment(h: HandoffInput, prUrl: string, resumed: boolean): string {
  return `## Handoff

**Status:** draft PR open; the runner's gate passed${resumed ? " after one fix round" : ""}.
**PR:** ${prUrl}
**Agent:** ${h.agent} (autopilot)
**Checks:** \`${h.cfg.autopilot.verifyCmd}\` passed in the worktree; an independent review approved it.
**Next:** review the PR, mark it ready (CI and e2e run), merge, then close.

**Summary**
${sanitizeForPublish(h.summary, 1500)}${notesBlock(h)}

+++ Agent notes

Branch \`${h.branch}\` · worktree \`${h.dir}\`
Changed files:
${h.changedFiles.map((f) => `- ${f}`).join("\n")}

+++`;
}

/**
 * The bounce note posted to Linear. Command output is redacted and cut short
 * (test output can carry fixture data); the full output stays in the local log.
 */
export function bounceComment(stage: string, reason: string, dir: string | null, next?: string): string {
  const short = sanitizeForPublish(reason, 1200);
  return `## Autopilot bounced

**Stage:** ${stage}
**Reason:** ${short}
**Next:** ${next ?? "answer or rescope, then re-add the label to queue it again."}${dir ? `\n\nWorktree kept for inspection: \`${dir}\`` : ""}`;
}
