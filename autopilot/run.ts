import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { agentFor } from "./agents.js";
import type { Agent, AgentRun } from "./agents.js";
import { STATE_DIR, childEnv, loadMachineConfig, loadRepoConfig } from "./config.js";
import { exec } from "./exec.js";
import { canary, changedFiles, gate, head, settingsFingerprint } from "./gate.js";
import type { Baseline } from "./gate.js";
import { PublishError, bounceComment, handoffComment, publish } from "./handoff.js";
import { record, writeLog } from "./ledger.js";
import { Linear } from "./linear.js";
import { buildPrompt, fixPrompt, parseVerdict, prepPrompt } from "./prompts.js";
import { redact } from "./redact.js";
import { parseReview, reviewFixPrompt, reviewPrompt, workingDiff } from "./review.js";
import { duplicateProblem, staleComment, verifyShipped } from "./stale.js";
import type { AgentName, AgentResult, RepoConfig, RunOutcome, Stage, StaleClose, Ticket } from "./types.js";
import { ensureWorktree, lock, prepareWorktree, worktreePath } from "./worktree.js";

export interface RunOptions {
  identifier: string;
  repoRoot: string;
  agent: AgentName;
  /**
   * Stop before publishing. Nothing is written anywhere off this machine: no
   * commit, push or PR, no runner Linear writes, and the agent gets read-only
   * Linear tools (so prep can't save its doc either). Gate and review still run.
   */
  dryRun: boolean;
  configFile?: string;
  log: (line: string) => void;
}

const HOUR = 60 * 60_000;

/** What a green dry run leaves for `publish`, so the build doesn't have to run again. */
interface DryRunRecord {
  startSha: string;
  plan: string;
  summary: string;
  sessionId: string | null;
  agent: AgentName;
}
const dryRunFile = (id: string) => path.join(STATE_DIR, `${id}.dryrun.json`);

/** Shared state for one run: config, ticket, accounting, and how the run ends. */
class Run {
  turns = 0;
  cost = 0;
  resumed = false;
  dir: string | null = null;
  stage: Stage = "worktree";
  readonly started = Date.now();

  constructor(
    readonly o: { identifier: string; agent: AgentName; dryRun: boolean; log: (l: string) => void },
    readonly cfg: RepoConfig,
    readonly ticket: Ticket,
    readonly linear: Linear,
    readonly agent: Agent,
    readonly env: NodeJS.ProcessEnv,
  ) {}

  step(r: Pick<AgentRun, "prompt" | "files" | "linear"> & Partial<AgentRun>): AgentResult {
    const res = this.agent.run({ cwd: this.dir!, env: this.env, repoTools: this.cfg.autopilot.allowedTools, maxTurns: this.cfg.autopilot.maxTurns, timeoutMs: HOUR, ...r });
    this.turns += res.turns ?? 0;
    this.cost += res.estimatedCostUsd ?? 0;
    return res;
  }

  async finish(outcome: RunOutcome, next?: string): Promise<RunOutcome> {
    if (outcome.kind === "bounced") {
      this.o.log(`full output: ${writeLog(STATE_DIR, this.ticket.identifier, `${outcome.stage}\n\n${outcome.reason}`)}`);
      if (!this.o.dryRun) await this.linear.comment(this.ticket.id, bounceComment(outcome.stage, outcome.reason, this.dir, next)).catch(() => undefined);
    }
    record(STATE_DIR, { ts: new Date().toISOString(), ticket: this.ticket.identifier, repo: this.cfg.repoRoot, agent: this.o.agent, outcome, turns: this.turns, estimatedCostUsd: Math.round(this.cost * 100) / 100, resumed: this.resumed, elapsedSeconds: Math.round((Date.now() - this.started) / 1000) });
    return outcome;
  }

  bounce(stage: Stage, reason: string, next?: string): Promise<RunOutcome> {
    return this.finish({ kind: "bounced", stage, reason }, next);
  }
}

const stopped = (r: AgentResult, step: string) => `The ${step} agent didn't finish cleanly (${r.stopReason ?? "no result"}).`;

