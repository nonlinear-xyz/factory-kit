import { loadMachineConfig, loadRepoConfig } from "./config.js";
import { exec } from "./exec.js";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Everything a headless run needs on this machine and in this repo. Read-only. */
export function doctor(repoRoot: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add("git", exec("git", ["--version"]).status === 0, "git on PATH");
  const gh = exec("gh", ["auth", "status"]);
  add("gh", gh.status === 0, gh.status === 0 ? "logged in" : "run `gh auth login`");
  add("LINEAR_API_KEY", Boolean(process.env.LINEAR_API_KEY), process.env.LINEAR_API_KEY ? "set" : "export a Linear personal API key");

  const machine = loadMachineConfig();
  for (const a of machine.agents) {
    const v = exec(a, ["--version"]);
    add(a, v.status === 0, v.status === 0 ? v.stdout.trim().split("\n")[0] ?? "" : `${a} not on PATH`);
  }
  if (!machine.allowApiBilling && (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY)) {
    add("billing", true, "API keys are set in this shell; autopilot strips them so runs use subscriptions");
  }

  try {
    const cfg = loadRepoConfig(repoRoot);
    add("repo config", true, `verify: ${cfg.autopilot.verifyCmd}${cfg.autopilot.canaryCmd ? ` · canary: ${cfg.autopilot.canaryCmd}` : " · no canary"}`);
  } catch (e) {
    add("repo config", false, e instanceof Error ? e.message : String(e));
  }
  return checks;
}
