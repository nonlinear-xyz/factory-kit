#!/usr/bin/env node
// factory-kit-check — read-only deterministic checker for the factory standard.
//
// Walks a repo, runs the rule set (each rule cites a factory-pitfalls.md entry),
// prints findings grouped by severity, exits non-zero on any critical/high.
//
// Thin shim, mirroring bin/factory-kit.js: the engine lives in dist/ (built
// from check/ via tsup). We read and judge; we never write.

import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  let run;
  try {
    ({ run } = await import(path.join(KIT_ROOT, "dist", "index.js")));
  } catch {
    console.error(
      "factory-kit-check: build artifacts missing. Run `npm run build` in the kit first."
    );
    process.exit(1);
    return;
  }

  // Parse: one optional positional (target repo, default cwd) plus flags.
  //   --base <ref>   diff against <ref>: adds the PR delta + new-critical gate
  //   --diff         scope reported findings to files changed vs --base
  //   --json         emit machine-readable score+delta
  //   --md           emit the Markdown scorecard (for the PR comment)
  const argv = process.argv.slice(2);
  let target = null;
  let base;
  let diffOnly = false;
  let format = "term";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") base = argv[++i];
    else if (a === "--diff") diffOnly = true;
    else if (a === "--json") format = "json";
    else if (a === "--md") format = "md";
    else if (!a.startsWith("--") && target === null) target = a;
  }
  const targetDir = target ? path.resolve(target) : process.cwd();
  const exitCode = await run({ targetDir, base, diffOnly, format });
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`factory-kit-check failed: ${err?.message ?? err}`);
  process.exit(1);
});
