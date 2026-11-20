import { exec } from "./exec.js";
import type { AgentName, AgentResult } from "./types.js";

export interface AgentRun {
  cwd: string;
  prompt: string;
  /** Resume this session with `prompt` as the follow-up instead of starting fresh. */
  resume?: string;
  allowedTools: string[];
  maxTurns: number;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface Agent {
  name: AgentName;
  run(r: AgentRun): AgentResult;
}

/** The agent edits files and runs checks. Git writes and PRs belong to the runner. */
export const CLAUDE_DENIED_TOOLS = ["Bash(git push:*)", "Bash(git commit:*)", "Bash(git reset:*)", "Bash(git checkout:*)", "Bash(gh:*)"];
const CLAUDE_BASE_TOOLS = ["Read", "Edit", "Write", "MultiEdit", "Grep", "Glob", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)"];

export function claudeArgs(r: AgentRun): string[] {
  const args = ["-p", r.prompt, "--output-format", "json", "--max-turns", String(r.maxTurns), "--permission-mode", "acceptEdits"];
  if (r.resume) args.push("--resume", r.resume);
  args.push("--allowedTools", ...CLAUDE_BASE_TOOLS, ...r.allowedTools);
  args.push("--disallowedTools", ...CLAUDE_DENIED_TOOLS);
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
  if (!json) return { ok: false, sessionId: null, text: stdout.slice(-2000), turns: null, estimatedCostUsd: null, limited: LIMIT.test(stdout) };
  const text = String(json.result ?? "");
  const isError = json.is_error === true || status !== 0;
  return {
    ok: !isError,
    sessionId: typeof json.session_id === "string" ? json.session_id : null,
    text,
    turns: typeof json.num_turns === "number" ? json.num_turns : null,
    estimatedCostUsd: typeof json.total_cost_usd === "number" ? json.total_cost_usd : null,
    limited: isError && LIMIT.test(text),
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
