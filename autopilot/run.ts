import { agentFor } from "./agents.js";
import type { AgentRun } from "./agents.js";
import { STATE_DIR, childEnv, loadMachineConfig, loadRepoConfig } from "./config.js";
import { canary, gate, head, settingsFingerprint } from "./gate.js";
import type { Baseline } from "./gate.js";
import { PublishError, bounceComment, handoffComment, publish } from "./handoff.js";
import { record, writeLog } from "./ledger.js";
import { Linear } from "./linear.js";
import { buildPrompt, fixPrompt, parseVerdict, prepPrompt } from "./prompts.js";
import { redact } from "./redact.js";
import { duplicateProblem, staleComment, verifyShipped } from "./stale.js";
import type { AgentName, AgentResult, RunOutcome, Stage, StaleClose } from "./types.js";
import { ensureWorktree, lock, prepareWorktree } from "./worktree.js";
import { changedFiles } from "./gate.js";

export interface RunOptions {
  identifier: string;
  repoRoot: string;
  agent: AgentName;
  /**
   * Stop after the gate. Nothing is written anywhere off this machine: no
   * commit, push or PR, no runner Linear writes, and the agent gets read-only
   * Linear tools (so prep can't save its doc either).
   */
  dryRun: boolean;
  configFile?: string;
  log: (line: string) => void;
}

const HOUR = 60 * 60_000;

