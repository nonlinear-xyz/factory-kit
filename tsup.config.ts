import { defineConfig } from "tsup";

// Builds the factory-kit-check engine + the importable library surface + the
// local MCP server. The bin shims import the compiled output from dist/; the
// `./engine` export is what the MCP server and the observatory SaaS consume.
// Source of truth is check/ and mcp/.
export default defineConfig({
  // Object form pins output basenames at the dist root (dist/index.js,
  // dist/engine.js, dist/server.js) — otherwise tsup mirrors the check/ + mcp/
  // source tree and the bin shims / exports map would have to chase it.
  entry: { index: "check/index.ts", engine: "check/engine.ts", server: "mcp/server.ts" },
  format: ["esm"],
  outDir: "dist",
  target: "node18",
  clean: true,
  splitting: false,
  sourcemap: false,
  dts: true,
});
