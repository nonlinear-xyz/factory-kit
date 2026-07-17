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

The canonical folder name and the `name` in each skill's YAML frontmatter are the same public identifier.

### Knowledge skills

| Skill | Domain |
|---|---|
| `factory-animation` | Motion discipline, attention budgets, diegetic motion, and reduced-motion fallbacks |
| `factory-api` | Server actions and tRPC conventions, validation, pagination, errors, and audit logging |
| `factory-auth` | Auth-provider decisions, authorization wrappers, session handling, and callback safety |
| `factory-ci` | Merge-gate structure, required checks, automated review, and deploy separation |
| `factory-commits` | Conventional Commits, Linear references, commitlint, and branch conventions |
| `factory-data-layer` | Drizzle schemas, multi-tenancy, shared helpers, JSONB, and migration boundaries |
| `factory-data-pipelines` | CSV ingestion, time-series envelopes, Python services, and simulation pipelines |
| `factory-db-migration` | Production database runbooks: preflight, mutation, verification, rollback, and idempotency |
| `factory-deployment` | Vercel, Cloud Run, Neon, Terraform, environment handling, and migration execution |
| `factory-design` | Semantic tokens, theme variables, primitives, and design-vocabulary discipline |
| `factory-forms` | react-hook-form, Zod variants, field registries, conditional fields, and uploads |
| `factory-frontend` | CRUD surfaces, tables, drawers, row actions, formatting, and component-library choices |
| `factory-llm-workflows` | LangGraph state, node factories, RAG, structured output, and SSE streaming |
| `factory-observability` | PostHog, Sentry, trace IDs, structured logs, audit events, and PII boundaries |
| `factory-pitfalls` | Cross-skill index of observed implementation and process failure modes |
| `factory-prompting` | XML-tag prompt vocabulary, minimum-tagging discipline, and prompt structure |
| `factory-security` | Sensitive-data handling, KMS, safe redirects, rate limiting, and AI-code safeguards |
| `factory-stack` | Locked stack choices, flexible seams, and criteria for context-driven decisions |
| `factory-testing` | Vitest, Playwright, co-location, shared test utilities, and coverage thresholds |
| `factory-verification` | Verification tiers, eval graduation, coverage disclosure, and delta-gated conformance |
| `factory-voice` | First-principles architectural communication for sessions, Linear, commits, and PRs |

### Portable command-workflow skills

| Skill | Claude adapter | Workflow |
|---|---|---|
| `factory-close` | `/close` | Complete a Linear issue, leave a closing comment, and clean up the branch or worktree |
| `factory-entry` | `/entry` | Load a Linear issue into context and enter a focused planning session |
| `factory-kit-audit` | `/kit-audit` | Measure baseline and on-demand token footprint and identify heavy assets |
| `factory-prompt` | `/prompt` | Turn a rough ask into a structured prompt using the prompting vocabulary |
| `factory-release` | `/release` | Synchronize versions, prepare notes, and run gated release and publication steps |
| `factory-setup-linear` | `/setup-linear` | Configure portable Linear settings with legacy migration support |
| `factory-standup` | `/standup` | Group open Linear work into in-flight, priority, and backlog views |
| `factory-submit` | `/submit` | Move the branch-associated Linear issue to In Review |

### Portable specialist-workflow skills

| Skill | Claude agent adapter | Workflow |
|---|---|---|
| `factory-api-route-engineer` | `api-route-engineer` | Design endpoints using the factory's API, validation, pagination, and error conventions |
| `factory-auth-wiring-specialist` | `auth-wiring-specialist` | Wire providers, roles, organizations, callbacks, and unified auth wrappers |
| `factory-code-reviewer` | `code-reviewer` | Review a diff against factory conventions and the pitfalls checklist |
| `factory-data-pipeline-engineer` | `data-pipeline-engineer` | Build ingestion, time-series, simulation, and adjacent Python-service workflows |
| `factory-db-migration-engineer` | `db-migration-engineer` | Produce human-gated production mutation runbooks and verification criteria |
| `factory-db-schema-architect` | `db-schema-architect` | Design Drizzle schemas, migrations, tenancy keys, and polymorphic data models |
| `factory-feature-architect` | `feature-architect` | Turn a vague request into a scoped feature specification and specialist routing plan |
| `factory-forms-builder` | `forms-builder` | Build complex forms with schema variants, field registries, and conditional behavior |
| `factory-frontend-engineer` | `frontend-engineer` | Build house-style lists, forms, tables, drawers, and entity-editing surfaces |
| `factory-llm-workflow-engineer` | `llm-workflow-engineer` | Build stateful LLM, RAG, structured-output, and streaming workflows |
| `factory-security-engineer` | `security-engineer` | Threat-model features and produce concrete sensitive-data and authorization fixes |
| `factory-verification-engineer` | `verification-engineer` | Design blast-radius-aware verification strategies and identify proof gaps |

## Claude compatibility adapters

Claude preserves the existing command and subagent names with thin adapters. Agent routing descriptions, tool permissions, models, and canonical skill preloads remain part of the compatibility surface.

### Agents

| Agent | Model | Preloaded skill | When to invoke |
|---|---|---|---|
| `feature-architect` | Sonnet | `factory-feature-architect` | Scope a vague client ask into a buildable feature specification |
| `frontend-engineer` | Sonnet | `factory-frontend-engineer` | Scaffold lists, forms, drawers, tables, and entity-editing surfaces |
| `db-schema-architect` | Sonnet | `factory-db-schema-architect` | Design schemas, migrations, tenancy keys, and polymorphic structures |
| `db-migration-engineer` | Sonnet | `factory-db-migration-engineer` | Plan destructive production data changes with gated runbook discipline |
| `auth-wiring-specialist` | Sonnet | `factory-auth-wiring-specialist` | Wire auth providers, RBAC, organizations, callbacks, and wrapper seams |
| `forms-builder` | Sonnet | `factory-forms-builder` | Build multi-step, conditional, auto-saving, or upload-heavy forms |
| `api-route-engineer` | Sonnet | `factory-api-route-engineer` | Design server actions, tRPC procedures, or external REST routes |
| `data-pipeline-engineer` | Sonnet | `factory-data-pipeline-engineer` | Build ingestion, time-series, simulation, or Python-service pipelines |
| `llm-workflow-engineer` | Sonnet | `factory-llm-workflow-engineer` | Build LangGraph, RAG, structured-output, or streaming LLM workflows |
| `security-engineer` | Sonnet | `factory-security-engineer` | Threat-model a feature or audit sensitive and AI-generated code paths |
| `code-reviewer` | Sonnet | `factory-code-reviewer` | Review a PR or diff against the factory's conventions; read-only |
| `verification-engineer` | Sonnet | `factory-verification-engineer` | Design a verification plan and surface unverifiable gaps; read-only |

### Slash commands

- `/standup` — show open Linear tickets grouped by in-flight, top priority, and backlog
- `/entry <issue>` — load a Linear issue into context and enter a focused planning session
- `/submit [issue]` — move a Linear issue to In Review, auto-detecting it from the branch when omitted
- `/close [issue]` — leave a closing comment, move the issue to Done, and clean up the branch or worktree
- `/release [patch|minor|major]` — run the gated version, notes, tag, GitHub Release, and npm publication workflow
- `/setup-linear` — configure `.factory-kit/linear.json`, using legacy Claude configuration as migration input
- `/prompt <rough ask>` — convert a rough ask into a structured XML-tagged prompt
- `/kit-audit` — measure baseline and on-demand token footprint and identify trim candidates

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