async function open(o: { identifier: string; repoRoot: string; agent: AgentName; dryRun: boolean; configFile?: string; log: (l: string) => void }) {
  const cfg = loadRepoConfig(o.repoRoot, o.configFile);
  const machine = loadMachineConfig();
  const linear = Linear.fromEnv();
  const ticket = await linear.ticket(o.identifier);
  const env = childEnv(machine, cfg.autopilot.envPassthrough);
  return new Run(o, cfg, ticket, linear, agentFor(o.agent), env);
}

export async function runTicket(o: RunOptions): Promise<RunOutcome> {
  const run = await open(o);
  const { cfg, ticket, linear } = run;
  const release = lock(STATE_DIR, ticket.identifier);
  try {
    o.log(`${ticket.identifier} · ${ticket.title} · agent ${o.agent}${o.dryRun ? " · dry run" : ""}`);
    const dir = (run.dir = ensureWorktree(cfg, ticket.identifier, ticket.branchName));
    o.log(`worktree ${dir} (${ticket.branchName})`);
    const setup = prepareWorktree(cfg, dir, run.env);
    if (!setup.ok) return await run.bounce("worktree", setup.output);

    run.stage = "canary";
    const can = canary(cfg, dir, run.env);
    if (!can.ok) return await run.bounce("canary", `The repo's canary failed, so its hooks can't be trusted. Nothing ran.\n${can.output}`);
    o.log("canary green");
    const baseline: Baseline = { head: head(dir), settings: settingsFingerprint(dir) };

    // Prep: read-only on files; may save its working doc to Linear only on a real run.
    run.stage = "prep";
    o.log("prep…");
    const prep = run.step({ prompt: prepPrompt(ticket, !o.dryRun), files: "read", linear: o.dryRun ? "read" : "write", maxTurns: 40 });
    if (prep.limited) return await run.bounce("prep", `${o.agent} hit a usage limit.`);
    if (!prep.ok) return await run.bounce("prep", stopped(prep, "prep"));
    if (changedFiles(dir).length || head(dir) !== baseline.head || settingsFingerprint(dir) !== baseline.settings) {
      return await run.bounce("prep", "Prep changed files in the worktree, which it must never do. Nothing was built or published.");
    }
    const { verdict, reason, evidence, duplicateOf } = parseVerdict(prep.text);
    if (verdict === "Shipped" || verdict === "Duplicate") return await closeStale(run, verdict, reason, evidence, duplicateOf);
    if (verdict !== "Ready") return await run.bounce("prep", verdict ? `Prep verdict: ${verdict}. ${reason}` : `Prep returned no verdict.\n${prep.text.slice(-800)}`);
    o.log("prep: Ready");
    const plan = prep.text.slice(-6000);

    // Build: file edits in the worktree, no Linear tools; prep's plan comes from the runner.
    run.stage = "build";
    o.log("build…");
    const build = run.step({ prompt: buildPrompt(ticket, cfg, dir, ticket.branchName, plan), files: "write", linear: "none" });
    if (build.limited) return await run.bounce("build", `${o.agent} hit a usage limit.`);
    return await gateReviewPublish(run, baseline, plan, build);
  } catch (err) {
    return await run.bounce(run.stage, redact(err instanceof Error ? err.message : String(err)));
  } finally {
    release();
  }
}

/**
 * Publish what a green dry run left in the ticket's worktree, without building
 * again. The gate and the independent review run again first, against the
 * worktree as it is now.
 */
