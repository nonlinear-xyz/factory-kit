---
name: factory-entry
description: Load a Linear issue into context and enter plan mode for a focused session
argument-hint: <issue-id> (e.g., NON-45 or 45)
---

You're starting a focused work session on a single Linear issue. Load its context, summarize it, and **enter plan mode** so the user can sign off before you start coding.

**Invocation input:** the issue identifier. Accept either the full form (`NON-45`) or just the number (`45`). If numeric, prepend the team key from the project configuration.

## What to do

1. **Read project configuration.** Prefer `.factory-kit/linear.json`; use legacy `.claude/linear.json` only as a migration fallback. If neither exists, stop and direct the user to the setup-linear workflow. Pull `teamKey` for ID resolution.

2. **Resolve the identifier.** If the invocation input is numeric, construct `<teamKey>-<num>` (e.g., `45` → `NON-45`). If already in `KEY-NN` form, use it as-is.

3. **Fetch the issue** through the connected Linear integration. Include comments and linked sub-issues if available.

4. **Fetch the project** through the Linear integration if the issue belongs to one and you haven't loaded it yet this session.

5. **Read the working records** that `factory-log.md` writes: the `## Plan`, `## State model` and `## Decisions` sections of the description, and any open `**Decision needed:**` or `**Learn rep:**` comment threads. For each decision answered since the last session (a ticked box or a reply), run `factory-log resolve` before planning. If a `## Plan` already exists, revise it; don't rewrite it from scratch.

6. **Check blockers.** If the issue has open `blockedBy` relations, list them and **warn loudly** before proceeding. Ask whether the user wants to continue or pick a different ticket.

7. **Summarize for context (≤ 250 words).** Use this shape — bold labels, short lines, omit any section that's empty:
   - **Issue:** `<KEY-N> — title` + priority + current state
   - **Outcome:** one sentence on what "done" observably looks like. If the issue lacks a clear outcome, say so — that's the first thing to fix.
   - **Scope:** the unchecked acceptance criteria / open checkboxes
   - **Encoded constraints:** anything in the description or comments that locks an approach — name the underlying force (compliance, perf budget, prior decision), not just the rule
   - **Customer voice:** if user feedback is quoted in the issue or linked, surface the raw words — don't paraphrase
   - **Open design calls:** "decide during build" items worth resolving up front
   - **Context graph:** parent, sub-issues, blockedBy/blocks, linked PRs, design docs — IDs + titles only. This is the issue's place in the wider decision graph; if it looks isolated, flag it as a yellow flag.

8. **Flag issue quality** *(brief — one line if everything is fine).* Linear's house style is: short title with a concrete outcome, body only as long as needed. If the issue is missing a clear outcome, written as a user story, or sitting orphaned with no context links, name it. Don't fix it silently — surface it so the user can decide whether to rewrite before designing the change.

9. **Offer one learn slice** *(only if `~/.factory/learner/profile.md` exists).* Read the active track's current rung, find the one slice of this ticket that fits it (usually a test, a state table or an invariant), and offer it in one line: "Learn slice: you write `<what>` in `<file>` (Rung N). Take it?" If accepted, mark that slice in the plan as the operator's, to run through `factory-learn.md` when the build reaches it. If declined, drop it silently. Never offer more than one.

10. **State model first** *(stateful or frontend changes only).* Post the props type and state union with `factory-log state`, so the operator reviews the union in Linear before approving the plan.

11. **Enter planning mode.** Use the host's planning capability when available. Otherwise, present the implementation plan in chat and stop for explicit approval. Do not start coding before approval.

12. **On approval, write the plan to Linear.** Run `factory-log plan` with the approved plan and set the agent-state label to `Working`. From then on, findings and operator-owned decisions go to the issue through `factory-log`, not into terminal prose.

## Style

Follow `factory-voice.md`. The reader is *you, two minutes from now, about to design the change* — give yourself what you'd need to make calls. Surface non-obvious constraints (invariants, prior decisions, blocking relations) at the top, not buried. No marketing copy, no hedging. If a constraint locks the design, name the principle behind it, not just the rule.
