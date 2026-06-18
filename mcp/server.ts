import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyze, renderScorecard, type Analysis, type Severity } from "../check/engine.js";

// The local control plane: a read-only MCP facade over the conformance engine.
// Ships with the kit (free wedge) so the agent can see a repo's band WHILE it
// builds, without leaving Claude. "Server observes, git owns" — no tool here
// writes to the target tree. The same tool shapes are served, with org state,
// by the remote observatory endpoint; the agent can't tell the difference.

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

// Resolve a caller-supplied dir against cwd; default to cwd. Kept tiny and pure
// so every tool shares one notion of "which repo".
function resolveDir(dir?: string): string {
  return dir ? path.resolve(dir) : process.cwd();
}

function asText(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

// --- Tool handlers (exported for tests; each returns an MCP content payload) ---

export async function scoreTool(args: { dir?: string }) {
  const { score } = await analyze({ targetDir: resolveDir(args.dir) });
  return asText({
    band: score.band,
    counts: score.counts,
    total: score.total,
    coverage: score.coverage,
  });
}

export async function deltaTool(args: { dir?: string; base: string }) {
  const { delta, blocking } = await analyze({ targetDir: resolveDir(args.dir), base: args.base });
  if (!delta) {
    return asText({
      base: args.base,
      resolved: false,
      message: `base ref "${args.base}" not found in this repo; no delta computed`,
    });
  }
  return asText({
    base: args.base,
    resolved: true,
    blocking,
    newCritical: delta.newCritical,
    newHigh: delta.newHigh,
    added: delta.added,
    fixed: delta.fixed,
  });
}

export async function findingsTool(args: { dir?: string; severity?: Severity }) {
  const { findings } = await analyze({ targetDir: resolveDir(args.dir) });
  const filtered = args.severity ? findings.filter((f) => f.severity === args.severity) : findings;
  return asText({
    count: filtered.length,
    findings: filtered.map((f) => ({
      severity: f.severity,
      ruleId: f.ruleId,
      location: f.line ? `${f.file}:${f.line}` : f.file,
      message: f.message,
      skillRef: f.skillRef,
    })),
  });
}

export async function scorecardTool(args: { dir?: string; base?: string }) {
  const { score, delta }: Analysis = await analyze({
    targetDir: resolveDir(args.dir),
    base: args.base,
  });
  return { content: [{ type: "text" as const, text: renderScorecard(score, delta ?? undefined) }] };
}

// --- Server assembly ---

export function createServer(): McpServer {
  const server = new McpServer({ name: "factory-kit", version: "0.3.0" });

  server.registerTool(
    "factory_score",
    {
      title: "Factory conformance score",
      description:
        "Read-only conformance band (pass/warn/fail) + severity counts + coverage for a repo.",
      inputSchema: { dir: z.string().optional().describe("repo path; defaults to cwd") },
    },
    (args) => scoreTool(args)
  );

  server.registerTool(
    "factory_delta",
    {
      title: "Factory conformance delta",
      description:
        "New vs fixed findings between a base ref and the working tree, plus the new-critical merge gate.",
      inputSchema: {
        dir: z.string().optional().describe("repo path; defaults to cwd"),
        base: z.string().describe("git ref to diff against, e.g. origin/main"),
      },
    },
    (args) => deltaTool(args)
  );

  server.registerTool(
    "factory_findings",
    {
      title: "Factory conformance findings",
      description: "List individual conformance findings, optionally filtered by severity.",
      inputSchema: {
        dir: z.string().optional().describe("repo path; defaults to cwd"),
        severity: z.enum(SEVERITIES).optional().describe("filter to one severity"),
      },
    },
    (args) => findingsTool(args)
  );

  server.registerTool(
    "factory_scorecard",
    {
      title: "Factory conformance scorecard",
      description: "The Markdown scorecard (same artifact as the PR comment) for a repo.",
      inputSchema: {
        dir: z.string().optional().describe("repo path; defaults to cwd"),
        base: z.string().optional().describe("git ref to diff against for the delta column"),
      },
    },
    (args) => scorecardTool(args)
  );

  return server;
}
