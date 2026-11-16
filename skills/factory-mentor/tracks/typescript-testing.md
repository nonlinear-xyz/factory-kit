# Track: typescript-testing

From "I don't know how to write a test" to writing the state table that would have caught last week's bug. The skill is deciding what should happen; the syntax around it is small. Every rung uses real code from the open repo, never a toy example.

The mechanism, once, so every rung can lean on it: a test runner (Vitest) collects every function registered with `it('name', fn)` and calls it. `expect(actual).toBe(expected)` throws when the two differ, and a function that throws is a failed test. That is the whole machine; everything else is choosing the input and the expected value.

How to find material in any repo: tests sit beside the code in `__tests__/` folders (`factory-testing.md`). Pure functions (same input, same output: no database, clock, network or screen) are the easiest to test and the right place to start. Good candidates are date, money, formatting, and "derive X from Y" modules.

---

## Rung 0 — Read a test file as a spec

**Skill.** A test file is a list of decisions someone made about what the code should do. Reading it tells you what the code promises.

**Exercise.** Pick a test file for a module touched by the current ticket. For each `it(...)`, read only the name and the setup, write down what you expect the result to be, then read the `expect` line. Run it: `bunx vitest run <file>`.

**Done when.** On two different files, your prediction matched the assertion for every test, or you can say exactly why it didn't.

**Glosses you'll meet.** `describe` (a labelled group, nothing more), `it.each` (the same test run once per row of a table).

## Rung 1 — Break the code on purpose

**Skill.** Knowing what a test protects. A test that can't fail protects nothing.

**Exercise.** Change one line in the module under test: flip a `<` to `<=`, drop a `+ 1`, return early. Before running, predict which tests fail. Run them. Revert.

**Done when.** Twice in a row you named every test that failed before running, or you found a change that no test caught and wrote it down. That is a missing test, and your next rep.

## Rung 2 — Add one case to an existing table

**Skill.** Making one decision and writing it down where the machine can check it.

**Exercise.** Find an `it.each` table or a state table (`*.states.test.ts`, `factory-state-modeling.md`). Add one row for a situation the table doesn't cover yet: a weekend 1st, an empty list, a zero, the last day of a period. Decide the expected value yourself before looking at what the code returns.

**Done when.** Two rows added where you made the decision first, ran it, and could explain the result: pass, or a failure you understand.

**Glosses you'll meet.** Template-literal types (`` `${A} · ${B}` `` builds every combination of two unions as a type), `Record<K, V>` (an object that must have every key in `K`).

## Rung 3 — Write an example test from scratch

**Skill.** The arrange, act, assert shape, for one pure function.

**Exercise.** Pick a pure function with thin or no tests. Write three tests: the ordinary case, one boundary (empty, zero, first or last day, one item), and one case you suspect is wrong. Name each test as a situation and a result: `'a weekend 1st counts on the first sales day'`.

```ts
it('<situation> → <result>', () => {
  const input = /* arrange: the situation */;
  const result = /* act: call the function */;
  expect(result).toBe(/* assert: your decision */);
});
```

**Done when.** Two functions done, where at least one of your boundary tests failed on the first run or would have failed against an older version of the code.

**Glosses you'll meet.** `toBe` compares identity and primitives; `toEqual` compares structure (objects, arrays); `toMatchObject` checks only the fields you list.

## Rung 4 — An invariant: two paths must agree

**Skill.** Finding a promise that spans two pieces of code and pinning it down. Many real bugs are two definitions of one concept drifting apart.

**Exercise.** Find two places that compute "the same" number: a headline and a chart, a list total and a server total, a label and its tooltip. Write one test that computes both for the same input and asserts they're equal. Choose inputs where they're most likely to disagree.

**Done when.** One invariant test written and run, and you can state the invariant in one plain-English sentence without looking at the code.

## Rung 5 — A state table from scratch

**Skill.** Turning "what are all the situations?" into something the compiler checks.

**Exercise.** Take a function that returns a `{ kind }` union. List the 2–4 facts that decide which kind comes back, as small unions. Key the expectations by every combination, and add the check that every kind is reachable. Template: `factory-state-modeling.md`, or a `*.states.test.ts` already in the repo.

```ts
type Cell = `${Today} · ${SoFar}`;
const EXPECTED = { /* one row per Cell */ } as const satisfies Record<Cell, Result['kind']>;
```

**Done when.** One table written where a missing row failed typecheck while you were building it, and you chose the dimensions yourself.

**Glosses you'll meet.** `satisfies` (checks a value against a type without widening it, so each row keeps its exact literal), `Exclude<A, B>` (the members of `A` that aren't in `B`).

## Rung 6 — Fakes at a boundary

**Skill.** Testing code that talks to a database or API by replacing the far side with something you control.

**Exercise.** Find a test that uses `vi.mock` or a fake client. Read it at Rung 0 level first. Then write one test that checks the code's behaviour when the far side fails: an error, an empty result, a permission denial.

**Done when.** One failure-path test written, and you can say what the fake is standing in for and what it can't prove. A fake of the database can't tell you whether a row-level-security policy allows the query.

## Rung 7 — State → screen

**Skill.** Component tests: given this state, the screen shows this.

**Exercise.** Pick a component with a `{ kind }` prop or state. For each kind, render it and assert the one thing the user must see. Prefer queries by role and text over test ids.

**Done when.** One component covered for every kind, and a deliberately broken branch made exactly one test fail.

---

Beyond this track: browser journeys, SQL and permission tests, and test design under a budget each warrant their own track. Start them only once Rung 5 is done.
