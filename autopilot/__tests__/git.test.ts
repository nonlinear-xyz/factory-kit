// Real git in a temp dir: a bare "origin", a main checkout, and the ticket
// worktree autopilot creates from it.
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exec, must } from "../exec.js";
import { changedFiles, gate } from "../gate.js";
import type { RepoConfig } from "../types.js";
import { ensureWorktree, lock, prepareWorktree, worktreePath } from "../worktree.js";

function fixture(autopilot: Partial<RepoConfig["autopilot"]> = {}): RepoConfig {
  const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "autopilot-git-")));
  const origin = path.join(tmp, "origin.git");
  const repo = path.join(tmp, "repo");
  must("git", ["init", "-q", "--bare", "-b", "main", origin]);
  must("git", ["clone", "-q", origin, repo]);
  must("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"]);
  must("git", ["-C", repo, "push", "-q", "origin", "HEAD:main"]);
  writeFileSync(path.join(repo, ".env.local"), "X=1\n");
  return {
    repoRoot: repo,
    teamKey: "KAI",
    inReviewState: "In Review",
    autopilot: { triggerLabel: "autopilot", baseBranch: "main", verifyCmd: "true", canaryCmd: null, setup: [], copyFiles: [".env.local"], denyPaths: ["supabase/**"], allowedTools: [], linearTools: [], maxTurns: 5, commitType: "fix", ...autopilot },
  };
}

describe("worktree", () => {
  it("creates the ticket worktree from origin/main with no upstream, and reuses it", () => {
    const cfg = fixture();
    const dir = ensureWorktree(cfg, "KAI-240", "nishu/kai-240-x");
    expect(dir).toBe(worktreePath(cfg.repoRoot, "KAI-240"));
    expect(exec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "@{u}"]).status).not.toBe(0);
    expect(ensureWorktree(cfg, "KAI-240", "nishu/kai-240-x")).toBe(dir);
  });

  it("copies configured env files and reports a failing setup command", () => {
    const cfg = fixture({ setup: ["false"] });
    const dir = ensureWorktree(cfg, "KAI-1", "nishu/kai-1-x");
    const r = prepareWorktree(cfg, dir);
    expect(r.ok).toBe(false);
    expect(changedFiles(dir)).toContain(".env.local");
  });

  it("holds one writer per ticket", () => {
    const state = mkdtempSync(path.join(os.tmpdir(), "autopilot-lock-"));
    const release = lock(state, "KAI-9");
    expect(() => lock(state, "KAI-9")).toThrow(/already running/);
    release();
    lock(state, "KAI-9")();
  });
});

describe("gate", () => {
  it("fails with no changes, on a denied path, and on a red verify; passes when green", () => {
    const cfg = fixture({ copyFiles: [] });
    const dir = ensureWorktree(cfg, "KAI-2", "nishu/kai-2-x");
    expect(gate(cfg, dir)).toMatchObject({ ok: false, failures: "The agent changed no files." });

    writeFileSync(path.join(dir, "a.ts"), "x\n");
    expect(gate(cfg, dir).ok).toBe(true);
    expect(gate({ ...cfg, autopilot: { ...cfg.autopilot, verifyCmd: "echo broke; exit 1" } }, dir)).toMatchObject({ ok: false, failures: expect.stringContaining("broke") });

    must("mkdir", ["-p", path.join(dir, "supabase")]);
    writeFileSync(path.join(dir, "supabase/m.sql"), "x\n");
    expect(gate(cfg, dir)).toMatchObject({ ok: false, deniedFiles: ["supabase/m.sql"] });
  });
});
