import { spawnSync } from "node:child_process";

export interface ExecResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
}

/** Run a command without a shell. Never throws on a non-zero exit. */
export function exec(cmd: string, args: string[], opts: ExecOptions = {}): ExecResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { status: 127, stdout: "", stderr: String(r.error.message ?? r.error) };
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Run a repo-configured command string (e.g. "bun run verify") through sh. */
export function shell(command: string, opts: ExecOptions = {}): ExecResult {
  return exec("sh", ["-c", command], opts);
}

/** Like exec, but throws with stderr on failure. For git plumbing. */
export function must(cmd: string, args: string[], opts: ExecOptions = {}): string {
  const r = exec(cmd, args, opts);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${(r.stderr || r.stdout).trim()}`);
  return r.stdout.trim();
}

/** Last n characters, for putting command output into prompts and comments. */
export function tail(text: string, n = 4000): string {
  return text.length > n ? `…${text.slice(-n)}` : text;
}
