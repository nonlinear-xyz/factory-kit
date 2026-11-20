import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentName, MachineConfig, RepoAutopilotConfig, RepoConfig } from "./types.js";

export const STATE_DIR = process.env.FACTORY_KIT_AUTOPILOT_STATE ?? path.join(os.homedir(), ".local/state/factory-kit/autopilot");
const MACHINE_CONFIG = process.env.FACTORY_KIT_AUTOPILOT_CONFIG ?? path.join(os.homedir(), ".config/factory-kit/autopilot.json");

/**
 * Paths no autopilot change may touch, in every repo, merged with the repo's own
 * denyPaths. Each is either executed with more trust than the agent has (CI,
 * git hooks, package scripts, agent settings) or holds secrets.
 */
export const IMPLICIT_DENY = [
  ".github/**",
  ".claude/**",
  ".codex/**",
  ".mcp.json",
  ".factory-kit/**",
  ".husky/**",
  ".git/**",
  ".gitignore",
  ".gitattributes",
  ".gitmodules",
  "**/package.json",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  ".npmrc",
  "bunfig.toml",
  "**/.env*",
];

const REPO_DEFAULTS: RepoAutopilotConfig = {
  triggerLabel: "autopilot",
  baseBranch: "main",
  verifyCmd: "",
  canaryCmd: null,
  setup: [],
  copyFiles: [],
  denyPaths: [],
  allowedTools: [],
  maxTurns: 60,
  commitType: "fix",
  staleAction: "close",
  envPassthrough: [],
};

function strings(v: unknown, name: string): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new Error(`autopilot.${name} must be a list of strings.`);
  return v;
}

/** Parse the repo's `.factory-kit/linear.json`. Throws when autopilot isn't configured. */
export function parseRepoConfig(repoRoot: string, raw: unknown): RepoConfig {
  const json = (raw ?? {}) as Record<string, unknown>;
  const block = json.autopilot as Record<string, unknown> | undefined;
  if (!block) throw new Error(`No "autopilot" block in ${repoRoot}/.factory-kit/linear.json; this repo hasn't opted in.`);
  const str = (k: string, d: string) => (typeof block[k] === "string" ? (block[k] as string) : d);
  const autopilot: RepoAutopilotConfig = {
    triggerLabel: str("triggerLabel", REPO_DEFAULTS.triggerLabel),
    baseBranch: str("baseBranch", REPO_DEFAULTS.baseBranch),
    verifyCmd: str("verifyCmd", ""),
    canaryCmd: typeof block.canaryCmd === "string" ? block.canaryCmd : null,
    setup: strings(block.setup, "setup"),
    copyFiles: strings(block.copyFiles, "copyFiles"),
    denyPaths: [...IMPLICIT_DENY, ...strings(block.denyPaths, "denyPaths")],
    allowedTools: strings(block.allowedTools, "allowedTools"),
    maxTurns: typeof block.maxTurns === "number" && block.maxTurns > 0 ? block.maxTurns : REPO_DEFAULTS.maxTurns,
    commitType: str("commitType", REPO_DEFAULTS.commitType),
    staleAction: block.staleAction === "comment" ? "comment" : "close",
    envPassthrough: strings(block.envPassthrough, "envPassthrough"),
  };
  if (!autopilot.verifyCmd.trim()) throw new Error('autopilot.verifyCmd is required: the gate needs a command that means "green" for this repo.');
  for (const f of autopilot.copyFiles) {
    if (path.isAbsolute(f) || f.split(/[\\/]/).includes("..")) throw new Error(`autopilot.copyFiles entry "${f}" must be a path inside the repo.`);
  }
  const states = (json.states ?? {}) as Record<string, string>;
  return {
    repoRoot,
    teamKey: String(json.teamKey ?? ""),
    inReviewState: states.inReview ?? "In Review",
    doneState: states.done ?? "Done",
    autopilot,
  };
}

/** `override` points at a trial config outside the repo, for testing before the repo opts in. */
export function loadRepoConfig(repoRoot: string, override?: string): RepoConfig {
  const file = override ? path.resolve(override) : [".factory-kit/linear.json", ".claude/linear.json"].map((f) => path.join(repoRoot, f)).find(existsSync);
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

/** The only variables a child process gets by default. No credential is on it. */
const BASE_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TERM", "TMPDIR", "TZ"];
const API_BILLING_ENV = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

/**
 * Environment for everything that runs repo or agent code: the agent, and the
 * setup, canary and verify commands (which execute files the agent can edit).
 * An allowlist, not a denylist: GH_TOKEN, SSH_AUTH_SOCK, cloud credentials,
 * LINEAR_API_KEY and model API keys never reach them, so the agent CLIs fall
 * back to their logged-in subscriptions. `extra` is the repo's envPassthrough.
 */
export function childEnv(machine: MachineConfig, extra: string[] = [], base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keep = new Set([...BASE_ENV, ...extra, ...(machine.allowApiBilling ? API_BILLING_ENV : [])]);
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && (keep.has(k) || k.startsWith("LC_"))) env[k] = v;
  return env;
}
