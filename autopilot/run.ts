import { agentFor } from "./agents.js";
import { STATE_DIR, agentEnv, loadMachineConfig, loadRepoConfig } from "./config.js";
import { canary, gate } from "./gate.js";
import { bounceComment, handoffComment, publish } from "./handoff.js";
import { record } from "./ledger.js";
import { Linear } from "./linear.js";
import { buildPrompt, fixPrompt, parseVerdict, prepPrompt } from "./prompts.js";
import type { AgentName, AgentResult, RunOutcome, Stage } from "./types.js";
import { ensureWorktree, lock, prepareWorktree } from "./worktree.js";

export interface RunOptions {
  identifier: string;
  repoRoot: string;
  agent: AgentName;
  /** Stop after the gate: no commit, push, PR or Linear writes by the runner. */
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
  const env = agentEnv(machine);
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
  const finish = async (outcome: RunOutcome): Promise<RunOutcome> => {
    if (outcome.kind === "bounced" && !o.dryRun) await linear.comment(ticket.id, bounceComment(outcome.stage, outcome.reason, dir)).catch(() => undefined);
    record(STATE_DIR, { ts: new Date().toISOString(), ticket: ticket.identifier, repo: cfg.repoRoot, agent: o.agent, outcome, turns, estimatedCostUsd: Math.round(cost * 100) / 100, resumed, elapsedSeconds: Math.round((Date.now() - started) / 1000) });
    return outcome;
  };
  const bounce = (stage: Stage, reason: string) => finish({ kind: "bounced", stage, reason });

  try {
    o.log(`${ticket.identifier} · ${ticket.title} · agent ${o.agent}${o.dryRun ? " · dry run" : ""}`);
    dir = ensureWorktree(cfg, ticket.identifier, ticket.branchName);
    o.log(`worktree ${dir} (${ticket.branchName})`);
    const setup = prepareWorktree(cfg, dir);
    if (!setup.ok) return await bounce("worktree", setup.output);

    stage = "canary";
    const can = canary(cfg, dir);
    if (!can.ok) return await bounce("canary", `The repo's canary failed, so its hooks can't be trusted. Nothing ran.\n${can.output}`);
    o.log("canary green");

    const tools = [...cfg.autopilot.allowedTools, ...cfg.autopilot.linearTools];
    const base = { cwd: dir, env, allowedTools: tools, maxTurns: cfg.autopilot.maxTurns, timeoutMs: HOUR };

    stage = "prep";
    o.log("prep…");
    const prep = agent.run({ ...base, prompt: prepPrompt(ticket, !o.dryRun), maxTurns: 40 });
    tally(prep);
    if (prep.limited) return await bounce("prep", `${o.agent} hit a usage limit.`);
    const { verdict, reason } = parseVerdict(prep.text);
    if (verdict !== "Ready") return await bounce("prep", verdict ? `Prep verdict: ${verdict}. ${reason}` : `Prep returned no verdict.\n${prep.text.slice(-800)}`);
    o.log("prep: Ready");

    stage = "build";
    o.log("build…");
    let build = agent.run({ ...base, prompt: buildPrompt(ticket, cfg, dir, ticket.branchName, o.dryRun ? prep.text.slice(-6000) : null) });
    tally(build);
    if (build.limited) return await bounce("build", `${o.agent} hit a usage limit.`);

    stage = "gate";
    o.log("gate…");
    let result = gate(cfg, dir);
    if (!result.ok && build.sessionId && !result.deniedFiles.length) {
      o.log("gate red; one fix round");
      resumed = true;
      build = agent.run({ ...base, prompt: fixPrompt(result.failures, cfg.autopilot.verifyCmd), resume: build.sessionId });
      tally(build);
      result = gate(cfg, dir);
    }
    if (!result.ok) return await bounce("gate", result.failures);
    o.log(`gate green · ${result.changedFiles.length} files`);

    if (o.dryRun) return await finish({ kind: "dry-run", worktree: dir, branch: ticket.branchName, changedFiles: result.changedFiles });

    stage = "handoff";
    const h = { cfg, ticket, dir, branch: ticket.branchName, agent: o.agent, summary: build.text, changedFiles: result.changedFiles };
    const prUrl = publish(h);
    await linear.comment(ticket.id, handoffComment(h, prUrl, resumed));
    await linear.moveTo(ticket, cfg.inReviewState);
    return await finish({ kind: "handed-off", prUrl, branch: ticket.branchName });
  } catch (err) {
    return await bounce(stage, err instanceof Error ? err.message : String(err));
  } finally {
    release();
  }
}
