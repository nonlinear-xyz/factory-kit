// `factory-kit autopilot …`: unattended ticket runs. Entry for the bin shim
// (bin/factory-kit.js imports main from the tsup-built dist/autopilot.js).
import { exec } from "./exec.js";
import { doctor } from "./doctor.js";
import { loadMachineConfig, loadRepoConfig } from "./config.js";
import { Linear } from "./linear.js";
import { runTicket } from "./run.js";
import { worktreePath } from "./worktree.js";
import type { AgentName } from "./types.js";

const USAGE = `factory-kit autopilot

  factory-kit autopilot run <ISSUE-ID> [--agent claude] [--repo <path>] [--config <file>] [--dry-run]
  factory-kit autopilot show <ISSUE-ID> [--repo <path>] [--config <file>]
  factory-kit autopilot doctor [--repo <path>] [--config <file>]

--config  use this linear.json instead of the repo's (try autopilot before the repo opts in)

run       prep → build → gate → draft PR + Linear handoff, in the ticket's worktree.
          --dry-run stops after the gate: no commit, push, PR or runner Linear writes.
show      read-only: what a run on this ticket would do. Writes nothing anywhere.
doctor    check git, gh, Linear key, agent CLIs and the repo's autopilot config.`;

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} needs a value, e.g. --${name} <path>.`);
  return value;
}

function repoRoot(args: string[]): string {
  const from = opt(args, "repo") ?? process.cwd();
  const r = exec("git", ["-C", from, "worktree", "list", "--porcelain"]);
  const main = r.stdout.match(/^worktree (.+)$/m)?.[1];
  if (r.status !== 0 || !main) throw new Error(`${from} is not inside a git repository.`);
  return main;
}

export async function main(args: string[]): Promise<number> {
  const [cmd, ...rest] = args;
  if (cmd === "doctor") {
    const checks = doctor(repoRoot(rest), opt(rest, "config"));
    for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(14)} ${c.detail}`);
    return checks.every((c) => c.ok) ? 0 : 1;
  }
  if (cmd === "show") {
    const id = rest.find((a) => /^[A-Z][A-Z0-9]*-\d+$/i.test(a));
    if (!id) throw new Error("Pass a Linear issue ID, e.g. factory-kit autopilot show KAI-240.");
    const root = repoRoot(rest);
    const cfg = loadRepoConfig(root, opt(rest, "config"));
    const machine = loadMachineConfig();
    const t = await Linear.fromEnv().ticket(id.toUpperCase());
    const queued = t.labels.includes(cfg.autopilot.triggerLabel);
    console.log([
      `${t.identifier} · ${t.title}`,
      `state      ${t.stateName} · labels: ${t.labels.join(", ") || "none"}${queued ? "" : ` (not queued: no "${cfg.autopilot.triggerLabel}" label)`}`,
      `branch     ${t.branchName}`,
      `worktree   ${worktreePath(root, t.identifier)}`,
      `agent      ${machine.agents.join(" / ")} · max ${cfg.autopilot.maxTurns} turns · API billing ${machine.allowApiBilling ? "ON" : "off"}`,
      `steps      setup [${cfg.autopilot.setup.join("; ") || "none"}] → canary [${cfg.autopilot.canaryCmd ?? "none"}] → prep → build → gate [${cfg.autopilot.verifyCmd}]`,
      `denied     ${cfg.autopilot.denyPaths.join(", ") || "none"}`,
      `on green   commit → push ${t.branchName} → draft PR into ${cfg.autopilot.baseBranch} → Linear Handoff comment → ${cfg.inReviewState}`,
    ].join("\n"));
    return 0;
  }
  if (cmd === "run") {
    const id = rest.find((a) => /^[A-Z][A-Z0-9]*-\d+$/i.test(a));
    if (!id) throw new Error("Pass a Linear issue ID, e.g. factory-kit autopilot run KAI-240.");
    const agent = (opt(rest, "agent") ?? "claude") as AgentName;
    if (agent !== "claude" && agent !== "codex") throw new Error(`Unknown agent "${agent}".`);
    const outcome = await runTicket({ identifier: id.toUpperCase(), repoRoot: repoRoot(rest), agent, dryRun: rest.includes("--dry-run"), configFile: opt(rest, "config"), log: (l) => console.log(`[autopilot] ${l}`) });
    switch (outcome.kind) {
      case "handed-off":
        console.log(`[autopilot] draft PR ${outcome.prUrl}`);
        return 0;
      case "dry-run":
        console.log(`[autopilot] dry run green · ${outcome.changedFiles.length} files in ${outcome.worktree}`);
        return 0;
      case "closed": {
        const what = outcome.close.reason === "shipped" ? `already shipped in ${outcome.close.commit.slice(0, 10)}` : `duplicate of ${outcome.close.of}`;
        console.log(`[autopilot] ${what} · ${outcome.applied ? "closed in Linear" : "not closed (dry run or staleAction: comment)"}`);
        return 0;
      }
      case "bounced":
        console.log(`[autopilot] bounced at ${outcome.stage}: ${outcome.reason}`);
        return 2;
      default:
        return outcome satisfies never;
    }
  }
  console.log(USAGE);
  return cmd === undefined || cmd === "help" || cmd === "--help" ? 0 : 1;
}
