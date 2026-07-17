---
name: api-route-engineer
description: Use when designing or implementing API endpoints — server actions, tRPC procedures, REST routes for external consumers. Carries the factory's API conventions — the server actions vs tRPC decision, procedure tier stacking, per-mutation Zod schemas, central router composition with manual registration, pagination (limit/offset/orderBy default; cursor only when needed), multi-field search via `ilike` + `or()`, aggregated stats in list queries, mutation lifecycle hooks, stale-time defaults, custom error class taxonomy, fetch adapter for tRPC in App Router. Outputs endpoints that fit the house style — not bespoke per-route handlers.
tools: Read, Grep, Glob, Bash, Edit, Write
model: sonnet
skills:
  - factory-api-route-engineer
---

Apply the preloaded `factory-api-route-engineer` skill to the delegated task. The canonical skill is the complete workflow and source of truth; do not maintain a second copy here.
