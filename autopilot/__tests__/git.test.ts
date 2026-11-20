// Real git in a temp dir: a bare "origin", a main checkout, and the ticket
// worktree autopilot creates from it.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IMPLICIT_DENY } from "../config.js";
import { exec, must } from "../exec.js";
import { changedFiles, gate, head, parsePorcelainZ, settingsFingerprint } from "../gate.js";
import type { Baseline } from "../gate.js";
import { PublishError, publish } from "../handoff.js";
import { staleComment, verifyShipped } from "../stale.js";
import type { RepoConfig, Ticket } from "../types.js";
import { ensureWorktree, lock, prepareWorktree, worktreePath } from "../worktree.js";

const ENV = { PATH: process.env.PATH, HOME: process.env.HOME };
const GIT_ID = ["-c", "user.email=t@t", "-c", "user.name=t"];

function fixture(autopilot: Partial<RepoConfig["autopilot"]> = {}): RepoConfig {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "autopilot-git-")));
  const origin = path.join(tmp, "origin.git");
  const repo = path.join(tmp, "repo");
  must("git", ["init", "-q", "--bare", "-b", "main", origin]);
  must("git", ["clone", "-q", origin, repo]);
  writeFileSync(path.join(repo, ".gitignore"), ".env.local\n");
  must("git", ["-C", repo, "add", ".gitignore"]);
  must("git", ["-C", repo, ...GIT_ID, "commit", "-q", "-m", "init"]);
  must("git", ["-C", repo, "push", "-q", "origin", "HEAD:main"]);
  writeFileSync(path.join(repo, ".env.local"), "X=1\n");
  return {
    repoRoot: repo,
    teamKey: "KAI",
    inReviewState: "In Review",
    doneState: "Done",
    autopilot: { triggerLabel: "autopilot", baseBranch: "main", verifyCmd: "true", canaryCmd: null, setup: [], copyFiles: [".env.local"], denyPaths: [...IMPLICIT_DENY, "supabase/**"], allowedTools: [], envPassthrough: [], maxTurns: 5, commitType: "fix", staleAction: "close", ...autopilot },
  };
}

function start(cfg: RepoConfig, id: string): { dir: string; baseline: Baseline } {
  const dir = ensureWorktree(cfg, id, `nishu/${id.toLowerCase()}-x`);
  return { dir, baseline: { head: head(dir), settings: settingsFingerprint(dir) } };
}

describe("worktree", () => {
  it("creates the ticket worktree from origin/main with no upstream, and reuses it", () => {
    const cfg = fixture();
    const dir = ensureWorktree(cfg, "KAI-240", "nishu/kai-240-x");
    expect(dir).toBe(worktreePath(cfg.repoRoot, "KAI-240"));
    expect(exec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "@{u}"]).status).not.toBe(0);
    expect(ensureWorktree(cfg, "KAI-240", "nishu/kai-240-x")).toBe(dir);
  });

  it("matches the ticket branch exactly, not by prefix", () => {
    const cfg = fixture();
    const longer = ensureWorktree(cfg, "KAI-12", "nishu/kai-12-xx");
    expect(() => ensureWorktree(cfg, "KAI-12", "nishu/kai-12-x")).toThrow(/exists but is not the worktree/);
    expect(longer).toBe(worktreePath(cfg.repoRoot, "KAI-12"));
  });

  it("copies only gitignored files and reports a failing setup command", () => {
    const cfg = fixture({ setup: ["false"] });
    const { dir } = start(cfg, "KAI-1");
    expect(prepareWorktree(cfg, dir, ENV).ok).toBe(false);
    expect(existsSync(path.join(dir, ".env.local"))).toBe(true);
    expect(changedFiles(dir)).toEqual([]);

    const leaky = fixture({ copyFiles: ["secrets.txt"] });
    writeFileSync(path.join(leaky.repoRoot, "secrets.txt"), "x\n");
    const w = start(leaky, "KAI-11");
    expect(prepareWorktree(leaky, w.dir, ENV)).toMatchObject({ ok: false, output: expect.stringContaining("not gitignored") });
  });

  it("refuses to reuse a dirty worktree, one with local commits, or the main checkout", () => {
    const cfg = fixture({ copyFiles: [] });
    const { dir } = start(cfg, "KAI-5");
    writeFileSync(path.join(dir, "leftover.ts"), "x\n");
    expect(() => ensureWorktree(cfg, "KAI-5", "nishu/kai-5-x")).toThrow(/uncommitted changes/);

    must("git", ["-C", dir, "add", "-A"]);
    must("git", ["-C", dir, ...GIT_ID, "commit", "-q", "-m", "by hand"]);
    expect(() => ensureWorktree(cfg, "KAI-5", "nishu/kai-5-x")).toThrow(/local commit/);

    must("git", ["-C", cfg.repoRoot, "checkout", "-q", "-b", "nishu/kai-6-x"]);
    expect(() => ensureWorktree(cfg, "KAI-6", "nishu/kai-6-x")).toThrow(/main checkout/);
  });

  it("lock: never empty, a live holder blocks, a dead holder's lock is taken over", () => {
    const state = mkdtempSync(path.join(os.tmpdir(), "autopilot-lock-"));
    const file = path.join(state, "KAI-7.lock");
    writeFileSync(file, "999999"); // dead pid
    const release = lock(state, "KAI-7");
    expect(Number(readFileSync(file, "utf8"))).toBe(process.pid);
    expect(() => lock(state, "KAI-7")).toThrow(/already running/);
    release();
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(state)).toEqual([]);
  });
});

