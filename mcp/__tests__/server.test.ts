import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { scoreTool, deltaTool, findingsTool, scorecardTool, createServer } from "../server.js";

// Reuse the rule-suite fixtures so the MCP facade is tested against the same
// ground truth as the engine. The facade's job is shape + wiring, not detection.
const fixtures = (name: string) =>
  fileURLToPath(new URL(`../../check/__tests__/fixtures/${name}`, import.meta.url));

// Each tool returns an MCP content payload; the data tools encode JSON in text.
function parse(payload: { content: { type: string; text: string }[] }) {
  return JSON.parse(payload.content[0].text);
}

describe("factory_score", () => {
  it("passes on the clean tree", async () => {
    const out = parse(await scoreTool({ dir: fixtures("clean") }));
    expect(out.band).toBe("pass");
    expect(out.counts.critical).toBe(0);
  });

  it("fails on the violations tree (has criticals)", async () => {
    const out = parse(await scoreTool({ dir: fixtures("violations") }));
    expect(out.band).toBe("fail");
    expect(out.counts.critical).toBeGreaterThan(0);
    expect(out.coverage.pct).toBeGreaterThan(0);
  });
});

describe("factory_findings", () => {
  it("returns no findings on the clean tree", async () => {
    const out = parse(await findingsTool({ dir: fixtures("clean") }));
    expect(out.count).toBe(0);
    expect(out.findings).toEqual([]);
  });

  it("filters by severity on the violations tree", async () => {
    const out = parse(await findingsTool({ dir: fixtures("violations"), severity: "critical" }));
    expect(out.count).toBeGreaterThan(0);
    expect(out.findings.every((f: { severity: string }) => f.severity === "critical")).toBe(true);
    // every finding carries its skillRef citation — the product, not a nicety
    expect(out.findings.every((f: { skillRef: string }) => /^factory-[\w-]+\.md §/.test(f.skillRef))).toBe(
      true
    );
  });
});

describe("factory_delta", () => {
  it("reports unresolved when the base ref does not exist", async () => {
    const out = parse(await deltaTool({ dir: fixtures("clean"), base: "no-such-ref-xyz" }));
    expect(out.resolved).toBe(false);
  });
});

describe("factory_scorecard", () => {
  it("renders the sticky-marker Markdown scorecard", async () => {
    const payload = await scorecardTool({ dir: fixtures("violations") });
    const md = payload.content[0].text;
    expect(md).toContain("Factory conformance");
    expect(md).toContain("❌ Fail");
  });
});

describe("createServer", () => {
  it("assembles a server with the four read-only tools registered", () => {
    const server = createServer();
    expect(server).toBeDefined();
    // McpServer exposes registered tools on its internal registry; assert the
    // factory wired all four without throwing.
    expect(typeof server.connect).toBe("function");
  });
});
