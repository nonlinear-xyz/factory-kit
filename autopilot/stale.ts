// Closing a ticket is an action on a claim. Prep makes the claim; these checks
// make it true before the runner acts, so an agent's say-so never closes work.
import { exec } from "./exec.js";
import type { StaleClose } from "./types.js";

/** The cited commit exists and is reachable from origin/<base>. Returns the full SHA. */
export function verifyShipped(repoRoot: string, base: string, sha: string): { ok: true; commit: string } | { ok: false; detail: string } {
  const full = exec("git", ["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
  if (full.status !== 0) return { ok: false, detail: `Prep cited commit ${sha}, which doesn't exist in this repo.` };
  const commit = full.stdout.trim();
  const onBase = exec("git", ["-C", repoRoot, "merge-base", "--is-ancestor", commit, `origin/${base}`]);
  if (onBase.status !== 0) return { ok: false, detail: `Prep cited commit ${sha}, which is not on origin/${base}.` };
  return { ok: true, commit };
}

export function staleComment(close: StaleClose, reason: string, applied: boolean, subject: string): string {
  const what = close.reason === "shipped" ? `Already shipped in \`${close.commit.slice(0, 10)}\` (${subject}).` : `Duplicate of ${close.of}.`;
  const action = applied
    ? close.reason === "shipped" ? "Autopilot closed this ticket as done." : "Autopilot marked this ticket as a duplicate."
    : "Autopilot did not close it (staleAction is \"comment\"). Close it, or rescope and re-queue.";
  return `## Autopilot: ${close.reason === "shipped" ? "already shipped" : "duplicate"}

${what}
**Prep:** ${reason || "(no reason given)"}
**Checked by the runner:** ${close.reason === "shipped" ? "the commit is on the default branch." : "the other ticket exists."}

${action} Reopen it if this is wrong.`;
}
