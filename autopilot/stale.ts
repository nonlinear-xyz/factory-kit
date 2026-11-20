// Closing a ticket is an action on a claim. Prep makes the claim; these checks
// make it true before the runner acts, so an agent's say-so never closes work.
import { exec } from "./exec.js";
import { sanitizeForPublish } from "./redact.js";
import type { StaleClose, Ticket } from "./types.js";

export type ShippedCheck =
  | { ok: true; commit: string; subject: string; namesTicket: boolean }
  | { ok: false; detail: string };

/**
 * The cited commit exists and is reachable from origin/<base>. Being on main
 * only proves the commit is real, not that it shipped this ticket, so the
 * result also says whether the commit message names the ticket. Only then may
 * the runner close it without a person.
 */
export function verifyShipped(repoRoot: string, base: string, sha: string, identifier: string): ShippedCheck {
  const full = exec("git", ["-C", repoRoot, "rev-parse", "--verify", "--quiet", `${sha}^{commit}`]);
  if (full.status !== 0) return { ok: false, detail: `Prep cited commit ${sha}, which doesn't exist in this repo.` };
  const commit = full.stdout.trim();
  const onBase = exec("git", ["-C", repoRoot, "merge-base", "--is-ancestor", commit, `origin/${base}`]);
  if (onBase.status !== 0) return { ok: false, detail: `Prep cited commit ${sha}, which is not on origin/${base}.` };
  const message = exec("git", ["-C", repoRoot, "log", "-1", "--format=%B", commit]).stdout;
  const namesTicket = new RegExp(`(?<![A-Za-z0-9])${identifier}(?![0-9])`, "i").test(message);
  return { ok: true, commit, subject: message.split("\n")[0] ?? "", namesTicket };
}

/** A duplicate must point at a live ticket on the same team. */
export function duplicateProblem(self: Ticket, other: Ticket): string | null {
  if (other.id === self.id) return "Prep cited the ticket itself as the duplicate.";
  if (other.teamId !== self.teamId) return `Prep cited ${other.identifier}, which is on another team.`;
  if (other.stateType === "canceled") return `Prep cited ${other.identifier}, which is canceled or itself a duplicate.`;
  return null;
}

export function staleComment(close: StaleClose, reason: string, applied: boolean, subject: string, whyNot?: string): string {
  const what = close.reason === "shipped" ? `Already shipped in \`${close.commit.slice(0, 10)}\` (${sanitizeForPublish(subject, 200)}).` : `Duplicate of ${close.of}.`;
  const action = applied
    ? close.reason === "shipped" ? "Autopilot closed this ticket as done." : "Autopilot marked this ticket as a duplicate."
    : `Autopilot did not close it${whyNot ? `: ${whyNot}` : "."} Close it, or rescope and re-queue.`;
  return `## Autopilot: ${close.reason === "shipped" ? "already shipped" : "duplicate"}

${what}
**Prep:** ${sanitizeForPublish(reason || "(no reason given)", 600)}
**Checked by the runner:** ${close.reason === "shipped" ? "the commit is on the default branch." : "the other ticket exists, is on this team and is not canceled."}

${action} Reopen it if this is wrong.`;
}
