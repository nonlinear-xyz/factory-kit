import { exec } from "./exec.js";
import type { AgentName, AgentResult } from "./types.js";

/**
 * What a headless step may do. Headless agents can't ask for permission, so a
 * tool that isn't allowed here is simply denied.
 *  - "read": no file edits (prep; and anything in a dry run that should only look).
 *  - "write": file edits in the worktree (build).
 * Linear access is separate: "read", or "write" = read plus saving the working
 * doc (prep on a real run). Build never writes to Linear; subagents are never
 * granted, since they could inherit wider tools.
 */
export interface AgentRun {
  cwd: string;
  prompt: string;
  /** Resume this session with `prompt` as the follow-up instead of starting fresh. */
  resume?: string;
  files: "read" | "write";
  linear: "none" | "read" | "write";
  /** Repo-configured extra tools (e.g. "Bash(bun run:*)"); only granted in "write" mode. */
  repoTools: string[];
  maxTurns: number;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface Agent {
  name: AgentName;
  run(r: AgentRun): AgentResult;
}

const LINEAR_SERVERS = ["mcp__linear-server", "mcp__linear"];
const LINEAR_READ_TOOLS = ["get_issue", "list_issues", "list_comments", "get_document", "list_documents", "get_project", "list_projects", "get_team", "list_teams", "list_issue_statuses", "get_issue_status", "list_issue_labels", "get_user", "list_users", "get_milestone", "list_milestones"];

/**
 * Always denied; deny rules win over allow rules. These are defence in depth,
 * not a boundary: prefix rules can't stop code the agent writes and then runs
 * through an allowed command. The runner's gate is what decides.
 */
export const CLAUDE_DENIED_TOOLS = [
  "Bash(git push:*)", "Bash(git commit:*)", "Bash(git reset:*)", "Bash(git checkout:*)", "Bash(git -C:*)", "Bash(git -c:*)",
  "Bash(gh:*)", "Bash(env:*)", "Bash(bash:*)", "Bash(sh:*)", "Bash(zsh:*)", "Bash(curl:*)", "Bash(wget:*)", "Bash(security:*)", "Bash(ssh:*)", "Bash(scp:*)",
  "Edit(.claude/**)", "Write(.claude/**)", "Edit(.codex/**)", "Write(.codex/**)", "Edit(.mcp.json)", "Write(.mcp.json)", "Edit(.git/**)", "Write(.git/**)",
  "Read(~/.ssh/**)", "Read(~/.config/**)", "Read(~/.aws/**)", "Read(~/.netrc)", "Read(**/.env*)",
];
const FILE_WRITE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

export function claudeArgs(r: AgentRun): string[] {
  const allowed = ["Read", "Grep", "Glob", "Bash(git status:*)"];
  const denied = [...CLAUDE_DENIED_TOOLS];
  if (r.files === "write") allowed.push(...FILE_WRITE_TOOLS, ...r.repoTools);
  else denied.push(...FILE_WRITE_TOOLS);
  if (r.linear !== "none") allowed.push(...LINEAR_SERVERS.flatMap((s) => LINEAR_READ_TOOLS.map((t) => `${s}__${t}`)));
  if (r.linear === "write") allowed.push(...LINEAR_SERVERS.map((s) => `${s}__save_document`));

  const args = ["-p", r.prompt, "--output-format", "json", "--max-turns", String(r.maxTurns), "--permission-mode", r.files === "write" ? "acceptEdits" : "default"];
  if (r.resume) args.push("--resume", r.resume);
  args.push("--allowedTools", ...allowed);
  args.push("--disallowedTools", ...denied);
  return args;
}

const LIMIT = /usage limit|rate limit|limit reached|out of (?:credits|usage)|\b429\b/i;

export function parseClaudeOutput(stdout: string, status: number): AgentResult {
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(stdout.trim().split("\n").filter(Boolean).at(-1) ?? "");
  } catch {
    json = null;
  }
  if (!json) return { ok: false, sessionId: null, text: "", turns: null, estimatedCostUsd: null, limited: LIMIT.test(stdout), stopReason: status === 0 ? "unreadable output" : `exit ${status}` };
  const text = String(json.result ?? "");
  const isError = json.is_error === true || status !== 0;
  return {
    ok: !isError,
    sessionId: typeof json.session_id === "string" ? json.session_id : null,
    text,
    turns: typeof json.num_turns === "number" ? json.num_turns : null,
    estimatedCostUsd: typeof json.total_cost_usd === "number" ? json.total_cost_usd : null,
    limited: isError && LIMIT.test(text),
    stopReason: isError ? String(json.subtype ?? `exit ${status}`) : null,
  };
}

export const claude: Agent = {
  name: "claude",
  run(r) {
    const res = exec("claude", claudeArgs(r), { cwd: r.cwd, env: r.env, timeoutMs: r.timeoutMs });
    return parseClaudeOutput(res.stdout || res.stderr, res.status);
  },
};

export function agentFor(name: AgentName): Agent {
  switch (name) {
    case "claude":
      return claude;
    case "codex":
      throw new Error("The Codex adapter lands in slice 2. Use --agent claude for now.");
    default:
      return name satisfies never;
  }
}
