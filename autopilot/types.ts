// Autopilot state model. A run moves through fixed stages and ends in exactly
// one outcome; every bounce names the stage that stopped it, so the ledger can
// say where tickets fail without parsing prose.

export type AgentName = "claude" | "codex";

export type Stage = "config" | "worktree" | "canary" | "prep" | "build" | "gate" | "handoff";

export type Verdict = "Ready" | "Split" | "Blocked" | "Needs decision" | "Shipped" | "Duplicate";

/** Why a stale ticket was closed, with evidence the runner checked itself. */
export type StaleClose =
  | { reason: "shipped"; commit: string }
  | { reason: "duplicate"; of: string };

export type RunOutcome =
  | { kind: "bounced"; stage: Stage; reason: string }
  | { kind: "dry-run"; worktree: string; branch: string; changedFiles: string[] }
  | { kind: "handed-off"; prUrl: string; branch: string }
  /** Already on main or duplicated. `applied` is false on a dry run or with staleAction "comment". */
  | { kind: "closed"; close: StaleClose; applied: boolean };

/** One headless agent turn (a run, or a resume with feedback). */
export interface AgentResult {
  ok: boolean;
  sessionId: string | null;
  text: string;
  turns: number | null;
  /** Estimated at API list prices; subscription runs are not billed this. */
  estimatedCostUsd: number | null;
  /** The agent stopped on a usage or rate limit, not on the task. */
  limited: boolean;
}

export interface GateResult {
  ok: boolean;
  changedFiles: string[];
  deniedFiles: string[];
  failures: string;
}

/** Repo policy: `.factory-kit/linear.json` → `autopilot`. */
export interface RepoAutopilotConfig {
  triggerLabel: string;
  baseBranch: string;
  verifyCmd: string;
  canaryCmd: string | null;
  setup: string[];
  copyFiles: string[];
  denyPaths: string[];
  /** Extra tools the build agent may use beyond file edits (Claude syntax). */
  allowedTools: string[];
  /** Tools prep (and build) need to read and write Linear, e.g. the Linear MCP server. */
  linearTools: string[];
  maxTurns: number;
  commitType: string;
  /** What to do when prep finds a ticket already shipped or duplicated. */
  staleAction: "close" | "comment";
}

/** Machine policy: `~/.config/factory-kit/autopilot.json`. */
export interface MachineConfig {
  launcher: "plain" | "rex";
  agents: AgentName[];
  dailyCap: Partial<Record<AgentName, number>>;
  /** false (default): strip API keys so runs bill to the CLI subscription. */
  allowApiBilling: boolean;
}

export interface RepoConfig {
  repoRoot: string;
  teamKey: string;
  inReviewState: string;
  doneState: string;
  autopilot: RepoAutopilotConfig;
}

export interface Ticket {
  id: string;
  identifier: string;
  title: string;
  url: string;
  branchName: string;
  stateName: string;
  labels: string[];
  teamStates: { id: string; name: string; type: string }[];
}
