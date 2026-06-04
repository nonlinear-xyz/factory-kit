import type { Rule, UncoveredPitfall } from "./types.js";
import { adminClientModuleScope } from "./admin-client-module-scope.js";
import { hardcodedEmailAllowlist } from "./hardcoded-email-allowlist.js";
import { publicProcedureMutation } from "./public-procedure-mutation.js";
import { updateDeleteNoWhere } from "./update-delete-no-where.js";
import { inMemoryRateLimiter } from "./in-memory-rate-limiter.js";
import { mixedTrpcServerActions } from "./mixed-trpc-server-actions.js";

// Manual registry — rules are registered explicitly, not auto-discovered, so the
// active set is always greppable and a new rule lands with intent. Each rule
// cites the factory-pitfalls.md entry it enforces.
export const rules: Rule[] = [
  adminClientModuleScope,
  hardcodedEmailAllowlist,
  publicProcedureMutation,
  updateDeleteNoWhere,
  inMemoryRateLimiter,
  mixedTrpcServerActions,
];

// The eval backlog: every named pitfall in factory-pitfalls.md that has NO rule
// yet. This is the denominator of the coverage score — `activeRules /
// (activeRules + UNCOVERED)` — and the source of the severity-aware disclosure
// ("N critical-class pitfalls are NOT machine-checked"). It is deliberately the
// FULL backlog, not a sample: an honest coverage number requires an honest
// denominator. Mirror factory-pitfalls.md — when a pitfall graduates into a rule
// above, delete its entry here; when a new failure mode lands in the catalog,
// add it here. The shrinking of this list over time IS the factory's progress.
export const UNCOVERED: UncoveredPitfall[] = [
  // Stack / architecture
  { id: "custom-auth-adapter-when-official-exists", severityClass: "high", lang: "ts", skillRef: "factory-auth.md §Better Auth — plugin composition" },
  { id: "triple-fallback-auth-surface", severityClass: "high", lang: "ts", skillRef: "factory-auth.md §The wrapper interface" },
  // Forms
  { id: "monolithic-form", severityClass: "high", lang: "ts", skillRef: "factory-forms.md §Modular section files from day one" },
  { id: "server-client-schema-unified", severityClass: "medium", lang: "ts", skillRef: "factory-forms.md §Three Zod variants" },
  { id: "missing-usetransition-async-submit", severityClass: "medium", lang: "ts", skillRef: "factory-forms.md §useTransition on async submit" },
  // Testing
  { id: "no-tests-under-src", severityClass: "high", lang: "ts", skillRef: "factory-testing.md §Tests-before-merge — coverage gates, not test-first dogma" },
  { id: "mock-only-tests-passing-while-prod-fails", severityClass: "medium", lang: "ts", skillRef: "factory-testing.md §Test the boundaries; trust the framework" },
  { id: "snapshot-tests-as-only-coverage", severityClass: "medium", lang: "ts", skillRef: "factory-testing.md §E2E owns user flows; unit owns behavior" },
  // Frontend
  { id: "two-way-state-db-sync", severityClass: "high", lang: "ts", skillRef: "factory-frontend.md §One direction of truth" },
  { id: "currency-formatting-drift", severityClass: "medium", lang: "ts", skillRef: "factory-frontend.md §Format helpers" },
  // Design system
  { id: "palette-position-token-names", severityClass: "medium", lang: "ts", skillRef: "factory-design.md §Token vocabulary — name intent, not palette position" },
  { id: "hex-literal-in-component", severityClass: "medium", lang: "ts", skillRef: "factory-design.md §Token source — CSS variables, bridged into Tailwind" },
  { id: "dark-variants-on-elements", severityClass: "medium", lang: "ts", skillRef: "factory-design.md §Mode is a variable swap, not a parallel palette" },
  { id: "components-referencing-primitive-names", severityClass: "medium", lang: "ts", skillRef: "factory-design.md §One layer or two" },
  { id: "token-sprawl", severityClass: "medium", lang: "ts", skillRef: "factory-design.md §Hold the line on vocabulary size" },
  { id: "half-replaced-theme-library", severityClass: "medium", lang: "ts", skillRef: "factory-design.md §When the existing surface is daisyUI / Bootstrap / Material" },
  // Data
  { id: "querying-inside-jsonb-at-app-speed", severityClass: "medium", lang: "ts", skillRef: "factory-data-layer.md §Custom attributes as JSONB" },
  { id: "raw-sql-hand-mapped-rows", severityClass: "high", lang: "ts", skillRef: "factory-data-layer.md §ORM pick" },
  { id: "mixed-migration-file-naming", severityClass: "low", lang: "ts", skillRef: "factory-data-layer.md §Migration file naming" },
  // Database migrations (destructive prod writes)
  { id: "coercing-historical-data-to-wrong-constraint", severityClass: "high", lang: "ts", skillRef: "factory-db-migration.md §The data is ground truth" },
  { id: "single-file-migration-mixing-stages", severityClass: "medium", lang: "ts", skillRef: "factory-db-migration.md §Three-stage write contract" },
  { id: "untested-rollback-shipped-to-prod", severityClass: "critical", lang: "ts", skillRef: "factory-db-migration.md §Three-stage write contract" },
  { id: "idempotency-asserted-in-comment", severityClass: "medium", lang: "ts", skillRef: "factory-db-migration.md §Idempotency via natural keys" },
  { id: "natural-key-bare-equals-on-nullable", severityClass: "high", lang: "ts", skillRef: "factory-db-migration.md §Idempotency via natural keys" },
  { id: "tristate-case-conflates-null-false", severityClass: "high", lang: "ts", skillRef: "factory-db-migration.md §Bidirectional update semantics" },
  { id: "prod-destructive-write-no-layer-c-snapshot", severityClass: "critical", lang: "ts", skillRef: "factory-db-migration.md §Layered backup independence" },
  { id: "llm-auto-runs-runbook-commands", severityClass: "critical", lang: "ts", skillRef: "factory-db-migration.md §Human gate at every step" },
  { id: "constraint-dropped-without-auditing-downstream", severityClass: "high", lang: "ts", skillRef: "factory-db-migration.md §Defense in depth" },
  { id: "local-then-prod-skipping-ephemeral-staging", severityClass: "high", lang: "ts", skillRef: "factory-db-migration.md §Migration testing protocol" },
  // Security
  { id: "phi-in-email-no-baa-check", severityClass: "critical", lang: "ts", skillRef: "factory-security.md §PHI in email/SMS" },
  { id: "ai-generated-code-no-review-queue", severityClass: "critical", lang: "ts", skillRef: "factory-security.md §AI-generated code — read-only by default" },
  // Deployment
  { id: "migrations-at-runtime", severityClass: "high", lang: "ts", skillRef: "factory-deployment.md §Migrations — CI, never runtime" },
  // CI
  { id: "claude-reviewer-advisory-not-required", severityClass: "medium", lang: "ts", skillRef: "factory-ci.md §Claude Code reviewer is a required check, not an advisory bot" },
  { id: "required-checks-drift-from-jobs", severityClass: "low", lang: "ts", skillRef: "factory-ci.md §Branch protection — short list, load-bearing" },
  { id: "pre-push-hook-as-merge-gate", severityClass: "low", lang: "ts", skillRef: "factory-ci.md §Pre-push hooks — fast feedback, not the gate" },
  // Observability
  { id: "regenerated-trace-ids-at-hops", severityClass: "medium", lang: "ts", skillRef: "factory-observability.md §Trace ID — propagate, don't regenerate" },
  // Commits
  { id: "commits-with-no-linear-linkage", severityClass: "low", lang: "ts", skillRef: "factory-commits.md §Tie every commit to a Linear issue" },
  // Pipelines (Python)
  { id: "prebuilt-libs-before-second-consumer", severityClass: "medium", lang: "py", skillRef: "factory-data-pipelines.md §Don't pre-build shared libs" },
  { id: "pydantic-copied-across-entry-points", severityClass: "medium", lang: "py", skillRef: "factory-data-pipelines.md §Three-entry-point pattern" },
  // LLM workflows (Python)
  { id: "pydantic-state-for-langgraph", severityClass: "high", lang: "py", skillRef: "factory-llm-workflows.md §State shape" },
  { id: "routing-inline-in-add-conditional-edges", severityClass: "high", lang: "py", skillRef: "factory-llm-workflows.md §Routing" },
  { id: "no-versioning-on-editable-content", severityClass: "medium", lang: "py", skillRef: "factory-llm-workflows.md §Version anything editable later" },
];

// Legacy per-language counts, derived — kept for any caller that wants the quick
// tally without walking the list.
export const UNCOVERED_COUNTS = {
  ts: UNCOVERED.filter((p) => p.lang === "ts").length,
  py: UNCOVERED.filter((p) => p.lang === "py").length,
} as const;