describe("gate", () => {
  it("fails with no changes, on a denied path, and on a red verify; passes when green", () => {
    const cfg = fixture({ copyFiles: [] });
    const { dir, baseline } = start(cfg, "KAI-2");
    expect(gate(cfg, dir, baseline, ENV)).toMatchObject({ ok: false, failures: "The agent changed no files." });

    writeFileSync(path.join(dir, "a.ts"), "x\n");
    expect(gate(cfg, dir, baseline, ENV).ok).toBe(true);
    expect(gate({ ...cfg, autopilot: { ...cfg.autopilot, verifyCmd: "echo broke; exit 1" } }, dir, baseline, ENV)).toMatchObject({ ok: false, failures: expect.stringContaining("broke") });

    mkdirSync(path.join(dir, "supabase"));
    writeFileSync(path.join(dir, "supabase/m.sql"), "x\n");
    expect(gate(cfg, dir, baseline, ENV)).toMatchObject({ ok: false, deniedFiles: ["supabase/m.sql"] });
  });

  it("parses NUL-delimited status: spaces stay unquoted, renames report both sides", () => {
    expect(parsePorcelainZ("?? supabase/a b.sql\0R  src/x.ts\0supabase/x.ts\0 M c.ts\0")).toEqual(["supabase/a b.sql", "src/x.ts", "supabase/x.ts", "c.ts"]);
  });

  it("denies a path with spaces, a rename out of a denied directory, and case tricks", () => {
    const cfg = fixture({ copyFiles: [] });
    const { dir, baseline } = start(cfg, "KAI-3");
    mkdirSync(path.join(dir, "supabase"));
    writeFileSync(path.join(dir, "supabase/a b.sql"), "x\n");
    expect(gate(cfg, dir, baseline, ENV).deniedFiles).toEqual(["supabase/a b.sql"]);

    const seeded = fixture({ copyFiles: [] });
    mkdirSync(path.join(seeded.repoRoot, "supabase"));
    writeFileSync(path.join(seeded.repoRoot, "supabase/old.sql"), "x\n");
    must("git", ["-C", seeded.repoRoot, "add", "-A"]);
    must("git", ["-C", seeded.repoRoot, ...GIT_ID, "commit", "-q", "-m", "seed"]);
    must("git", ["-C", seeded.repoRoot, "push", "-q", "origin", "HEAD:main"]);
    const s = start(seeded, "KAI-13");
    must("git", ["-C", s.dir, "mv", "supabase/old.sql", "moved.sql"]);
    expect(gate(seeded, s.dir, s.baseline, ENV)).toMatchObject({ ok: false, deniedFiles: ["supabase/old.sql"] });

    expect(gate(cfg, dir, baseline, ENV).ok).toBe(false);
    const c = start(fixture({ copyFiles: [] }), "KAI-14");
    mkdirSync(path.join(c.dir, ".GitHub/workflows"), { recursive: true });
    writeFileSync(path.join(c.dir, ".GitHub/workflows/ci.yml"), "x\n");
    expect(gate(fixture(), c.dir, c.baseline, ENV).deniedFiles).toEqual([".GitHub/workflows/ci.yml"]);
  });

  it("denies the implicit list: CI, agent settings, package scripts, env files", () => {
    const cfg = fixture({ copyFiles: [] });
    const { dir, baseline } = start(cfg, "KAI-15");
    writeFileSync(path.join(dir, "package.json"), "{}\n");
    expect(gate(cfg, dir, baseline, ENV).deniedFiles).toEqual(["package.json"]);
  });

  it("re-checks denied paths after verify, which can generate files", () => {
    const cfg = fixture({ copyFiles: [], verifyCmd: "mkdir -p supabase && echo gen > supabase/generated.sql" });
    const { dir, baseline } = start(cfg, "KAI-4");
    writeFileSync(path.join(dir, "ok.ts"), "x\n");
    expect(gate(cfg, dir, baseline, ENV)).toMatchObject({ ok: false, deniedFiles: ["supabase/generated.sql"] });
  });

  it("fails when the agent committed, or changed its own (even gitignored) settings", () => {
    const cfg = fixture({ copyFiles: [] });
    const a = start(cfg, "KAI-16");
    writeFileSync(path.join(a.dir, "x.ts"), "x\n");
    must("git", ["-C", a.dir, "add", "-A"]);
    must("git", ["-C", a.dir, ...GIT_ID, "commit", "-q", "-m", "agent commit"]);
    expect(gate(cfg, a.dir, a.baseline, ENV)).toMatchObject({ ok: false, failures: expect.stringContaining("created commits") });

    const b = start(cfg, "KAI-17");
    mkdirSync(path.join(b.dir, ".claude"));
    writeFileSync(path.join(b.dir, ".claude/settings.local.json"), '{"permissions":{"allow":["Bash(*)"]}}');
    writeFileSync(path.join(b.dir, "y.ts"), "y\n");
    expect(gate(cfg, b.dir, b.baseline, ENV)).toMatchObject({ ok: false, failures: expect.stringContaining("settings") });
  });

  it("runs verify with only the env it is given", () => {
    const cfg = fixture({ copyFiles: [], verifyCmd: 'test -z "$GH_TOKEN"' });
    const { dir, baseline } = start(cfg, "KAI-18");
    writeFileSync(path.join(dir, "z.ts"), "z\n");
    expect(gate(cfg, dir, baseline, ENV).ok).toBe(true);
    expect(gate(cfg, dir, baseline, { ...ENV, GH_TOKEN: "leak" }).ok).toBe(false);
  });
});

