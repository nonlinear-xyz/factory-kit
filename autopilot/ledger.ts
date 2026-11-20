import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redact } from "./redact.js";
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

function privateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** Append-only run ledger (owner-only, redacted): the data for comparing agents and finding where tickets bounce. */
export function record(stateDir: string, r: RunRecord): void {
  privateDir(stateDir);
  const file = path.join(stateDir, "runs.jsonl");
  appendFileSync(file, `${redact(JSON.stringify(r))}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

/** Full, redacted output of a failed step, kept locally (owner-only). Linear only gets a short excerpt. */
export function writeLog(stateDir: string, ticket: string, body: string): string {
  const dir = path.join(stateDir, "logs");
  privateDir(dir);
  const file = path.join(dir, `${ticket}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  writeFileSync(file, redact(body), { mode: 0o600 });
  return file;
}