export async function runTicket(o: RunOptions): Promise<RunOutcome> {
  const started = Date.now();
  const cfg = loadRepoConfig(o.repoRoot, o.configFile);
  const machine = loadMachineConfig();
  const linear = Linear.fromEnv();
  const ticket = await linear.ticket(o.identifier);
  const agent = agentFor(o.agent);
  const env = childEnv(machine, cfg.autopilot.envPassthrough);
  const release = lock(STATE_DIR, ticket.identifier);
  let turns = 0;
  let cost = 0;
  let resumed = false;
  let dir: string | null = null;
  let stage: Stage = "worktree";

  const tally = (r: AgentResult) => {
    turns += r.turns ?? 0;
    cost += r.estimatedCostUsd ?? 0;
  };
  const finish = async (outcome: RunOutcome, next?: string): Promise<RunOutcome> => {
    if (outcome.kind === "bounced") {
      const logFile = writeLog(STATE_DIR, ticket.identifier, `${outcome.stage}\n\n${outcome.reason}`);
      o.log(`full output: ${logFile}`);
      if (!o.dryRun) await linear.comment(ticket.id, bounceComment(outcome.stage, outcome.reason, dir, next)).catch(() => undefined);
    }
    record(STATE_DIR, { ts: new Date().toISOString(), ticket: ticket.identifier, repo: cfg.repoRoot, agent: o.agent, outcome, turns, estimatedCostUsd: Math.round(cost * 100) / 100, resumed, elapsedSeconds: Math.round((Date.now() - started) / 1000) });
    return outcome;
  };
  const bounce = (s: Stage, reason: string, next?: string) => finish({ kind: "bounced", stage: s, reason }, next);
  const stopped = (r: AgentResult, step: string) => `The ${step} agent didn't finish cleanly (${r.stopReason ?? "no result"}).`;

  try {
    o.log(`${ticket.identifier} · ${ticket.title} · agent ${o.agent}${o.dryRun ? " · dry run" : ""}`);
    dir = ensureWorktree(cfg, ticket.identifier, ticket.branchName);
    o.log(`worktree ${dir} (${ticket.branchName})`);
    const setup = prepareWorktree(cfg, dir, env);
    if (!setup.ok) return await bounce("worktree", setup.output);

    stage = "canary";
    const can = canary(cfg, dir, env);
    if (!can.ok) return await bounce("canary", `The repo's canary failed, so its hooks can't be trusted. Nothing ran.\n${can.output}`);
    o.log("canary green");

    const baseline: Baseline = { head: head(dir), settings: settingsFingerprint(dir) };
    const step = (r: Pick<AgentRun, "prompt" | "files" | "linear"> & Partial<AgentRun>): AgentResult => {
      const res = agent.run({ cwd: dir!, env, repoTools: cfg.autopilot.allowedTools, maxTurns: cfg.autopilot.maxTurns, timeoutMs: HOUR, ...r });
      tally(res);
      return res;
    };

    // Prep: read-only on files; may save its working doc to Linear only on a real run.
    stage = "prep";
    o.log("prep…");
    const prep = step({ prompt: prepPrompt(ticket, !o.dryRun), files: "read", linear: o.dryRun ? "read" : "write", maxTurns: 40 });
    if (prep.limited) return await bounce("prep", `${o.agent} hit a usage limit.`);
    if (!prep.ok) return await bounce("prep", stopped(prep, "prep"));
    if (changedFiles(dir).length || head(dir) !== baseline.head || settingsFingerprint(dir) !== baseline.settings) {
      return await bounce("prep", "Prep changed files in the worktree, which it must never do. Nothing was built or published.");
    }
    const { verdict, reason, evidence, duplicateOf } = parseVerdict(prep.text);

    if (verdict === "Shipped" || verdict === "Duplicate") {
      let close: StaleClose;
      let subject = "";
      let whyNot: string | undefined;
      if (verdict === "Shipped") {
        if (!evidence) return await bounce("prep", `Prep said Shipped but cited no commit. ${reason}`);
        const check = verifyShipped(cfg.repoRoot, cfg.autopilot.baseBranch, evidence, ticket.identifier);
        if (!check.ok) return await bounce("prep", `Prep said Shipped, but the evidence didn't check out. ${check.detail} ${reason}`);
        close = { reason: "shipped", commit: check.commit };
        subject = check.subject;
        if (!check.namesTicket) whyNot = `the commit doesn't name ${ticket.identifier}, so a person should confirm it shipped this ticket`;
      } else {
        if (!duplicateOf) return await bounce("prep", `Prep said Duplicate but cited no other ticket. ${reason}`);
        const other = await linear.ticket(duplicateOf).catch(() => null);
        if (!other) return await bounce("prep", `Prep said Duplicate of ${duplicateOf}, which Linear can't find. ${reason}`);
        const problem = duplicateProblem(ticket, other);
        if (problem) return await bounce("prep", `${problem} ${reason}`);
        close = { reason: "duplicate", of: other.identifier };
      }
      if (cfg.autopilot.staleAction === "comment") whyNot ??= 'staleAction is "comment"';
      const apply = !o.dryRun && !whyNot;
      o.log(`prep: ${verdict} (${close.reason === "shipped" ? close.commit.slice(0, 10) : close.of}) · ${apply ? "closing" : `not closing${whyNot ? `: ${whyNot}` : " (dry run)"}`}`);
      if (!o.dryRun) {
        await linear.comment(ticket.id, staleComment(close, reason, apply, subject, whyNot));
        if (apply && close.reason === "shipped") await linear.moveTo(ticket, cfg.doneState);
        if (apply && close.reason === "duplicate") await linear.markDuplicate(ticket, (await linear.ticket(close.of)).id);
      }
      return await finish({ kind: "closed", close, applied: apply });
    }
    if (verdict !== "Ready") return await bounce("prep", verdict ? `Prep verdict: ${verdict}. ${reason}` : `Prep returned no verdict.\n${prep.text.slice(-800)}`);
    o.log("prep: Ready");

    // Build: file edits in the worktree, no Linear tools; prep's plan comes from the runner.
    stage = "build";
    o.log("build…");
    let build = step({ prompt: buildPrompt(ticket, cfg, dir, ticket.branchName, prep.text.slice(-6000)), files: "write", linear: "none" });
    if (build.limited) return await bounce("build", `${o.agent} hit a usage limit.`);

    stage = "gate";
    o.log("gate…");
    let result = gate(cfg, dir, baseline, env);
    if (!result.ok && build.sessionId && !result.deniedFiles.length && head(dir) === baseline.head) {
      o.log("gate red; one fix round");
      resumed = true;
      build = step({ prompt: fixPrompt(result.failures, cfg.autopilot.verifyCmd), resume: build.sessionId, files: "write", linear: "none" });
      result = gate(cfg, dir, baseline, env);
    }
    if (!result.ok) return await bounce("gate", result.failures);
    if (!build.ok || !build.text.trim()) return await bounce("build", `${stopped(build, "build")} The gate passed, but an unfinished session isn't published.`);
    o.log(`gate green · ${result.changedFiles.length} files`);

    if (o.dryRun) return await finish({ kind: "dry-run", worktree: dir, branch: ticket.branchName, changedFiles: result.changedFiles });

    stage = "handoff";
    const h = { cfg, ticket, dir, branch: ticket.branchName, agent: o.agent, summary: build.text, changedFiles: result.changedFiles, startSha: baseline.head };
    let prUrl: string;
    try {
      prUrl = publish(h);
    } catch (err) {
      if (err instanceof PublishError) {
        return await bounce("handoff", err.message, err.pushed ? "open the PR for the pushed branch (see reason), then move the ticket to In Review." : "inspect the worktree; nothing left this machine.");
      }
      throw err;
    }
    // The PR exists from here on. A Linear failure is reported, not turned into a bounce.
    try {
      await linear.comment(ticket.id, handoffComment(h, prUrl, resumed));
      await linear.moveTo(ticket, cfg.inReviewState);
      return await finish({ kind: "handed-off", prUrl, branch: ticket.branchName });
    } catch (err) {
      const warning = `PR is open, but the Linear handoff didn't complete: ${redact(err instanceof Error ? err.message : String(err))}`;
      return await finish({ kind: "handed-off", prUrl, branch: ticket.branchName, warning });
    }
  } catch (err) {
    return await bounce(stage, redact(err instanceof Error ? err.message : String(err)));
  } finally {
    release();
  }
}
