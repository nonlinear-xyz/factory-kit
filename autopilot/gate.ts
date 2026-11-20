import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { exec, shell, tail } from "./exec.js";
import type { GateResult, RepoConfig } from "./types.js";

/**
 * Minimal glob: `**` spans directories, `*` stays within one, `?` is one char.
 * Case-insensitive, because macOS filesystems usually are: `.GitHub/x` must not
 * slip past `.github/**`.
 */
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
  return new RegExp(`^${re}$`, "i");
}

export function deniedFiles(files: string[], denyPaths: string[]): string[] {
  const patterns = denyPaths.map(globToRegExp);
  return files.filter((f) => patterns.some((p) => p.test(f)));
}

/**
 * Every path the change touches, relative to the worktree root: tracked edits,
 * untracked files, and BOTH sides of a rename or copy (moving a file out of a
 * denied directory deletes it there). Parsed from NUL-delimited porcelain, so
 * paths with spaces or quotes arrive unquoted.
 */
export function parsePorcelainZ(out: string): string[] {
  const fields = out.split("\0");
  const files: string[] = [];
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i]!;
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    files.push(rec.slice(3));
    if (/[RC]/.test(xy)) {
      const source = fields[++i];
      if (source) files.push(source);
    }
  }
  return [...new Set(files)];
}

export function changedFiles(dir: string): string[] {
  const r = exec("git", ["-C", dir, "status", "--porcelain=v1", "-z", "-uall"]);
  if (r.status !== 0) throw new Error(`git status failed in ${dir}: ${r.stderr.trim()}`);
  return parsePorcelainZ(r.stdout);
}

export function head(dir: string): string {
  return exec("git", ["-C", dir, "rev-parse", "HEAD"]).stdout.trim();
}

/** Agent and tool settings the agent must never change, including gitignored ones (settings.local.json). */
const SETTINGS_PATHS = [".claude", ".codex", ".mcp.json"];

/** Hash of every file under the settings paths, ignored or not. Compared before and after each agent turn. */
export function settingsFingerprint(dir: string): string {
  const h = createHash("sha256");
  const walk = (rel: string) => {
    const abs = path.join(dir, rel);
    if (!existsSync(abs)) return;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) walk(path.join(rel, name));
    } else {
      h.update(rel).update("\0").update(readFileSync(abs)).update("\0");
    }
  };
  for (const p of SETTINGS_PATHS) walk(p);
  return h.digest("hex");
}

/** Runs before any agent: a broken hook fails open, so prove the gates work first. */
export function canary(cfg: RepoConfig, dir: string, env: NodeJS.ProcessEnv): { ok: boolean; output: string } {
  if (!cfg.autopilot.canaryCmd) return { ok: true, output: "" };
  const r = shell(cfg.autopilot.canaryCmd, { cwd: dir, env, timeoutMs: 10 * 60_000 });
  return { ok: r.status === 0, output: tail(`${r.stdout}\n${r.stderr}`) };
}

export interface Baseline {
  head: string;
  settings: string;
}

/**
 * The only pass/fail. An agent saying "done" counts for nothing until this is green.
 * Judged against the baseline taken before the agent ran: the agent may not
 * commit (HEAD must not move) or touch its own settings, and every changed path
 * is checked against denyPaths before AND after verify (verify can write files).
 */
export function gate(cfg: RepoConfig, dir: string, baseline: Baseline, env: NodeJS.ProcessEnv): GateResult {
  const fail = (failures: string, files: string[] = [], denied: string[] = []): GateResult => ({ ok: false, changedFiles: files, deniedFiles: denied, failures });
  if (head(dir) !== baseline.head) return fail("The agent created commits. Only the runner commits; nothing was published.");
  if (settingsFingerprint(dir) !== baseline.settings) return fail("Agent or tool settings (.claude, .codex, .mcp.json) changed during the run. Nothing was published.");
  const files = changedFiles(dir);
  if (!files.length) return fail("The agent changed no files.");
  const denied = deniedFiles(files, cfg.autopilot.denyPaths);
  if (denied.length) return fail(`Touched paths autopilot may not change:\n${denied.join("\n")}`, files, denied);
  const r = shell(cfg.autopilot.verifyCmd, { cwd: dir, env, timeoutMs: 30 * 60_000 });
  if (r.status !== 0) return fail(tail(`${r.stdout}\n${r.stderr}`), files);
  if (head(dir) !== baseline.head) return fail("Verify created commits. Nothing was published.", files);
  const after = changedFiles(dir);
  if (!after.length) return fail("No changes left after verify.");
  const deniedAfter = deniedFiles(after, cfg.autopilot.denyPaths);
  if (deniedAfter.length) return fail(`The verify command wrote to paths autopilot may not change:\n${deniedAfter.join("\n")}`, after, deniedAfter);
  return { ok: true, changedFiles: after, deniedFiles: [], failures: "" };
}