describe("publish", () => {
  const ticket: Ticket = { id: "u", identifier: "KAI-19", title: "T", url: "https://l/KAI-19", branchName: "nishu/kai-19-x", stateName: "Todo", stateType: "unstarted", teamId: "t", createdAt: "", labels: [], teamStates: [] };

  it("undoes its commit and publishes nothing when the push fails", () => {
    const cfg = fixture({ copyFiles: [] });
    const { dir, baseline } = start(cfg, "KAI-19");
    writeFileSync(path.join(dir, "a.ts"), "x\n");
    must("git", ["-C", dir, "remote", "set-url", "origin", "/nonexistent/origin.git"]);
    const h = { cfg, ticket, dir, branch: ticket.branchName, agent: "claude" as const, summary: "did it", changedFiles: ["a.ts"], startSha: baseline.head };
    expect(() => publish(h)).toThrow(PublishError);
    expect(head(dir)).toBe(baseline.head);
    expect(changedFiles(dir)).toEqual(["a.ts"]);
  });

  it("refuses a credential in the diff or the summary", () => {
    const cfg = fixture({ copyFiles: [] });
    const { dir, baseline } = start(cfg, "KAI-20");
    writeFileSync(path.join(dir, "a.ts"), `const k = "ghp_${"a".repeat(36)}";\n`);
    const h = { cfg, ticket: { ...ticket, identifier: "KAI-20", branchName: "nishu/kai-20-x" }, dir, branch: "nishu/kai-20-x", agent: "claude" as const, summary: "ok", changedFiles: ["a.ts"], startSha: baseline.head };
    expect(() => publish(h)).toThrow(/credential/);
    expect(head(dir)).toBe(baseline.head);
  });
});

describe("stale close", () => {
  it("accepts only a commit on origin/main, and says whether it names the ticket", () => {
    const cfg = fixture();
    const repo = cfg.repoRoot;
    must("git", ["-C", repo, ...GIT_ID, "commit", "-q", "--allow-empty", "-m", "Fix palette (KAI-318)"]);
    must("git", ["-C", repo, "push", "-q", "origin", "HEAD:main"]);
    const named = must("git", ["-C", repo, "rev-parse", "HEAD"]);
    expect(verifyShipped(repo, "main", named.slice(0, 8), "KAI-318")).toMatchObject({ ok: true, commit: named, namesTicket: true });
    expect(verifyShipped(repo, "main", named, "KAI-31")).toMatchObject({ ok: true, namesTicket: false });

    must("git", ["-C", repo, ...GIT_ID, "commit", "-q", "--allow-empty", "-m", "local only"]);
    const local = must("git", ["-C", repo, "rev-parse", "HEAD"]);
    expect(verifyShipped(repo, "main", local, "KAI-1")).toMatchObject({ ok: false, detail: expect.stringContaining("not on origin/main") });
    expect(verifyShipped(repo, "main", "deadbeef", "KAI-1")).toMatchObject({ ok: false, detail: expect.stringContaining("doesn't exist") });
  });

  it("says what it did, why it didn't, and how to undo it", () => {
    expect(staleComment({ reason: "shipped", commit: "51774a4abcdef" }, "fixed in #203", true, "Floating command panel (#203)")).toMatch(/51774a4abc[\s\S]*closed this ticket as done[\s\S]*Reopen/);
    expect(staleComment({ reason: "shipped", commit: "51774a4abcdef" }, "", false, "x", "the commit doesn't name KAI-318")).toMatch(/did not close it: the commit doesn't name KAI-318/);
  });
});