export async function publishTicket(o: Omit<RunOptions, "dryRun">): Promise<RunOutcome> {
  const run = await open({ ...o, dryRun: false });
  const { cfg, ticket } = run;
  const release = lock(STATE_DIR, ticket.identifier);
  try {
    o.log(`${ticket.identifier} · ${ticket.title} · publish`);
    const dir = worktreePath(cfg.repoRoot, ticket.identifier);
    if (!existsSync(dir)) return await run.bounce("worktree", `No worktree at ${dir}. Run \`fk autopilot run ${ticket.identifier}\` instead.`);
    run.dir = dir;
    const branch = exec("git", ["-C", dir, "branch", "--show-current"]).stdout.trim();
    if (branch !== ticket.branchName) return await run.bounce("worktree", `${dir} is on ${branch}, not ${ticket.branchName}.`);
    exec("git", ["-C", cfg.repoRoot, "fetch", "origin", cfg.autopilot.baseBranch], { timeoutMs: 120_000 });
    const ahead = exec("git", ["-C", dir, "rev-list", "--count", `origin/${cfg.autopilot.baseBranch}..HEAD`]).stdout.trim();
    if (ahead !== "0") return await run.bounce("worktree", `${dir} has local commits; autopilot only publishes uncommitted work it made.`);
    // Gitignored settings files aren't visible to the gate; a dry run never creates them.
    const ignored = exec("git", ["-C", dir, "status", "--porcelain", "--ignored", "-uall", "--", ".claude", ".codex", ".mcp.json"]).stdout.split("\n").filter((l) => l.startsWith("!!"));
    if (ignored.length) return await run.bounce("worktree", `Ignored agent settings exist in the worktree (${ignored.map((l) => l.slice(3)).join(", ")}). Inspect them; nothing was published.`);

    const saved: DryRunRecord | null = existsSync(dryRunFile(ticket.identifier)) ? JSON.parse(readFileSync(dryRunFile(ticket.identifier), "utf8")) : null;
    const fresh = saved && saved.startSha === head(dir) ? saved : null;
    if (!fresh) o.log("no saved dry run for this worktree; the reviewer will write the PR summary");
    const baseline: Baseline = { head: head(dir), settings: settingsFingerprint(dir) };
    const build: AgentResult = { ok: true, sessionId: fresh?.agent === o.agent ? fresh.sessionId : null, text: fresh?.summary ?? "", turns: 0, estimatedCostUsd: 0, limited: false, stopReason: null };
    return await gateReviewPublish(run, baseline, fresh?.plan ?? "", build);
  } catch (err) {
    return await run.bounce(run.stage, redact(err instanceof Error ? err.message : String(err)));
  } finally {
    release();
  }
}

/**
 * Gate → independent review → publish. One fix round is allowed for each of
 * the gate and the review, and only when the builder's session can be resumed.
 */
