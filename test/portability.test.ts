import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS = path.join(ROOT, "skills");
const VERSION = "0.4.0";

function frontmatter(content: string) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n/);
  expect(match, "missing YAML frontmatter").not.toBeNull();
  return match?.[1] ?? "";
}

function field(yaml: string, name: string) {
  return yaml.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1];
}

function skillDirs() {
  return fs.readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(SKILLS, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

const commandWorkflows = ["close", "entry", "kit-audit", "prompt", "release", "setup-linear", "standup", "submit"];
const specialistWorkflows = [
  "api-route-engineer",
  "auth-wiring-specialist",
  "code-reviewer",
  "data-pipeline-engineer",
  "db-migration-engineer",
  "db-schema-architect",
  "feature-architect",
  "forms-builder",
  "frontend-engineer",
  "llm-workflow-engineer",
  "security-engineer",
  "verification-engineer",
];

describe("portable Factory Kit surface", () => {
  it("uses one valid Open Agent Skills directory per skill", () => {
    const flat = fs.readdirSync(SKILLS, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
    expect(flat).toEqual([]);

    const dirs = skillDirs();
    expect(dirs).toHaveLength(41);
    for (const name of dirs) {
      const content = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
      const yaml = frontmatter(content);
      expect(field(yaml, "name"), name).toBe(name);
      expect(field(yaml, "description"), `${name} description`).toBeTruthy();
    }
  });

  it("promotes every command and specialist workflow without host-only identifiers", () => {
    for (const workflow of [...commandWorkflows, ...specialistWorkflows]) {
      const content = fs.readFileSync(path.join(SKILLS, `factory-${workflow}`, "SKILL.md"), "utf8");
      expect(content).not.toContain("$ARGUMENTS");
      expect(content).not.toContain("AskUserQuestion");
      expect(content).not.toMatch(/mcp__linear__/);
      expect(content).not.toContain("EnterPlanMode");
      expect(content).not.toContain("ExitWorktree");
      expect(content).not.toContain("~/.claude/skills");
    }
  });

  it("keeps every logical factory-*.md citation resolvable", () => {
    const names = new Set(skillDirs());
    for (const name of skillDirs()) {
      const content = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
      for (const match of content.matchAll(/factory-[a-z0-9-]+\.md/g)) {
        if (match[0] === "factory-x.md") continue; // documented release-note placeholder
        const target = match[0].slice(0, -3);
        expect(names.has(target), `${name} references missing ${match[0]}`).toBe(true);
      }
    }
  });

  it("keeps Claude agent routing metadata and preloads canonical skills", () => {
    for (const name of specialistWorkflows) {
      const agent = fs.readFileSync(path.join(ROOT, "agents", `${name}.md`), "utf8");
      const agentYaml = frontmatter(agent);
      const skill = fs.readFileSync(path.join(SKILLS, `factory-${name}`, "SKILL.md"), "utf8");
      const skillYaml = frontmatter(skill);

      expect(field(agentYaml, "name")).toBe(name);
      expect(field(agentYaml, "description")).toBe(field(skillYaml, "description"));
      expect(field(agentYaml, "tools")).toBeTruthy();
      expect(field(agentYaml, "model")).toBe("sonnet");
      expect(agentYaml).toContain(`  - factory-${name}`);
      expect(agent.split("\n").length).toBeLessThan(16);
    }
  });

  it("keeps Claude command names as thin canonical adapters", () => {
    for (const name of commandWorkflows) {
      const command = fs.readFileSync(path.join(ROOT, "commands", `${name}.md`), "utf8");
      expect(command).toContain(`factory-${name}`);
      expect(command.split("\n").length).toBeLessThan(14);
    }
  });

  it("keeps package, plugin, marketplace, and MCP versions aligned", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const claude = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
    const codex = JSON.parse(fs.readFileSync(path.join(ROOT, ".codex-plugin", "plugin.json"), "utf8"));
    const claudeMarket = JSON.parse(fs.readFileSync(path.join(ROOT, ".claude-plugin", "marketplace.json"), "utf8"));
    const codexMarket = JSON.parse(fs.readFileSync(path.join(ROOT, ".agents", "plugins", "marketplace.json"), "utf8"));
    const mcp = JSON.parse(fs.readFileSync(path.join(ROOT, ".mcp.json"), "utf8"));

    expect(fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim()).toBe(VERSION);
    expect(pkg.version).toBe(VERSION);
    expect(claude.version).toBe(VERSION);
    expect(codex.version).toBe(VERSION);
    expect(claude.skills).toBe("./skills/");
    expect(codex.skills).toBe("./skills/");
    expect(claudeMarket.plugins[0].source).toBe("./");
    expect(codexMarket.plugins[0].source.path).toBe("./");
    expect(codexMarket.plugins[0].policy).toEqual({
      installation: "AVAILABLE",
      authentication: "ON_INSTALL",
    });
    expect(mcp.mcpServers.linear).toEqual({
      type: "http",
      url: "https://mcp.linear.app/mcp",
    });
  });
});
