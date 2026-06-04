import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { walk } from "./walk.js";
import type { RepoFile } from "./rules/types.js";

// Git I/O for delta scoring. Kept separate from the rule engine so the engine
// stays pure (files in, findings out) and this module owns the side effects.
// Returns RepoFile[] — NOT findings — so there's no import cycle with runner.

const exec = promisify(execFile);

async function git(repoDir: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, {
    cwd: repoDir,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

export async function refExists(repoDir: string, ref: string): Promise<boolean> {
  try {
    await git(repoDir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

// Files changed between the base ref and the working tree (PR head in CI).
export async function changedFiles(repoDir: string, baseRef: string): Promise<string[]> {
  const out = await git(repoDir, ["diff", "--name-only", baseRef]);
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Materialise the repo at `ref` in a throwaway detached worktree, walk it, and
// hand back the files. Worktree lives in the OS temp dir, never inside the
// target repo — honouring "no writes to the target working tree". Always cleaned
// up, even on failure.
export async function filesAtRef(
  repoDir: string,
  ref: string,
  extraIgnores: string[] = []
): Promise<RepoFile[]> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "fkc-base-"));
  try {
    await git(repoDir, ["worktree", "add", "--detach", "--quiet", tmp, ref]);
    const { files } = await walk(tmp, extraIgnores);
    return files;
  } finally {
    try {
      await git(repoDir, ["worktree", "remove", "--force", tmp]);
    } catch {
      /* fall through to rm */
    }
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
