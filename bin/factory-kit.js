#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LINEAR_URL = "https://mcp.linear.app/mcp";
const GUIDANCE_BEGIN = "<!-- BEGIN FACTORY KIT MANAGED GUIDANCE -->";
const GUIDANCE_END = "<!-- END FACTORY KIT MANAGED GUIDANCE -->";
const CODEX_MCP_BEGIN = "# >>> factory-kit linear mcp >>>";
const CODEX_MCP_END = "# <<< factory-kit linear mcp <<<";

const HOSTS = {
  claude: {
    root(home) {
      return path.join(home, ".claude");
    },
    guidance(home) {
      return path.join(home, ".claude", "CLAUDE.md");
    },
  },
  codex: {
    root(home) {
      return path.join(home, ".codex");
    },
    guidance(home) {
      return path.join(home, ".codex", "AGENTS.md");
    },
  },
};

function readVersion() {
  try {
    return fs.readFileSync(path.join(KIT_ROOT, "VERSION"), "utf8").trim();
  } catch {
    return JSON.parse(fs.readFileSync(path.join(KIT_ROOT, "package.json"), "utf8")).version ?? "unknown";
  }
}

function readCommit() {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: KIT_ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
  } catch {
    return "no-git";
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function lstat(file) {
  try {
    return fs.lstatSync(file);
  } catch {
    return null;
  }
}

function symlinkTarget(link) {
  const target = fs.readlinkSync(link);
  return path.resolve(path.dirname(link), target);
}

function pathBelongsToFactoryKit(candidate) {
  const absolute = path.resolve(candidate);
  if (absolute === KIT_ROOT || absolute.startsWith(`${KIT_ROOT}${path.sep}`)) return true;
  if (absolute.includes(`${path.sep}node_modules${path.sep}@nonlinear-labs${path.sep}factory-kit${path.sep}`)) return true;

  let cursor = lstat(absolute)?.isDirectory() ? absolute : path.dirname(absolute);
  for (let i = 0; i < 10; i += 1) {
    const manifest = path.join(cursor, "package.json");
    try {
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (pkg.name === "@nonlinear-labs/factory-kit") return true;
    } catch {
      // Keep walking. Old skill links may be dangling after a layout migration.
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return false;
}

function isFactoryKitLink(file) {
  const stat = lstat(file);
  return Boolean(stat?.isSymbolicLink() && pathBelongsToFactoryKit(symlinkTarget(file)));
}

function linkOne(src, dst, label, counters) {
  const stat = lstat(dst);
  if (stat?.isSymbolicLink()) {
    const current = symlinkTarget(dst);
    if (current === src) {
      console.log(`  ok      ${label}`);
      counters.ok += 1;
      return true;
    }
    if (!pathBelongsToFactoryKit(current)) {
      console.warn(`  conflict ${label} (unrelated symlink preserved)`);
      counters.conflict += 1;
      return false;
    }
    fs.unlinkSync(dst);
    fs.symlinkSync(src, dst, lstat(src)?.isDirectory() ? "dir" : "file");
    console.log(`  relink  ${label}`);
    counters.relink += 1;
    return true;
  }
  if (stat) {
    console.warn(`  conflict ${label} (user-owned path preserved)`);
    counters.conflict += 1;
    return false;
  }
  fs.symlinkSync(src, dst, lstat(src)?.isDirectory() ? "dir" : "file");
  console.log(`  link    ${label}`);
  counters.link += 1;
  return true;
}

function skillNames() {
  return fs.readdirSync(path.join(KIT_ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(KIT_ROOT, "skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function migrateFlatSkillLinks(hostRoot, names, counters) {
  for (const name of names) {
    const legacy = path.join(hostRoot, "skills", `${name}.md`);
    if (!isFactoryKitLink(legacy)) continue;
    fs.unlinkSync(legacy);
    console.log(`  migrate skills/${name}.md (removed stale Factory Kit link)`);
    counters.migrate += 1;
  }
}

function installSkills(host, home, counters) {
  const hostRoot = HOSTS[host].root(home);
  const dstSkills = path.join(hostRoot, "skills");
  ensureDir(dstSkills);
  const names = skillNames();
  console.log(`[${host}:skills]`);
  for (const name of names) {
    linkOne(
      path.join(KIT_ROOT, "skills", name),
      path.join(dstSkills, name),
      `skills/${name}`,
      counters,
    );
  }
  migrateFlatSkillLinks(hostRoot, names, counters);
}

function installClaudeAdapters(home, counters) {
  const root = HOSTS.claude.root(home);
  for (const subdir of ["agents", "commands"]) {
    const srcDir = path.join(KIT_ROOT, subdir);
    const dstDir = path.join(root, subdir);
    ensureDir(dstDir);
    console.log(`[claude:${subdir}]`);
    for (const name of fs.readdirSync(srcDir).filter((entry) => entry.endsWith(".md")).sort()) {
      linkOne(path.join(srcDir, name), path.join(dstDir, name), `${subdir}/${name}`, counters);
    }
  }
}

function removeLegacyGuidanceLink(home) {
  const legacy = path.join(home, ".claude", "CLAUDE.md");
  if (!isFactoryKitLink(legacy)) return;
  fs.unlinkSync(legacy);
  console.log("[claude:guidance]");
  console.log("  migrate CLAUDE.md (removed legacy always-on Factory Kit symlink)");
}

function configureClaudeLinear(home, counters) {
  const configPath = path.join(home, ".claude.json");
  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
      console.warn(`  conflict ${configPath} is not valid JSON; Linear config was not changed`);
      counters.conflict += 1;
      return;
    }
  }
  config.mcpServers ??= {};
  const existing = config.mcpServers.linear;
  if (existing) {
    if (existing.type === "http" && existing.url === LINEAR_URL) {
      console.log("  ok      Linear MCP");
      return;
    }
    console.warn("  conflict Linear MCP already exists in Claude config; preserved");
    counters.conflict += 1;
    return;
  }
  config.mcpServers.linear = { type: "http", url: LINEAR_URL };
  ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log("  add     Linear MCP (Claude will request authorization)");
}

function configureCodexLinear(home, counters) {
  const configPath = path.join(home, ".codex", "config.toml");
  ensureDir(path.dirname(configPath));
  const current = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf8") : "";
  const block = [
    CODEX_MCP_BEGIN,
    "[mcp_servers.linear]",
    `url = "${LINEAR_URL}"`,
    `oauth_resource = "${LINEAR_URL}"`,
    CODEX_MCP_END,
  ].join("\n");

  const begin = current.indexOf(CODEX_MCP_BEGIN);
  const end = current.indexOf(CODEX_MCP_END);
  if (begin !== -1 && end > begin) {
    const next = current.slice(0, begin) + block + current.slice(end + CODEX_MCP_END.length);
    fs.writeFileSync(configPath, next);
    console.log("  ok      Linear MCP");
    return;
  }
  if (/^\s*\[mcp_servers\.linear\]\s*$/m.test(current)) {
    console.warn("  conflict Linear MCP already exists in Codex config; preserved");
    counters.conflict += 1;
    return;
  }
  fs.writeFileSync(configPath, `${current}${current ? "\n\n" : ""}${block}\n`);
  console.log("  add     Linear MCP (Codex will request authorization)");
}

function configureLinear(host, home, counters) {
  console.log(`[${host}:linear]`);
  if (host === "claude") configureClaudeLinear(home, counters);
  else configureCodexLinear(home, counters);
}

function guidanceBody(host) {
  const shared = fs.readFileSync(path.join(KIT_ROOT, "guidance", "shared.md"), "utf8").trim();
  const adapter = fs.readFileSync(path.join(KIT_ROOT, "guidance", `${host}.md`), "utf8").trim();
  return `${GUIDANCE_BEGIN}\n\n${shared}\n\n${adapter}\n\n${GUIDANCE_END}`;
}

function findGuidanceBlock(content) {
  const begin = content.indexOf(GUIDANCE_BEGIN);
  const end = content.indexOf(GUIDANCE_END, begin + GUIDANCE_BEGIN.length);
  if (begin === -1 || end === -1) return null;
  return { begin, end: end + GUIDANCE_END.length };
}

function addGuidance(host, home, counters) {
  const file = HOSTS[host].guidance(home);
  const stat = lstat(file);
  if (stat?.isSymbolicLink()) {
    if (!isFactoryKitLink(file)) {
      console.warn(`  conflict ${file} is an unrelated symlink; preserved`);
      counters.conflict += 1;
      return;
    }
    fs.unlinkSync(file);
  } else if (stat && !stat.isFile()) {
    console.warn(`  conflict ${file} is not a regular file; preserved`);
    counters.conflict += 1;
    return;
  }

  ensureDir(path.dirname(file));
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const found = findGuidanceBlock(current);
  const block = guidanceBody(host);
  if (found) {
    fs.writeFileSync(file, current.slice(0, found.begin) + block + current.slice(found.end));
    console.log(`  update  ${path.relative(home, file)}`);
    counters.update += 1;
  } else {
    fs.writeFileSync(file, `${current}\n\n${block}\n`);
    console.log(`  add     ${path.relative(home, file)}`);
    counters.link += 1;
  }
}

function removeGuidance(host, home, counters) {
  const file = HOSTS[host].guidance(home);
  const stat = lstat(file);
  if (!stat) {
    console.log(`  ok      ${path.relative(home, file)} (no managed block)`);
    return;
  }
  if (stat.isSymbolicLink()) {
    console.warn(`  conflict ${file} is a symlink; preserved`);
    counters.conflict += 1;
    return;
  }
  const current = fs.readFileSync(file, "utf8");
  const found = findGuidanceBlock(current);
  if (!found) {
    console.log(`  ok      ${path.relative(home, file)} (no managed block)`);
    return;
  }
  let start = found.begin;
  if (current.slice(start - 2, start) === "\n\n") start -= 2;
  let end = found.end;
  if (current[end] === "\n") end += 1;
  fs.writeFileSync(file, current.slice(0, start) + current.slice(end));
  console.log(`  remove  ${path.relative(home, file)}`);
  counters.remove += 1;
}

function detectHost() {
  const forced = process.env.FACTORY_KIT_HOST;
  if (forced === "claude" || forced === "codex") return forced;
  const claude = ["CLAUDECODE", "CLAUDE_CODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_SESSION_ID"]
    .some((name) => Boolean(process.env[name]));
  const codex = ["CODEX_THREAD_ID", "CODEX_HOME", "CODEX_AGENT", "CODEX_CI"]
    .some((name) => Boolean(process.env[name]));
  if (claude !== codex) return claude ? "claude" : "codex";
  throw new Error("Could not unambiguously detect the invoking host. Choose --target claude, --target codex, or --target all.");
}

function resolveTargets(target, { allowAuto = true } = {}) {
  if (target === "all") return ["claude", "codex"];
  if (target === "claude" || target === "codex") return [target];
  if (target === "auto" && allowAuto) return [detectHost()];
  throw new Error(`Invalid target "${target}". Choose claude, codex, all${allowAuto ? ", or auto" : ""}.`);
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function freshCounters() {
  return { ok: 0, link: 0, relink: 0, migrate: 0, update: 0, remove: 0, conflict: 0 };
}

function install(args, { legacyNoArgs = false } = {}) {
  const home = process.env.HOME || os.homedir();
  const target = legacyNoArgs ? "claude" : option(args, "--target", "auto");
  const targets = resolveTargets(target);
  const counters = freshCounters();
  console.log(`Installing factory-kit v${readVersion()} (${readCommit()}) from ${KIT_ROOT}`);
  console.log(`Targets: ${targets.join(", ")}`);

  for (const host of targets) {
    installSkills(host, home, counters);
    if (host === "claude") {
      installClaudeAdapters(home, counters);
      removeLegacyGuidanceLink(home);
    }
    if (!args.includes("--skip-linear")) configureLinear(host, home, counters);
    if (args.includes("--global-guidance")) {
      console.log(`[${host}:guidance]`);
      addGuidance(host, home, counters);
    }
  }
  console.log(`Done. ${skillNames().length} canonical skills; ${counters.conflict} conflict(s).`);
  if (!args.includes("--global-guidance")) {
    console.log("Global guidance remains disabled. Add it with factory-kit guidance add --target <target>.");
  }
  if (counters.conflict) process.exitCode = 2;
}

function runGuidance(args) {
  const action = args[0];
  if (action !== "add" && action !== "remove") throw new Error("Usage: factory-kit guidance add|remove --target claude|codex|all");
  const targets = resolveTargets(option(args, "--target", "all"));
  const home = process.env.HOME || os.homedir();
  const counters = freshCounters();
  for (const host of targets) {
    console.log(`[${host}:guidance]`);
    if (action === "add") addGuidance(host, home, counters);
    else removeGuidance(host, home, counters);
  }
  if (counters.conflict) process.exitCode = 2;
}

function walkForManifest(root, manifestName, depth = 0) {
  if (depth > 7 || !lstat(root)?.isDirectory()) return false;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isFile() && entry.name === manifestName) {
      try {
        if (JSON.parse(fs.readFileSync(file, "utf8")).name === "factory-kit") return true;
      } catch {
        // Doctor reports only valid, installed Factory Kit manifests.
      }
    }
    if (entry.isDirectory() && walkForManifest(file, manifestName, depth + 1)) return true;
  }
  return false;
}

function doctor(args) {
  const targets = resolveTargets(option(args, "--target", "all"));
  const home = process.env.HOME || os.homedir();
  const names = skillNames();
  for (const host of targets) {
    const root = HOSTS[host].root(home);
    const linked = names.filter((name) => isFactoryKitLink(path.join(root, "skills", name))).length;
    const stale = names.filter((name) => isFactoryKitLink(path.join(root, "skills", `${name}.md`))).length;
    const manifest = host === "claude" ? "plugin.json" : "plugin.json";
    const pluginRoot = path.join(root, "plugins", "cache");
    const nativePlugin = walkForManifest(pluginRoot, manifest);
    const guidance = (() => {
      const file = HOSTS[host].guidance(home);
      return lstat(file)?.isFile() && findGuidanceBlock(fs.readFileSync(file, "utf8"));
    })();
    console.log(`[${host}]`);
    console.log(`  symlink skills: ${linked}/${names.length}`);
    console.log(`  native plugin: ${nativePlugin ? "installed" : "not detected"}`);
    console.log(`  managed guidance: ${guidance ? "installed" : "disabled"}`);
    if (stale) console.warn(`  warning: ${stale} stale flat Factory Kit skill link(s)`);
    if (linked && nativePlugin) console.warn("  warning: native plugin and symlink install coexist; duplicate skills may be exposed");
  }
}

function addCi(targetArg) {
  const targetRepo = targetArg ? path.resolve(targetArg) : process.cwd();
  const src = path.join(KIT_ROOT, "templates", "factory-conformance.yml");
  const dstDir = path.join(targetRepo, ".github", "workflows");
  const dst = path.join(dstDir, "factory-conformance.yml");
  ensureDir(dstDir);
  if (fs.existsSync(dst)) {
    console.log(`  skip   ${path.relative(targetRepo, dst)} (already exists — remove it to re-add)`);
    return;
  }
  fs.copyFileSync(src, dst);
  console.log(`  add    ${path.relative(targetRepo, dst)}`);
  console.log("Next: commit the workflow and make Factory conformance a required check.");
}

function help() {
  console.log(`factory-kit

  factory-kit install --target auto|claude|codex|all [--global-guidance] [--skip-linear]
  factory-kit guidance add|remove --target claude|codex|all
  factory-kit doctor --target claude|codex|all
  factory-kit add-ci [target-repo]

Running factory-kit without arguments keeps the legacy Claude-only bootstrap target.
`);
}

function main(argv = process.argv.slice(2)) {
  if (argv.length === 0) return install([], { legacyNoArgs: true });
  const [command, ...args] = argv;
  if (command === "install") return install(args);
  if (command === "guidance") return runGuidance(args);
  if (command === "doctor") return doctor(args);
  if (command === "add-ci") return addCi(args[0]);
  if (command === "--help" || command === "-h" || command === "help") return help();
  if (command.startsWith("--")) return install(argv);
  throw new Error(`Unknown command "${command}". Run factory-kit --help.`);
}

try {
  main();
} catch (error) {
  console.error(`factory-kit failed: ${error.message ?? error}`);
  process.exitCode = 1;
}
