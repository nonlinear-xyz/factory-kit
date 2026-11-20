import { exec, shell, tail } from "./exec.js";
import type { GateResult, RepoConfig } from "./types.js";

/** Minimal glob: `**` spans directories, `*` stays within one, `?` is one char. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      re += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function deniedFiles(files: string[], denyPaths: string[]): string[] {
  const patterns = denyPaths.map(globToRegExp);
  return files.filter((f) => patterns.some((p) => p.test(f)));
}

/** Tracked changes and untracked files, relative to the worktree root. */
export function changedFiles(dir: string): string[] {
  const out = exec("git", ["-C", dir, "status", "--porcelain", "-uall"]).stdout;
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim().replace(/^.* -> /, ""));
}

/** Runs before any agent: a broken hook fails open, so prove the gates work first. */
export function canary(cfg: RepoConfig, dir: string): { ok: boolean; output: string } {
  if (!cfg.autopilot.canaryCmd) return { ok: true, output: "" };
  const r = shell(cfg.autopilot.canaryCmd, { cwd: dir, timeoutMs: 10 * 60_000 });
  return { ok: r.status === 0, output: tail(`${r.stdout}\n${r.stderr}`) };
}

/** The only pass/fail. An agent saying "done" counts for nothing until this is green. */
export function gate(cfg: RepoConfig, dir: string): GateResult {
  const files = changedFiles(dir);
  const denied = deniedFiles(files, cfg.autopilot.denyPaths);
  if (!files.length) return { ok: false, changedFiles: files, deniedFiles: denied, failures: "The agent changed no files." };
  if (denied.length) return { ok: false, changedFiles: files, deniedFiles: denied, failures: `Touched paths autopilot may not change:\n${denied.join("\n")}` };
  const r = shell(cfg.autopilot.verifyCmd, { cwd: dir, timeoutMs: 30 * 60_000 });
  return { ok: r.status === 0, changedFiles: files, deniedFiles: denied, failures: r.status === 0 ? "" : tail(`${r.stdout}\n${r.stderr}`) };
}
