---
name: factory-log
description: Write the plan, state model, findings, decisions and learn reps for the current ticket into its Linear issue instead of the terminal. Description sections are patched in place; findings, decisions and learn reps are typed comments; an agent-state label group makes the issue a review queue.
argument-hint: "<plan|state|finding|decision|learn|resolve> [issue-id] (issue auto-detected from branch)"
---

# Factory log

Linear is the working surface for a ticket, not just its bookends. The terminal is a synchronous chat: it mixes exploration, logs and answers, and it makes the operator read prose to find the one decision they owe. The issue is durable, structured, linkable and async. The operator can steer from it on any device, and the next session inherits it.

So the rule is: **if a record outlives this turn, it goes to Linear in one of the shapes below, and the terminal shows one line plus the link.**

**Invocation input:** a record kind, optionally followed by an issue identifier. If the identifier is omitted, auto-detect it from the current branch (the same way `factory-submit.md` does). If none can be derived, ask.

## Configuration

Read `.factory-kit/linear.json` (legacy `.claude/linear.json` as fallback). Keys this workflow uses, with defaults:

```json
{
  "teamKey": "NON",
  "agentLabels": {
    "group": "Agent",
    "working": "Working",
    "needsDecision": "Needs decision",
    "blocked": "Blocked"
  },
  "learnSurface": "local"
}
```

- `agentLabels` names a Linear **label group**. A group allows one label per issue, so Linear itself enforces that the agent state is exactly one of working, needs decision or blocked. If the group is missing in the workspace, say so once and point to `factory-setup-linear.md`. Do not create labels from this workflow.
- `learnSurface` is `"linear"` or `"local"`. Learn-rep threads go to Linear only when it is `"linear"`. A client's Linear workspace is a client-facing surface (see `factory-mentor.md` § Where this applies), so the default is local.

## The records

| Kind | Where | Write mode |
|---|---|---|
| `plan` | Issue description, `## Plan` | Replace the section |
| `state` | Issue description, `## State model` | Replace the section |
| `finding` | Comment starting `**Finding:**` | New comment |
| `decision` | Comment starting `**Decision needed:**` + label `Needs decision` | New comment |
| `resolve` | Reply under the decision + `## Decisions` line in the description | Append one line; set label back to `Working` |
| `learn` | Comment starting `**Learn rep:**`, discussion as threaded replies | New comment, then replies |

### Description sections: patch, never append

The issue description is the current truth. Comments are the history. Managed sections sit **below** the original body, in this order: `## Plan`, `## State model`, `## Decisions`. Never edit text above the first managed heading.

- If the heading exists, replace everything from it up to the next managed heading (or the end of the description).
- If it doesn't exist, insert it in its ordered position.
- Use the integration's partial-description edit when it has one. Otherwise read the description, splice it, and write it back whole. Re-read immediately before writing so a concurrent human edit isn't lost.
- When replacing a section, post a one-line comment (`Plan revised: <what changed>`) so the history stays in comments.

### `plan`

A short step walkthrough the operator can approve at a glance:

```md
## Plan
_Approved 2026-11-17 · branch `nishu/kai-329-topic`_

1. **<step>.** <one or two lines: what changes, where (`path/file.ts`)>
2. ...

**Verify:** <the commands or journeys that prove it>
**Not doing:** <explicit exclusions — omit if none>

+++ Agent notes
<file lists, traces, alternatives considered>
+++
```

### `state`

The state model in code blocks, so it reads as code and diffs as code. Follow the state-modeling recipe in `factory-state-modeling.md`:

````md
## State model
```ts
type PanelProps = { rows: Row[]; onOpen: (id: string) => void };

type PanelState =
  | { kind: 'closed' }
  | { kind: 'peek'; id: string }
  | { kind: 'confirm'; action: Action };
```

| State | When | Screen |
|---|---|---|
| `closed` | default | table only |
| `peek` | row opened | table + peek |
| `confirm` | destructive action chosen | peek suspended, confirm sheet |

**Changed:** + `confirm` · − `isConfirming`, `pendingAction` (collapsed into the union)
````

The operator reviews and argues about the union in comments under the revision note. Each agreed change re-runs `state`, which replaces the section.