async function gateReviewPublish(run: Run, baseline: Baseline, plan: string, initial: AgentResult): Promise<RunOutcome> {
  const { cfg, ticket, o } = run;
  const dir = run.dir!;
  let build = initial;
  const fix = (prompt: string) => {
    run.resumed = true;
    const next = run.step({ prompt, resume: build.sessionId!, files: "write", linear: "none" });
    build = { ...next, text: next.text.trim() ? next.text : build.text };
    return next;
  };

  run.stage = "gate";
  o.log("gate…");
  let result = gate(cfg, dir, baseline, run.env);
  if (!result.ok && build.sessionId && !result.deniedFiles.length && head(dir) === baseline.head) {
    o.log("gate red; one fix round");
    if (fix(fixPrompt(result.failures, cfg.autopilot.verifyCmd)).limited) return await run.bounce("gate", `${o.agent} hit a usage limit.`);
    result = gate(cfg, dir, baseline, run.env);
  }
  if (!result.ok) return await run.bounce("gate", result.failures);
  if (!build.ok) return await run.bounce("build", `${stopped(build, "build")} The gate passed, but an unfinished session isn't published.`);
  o.log(`gate green · ${result.changedFiles.length} files`);

  run.stage = "review";
  const review = () => {
    o.log("independent review…");
    const r = run.step({ prompt: reviewPrompt(ticket, cfg, plan, workingDiff(dir, result.changedFiles), result.changedFiles), files: "read", linear: "none", maxTurns: 40 });
    return { res: r, review: parseReview(r.text) };
  };
  let { res, review: verdict } = review();
  if (res.limited) return await run.bounce("review", `${o.agent} hit a usage limit during review.`);
  if (verdict.verdict === "changes" && build.sessionId) {
    o.log(`review blocked (${verdict.blocking.length}); one fix round`);
    if (fix(reviewFixPrompt(verdict, cfg.autopilot.verifyCmd)).limited) return await run.bounce("review", `${o.agent} hit a usage limit.`);
    result = gate(cfg, dir, baseline, run.env);
    if (!result.ok) return await run.bounce("gate", `After the review fix: ${result.failures}`);
    if (!build.ok) return await run.bounce("review", `${stopped(build, "review fix")} The gate passed, but an unfinished session isn't published.`);
    ({ res, review: verdict } = review());
  }
  if (!res.ok || verdict.verdict === null) return await run.bounce("review", `The reviewer didn't return a verdict (${res.stopReason ?? "unparseable reply"}).`);
  if (verdict.verdict === "changes") return await run.bounce("review", `The independent reviewer blocked it:\n${verdict.blocking.map((b) => `- ${b}`).join("\n")}`);
  o.log(`review: approved${verdict.notes.length ? ` · ${verdict.notes.length} notes` : ""}`);

  const summary = build.text.trim() || verdict.summary;
  if (!summary) return await run.bounce("review", "No PR description: neither the builder nor the reviewer produced a summary.");

  if (o.dryRun) {
    const saved: DryRunRecord = { startSha: baseline.head, plan, summary, sessionId: build.sessionId, agent: o.agent };
    writeFileSync(dryRunFile(ticket.identifier), JSON.stringify(saved), { mode: 0o600 });
    return await run.finish({ kind: "dry-run", worktree: dir, branch: ticket.branchName, changedFiles: result.changedFiles });
  }

  run.stage = "handoff";
  const h = { cfg, ticket, dir, branch: ticket.branchName, agent: o.agent, summary, changedFiles: result.changedFiles, startSha: baseline.head, reviewNotes: verdict.notes };
  let prUrl: string;
  try {
    prUrl = publish(h);
  } catch (err) {
    if (err instanceof PublishError) {
      return await run.bounce("handoff", err.message, err.pushed ? "open the PR for the pushed branch (see reason), then move the ticket to In Review." : "inspect the worktree; nothing left this machine.");
    }
    throw err;
  }
  // The PR exists from here on. A Linear failure is reported, not turned into a bounce.
  try {
    await run.linear.comment(ticket.id, handoffComment(h, prUrl, run.resumed));
    await run.linear.moveTo(ticket, cfg.inReviewState);
    return await run.finish({ kind: "handed-off", prUrl, branch: ticket.branchName });
  } catch (err) {
    const warning = `PR is open, but the Linear handoff didn't complete: ${redact(err instanceof Error ? err.message : String(err))}`;
    return await run.finish({ kind: "handed-off", prUrl, branch: ticket.branchName, warning });
  }
}

async function closeStale(run: Run, verdict: "Shipped" | "Duplicate", reason: string, evidence: string | null, duplicateOf: string | null): Promise<RunOutcome> {
  const { cfg, ticket, linear, o } = run;
  let close: StaleClose;
  let subject = "";
  let whyNot: string | undefined;
  if (verdict === "Shipped") {
    if (!evidence) return await run.bounce("prep", `Prep said Shipped but cited no commit. ${reason}`);
    const check = verifyShipped(cfg.repoRoot, cfg.autopilot.baseBranch, evidence, ticket.identifier);
    if (!check.ok) return await run.bounce("prep", `Prep said Shipped, but the evidence didn't check out. ${check.detail} ${reason}`);
    close = { reason: "shipped", commit: check.commit };
    subject = check.subject;
    if (!check.namesTicket) whyNot = `the commit doesn't name ${ticket.identifier}, so a person should confirm it shipped this ticket`;
  } else {
    if (!duplicateOf) return await run.bounce("prep", `Prep said Duplicate but cited no other ticket. ${reason}`);
    const other = await linear.ticket(duplicateOf).catch(() => null);
    if (!other) return await run.bounce("prep", `Prep said Duplicate of ${duplicateOf}, which Linear can't find. ${reason}`);
    const problem = duplicateProblem(ticket, other);
    if (problem) return await run.bounce("prep", `${problem} ${reason}`);
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
  return await run.finish({ kind: "closed", close, applied: apply });
}
