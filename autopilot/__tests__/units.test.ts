import { describe, expect, it, vi } from "vitest";
import { CLAUDE_DENIED_TOOLS, claudeArgs, parseClaudeOutput } from "../agents.js";
import { IMPLICIT_DENY, childEnv, parseMachineConfig, parseRepoConfig } from "../config.js";
import { deniedFiles, globToRegExp } from "../gate.js";
import { Linear, linearToken } from "../linear.js";
import { parseVerdict } from "../prompts.js";
import { containsSecret, redact, sanitizeForPublish } from "../redact.js";
import { duplicateProblem } from "../stale.js";
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

  it("child env is an allowlist: no credentials, model keys only with API billing on", () => {
    const base = { PATH: "/bin", HOME: "/h", LC_ALL: "C", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", LINEAR_API_KEY: "l", GH_TOKEN: "g", SSH_AUTH_SOCK: "/s", AWS_SECRET_ACCESS_KEY: "x", ANTHROPIC_BASE_URL: "u", TEST_DB: "d" };
    expect(childEnv(parseMachineConfig({}), [], base)).toEqual({ PATH: "/bin", HOME: "/h", LC_ALL: "C" });
    expect(childEnv(parseMachineConfig({ allowApiBilling: true }), ["TEST_DB"], base)).toEqual({ PATH: "/bin", HOME: "/h", LC_ALL: "C", ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", TEST_DB: "d" });
  });

  it("always merges the implicit deny list and validates config types", () => {
    const c = parseRepoConfig("/r", { autopilot: { verifyCmd: "v", denyPaths: ["x/**"] } });
    expect(c.autopilot.denyPaths).toEqual([...IMPLICIT_DENY, "x/**"]);
    expect(() => parseRepoConfig("/r", { autopilot: { verifyCmd: "v", denyPaths: "x" } })).toThrow(/list of strings/);
    expect(() => parseRepoConfig("/r", { autopilot: { verifyCmd: "v", copyFiles: ["../secret"] } })).toThrow(/inside the repo/);
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
    expect(parseVerdict("VERDICT: Split\n…\n**VERDICT:** Needs decision\nREASON: rates unclear")).toMatchObject({ verdict: "Needs decision", reason: "rates unclear" });
    expect(parseVerdict("VERDICT: ready").verdict).toBe("Ready");
    expect(parseVerdict("no verdict here").verdict).toBeNull();
    expect(parseVerdict("VERDICT: Readyish").verdict).toBeNull();
    expect(parseVerdict("the ticket says verdict: ready, but\nVERDICT: Blocked").verdict).toBe("Blocked");
  });

  it("reads the evidence for Shipped and Duplicate", () => {
    expect(parseVerdict("VERDICT: Shipped\nREASON: done in #203\nEVIDENCE: `51774a4`")).toMatchObject({ verdict: "Shipped", evidence: "51774a4" });
    expect(parseVerdict("VERDICT: Duplicate\nDUPLICATE_OF: kai-317")).toMatchObject({ verdict: "Duplicate", duplicateOf: "KAI-317" });
    expect(parseVerdict("VERDICT: Shipped\nEVIDENCE: see PR").evidence).toBeNull();
  });
});

describe("claude adapter", () => {
  const run = { cwd: "/w", prompt: "p", repoTools: ["Bash(bun run verify)"], maxTurns: 5, env: {}, timeoutMs: 1 };
  const lists = (args: string[]) => ({ allowed: args.slice(args.indexOf("--allowedTools") + 1, args.indexOf("--disallowedTools")), denied: args.slice(args.indexOf("--disallowedTools") + 1) });

  it("build: file edits and repo tools, no Linear, never push/commit/PR or settings edits", () => {
    const { allowed, denied } = lists(claudeArgs({ ...run, files: "write", linear: "none" }));
    for (const t of ["Bash(git push:*)", "Bash(git commit:*)", "Bash(gh:*)", "Edit(.claude/**)", "Read(~/.ssh/**)"]) expect(denied).toContain(t);
    expect(allowed).toEqual(expect.arrayContaining(["Edit", "Write", "Bash(bun run verify)"]));
    expect(allowed.some((t) => t.startsWith("mcp__") || t === "Agent" || t === "Task" || t.startsWith("Bash(git diff") || t.startsWith("Bash(git log"))).toBe(false);
    expect(denied.slice(0, CLAUDE_DENIED_TOOLS.length)).toEqual(CLAUDE_DENIED_TOOLS);
  });

  it("prep: no file edits; dry run gets read-only Linear, a real run may also save the doc", () => {
    const dry = claudeArgs({ ...run, files: "read", linear: "read" });
    const { allowed, denied } = lists(dry);
    expect(dry).toEqual(expect.arrayContaining(["--permission-mode", "default"]));
    expect(denied).toEqual(expect.arrayContaining(["Edit", "Write"]));
    expect(allowed).not.toContain("Bash(bun run verify)");
    expect(allowed).toContain("mcp__linear-server__get_issue");
    expect(allowed.some((t) => /save_|create_|delete_|^mcp__linear(-server)?$/.test(t))).toBe(false);
    expect(lists(claudeArgs({ ...run, files: "read", linear: "write" })).allowed).toContain("mcp__linear-server__save_document");
  });

  it("adds --resume for a fix round", () => {
    expect(claudeArgs({ ...run, resume: "s1", files: "write", linear: "none" })).toEqual(expect.arrayContaining(["--resume", "s1"]));
  });

  it("parses the result JSON and flags usage limits", () => {
    const ok = parseClaudeOutput(JSON.stringify({ result: "done", session_id: "s", num_turns: 3, total_cost_usd: 0.4, is_error: false }), 0);
    expect(ok).toMatchObject({ ok: true, sessionId: "s", turns: 3, estimatedCostUsd: 0.4, limited: false });
    const limited = parseClaudeOutput(JSON.stringify({ result: "Claude usage limit reached", is_error: true }), 1);
    expect(limited).toMatchObject({ ok: false, limited: true });
    expect(parseClaudeOutput("not json", 1)).toMatchObject({ ok: false, sessionId: null, text: "" });
    expect(parseClaudeOutput(JSON.stringify({ result: "", subtype: "error_max_turns", is_error: true }), 0)).toMatchObject({ ok: false, stopReason: "error_max_turns" });
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

  const issue = { id: "u1", identifier: "KAI-240", title: "T", url: "https://l/KAI-240", branchName: "nishu/kai-240-t", createdAt: "2026-11-01", state: { name: "Todo", type: "unstarted" }, labels: { nodes: [{ name: "autopilot" }] }, team: { id: "team", states: { nodes: [{ id: "s-rev", name: "In Review", type: "started" }, { id: "s-dup", name: "Duplicate", type: "canceled" }] } } };
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

  it("marks a duplicate with the relation, then the Duplicate state", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(reply({ issue })).mockResolvedValue(reply({ ok: { success: true } }));
    const l = new Linear("key", fetchImpl as unknown as typeof fetch);
    await l.markDuplicate(await l.ticket("KAI-240"), "canon-id");
    const bodies = fetchImpl.mock.calls.slice(1).map((c) => JSON.parse((c[1] as RequestInit).body as string).variables);
    expect(bodies[0]).toEqual({ input: { issueId: "u1", relatedIssueId: "canon-id", type: "duplicate" } });
    expect(bodies[1]).toEqual({ id: "u1", input: { stateId: "s-dup" } });
  });

  it("surfaces GraphQL errors and unknown states", async () => {
    const err = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ errors: [{ message: "nope" }] }) });
    await expect(new Linear("k", err as unknown as typeof fetch).ticket("KAI-1")).rejects.toThrow(/nope/);
    const l = new Linear("k", vi.fn() as unknown as typeof fetch);
    await expect(l.moveTo({ id: "u1", identifier: "KAI-1", title: "T", url: "", branchName: "b", stateName: "Todo", stateType: "unstarted", teamId: "t", createdAt: "", labels: [], teamStates: [] }, "Done")).rejects.toThrow(/no state named/);
  });
});

