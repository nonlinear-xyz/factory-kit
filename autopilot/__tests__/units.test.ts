import { describe, expect, it, vi } from "vitest";
import { CLAUDE_DENIED_TOOLS, claudeArgs, parseClaudeOutput } from "../agents.js";
import { agentEnv, parseMachineConfig, parseRepoConfig } from "../config.js";
import { deniedFiles, globToRegExp } from "../gate.js";
import { Linear, linearToken } from "../linear.js";
import { parseVerdict } from "../prompts.js";
import { assertTicketBranch } from "../worktree.js";

describe("config", () => {
  it("refuses a repo without an autopilot block or a verify command", () => {
    expect(() => parseRepoConfig("/r", { teamKey: "KAI" })).toThrow(/hasn't opted in/);
    expect(() => parseRepoConfig("/r", { autopilot: {} })).toThrow(/verifyCmd is required/);
  });

  it("fills defaults and reads the In Review state name", () => {
    const c = parseRepoConfig("/r", { teamKey: "KAI", states: { inReview: "Review" }, autopilot: { verifyCmd: "bun run verify" } });
    expect(c.inReviewState).toBe("Review");
    expect(c.autopilot.triggerLabel).toBe("autopilot");
    expect(c.autopilot.baseBranch).toBe("main");
  });

  it("strips API keys unless the machine opts in to API billing", () => {
    const base = { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", PATH: "/bin" };
    expect(agentEnv(parseMachineConfig({}), base)).toEqual({ PATH: "/bin" });
    expect(agentEnv(parseMachineConfig({ allowApiBilling: true }), base)).toEqual(base);
  });

  it("never hands the runner's Linear or GitHub credentials to the agent", () => {
    const base = { LINEAR_API_KEY: "l", GH_TOKEN: "g", GITHUB_TOKEN: "g2", PATH: "/bin" };
    expect(agentEnv(parseMachineConfig({ allowApiBilling: true }), base)).toEqual({ PATH: "/bin" });
  });

  it("defaults to claude with the plain launcher and drops unknown agents", () => {
    expect(parseMachineConfig({ agents: ["gpt"], launcher: "tmux" })).toMatchObject({ agents: ["claude"], launcher: "plain" });
  });
});

describe("denyPaths", () => {
  it("matches ** across directories and * within one", () => {
    expect(globToRegExp("supabase/migrations/**").test("supabase/migrations/2026/x.sql")).toBe(true);
    expect(globToRegExp("src/**/*.sql").test("src/a.sql")).toBe(true);
    expect(globToRegExp("src/*.ts").test("src/lib/a.ts")).toBe(false);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });

  it("returns only the files a pattern denies", () => {
    expect(deniedFiles(["src/lib/format.ts", "supabase/migrations/1.sql"], ["supabase/migrations/**"])).toEqual(["supabase/migrations/1.sql"]);
  });
});

describe("prep verdict", () => {
  it("takes the last VERDICT line and its reason", () => {
    expect(parseVerdict("VERDICT: Split\n…\n**VERDICT:** Needs decision\nREASON: rates unclear")).toEqual({ verdict: "Needs decision", reason: "rates unclear" });
    expect(parseVerdict("VERDICT: ready").verdict).toBe("Ready");
    expect(parseVerdict("no verdict here").verdict).toBeNull();
  });
});

describe("claude adapter", () => {
  it("never lets the agent push, commit or open PRs", () => {
    const args = claudeArgs({ cwd: "/w", prompt: "p", allowedTools: ["Bash(bun run:*)"], maxTurns: 5, env: {}, timeoutMs: 1 });
    const denied = args.slice(args.indexOf("--disallowedTools") + 1);
    for (const t of ["Bash(git push:*)", "Bash(git commit:*)", "Bash(gh:*)"]) expect(denied).toContain(t);
    expect(CLAUDE_DENIED_TOOLS.length).toBe(denied.length);
    expect(args).toContain("Bash(bun run:*)");
  });

  it("adds --resume for a fix round", () => {
    expect(claudeArgs({ cwd: "/w", prompt: "fix", resume: "s1", allowedTools: [], maxTurns: 5, env: {}, timeoutMs: 1 })).toEqual(expect.arrayContaining(["--resume", "s1"]));
  });

  it("parses the result JSON and flags usage limits", () => {
    const ok = parseClaudeOutput(JSON.stringify({ result: "done", session_id: "s", num_turns: 3, total_cost_usd: 0.4, is_error: false }), 0);
    expect(ok).toMatchObject({ ok: true, sessionId: "s", turns: 3, estimatedCostUsd: 0.4, limited: false });
    const limited = parseClaudeOutput(JSON.stringify({ result: "Claude usage limit reached", is_error: true }), 1);
    expect(limited).toMatchObject({ ok: false, limited: true });
    expect(parseClaudeOutput("not json", 1)).toMatchObject({ ok: false, sessionId: null });
  });
});

describe("branch guard", () => {
  it("requires the ticket id and refuses protected branches", () => {
    expect(() => assertTicketBranch("nishu/kai-240-currency", "KAI-240")).not.toThrow();
    expect(() => assertTicketBranch("nishu/kai-2400-x", "KAI-240")).toThrow();
    expect(() => assertTicketBranch("main", "KAI-240")).toThrow();
  });
});

describe("linear", () => {
  it("prefers LINEAR_API_KEY from the environment", () => {
    expect(linearToken({ LINEAR_API_KEY: "env-key" })).toBe("env-key");
  });

  const issue = { id: "u1", identifier: "KAI-240", title: "T", url: "https://l/KAI-240", branchName: "nishu/kai-240-t", state: { name: "Todo" }, labels: { nodes: [{ name: "autopilot" }] }, team: { states: { nodes: [{ id: "s-rev", name: "In Review" }] } } };
  const reply = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) }) as Response;

  it("maps an issue and moves it by state name", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply({ issue })).mockResolvedValueOnce(reply({ issueUpdate: { success: true } }));
    const l = new Linear("key", fetchImpl as unknown as typeof fetch);
    const t = await l.ticket("KAI-240");
    expect(t).toMatchObject({ id: "u1", labels: ["autopilot"], branchName: "nishu/kai-240-t" });
    await l.moveTo(t, "in review");
    const body = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string);
    expect(body.variables).toEqual({ id: "u1", input: { stateId: "s-rev" } });
  });

  it("surfaces GraphQL errors and unknown states", async () => {
    const err = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ errors: [{ message: "nope" }] }) });
    await expect(new Linear("k", err as unknown as typeof fetch).ticket("KAI-1")).rejects.toThrow(/nope/);
    const l = new Linear("k", vi.fn() as unknown as typeof fetch);
    await expect(l.moveTo({ id: "u1", identifier: "KAI-1", title: "T", url: "", branchName: "b", stateName: "Todo", labels: [], teamStates: [] }, "Done")).rejects.toThrow(/no state named/);
  });
});
