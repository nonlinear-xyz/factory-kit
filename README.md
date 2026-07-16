# Factory Kit

Factory Kit is a portable software-factory playbook for Claude and Codex. One canonical [Open Agent Skills](https://agentskills.io/) tree contains the knowledge, ticket workflows, and specialist workflows. Claude commands and subagents are thin compatibility adapters over that tree.

The kit separates stack-independent principles from the opinionated Factory recipe: Next.js, Drizzle, Better Auth, Mantine or shadcn, Cloud Run, Linear, and the operational failure modes learned across production builds.

## Install

Choose either the universal npm bootstrap or a native plugin marketplace. They are alternative installation methods, not prerequisites for each other.

### Universal npm bootstrap

```sh
npx @nonlinear-labs/factory-kit install --target auto
```

`auto` detects whether Claude or Codex invoked the installer. If both or neither host can be identified, the command fails with an explicit `--target claude|codex|all` choice instead of guessing.

```sh
factory-kit install --target claude
factory-kit install --target codex
factory-kit install --target all
factory-kit install --target auto --global-guidance
factory-kit install --target auto --skip-linear
```

Running `npx @nonlinear-labs/factory-kit` without arguments retains the original Claude-only bootstrap target. Global guidance is still opt-in.

The bootstrap installs directory symlinks for canonical skills. Claude also receives the existing command and subagent names. Re-running is idempotent. Factory Kit-owned legacy flat links are migrated; user-owned files and unrelated symlinks are preserved as conflicts.

From a local clone:

```sh
./install.sh
```

### Claude plugin marketplace

```sh
claude plugin marketplace add nonlinear-xyz/factory-kit
claude plugin install factory-kit@factory-kit
```

### Codex plugin marketplace

```sh
codex plugin marketplace add nonlinear-xyz/factory-kit
codex plugin add factory-kit@factory-kit
```

The repository contains both catalogs and both manifests over the same root `skills/` tree. Native installs bundle the official Linear HTTP MCP endpoint; the host requests authorization.

### Pasteable agent prompt

> Install Factory Kit with `npx @nonlinear-labs/factory-kit install --target auto`. Preserve all existing global instructions and user-owned files. Leave global guidance disabled unless I explicitly request it. If host detection is ambiguous, stop and tell me to choose Claude or Codex.

## Global guidance

Factory Kit never replaces a global instruction file. Guidance is installed only through a marked, reversible block assembled from shared content plus a host adapter.

```sh
factory-kit guidance add --target claude
factory-kit guidance add --target codex
factory-kit guidance add --target all

factory-kit guidance remove --target claude
factory-kit guidance remove --target codex
factory-kit guidance remove --target all
```

The managed block lives in `~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md`. Updates replace only that block. Removal preserves the surrounding file byte-for-byte.

## Linear workflows

Project configuration belongs at `.factory-kit/linear.json`:

```json
{
  "teamKey": "NON",
  "teamId": "<uuid>",
  "projectId": "<optional-uuid>",
  "projectName": "<optional-name>",
  "states": {
    "inReview": "In Review",
    "done": "Done"
  },
  "branchPattern": "<owner>/<team-key>-<number>-<topic>"
}
```

`.claude/linear.json` remains a read-only migration fallback. The setup-linear workflow writes the canonical path. The npm bootstrap registers Linear by default without storing credentials; `--skip-linear` leaves host MCP configuration untouched.

## Diagnostics

```sh
factory-kit doctor --target claude
factory-kit doctor --target codex
factory-kit doctor --target all
```

`doctor` reports canonical skill links, native plugin detection, managed guidance, stale flat links, and the duplicate-skill risk when native and symlink installs coexist.

## Architecture

```text
factory-kit/
├── skills/<factory-name>/SKILL.md   # canonical knowledge and workflows
├── commands/*.md                    # thin Claude slash-command adapters
├── agents/*.md                      # thin Claude agents with skill preloads
├── guidance/
│   ├── shared.md
│   ├── claude.md
│   └── codex.md
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── .codex-plugin/plugin.json
├── .agents/plugins/marketplace.json
├── .mcp.json                        # official Linear HTTP MCP
├── bin/factory-kit.js               # universal installer and doctor
├── check/                            # deterministic conformance engine
└── templates/factory-conformance.yml
```

There are 41 canonical skills:

- 21 principle-first knowledge skills: voice, stack, frontend, design, animation, auth, data layer, database migration, forms, API, data pipelines, testing, LLM workflows, prompting, security, observability, deployment, CI, commits, pitfalls, and verification.
- 8 portable command workflows: standup, entry, submit, close, release, setup-linear, prompt, and kit-audit.
- 12 portable specialist workflows: feature architect, frontend engineer, database schema architect, database migration engineer, auth wiring specialist, forms builder, API route engineer, data pipeline engineer, LLM workflow engineer, security engineer, code reviewer, and verification engineer.

Claude preserves the existing public names: `/standup`, `/entry`, `/submit`, `/close`, `/release`, `/setup-linear`, `/prompt`, `/kit-audit`, plus all twelve specialist agent names. Their routing descriptions, tools, and models remain intact; only their workflow bodies moved to canonical skills.

## factory-kit-check

Skills describe the conventions. `factory-kit-check` enforces a deterministic subset:

```sh
factory-kit-check
factory-kit-check ../some-repo
factory-kit-check . --base origin/main --md
npx @nonlinear-labs/factory-kit add-ci
```

The checker is read-only. Without `--base`, critical and high findings produce a non-zero exit. With `--base`, the conformance gate evaluates the delta and blocks newly introduced critical findings by default.

| Rule | Severity | Citation |
|---|---:|---|
| `admin-client-module-scope` | critical | `factory-auth.md §Admin client — always wrapped` |
| `hardcoded-email-allowlist` | critical | `factory-auth.md §Hardcoded email allowlists` |
| `public-procedure-mutation` | critical | `factory-auth.md §Auth from day one` |
| `update-delete-no-where` | critical | `factory-data-layer.md §ORM pick` |
| `in-memory-rate-limiter` | high | `factory-security.md §Rate limiting` |
| `mixed-trpc-server-actions` | high | `factory-api.md §API style — pick one` |

Configure repository-specific exclusions in `.factory-check.json`:

```json
{
  "disabledRules": ["update-delete-no-where"],
  "ignorePaths": ["**/__tests__/**"],
  "gateOnHigh": false
}
```

## Development

```sh
npm install
npm test
npm run build
npm pack --dry-run
node bin/factory-kit-check.js .
claude plugin validate --strict .claude-plugin/plugin.json
claude plugin validate --strict .claude-plugin/marketplace.json
```

The test suite exercises temporary-home installs for Claude, Codex, both targets, auto detection, idempotency, legacy migration, conflicts, Linear configuration, managed guidance, duplicate-install diagnostics, skill frontmatter, references, and plugin metadata.

## Versioning

SemVer uses a long `0.x` runway. Version `0.4.0` introduces the portable canonical skill tree and cross-host installation surfaces. Skill names, Claude command names, Claude agent names/frontmatter, installer commands, and checker citations are compatibility API.

No package publication, tag, push, or release is performed by repository validation.

## License

MIT — see [LICENSE](./LICENSE).
