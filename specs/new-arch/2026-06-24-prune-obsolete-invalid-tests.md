# Prune Obsolete Invalid Tests

Date: 2026-06-24

## Objective

Delete repository tests that now assert obsolete or invalid contracts. This is
not a blanket deletion of failing tests: each removed test must conflict with a
current source-of-truth contract or exercise a retired interface.

## Recall

- `2026-06-24-remove-web-clone-source-audit.md` deletes
  `web_clone_source_audit`, the source-skeleton consumption audit implementation,
  and the audit JSON acceptance path.
- `2026-06-24-terminal-task-no-wake-tool-ownership.md` makes completed, failed,
  and cancelled tasks terminal. Ordinary messages, injected messages, queued
  wakes, and same-turn tool-result continuations must not reactivate them.
- Current `submit_frontend_template` is a small finalizer. Frontend-design
  report content is accumulated through `update_frontend_*` tools and the
  process trace tools; the full-report direct submit payload is no longer the
  public contract.
- `AGENTS.md` forbids host-side gates and compatibility paths. Tests that
  preserve old host-blocking, same-session continuation, or retired audit paths
  create pressure to reintroduce those invalid mechanisms.

## Evidence Sweep

Commands:

```powershell
bun test packages/opencorvus/test/frontend-design/output-tools.test.ts
bun test packages/opencorvus/test/orchestrator/tools.test.ts
rg -n "web_clone_source_audit|source-skeleton-consumption-audit|web-clone-source-skeleton-consumption-audit|missing consumption audit|missing audit evidence|host-blocking|terminal finalizer miss|continuation rejects stale|same-session continuation|freshContext" packages/opencorvus/test
```

Observed:

- `packages/opencorvus/test/frontend-design/output-tools.test.ts` fails 44/44
  tests because it still submits full frontend report fields directly to
  `submit_frontend_template`; the live schema only accepts `{ final: true }`.
- `packages/opencorvus/test/orchestrator/tools.test.ts` contains failing tests
  that expect task-level scheduler tools to execute after a terminal task, expect
  same-session continuation to mutate task state, assert old task-level direct
  build behavior, or reference host-blocking around deleted source-audit
  evidence.
- Replacement coverage remains in focused current tests:
  `frontend-design/output-incremental-tools.test.ts`,
  `frontend-design/prompt.test.ts`, `frontend-design/agent-process.test.ts`,
  `provider/schema-stress.test.ts`, `tool/web-clone-generate-source-project.test.ts`,
  `tool/web-clone-prepare-context.test.ts`, and current terminal-task route
  tests.

## Deletion Scope

Delete:

- `packages/opencorvus/test/frontend-design/output-tools.test.ts` in full. It is
  the retired direct-submit contract.
- Only the obsolete blocks in
  `packages/opencorvus/test/orchestrator/tools.test.ts` whose names match the
  failing old continuation, direct-build, host-blocking, architecture auto-rework,
  or source-audit expectations from the evidence run.

Keep:

- Current non-exposure tests for removed tools.
- Incremental frontend-design output tests.
- Provider schema stress tests.
- Document-health absence tests.
- Tests for terminal task no-wake route behavior.

## Verification

- Rerun `bun test packages/opencorvus/test/frontend-design/output-incremental-tools.test.ts packages/opencorvus/test/frontend-design/prompt.test.ts packages/opencorvus/test/frontend-design/agent-process.test.ts`.
- Rerun `bun test packages/opencorvus/test/orchestrator/tools.test.ts` after pruning.
- Rerun the web-clone/source-audit deletion targeted tests.
- Run final grep for deleted test names and retired audit IDs.
- Run typecheck and `git diff --check`.
