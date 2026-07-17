// Public library surface for the conformance engine. External consumers — the
// local MCP server and the observatory SaaS — import from
// "@nonlinear-labs/factory-kit/engine" and get the VALUE-returning core, never
// the CLI's printing/exit machinery. "Server observes, git owns": this module is
// read-only analysis; nothing here writes to a target tree.

export {
  analyze,
  collectFindings,
  hasBlocking,
  hasBlockingDelta,
  type Analysis,
  type AnalysisStats,
  type AnalyzeOptions,
} from "./analyze.js";

export {
  score,
  delta,
  deltaBlocks,
  countBySeverity,
  bandFor,
  coverageFor,
  type Band,
  type Score,
  type Delta,
  type Coverage,
  type SeverityCounts,
} from "./score.js";

export { walk, type WalkResult } from "./walk.js";
export { loadConfig, type CheckConfig } from "./config.js";
export { renderScorecard, STICKY_MARKER } from "./scorecard.js";
export { rules, UNCOVERED } from "./rules/index.js";
export type {
  Rule,
  Finding,
  RepoFile,
  Severity,
  Lang,
  UncoveredPitfall,
} from "./rules/types.js";
