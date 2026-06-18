#!/usr/bin/env node
// factory-kit-mcp — the local control plane. A read-only MCP server (stdio) that
// exposes the conformance engine to any MCP host (Claude Code, Cursor, Codex).
//
// Thin shim, mirroring bin/factory-kit-check.js: the server is built from mcp/
// via tsup into dist/server.js. We observe; we never write to the target tree.

import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  let createServer, StdioServerTransport;
  try {
    ({ createServer } = await import(path.join(KIT_ROOT, "dist", "server.js")));
    ({ StdioServerTransport } = await import(
      "@modelcontextprotocol/sdk/server/stdio.js"
    ));
  } catch (err) {
    console.error(
      "factory-kit-mcp: build artifacts or SDK missing. Run `npm run build` in the kit first."
    );
    console.error(err?.message ?? err);
    process.exit(1);
    return;
  }

  const server = createServer();
  await server.connect(new StdioServerTransport());
  // stdio transport keeps the process alive on stdin; nothing more to do.
}

main().catch((err) => {
  console.error(`factory-kit-mcp failed: ${err?.message ?? err}`);
  process.exit(1);
});
