import { loadMachineConfig, loadRepoConfig } from "./config.js";
import { exec } from "./exec.js";
import { KEYCHAIN_SERVICE, linearToken } from "./linear.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Everything a headless run needs on this machine and in this repo. Read-only. */
export function doctor(repoRoot: string, configFile?: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add("git", exec("git", ["--version"]).status === 0, "git on PATH");
  const gh = exec("gh", ["auth", "status"]);
  add("gh", gh.status === 0, gh.status === 0 ? "logged in" : "run `gh auth login`");
  const source = process.env.LINEAR_API_KEY ? "LINEAR_API_KEY" : linearToken() ? `Keychain (${KEYCHAIN_SERVICE})` : null;
  add("linear key", Boolean(source), source ?? `security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w`);

  const machine = loadMachineConfig();
  for (const a of machine.agents) {
    const v = exec(a, ["--version"]);
    add(a, v.status === 0, v.status === 0 ? v.stdout.trim().split("\n")[0] ?? "" : `${a} not on PATH`);
  }
  if (!machine.allowApiBilling && (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)) {
    add("billing", true, "API keys are set in this shell; autopilot strips them so runs use subscriptions");
  }

  try {
    const cfg = loadRepoConfig(repoRoot, configFile);
    add("repo config", true, `verify: ${cfg.autopilot.verifyCmd}${cfg.autopilot.canaryCmd ? ` · canary: ${cfg.autopilot.canaryCmd}` : " · no canary"}`);
  } catch (e) {
    add("repo config", false, e instanceof Error ? e.message : String(e));
  }
  return checks;
}
