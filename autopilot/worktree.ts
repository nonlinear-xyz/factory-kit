import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { exec, must, shell, tail } from "./exec.js";
import type { RepoConfig } from "./types.js";

const PROTECTED = new Set(["main", "master", "develop"]);

/** The branch must name the ticket and must never be a protected branch. */
export function assertTicketBranch(branch: string, identifier: string): void {
  const names = new RegExp(`(?<![a-z0-9])${identifier}(?![a-z0-9])`, "i");
  if (!names.test(branch) || PROTECTED.has(branch)) {
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
  const listed = must("git", ["-C", repo, "worktree", "list", "--porcelain"]);
  const existing = listed.split("\n\n").find((block) => block.includes(`branch refs/heads/${branch}`));
  if (existing) {
    const at = existing.match(/^worktree (.+)$/m)?.[1];
    if (!at) throw new Error(`Could not read the existing worktree for ${branch}.`);
    return verify(at, branch);
  }
  if (existsSync(target)) throw new Error(`${target} exists but is not the worktree for ${branch}. Inspect it first.`);
  const base = cfg.autopilot.baseBranch;
  must("git", ["-C", repo, "fetch", "origin", base], { timeoutMs: 120_000 });
  mkdirSync(path.dirname(target), { recursive: true });
  const hasBranch = exec("git", ["-C", repo, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
  if (hasBranch) must("git", ["-C", repo, "worktree", "add", target, branch]);
  else must("git", ["-C", repo, "worktree", "add", "--no-track", "-b", branch, target, `origin/${base}`]);
  return verify(target, branch);
}

function verify(dir: string, branch: string): string {
  const current = must("git", ["-C", dir, "branch", "--show-current"]);
  if (current !== branch) throw new Error(`Worktree ${dir} is on ${current}, expected ${branch}.`);
  const upstream = exec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "@{u}"]);
  if (upstream.status === 0 && PROTECTED.has(upstream.stdout.trim().replace(/^[^/]+\//, ""))) {
    throw new Error(`Worktree branch tracks ${upstream.stdout.trim()}. Unset it (git branch --unset-upstream) before autopilot pushes.`);
  }
  return dir;
}

/** Copy env files from the main checkout and run the repo's setup commands. */
export function prepareWorktree(cfg: RepoConfig, dir: string): { ok: boolean; output: string } {
  for (const rel of cfg.autopilot.copyFiles) {
    const from = path.join(cfg.repoRoot, rel);
    if (existsSync(from) && !existsSync(path.join(dir, rel))) copyFileSync(from, path.join(dir, rel));
  }
  for (const cmd of cfg.autopilot.setup) {
    const r = shell(cmd, { cwd: dir, timeoutMs: 15 * 60_000 });
    if (r.status !== 0) return { ok: false, output: `${cmd} failed:\n${tail(r.stderr || r.stdout)}` };
  }
  return { ok: true, output: "" };
}

/** One writer per ticket. A lock left by a dead process is taken over. */
export function lock(stateDir: string, identifier: string): () => void {
  mkdirSync(stateDir, { recursive: true });
  const file = path.join(stateDir, `${identifier}.lock`);
  try {
    closeSync(openSync(file, "wx"));
  } catch {
    const pid = Number(readFileSync(file, "utf8").trim());
    if (pid && isAlive(pid)) throw new Error(`${identifier} is already running (pid ${pid}).`);
  }
  writeFileSync(file, String(process.pid));
  return () => rmSync(file, { force: true });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
