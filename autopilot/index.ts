// `factory-kit autopilot …`: unattended ticket runs. Entry for the bin shim
// (bin/factory-kit.js imports main from the tsup-built dist/autopilot.js).
import { exec } from "./exec.js";
import { doctor } from "./doctor.js";
import { runTicket } from "./run.js";
import type { AgentName } from "./types.js";

const USAGE = `factory-kit autopilot

  factory-kit autopilot run <ISSUE-ID> [--agent claude] [--repo <path>] [--dry-run]
  factory-kit autopilot doctor [--repo <path>]

run       prep → build → gate → draft PR + Linear handoff, in the ticket's worktree.
          --dry-run stops after the gate: no commit, push, PR or runner Linear writes.
doctor    check git, gh, Linear key, agent CLIs and the repo's autopilot config.`;

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
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
    const checks = doctor(repoRoot(rest));
    for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.name.padEnd(14)} ${c.detail}`);
    return checks.every((c) => c.ok) ? 0 : 1;
  }
  if (cmd === "run") {
    const id = rest.find((a) => /^[A-Z][A-Z0-9]*-\d+$/i.test(a));
    if (!id) throw new Error("Pass a Linear issue ID, e.g. factory-kit autopilot run KAI-240.");
    const agent = (opt(rest, "agent") ?? "claude") as AgentName;
    if (agent !== "claude" && agent !== "codex") throw new Error(`Unknown agent "${agent}".`);
    const outcome = await runTicket({ identifier: id.toUpperCase(), repoRoot: repoRoot(rest), agent, dryRun: rest.includes("--dry-run"), log: (l) => console.log(`[autopilot] ${l}`) });
    switch (outcome.kind) {
      case "handed-off":
        console.log(`[autopilot] draft PR ${outcome.prUrl}`);
        return 0;
      case "dry-run":
        console.log(`[autopilot] dry run green · ${outcome.changedFiles.length} files in ${outcome.worktree}`);
        return 0;
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
