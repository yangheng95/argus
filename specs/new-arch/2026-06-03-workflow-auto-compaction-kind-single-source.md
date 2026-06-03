# 2026-06-03: Workflow Auto Compaction Kind Single Source

## Trigger

Task `tsk_e8bec4c750018Kcr5TWYo2AZka` showed goal #1 retrying after the first build attempt failed without delivery. The reported symptom was that the automatic compaction threshold did not protect the first G1 build from context pressure.

Live board evidence at `2026-06-03`:

- Goal #1 `gol_e8c0317c8001azy6EE0JLW7Fed` is passed only after `retryCount=1`.
- The successful build session later reached about `140k` tokens per assistant tool turn.
- The build phase remained a workflow child session, so it should not rely on the old automatic compaction continuation path.

## Call-Point Audit

Command:

`rg -n 'SessionCompaction\.create|SessionCompaction\.process|SessionCompaction\.isOverflow|disablesAutomaticCompaction|workflowAutoCompactionDisabledSessionKinds|compaction_request|ContextBudget\.predictiveLimit|predictiveCompactionDecision|result === "compact"|decision\.kind === "compact"' packages/opencorvus/src packages/opencorvus/test specs/new-arch -g '!**/*.json'`

Relevant decisions:

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/session/loop.ts::workflowAutoCompactionDisabledSessionKinds` | Delete local list; use one shared helper. |
| `packages/opencorvus/src/session/compaction.ts::workflowAutoCompactionDisabledSessionKinds` | Delete local list; use one shared helper. |
| `SessionLoop` predictive branch `decision.kind === "compact"` | Keep branch, but workflow kinds must produce a visible typed prompt-budget error instead of queuing compaction. |
| `SessionLoop` reactive `result === "compact"` branch | Keep branch, but workflow kinds must produce visible `ContextOverflowError`. |
| `SessionLoop` pending `compaction_request` handling | Keep manual summarize; reject automatic workflow compaction through the same helper. |
| `SessionCompaction.create` | Keep control-record creation for allowed sessions and manual summarize; reject automatic workflow compaction through the same helper. |
| `ContextBudget.predictiveLimit` / `predictiveCompactionDecision` | Keep math; this bug is kind-policy drift, not threshold arithmetic. |
| `packages/opencorvus/test/session/compaction-continue-inherit.test.ts` | Replace stale "build auto compaction allowed" expectation with workflow rejection tests. |

## Decision

Create one session-level policy source for automatic compaction eligibility. `build` and `frontend-design` must be included with the already-disabled workflow kinds. This restores the accepted `2026-05-29-compaction-continuation-rewrite.md` Phase 0 behavior: workflow sessions that exceed budget fail visibly with typed errors until durable continuation is implemented, rather than entering automatic compaction.

This is not a fallback or route bypass. It removes duplicate policy lists and applies the existing workflow compaction design consistently.

## Tests

- Automatic compaction creation rejects `build`, `frontend-design`, and `integrity` sessions.
- Manual summarize still works for `build`.
- Generic assistant automatic compaction still creates a `compaction_request`.
