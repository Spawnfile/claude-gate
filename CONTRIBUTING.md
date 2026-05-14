# Contributing to claude-gate

## 1. The non-negotiable rule: no real database connections in tests

**NO REAL DATABASE CONNECTIONS IN ANY TEST UNDER ANY CIRCUMSTANCE.**

The rule:

> Connecting to a real Postgres / MySQL / Mongo / Redis / Supabase from any
> test is forbidden. A misrouted call could hit production. The entire premise
> of claude-gate is preventing accidental destructive DB operations; allowing
> real DB connections in tests would be a bizarre exception to our own thesis.

What you must use instead: in-process SQL parser (pure logic), fixture files,
and decision-simulator. All filesystem writes in tests go to a per-test tmpdir
cleaned in afterEach. Real DB testing happens in user environments via the
sandbox-mcp dogfood pathway, never in the CI test suite.

For context on the attack surface this protects, see
[docs/threat-model.md](docs/threat-model.md).

**CI enforcement:**
- Network egress is blocked at the test runner level.
- A banlist test fails CI if `pg`, `mysql2`, `redis`, `@supabase/supabase-js`,
  or `mongodb` appears as a non-type import in any file under `tests/`.
- Pre-commit hook scans for forbidden imports.

PRs that add any of the banned packages to test dependencies will fail CI and
will not be merged.

## 2. TDD workflow

Write the failing test first. Then implement. Then commit.

1. Write test -- it must FAIL (RED).
2. Run `npm test` -- verify it fails.
3. Write minimal implementation (GREEN).
4. Run `npm test` -- verify it passes.
5. Refactor if needed.
6. Commit.

Do not submit a PR where tests were written after the implementation. Decision
regression tests (under `tests/decisions/`) are especially important: every new
policy behavior needs a corresponding test case.

Minimum coverage: 80% line coverage on new code. Run `npm run test:coverage`
to verify.

## 3. Conventional commits

Format:

    <type>(<scope>): <description>

Types: feat, fix, refactor, docs, test, chore, perf, ci

Scopes: hook, ipc, bootstrap, setup, commands, cli, debug, audit, policy,
config, notices, tools, docs, ci, plugin, tests

Examples:

    feat(hook): parse stdin envelope and forward to IPC
    test(policy): add decision regression for confirm policy HIGH risk
    docs(threat-model): add gap 8 audit integrity section
    fix(ipc): handle ECONNREFUSED with tiered fail policy

Keep the description under 72 characters. Use the body for details when needed.

## 4. No --no-verify, --amend, or force-push

- Never use `git commit --no-verify`. Pre-commit hooks enforce the import
  banlist and must run.
- Never use `git commit --amend` on commits already visible to collaborators.
  Create a new commit instead.
- Never force-push to main (`git push --force`). This is a pre-release project
  with no external collaborators yet, but the discipline starts now.

These rules are enforced by code review, not only by CI.

## 5. English only

All code, comments, tests, commit messages, and documentation must be in
English. No other languages anywhere in the repository, including in variable
names, string literals used in output, or inline comments.

## 6. .js extensions on relative imports

Under `mcp-server/src/`, all relative imports must use `.js` extensions:

    // correct
    import { decide } from "./engine.js";

    // wrong -- will fail at runtime under Node ESM
    import { decide } from "./engine";

Test files (under `mcp-server/tests/`) use extensionless imports (Jest resolves
them). Do not add .js extensions to test imports.

## 7. Banlist enforcement

The following packages are banned from test dependencies:

- `pg`
- `mysql2`
- `redis`
- `@supabase/supabase-js`
- `mongodb`

The banlist test (`tests/banlist.test.ts` or equivalent) runs as part of
`npm test` and fails if any of these appear as non-type imports in test files.
This is enforced in CI and locally via the pre-commit hook.

If you need a type-only import from one of these packages for TypeScript type
annotations, use `import type { ... } from "..."`. The banlist checks runtime
imports only.

## 8. Where to ask questions

File a GitHub issue at https://github.com/Spawnfile/claude-gate.

When opening an issue:
- Describe the behavior you observed.
- Include the output of `/gate status` and the relevant lines from
  `.claude-gate/audit.jsonl`.
- Specify your Claude Code version (`claude --version`) and OS.

## Further reading

- [Custom rule packs](docs/rule-packs.md) -- author your own rule pack
