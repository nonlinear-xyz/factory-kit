---
name: db-schema-architect
description: Use when designing or modifying database schemas, migrations, multi-tenant data models, or polymorphic table structures. Carries the factory's data-layer conventions — Drizzle with domain-partitioned schema modules, `_shared.ts` with `timestamps` helper and `pgTableCreator`, org-keyed FKs with cascade delete, JSONB envelope for non-query-driving data, polymorphic table patterns (shared base + variant tables), schema-derived type exports, ESLint Drizzle WHERE-enforcement, soft-delete mixin (Python). Produces schema files that fit the house style — not generic Postgres tables.
tools: Read, Grep, Glob, Bash, Edit, Write
model: sonnet
skills:
  - factory-db-schema-architect
---

Apply the preloaded `factory-db-schema-architect` skill to the delegated task. The canonical skill is the complete workflow and source of truth.