### `finding`

Something learned that changes what happens next. A bug, a constraint, a surprise in the data shape. Not progress narration.

```md
**Finding:** <one sentence>
**Evidence:** `path/file.ts:42` · <test name and result, query plan, log line>
**Impact:** <what this changes in the plan, or "none, recorded for later">
**Next:** <what the agent does now, or the follow-up issue filed>
```

### `decision`

A call that belongs to the operator (see `factory-voice.md` § When to ask vs when to decide). Post it, set the label to `Needs decision`, then **keep working on everything the decision does not block**. Ask in the terminal instead only when the operator is in the session right now and the answer blocks all remaining work.

```md
**Decision needed:** <the question, one line>
**Context:** <the constraint that forces the choice, one or two lines>

- [ ] **A — <option> (recommended).** <tradeoff>
- [ ] **B — <option>.** <tradeoff>
- [ ] **C — <option>.** <tradeoff>

**Default:** if unanswered by <next session / date>, I take **A**.
**Blocked meanwhile:** <what waits on this — or "nothing">
```

The operator answers by ticking a box or replying with a letter and any note. A reply overrides a checkbox.

### `resolve`

Run when an answer is found (at session start, by `factory-entry.md`, or when polling). Reply under the decision comment with `**Resolved:** <choice> — <one-line why>`. Append one line to `## Decisions` in the description: `- <date> · <question> → <choice>. <why> ([thread](<comment link>))`. Set the agent label back to `Working`.

### `learn`

Only when `learnSurface` is `"linear"`. Otherwise the rep follows `factory-learn.md` in the terminal and the local log, unchanged.

```md
**Learn rep:** <track> · Rung <N> — <skill>
**Where:** `path/file.test.ts` · `<function>`
**Your job:** <what the operator writes, one sentence>
**Done when:** <the rung's signal>

<skeleton with the decisions left blank, in a code block>

**Question:** <the one guiding question>
```

The operator replies with their picks and reasoning (which cases, why, the expected values) and pastes or links what they wrote. Coach in the same thread under the rules in `factory-learn.md`: one guiding question, one hint, then a parallel case, never theirs. When the operator's code in the thread is final, copy it verbatim into the repo file. Copying their code isn't writing it for them, but don't "fix" it on the way in: a correction goes back to the thread as a hint. Post the review as the final reply (`**Review:** met / not yet — <the input that breaks it> · <one improvement>`). Then record the rep in `~/.factory/learner/` with the comment link. The local log is still the record of the operator's progress across tickets.

## Agent state

Set the label from the agent-state group as work moves:

- `Working`: when work starts on the issue (on plan approval).
- `Needs decision`: while any `decision` is open. It takes priority over `Working`.
- `Blocked`: when a failure needs the operator (credentials, a broken environment, a gate the agent may not cross). Post a `finding` saying what is blocked and why.
- Remove all three on close (`factory-close.md`).

A saved Linear view filtered on `Needs decision` is the operator's review queue across every ticket.

## Terminal output

After any write, print one line and nothing else about it:

```
KAI-329 · decision posted (needs you): pace chart scope → <link>
```

Do not repeat the record's contents in the terminal. The point is that the operator reads it in one place.

## Rules

- **No sensitive data.** Evidence cites file paths, test names and synthetic fixtures. Never real records, credentials or anything the project's data policy keeps out of logs. Linear is an external service.
- **No narration.** Progress belongs in commits. A finding that doesn't change what happens next isn't a finding.
- **One issue per write.** If a finding belongs to a different ticket, post it there and link back.
- **Confirm first** only for `resolve` when the answer is ambiguous (a checkbox ticked and a contradicting reply). Every other write is pre-authorized by invoking this workflow.

## Related

- `factory-voice.md` owns register and the general Linear comment shape. This skill adds the typed records.
- `factory-entry.md` reads these records at session start and calls `resolve` on answered decisions.
- `factory-state-modeling.md` owns what goes inside `## State model`.
- `factory-learn.md` and `factory-mentor.md` own the learn-rep rules. This skill only moves the thread to Linear.
- `factory-close.md` reads `## Decisions` for the closing comment and clears the agent labels.
