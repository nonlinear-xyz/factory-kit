---
description: Fix a PR's review comments, verify, push to the PR branch, and resolve the threads
argument-hint: <pr-number> (optional — auto-detected from the current branch if omitted)
---

Load and follow the canonical `factory-pr-fix` skill. Pass `$ARGUMENTS` as its invocation input. Preserve the skill's hard limits: additive commits only, no force-push, no merge, no push to the default branch.
