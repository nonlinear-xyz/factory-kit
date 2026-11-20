import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exec, must, shell, tail } from "./exec.js";
import type { RepoConfig } from "./types.js";

const PROTECTED = /^(?:main|master|develop|staging|production|prod|gh-pages|release(?:\/.*)?|hotfix\/.*)$/i;

/**
 * The branch must name the ticket and must never be a protected branch. Linear
 * lets anyone edit a ticket's branch name, so this is checked, not trusted.
 */
export function assertTicketBranch(branch: string, identifier: string): void {
  const names = new RegExp(`(?<![a-z0-9])${identifier}(?![a-z0-9])`, "i");
  if (!names.test(branch) || PROTECTED.test(branch)) {
    throw new Error(`Branch "${branch}" must contain ${identifier} and must not be a protected branch.`);
  }
}

export function worktreePath(repoRoot: string, identifier: string): string {
  return path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-worktrees`, identifier.toLowerCase());
}

/**
 * Create (or reuse) the ticket worktree. New branches start from origin/<base>
 * with --no-track, so a bare `git push` can never land on the base branch.
 */
export function ensureWorktree(cfg: RepoConfig, identifier: string, branch: string): string {
  assertTicketBranch(branch, identifier);
  const repo = cfg.repoRoot;
  const target = worktreePath(repo, identifier);
  const base = cfg.autopilot.baseBranch;
  // Always refresh the base: the clean-start check and Shipped evidence compare against it.
  must("git", ["-C", repo, "fetch", "origin", base], { timeoutMs: 120_000 });
  const listed = must("git", ["-C", repo, "worktree", "list", "--porcelain"]);
  const existing = listed.split("\n\n").find((block) => block.split("\n").includes(`branch refs/heads/${branch}`));
  if (existing) {
    const at = existing.match(/^worktree (.+)$/m)?.[1];
    if (!at) throw new Error(`Could not read the existing worktree for ${branch}.`);
    if (realpathSync(at) === realpathSync(repo)) throw new Error(`${branch} is checked out in the main checkout. Autopilot only works in a ticket worktree.`);
    assertCleanStart(at, base);
    return verify(at, branch);
  }
  if (existsSync(target)) throw new Error(`${target} exists but is not the worktree for ${branch}. Inspect it first.`);
  mkdirSync(path.dirname(target), { recursive: true });
  const hasBranch = exec("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
  if (hasBranch) must("git", ["-C", repo, "worktree", "add", target, branch]);
  else must("git", ["-C", repo, "worktree", "add", "--no-track", "-b", branch, target, `origin/${base}`]);
  assertCleanStart(target, base);
  return verify(target, branch);
}

/**
 * A run starts from a known baseline: no uncommitted changes and no local
 * commits beyond origin/<base>. Otherwise someone else's edits would pass the
 * gate as the agent's work and be published with it.
 */
export function assertCleanStart(dir: string, base: string): void {
  if (exec("git", ["-C", dir, "status", "--porcelain", "-uall"]).stdout.trim()) {
    throw new Error(`${dir} has uncommitted changes from an earlier run or by hand. Inspect it, then clean it (git -C ${dir} stash -u, or remove the worktree) and run again.`);
  }
  const ahead = exec("git", ["-C", dir, "rev-list", "--count", `origin/${base}..HEAD`]).stdout.trim();
  if (ahead && ahead !== "0") throw new Error(`${dir} has ${ahead} local commit(s) not on origin/${base}. Autopilot won't publish work it didn't make.`);
}

function verify(dir: string, branch: string): string {
  const current = must("git", ["-C", dir, "branch", "--show-current"]);
  if (current !== branch) throw new Error(`Worktree ${dir} is on ${current}, expected ${branch}.`);
  const upstream = exec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "@{u}"]);
  if (upstream.status === 0 && PROTECTED.test(upstream.stdout.trim().replace(/^[^/]+\//, ""))) {
    throw new Error(`Worktree branch tracks ${upstream.stdout.trim()}. Unset it (git branch --unset-upstream) before autopilot pushes.`);
  }
  return realpathSync(dir);
}

/**
 * Copy local-only files (e.g. .env.local) from the main checkout and run the
 * repo's setup commands. A copied file must be gitignored, so it can never be
 * committed, and must not be a symlink.
 */
export function prepareWorktree(cfg: RepoConfig, dir: string, env: NodeJS.ProcessEnv): { ok: boolean; output: string } {
  for (const rel of cfg.autopilot.copyFiles) {
    const from = path.join(cfg.repoRoot, rel);
    const to = path.join(dir, rel);
    if (!existsSync(from) || existsSync(to)) continue;
    if (lstatSync(from).isSymbolicLink()) return { ok: false, output: `copyFiles: ${rel} is a symlink; refusing to copy it.` };
    if (exec("git", ["-C", dir, "check-ignore", "-q", "--", rel]).status !== 0) {
      return { ok: false, output: `copyFiles: ${rel} is not gitignored, so it could be committed. Ignore it or remove it from copyFiles.` };
    }
    copyFileSync(from, to);
  }
  for (const cmd of cfg.autopilot.setup) {
    const r = shell(cmd, { cwd: dir, env, timeoutMs: 15 * 60_000 });
    if (r.status !== 0) return { ok: false, output: `${cmd} failed:\n${tail(r.stderr || r.stdout)}` };
  }
  return { ok: true, output: "" };
}

/**
 * One writer per ticket. The lock file appears atomically with its PID already
 * in it (written to a temp file, then hard-linked into place, which fails if the
 * lock exists), so no reader ever sees an empty lock. A lock left by a dead
 * process is moved aside under a unique name before retrying; if what got moved
 * turns out to be a live holder's lock, it is put back and this run backs off.
 */
export function lock(stateDir: string, identifier: string): () => void {
  mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, `${identifier}.lock`);
  const mine = `${file}.${process.pid}.${Date.now()}`;
  writeFileSync(mine, String(process.pid));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        linkSync(mine, file);
        return () => {
          if (readPid(file) === process.pid) rmSync(file, { force: true });
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
      const holder = readPid(file);
      if (holder && isAlive(holder)) throw new Error(`${identifier} is already running (pid ${holder}).`);
      const aside = `${file}.stale.${process.pid}.${Date.now()}`;
      try {
        renameSync(file, aside);
      } catch {
        continue; // someone else moved it first; retry the link
      }
      const moved = readPid(aside);
      if (moved && moved !== holder && isAlive(moved)) {
        try { linkSync(aside, file); } catch { /* the live holder already re-created it */ }
        rmSync(aside, { force: true });
        throw new Error(`${identifier} is already running (pid ${moved}).`);
      }
      rmSync(aside, { force: true });
    }
    throw new Error(`Could not take the ${identifier} lock; another run is contending for it.`);
  } finally {
    rmSync(mine, { force: true });
  }
}

function readPid(file: string): number | null {
  try {
    const n = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
