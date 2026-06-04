import { readFile } from "node:fs/promises";
import path from "node:path";

// Optional per-repo config, read from the *target* repo. The only knob in v0 is
// disabling rules. The runner reports how many are disabled — the dogfood gate
// from the thesis: if >4 of the set get disabled, the rule design is wrong, not
// the repo.
export interface CheckConfig {
  disabledRules: Set<string>;
  // Tighten the PR delta gate to also block on a newly-introduced high (default
  // is new-critical only — the least-disruptive guardrail).
  gateOnHigh: boolean;
  // fast-glob patterns (relative to repo root) to exclude from the walk — e.g.
  // test fixtures that contain intentional violations as bait for the rule
  // suite. Path exclusion belongs to the repo, not the rule set: disabling a
  // rule blinds the whole repo, ignoring a path scopes where a rule applies.
  ignorePaths: string[];
}

const CONFIG_FILE = ".factory-check.json";

const asStringArray = (x: unknown): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string") : [];

export async function loadConfig(targetDir: string): Promise<CheckConfig> {
  try {
    const raw = await readFile(path.join(targetDir, CONFIG_FILE), "utf8");
    const parsed = JSON.parse(raw) as {
      disabledRules?: unknown;
      gateOnHigh?: unknown;
      ignorePaths?: unknown;
    };
    return {
      disabledRules: new Set(asStringArray(parsed.disabledRules)),
      gateOnHigh: parsed.gateOnHigh === true,
      ignorePaths: asStringArray(parsed.ignorePaths),
    };
  } catch {
    return { disabledRules: new Set(), gateOnHigh: false, ignorePaths: [] };
  }
}
