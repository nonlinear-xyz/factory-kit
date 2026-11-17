---
name: factory-setup-linear
description: Configure portable Linear workflow settings in `.factory-kit/linear.json`, migrating legacy `.claude/linear.json` settings when present.
---

You're configuring this project to use the Factory Kit Linear workflows. The other workflows read `.factory-kit/linear.json` from the project root; this workflow creates or migrates it.

## What to do

1. **Check for configuration.** Read `.factory-kit/linear.json`. If it exists, show the current contents and ask whether the user wants to overwrite, edit, or abort. If it is absent but legacy `.claude/linear.json` exists, use that as a migration fallback, show it, and offer to write the equivalent canonical file.

2. **Discover Linear context.** Use the connected Linear integration's available capabilities:
   - List teams the user can access. Show `key — name (id)` lines.
   - Ask which team to use through the host's user-interaction capability, or directly in chat when no structured prompt exists. Capture both `key` (e.g., `NON`) and `id` (UUID).
   - List projects filtered to the chosen team. Ask whether standup should be scoped to one active project; "no" means team-wide.
   - If a project is chosen, capture `id` and `name`.

3. **Confirm state names.** Defaults are `"In Review"` and `"Done"`. List issue statuses for the chosen team through the Linear integration and verify both names exist. If not, ask the user for the actual names.

4. **Agent-state labels** (used by `factory-log.md`). List the team's labels. If there's no label group for agent state, offer to create a group named `Agent` with the children `Working`, `Needs decision` and `Blocked`. A label group allows one label per issue, so the agent state is always exactly one of the three. Create it only on approval. Then suggest the user save a Linear view filtered on `Agent: Needs decision`. That view is their review queue.

5. **Learn surface.** Ask whether learn-rep threads should run in this team's Linear (`"linear"`) or stay in the terminal (`"local"`, the default). Point out that everyone in the workspace can see Linear threads; for a client's workspace, `"local"` is usually right.

6. **Write `.factory-kit/linear.json`** with this shape:

   ```json
   {
     "teamKey": "NON",
     "teamId": "<uuid>",
     "projectId": "<uuid-or-omit>",
     "projectName": "<name-or-omit>",
     "states": {
       "inReview": "In Review",
       "done": "Done"
     },
     "branchPattern": "<owner>/<teamKey-lower>-<number>-<topic>",
     "agentLabels": {
       "group": "Agent",
       "working": "Working",
       "needsDecision": "Needs decision",
       "blocked": "Blocked"
     },
     "learnSurface": "local"
   }
   ```

   - `projectId` / `projectName` are optional — omit the keys entirely if the user didn't pick a project.
   - `branchPattern` is documentation-only — `/submit` and `/close` parse the branch with a regex (`-(\d+)-`) and don't depend on this string. Include it so future readers know the convention.

7. **Show the file path and confirm** — print "Wrote .factory-kit/linear.json. Factory Kit's standup, entry, log, submit, and close workflows are ready." Don't commit it; the user decides whether to check it in.

## Style

Direct, minimal back-and-forth. If the user has only one team, skip the question — just use it. If they don't pick a project, that's fine — many repos don't have one.
