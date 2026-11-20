import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentName, MachineConfig, RepoAutopilotConfig, RepoConfig } from "./types.js";

export const STATE_DIR = process.env.FACTORY_KIT_AUTOPILOT_STATE ?? path.join(os.homedir(), ".local/state/factory-kit/autopilot");
const MACHINE_CONFIG = process.env.FACTORY_KIT_AUTOPILOT_CONFIG ?? path.join(os.homedir(), ".config/factory-kit/autopilot.json");

const REPO_DEFAULTS: RepoAutopilotConfig = {
  triggerLabel: "autopilot",
  baseBranch: "main",
  verifyCmd: "",
  canaryCmd: null,
  setup: [],
  copyFiles: [],
  denyPaths: [],
  allowedTools: [],
  linearTools: ["mcp__linear-server", "mcp__linear", "Agent", "Task"],
  maxTurns: 60,
  commitType: "fix",
};

/** Parse the repo's `.factory-kit/linear.json`. Throws when autopilot isn't configured. */
export function parseRepoConfig(repoRoot: string, raw: unknown): RepoConfig {
  const json = (raw ?? {}) as Record<string, unknown>;
  const block = json.autopilot as Partial<RepoAutopilotConfig> | undefined;
  if (!block) throw new Error(`No "autopilot" block in ${repoRoot}/.factory-kit/linear.json; this repo hasn't opted in.`);
  const autopilot: RepoAutopilotConfig = { ...REPO_DEFAULTS, ...block };
  if (!autopilot.verifyCmd.trim()) throw new Error('autopilot.verifyCmd is required: the gate needs a command that means "green" for this repo.');
  const states = (json.states ?? {}) as Record<string, string>;
  return {
    repoRoot,
    teamKey: String(json.teamKey ?? ""),
    inReviewState: states.inReview ?? "In Review",
    autopilot,
  };
}

export function loadRepoConfig(repoRoot: string): RepoConfig {
  const file = [".factory-kit/linear.json", ".claude/linear.json"].map((f) => path.join(repoRoot, f)).find(existsSync);
  if (!file) throw new Error(`No .factory-kit/linear.json in ${repoRoot}. Run factory-setup-linear first.`);
  return parseRepoConfig(repoRoot, JSON.parse(readFileSync(file, "utf8")));
}

export function parseMachineConfig(raw: unknown): MachineConfig {
  const json = (raw ?? {}) as Partial<MachineConfig>;
  const agents = (json.agents ?? ["claude"]).filter((a): a is AgentName => a === "claude" || a === "codex");
  return {
    launcher: json.launcher === "rex" ? "rex" : "plain",
    agents: agents.length ? agents : ["claude"],
    dailyCap: json.dailyCap ?? {},
    allowApiBilling: json.allowApiBilling === true,
  };
}

export function loadMachineConfig(): MachineConfig {
  return parseMachineConfig(existsSync(MACHINE_CONFIG) ? JSON.parse(readFileSync(MACHINE_CONFIG, "utf8")) : {});
}

/**
 * The agent's environment. Unless the machine opts in, API keys are removed so
 * the CLIs use their logged-in subscriptions instead of billing an API account.
 */
export function agentEnv(machine: MachineConfig, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  if (!machine.allowApiBilling) {
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    delete env.OPENAI_API_KEY;
  }
  return env;
}
