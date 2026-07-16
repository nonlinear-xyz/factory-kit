import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const CLI = path.join(ROOT, "bin", "factory-kit.js");
const homes: string[] = [];

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-kit-test-"));
  homes.push(dir);
  return dir;
}

function cleanEnv(targetHome: string, extra: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra, HOME: targetHome };
  for (const name of [
    "CLAUDECODE",
    "CLAUDE_CODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_SESSION_ID",
    "CODEX_THREAD_ID",
    "CODEX_HOME",
    "CODEX_AGENT",
    "CODEX_CI",
    "FACTORY_KIT_HOST",
  ]) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

function run(targetHome: string, args: string[], extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: cleanEnv(targetHome, extra),
  });
}

function output(result: ReturnType<typeof run>) {
  return `${result.stdout}${result.stderr}`;
}

function skillCount() {
  return fs.readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, "skills", entry.name, "SKILL.md")))
    .length;
}

afterEach(() => {
  for (const dir of homes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("factory-kit installer", () => {
  it("keeps the no-argument bootstrap Claude-only", () => {
    const targetHome = home();
    const result = run(targetHome, [], { FACTORY_KIT_HOST: "codex" });

    expect(result.status, output(result)).toBe(0);
    expect(fs.realpathSync(path.join(targetHome, ".claude", "skills", "factory-voice")))
      .toBe(path.join(ROOT, "skills", "factory-voice"));
    expect(fs.existsSync(path.join(targetHome, ".claude", "agents", "feature-architect.md"))).toBe(true);
    expect(fs.existsSync(path.join(targetHome, ".codex", "skills", "factory-voice"))).toBe(false);
    expect(fs.existsSync(path.join(targetHome, ".claude", "CLAUDE.md"))).toBe(false);
  });

  it("installs canonical skills plus Claude compatibility adapters", () => {
    const targetHome = home();
    const result = run(targetHome, ["install", "--target", "claude", "--skip-linear"]);

    expect(result.status, output(result)).toBe(0);
    expect(fs.readdirSync(path.join(targetHome, ".claude", "skills"))).toHaveLength(skillCount());
    expect(fs.realpathSync(path.join(targetHome, ".claude", "skills", "factory-entry")))
      .toBe(path.join(ROOT, "skills", "factory-entry"));
    expect(fs.realpathSync(path.join(targetHome, ".claude", "commands", "entry.md")))
      .toBe(path.join(ROOT, "commands", "entry.md"));
    expect(fs.realpathSync(path.join(targetHome, ".claude", "agents", "feature-architect.md")))
      .toBe(path.join(ROOT, "agents", "feature-architect.md"));
  });

  it("installs only canonical skills for Codex", () => {
    const targetHome = home();
    const result = run(targetHome, ["install", "--target", "codex", "--skip-linear"]);

    expect(result.status, output(result)).toBe(0);
    expect(fs.readdirSync(path.join(targetHome, ".codex", "skills"))).toHaveLength(skillCount());
    expect(fs.existsSync(path.join(targetHome, ".codex", "agents"))).toBe(false);
    expect(fs.existsSync(path.join(targetHome, ".codex", "commands"))).toBe(false);
  });

  it("installs both targets and is idempotent", () => {
    const targetHome = home();
    const first = run(targetHome, ["install", "--target", "all", "--skip-linear"]);
    const second = run(targetHome, ["install", "--target", "all", "--skip-linear"]);

    expect(first.status, output(first)).toBe(0);
    expect(second.status, output(second)).toBe(0);
    expect(output(second)).toContain("ok      skills/factory-voice");
    expect(fs.readdirSync(path.join(targetHome, ".claude", "skills"))).toHaveLength(skillCount());
    expect(fs.readdirSync(path.join(targetHome, ".codex", "skills"))).toHaveLength(skillCount());
  });

  it("detects one invoking host and rejects missing or ambiguous signals", () => {
    const claudeHome = home();
    const claude = run(claudeHome, ["install", "--target", "auto", "--skip-linear"], { CLAUDE_CODE: "1" });
    expect(claude.status, output(claude)).toBe(0);
    expect(output(claude)).toContain("Targets: claude");

    const codexHome = home();
    const codex = run(codexHome, ["install", "--target", "auto", "--skip-linear"], { CODEX_THREAD_ID: "test" });
    expect(codex.status, output(codex)).toBe(0);
    expect(output(codex)).toContain("Targets: codex");

    const missing = run(home(), ["install", "--target", "auto", "--skip-linear"]);
    expect(missing.status).toBe(1);
    expect(output(missing)).toContain("Could not unambiguously detect");

    const ambiguous = run(home(), ["install", "--target", "auto", "--skip-linear"], {
      CLAUDE_CODE: "1",
      CODEX_THREAD_ID: "test",
    });
    expect(ambiguous.status).toBe(1);
    expect(output(ambiguous)).toContain("--target all");
  });

  it("bundles Linear config by default and honors --skip-linear", () => {
    const targetHome = home();
    const installed = run(targetHome, ["install", "--target", "all"]);
    expect(installed.status, output(installed)).toBe(0);

    const claude = JSON.parse(fs.readFileSync(path.join(targetHome, ".claude.json"), "utf8"));
    expect(claude.mcpServers.linear).toEqual({ type: "http", url: "https://mcp.linear.app/mcp" });
    const codex = fs.readFileSync(path.join(targetHome, ".codex", "config.toml"), "utf8");
    expect(codex).toContain("[mcp_servers.linear]");
    expect(codex).toContain('oauth_resource = "https://mcp.linear.app/mcp"');

    const skippedHome = home();
    const skipped = run(skippedHome, ["install", "--target", "all", "--skip-linear"]);
    expect(skipped.status, output(skipped)).toBe(0);
    expect(fs.existsSync(path.join(skippedHome, ".claude.json"))).toBe(false);
    expect(fs.existsSync(path.join(skippedHome, ".codex", "config.toml"))).toBe(false);
  });

  it("migrates only stale flat Factory Kit links", () => {
    const targetHome = home();
    const skills = path.join(targetHome, ".claude", "skills");
    fs.mkdirSync(skills, { recursive: true });
    fs.symlinkSync(path.join(ROOT, "skills", "factory-voice", "SKILL.md"), path.join(skills, "factory-voice.md"));
    const userTarget = path.join(targetHome, "my-skill.md");
    fs.writeFileSync(userTarget, "mine");
    fs.symlinkSync(userTarget, path.join(skills, "factory-api.md"));

    const result = run(targetHome, ["install", "--target", "claude", "--skip-linear"]);

    expect(result.status, output(result)).toBe(0);
    expect(fs.existsSync(path.join(skills, "factory-voice.md"))).toBe(false);
    expect(fs.readlinkSync(path.join(skills, "factory-api.md"))).toBe(userTarget);
    expect(output(result)).toContain("removed stale Factory Kit link");
  });

  it("preserves user-owned conflicts", () => {
    const targetHome = home();
    const skill = path.join(targetHome, ".codex", "skills", "factory-voice");
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, "KEEP"), "user-owned");

    const result = run(targetHome, ["install", "--target", "codex", "--skip-linear"]);

    expect(result.status).toBe(2);
    expect(fs.readFileSync(path.join(skill, "KEEP"), "utf8")).toBe("user-owned");
    expect(output(result)).toContain("user-owned path preserved");
  });

  it("adds, updates, and removes guidance without changing surrounding content", () => {
    const targetHome = home();
    const file = path.join(targetHome, ".codex", "AGENTS.md");
    const original = "before\n<!-- user content -->\nafter";
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, original);

    const added = run(targetHome, ["guidance", "add", "--target", "codex"]);
    expect(added.status, output(added)).toBe(0);
    const withBlock = fs.readFileSync(file, "utf8");
    expect(withBlock).toContain("BEGIN FACTORY KIT MANAGED GUIDANCE");
    expect(withBlock).toContain("### Codex adapter");

    fs.writeFileSync(file, withBlock.replace("Operate as a senior software architect.", "STALE"));
    const updated = run(targetHome, ["guidance", "add", "--target", "codex"]);
    expect(updated.status, output(updated)).toBe(0);
    expect(fs.readFileSync(file, "utf8")).not.toContain("STALE");

    const removed = run(targetHome, ["guidance", "remove", "--target", "codex"]);
    expect(removed.status, output(removed)).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("warns when native and symlink installations coexist", () => {
    const targetHome = home();
    const installed = run(targetHome, ["install", "--target", "codex", "--skip-linear"]);
    expect(installed.status, output(installed)).toBe(0);
    const manifest = path.join(
      targetHome,
      ".codex",
      "plugins",
      "cache",
      "factory-kit",
      "factory-kit",
      "0.4.0",
      ".codex-plugin",
      "plugin.json",
    );
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify({ name: "factory-kit" }));

    const result = run(targetHome, ["doctor", "--target", "codex"]);

    expect(result.status, output(result)).toBe(0);
    expect(output(result)).toContain("native plugin and symlink install coexist");
  });
});
