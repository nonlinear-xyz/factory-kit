import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { AgentName, RunOutcome } from "./types.js";

export interface RunRecord {
  ts: string;
  ticket: string;
  repo: string;
  agent: AgentName;
  outcome: RunOutcome;
  turns: number;
  estimatedCostUsd: number;
  resumed: boolean;
  elapsedSeconds: number;
}

/** Append-only run ledger: the data for comparing agents and finding where tickets bounce. */
export function record(stateDir: string, r: RunRecord): void {
  mkdirSync(stateDir, { recursive: true });
  appendFileSync(path.join(stateDir, "runs.jsonl"), `${JSON.stringify(r)}\n`);
}