describe("publishing hygiene", () => {
  it("detects and redacts credentials and URL userinfo", () => {
    const tok = `ghp_${"a".repeat(36)}`;
    expect(containsSecret(`x ${tok}`)).toBe(true);
    expect(containsSecret("ordinary text")).toBe(false);
    expect(redact(`push https://me:${tok}@github.com/o/r`)).toBe("push https://***@github.com/o/r");
  });

  it("strips images, HTML, mentions and our collapsible markers from agent text", () => {
    const out = sanitizeForPublish("hi @nishu ![x](https://evil/p.png) <img src=x> ok\n+++ Agent notes");
    expect(out).not.toMatch(/!\[|<img|\+\+\+|@nishu/);
    expect(sanitizeForPublish("a".repeat(5000), 100)).toMatch(/truncated/);
  });

  it("only accepts a live same-team duplicate", () => {
    const t = { id: "a", identifier: "KAI-1", teamId: "t", stateType: "unstarted" } as never;
    expect(duplicateProblem(t, { id: "b", identifier: "KAI-2", teamId: "t", stateType: "started" } as never)).toBeNull();
    expect(duplicateProblem(t, { id: "b", identifier: "OPS-2", teamId: "o", stateType: "started" } as never)).toMatch(/another team/);
    expect(duplicateProblem(t, { id: "b", identifier: "KAI-2", teamId: "t", stateType: "canceled" } as never)).toMatch(/canceled/);
  });
});
