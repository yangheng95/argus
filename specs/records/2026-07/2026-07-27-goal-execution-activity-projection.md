# Goal Execution Activity Projection

Date: 2026-07-27

Status: Implemented and verified.

## Recall

### User request

The operator reported that Goal execution state disappeared and that the Goals
panel no longer reveals which Goal is currently executing. After the causal
explanation, the operator explicitly requested the problem be fixed.

### Acceptance criteria

- A Goal whose exact current-process prompt controller is `streaming` or
  `retry` displays an explicit localized running label in the Goals panel.
- A pending Goal with no active prompt controller remains visually pending.
- Goal result state remains `pending | passed | failed`; execution activity is
  a separate read-only projection and never becomes a dispatch, completion, or
  mutation predicate.
- `session.status` changes for the selected Task invalidate the Board so active
  Goal activity appears and clears without a manual refresh.
- The Board cache identity includes the current active Goal-session ownership
  signature so a Host restart cannot return a stale active snapshot through
  `304 Not Modified`.
- Focused server, Overlay, event-routing, and Node browser tests pass. The real
  Vite-rendered Goals panel is captured and personally reviewed.

### Hard constraints

- Do not restore mutable or persisted `Goal.running`.
- Reuse `SessionPromptState` ownership plus `SessionStatus` lifecycle as the
  only current-process execution authority.
- Do not introduce a gate, lease, fallback status, state machine, or second
  conversation hierarchy.
- Reuse the existing shared Button, Icon, and localization primitives.
- Do not restart, refresh, stop, or otherwise interfere with the operator's
  running OpenCorvus or Overlay process.
- Run Playwright-compatible browser coverage through Node.js, never Bun.
- Preserve all unrelated parallel worktree modifications.
- Commit subjects start with `dsw-33987` and push through the `myhexin`
  git-cc remote without bypassing hooks.

### Disk sources read

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-23-retire-execution-liveness-and-task-run.md`
- `specs/records/2026-07/2026-07-23-overlay-goal-status-settings-macos-keyboard-repair.md`
- `specs/records/2026-07/2026-07-25-research-deliverable-case-benchmark.md`
- `packages/opencorvus/src/engine/{describe,model,store,goal-status}.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/src/session/{status,lifecycle}.ts`
- `packages/overlay/src/components/GoalGroup.tsx`
- `packages/overlay/src/services/{events,event-policy,goal-locate}.ts`
- `packages/overlay/src/store/board.ts`
- `packages/overlay/src/styles/surfaces/inspector.css`
- Focused tests listed below.

### Whole-repository grep evidence

- `EngineGoalStatus` has one definition and intentionally contains only
  `pending`, `passed`, and `failed`. `deriveGoalStatus` reads only the newest
  immutable Goal-attempt result.
- `listOwnedPromptSessionsForTask` is the single Task-scoped reader of exact
  prompt controllers owned by the current process. `describe.ts` pairs it with
  `SessionStatus.get` and already exposes exact Goal, Session, lifecycle, and
  activity observations to the Orchestrator.
- `workbench/board.ts::buildGoalFields` is the sole Board Goal projection. It
  currently exposes only `goalStatus`, so active and never-dispatched pending
  Goals are indistinguishable to the Overlay.
- `TaskBoardGoal` is the wire schema consumed by the Overlay. Its contract tests
  are `server/overlay-contract.test.ts` and
  `workbench/board-goal-worktree-schema.test.ts`; Board behavior is covered in
  `workbench/board.test.ts`.
- `GoalGroup.tsx` is the sole Goals-panel row renderer. It uses `goalStatus` for
  the icon and has no execution-activity field or explicit running label.
- `events.ts` consumes `session.status` before Board invalidation and
  `shouldRefreshSelectedBoard` explicitly returns false for that type. Existing
  coverage is `overlay/test/events-refresh.test.ts`.
- `boardTagForTask` owns the Board entity tag. Its durable session-tree fields
  observe status events but cannot distinguish a restarted Host with no
  process-owned controller from a stale persisted streaming status.
- `goal-group-css-residue-browser.test.ts` is the existing real rendered
  GoalGroup geometry, color, keyboard, and screenshot fixture. It currently
  fabricates `goalStatus: running`, which no longer matches the backend
  contract and must be replaced by the new execution-activity projection.
- `goal-locate.ts` resolves only persisted Build evidence. The new active
  session identity should be projected into the existing evidence field so
  the current Goal remains navigable without creating a second locator.

### Independent agent feedback

None. The operator did not request sub-agents, and the active delegation policy
forbids spawning them for this task.

## Diagnosis

The execution-liveness retirement correctly removed mutable Goal status as a
Host control source, but it also removed the observable activity projection.
An unresolved active attempt therefore maps to the same `pending` result as a
never-dispatched Goal. The Orchestrator sees exact current prompt owners, while
the Board drops those facts. The Overlay then has no data from which it could
render the active Goal.

This is a projection-boundary defect, not missing runtime ownership:

```text
SessionPromptState owner + SessionStatus streaming/retry
  -> describeTask current_process_prompt_owners
  -> missing from TaskBoard.goals[]
  -> GoalGroup receives pending only
```

The event path compounds the defect by treating `session.status` as
conversation-only. Even after adding the field, the selected Board would not
refresh at the lifecycle boundary. The entity tag must also include the
process-local active Goal-session signature; persisted status sequence alone
cannot invalidate a stale pre-restart activity snapshot.

## Call-point disposition

| Surface | Call point | Disposition |
| --- | --- | --- |
| Current prompt facts | `engine/describe.ts` | Extract and reuse the existing exact Task owner projection; preserve its Orchestrator rendering. |
| Board Goal projection | `workbench/board.ts::buildGoalFields` | Add a separate active execution activity carrying the exact active Session IDs; do not rewrite persisted Build evidence. |
| Board cache identity | `workbench/board.ts::boardTagForTask` | Add a stable sorted active Goal-session signature. |
| Wire contract | `engine/model.ts::TaskBoardGoal` | Add one typed optional `executionActivity` object; keep `goalStatus` unchanged. |
| Selected event routing | `overlay/services/events.ts` | Schedule a debounced Board reload for selected-Task `session.status`. |
| Goal renderer | `overlay/components/GoalGroup.tsx` | Prefer active presentation while activity exists and render explicit localized running text. |
| Goal chrome | `overlay/styles/surfaces/inspector.css` | Add active icon and compact activity-label styling with restrained motion. |
| Goal locator | `overlay/services/goal-locate.ts` | Preserve the existing persisted Build-evidence locator; execution visibility does not invent a generic Session locator. |
| Result consumers | progress, analytics, requirements, transcript | Preserve `goalStatus`; execution activity must not alter result counts or scheduling semantics. |

## Implementation plan

1. Extract the exact current-process prompt-owner projection already used by
   `describeTask`, then derive a stable per-Goal active Session list.
2. Extend the Board schema, payload, and entity tag without changing
   `EngineGoalStatus`.
3. Refresh the selected Board on `session.status` lifecycle events.
4. Render an explicit running label and active icon in `GoalGroup`, preserving
   terminal result semantics and existing keyboard/navigation behavior.
5. Add server projection/cache tests, event invalidation tests, and rendered
   Node browser assertions plus screenshot.
6. Run focused checks, inspect the screenshot, perform a second diff review,
   update this record with evidence, commit task-owned files, and push.

## Validation targets

- `bun test packages/opencorvus/test/workbench/board.test.ts packages/opencorvus/test/server/overlay-contract.test.ts packages/opencorvus/test/workbench/board-goal-worktree-schema.test.ts`
- `bun test packages/overlay/test/events-refresh.test.ts packages/overlay/test/goal-group-worktree.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/goal-group-css-residue-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Validation evidence

- Focused OpenCorvus projection, schema, cache-tag, and Board coverage: 26
  passed, 0 failed.
- Focused Overlay event routing, presentation-state, Goal worktree, and progress
  coverage: 53 passed, 0 failed.
- Overlay TypeScript typecheck and panel localization check passed.
- OpenCorvus TypeScript typecheck passed.
- Node browser runner built the real Vite application and passed
  `goal-group-css-residue-browser.test.ts`.
- The Vite-rendered Goals panel was personally inspected in compact and
  expanded forms. The exact active pending Goal displays a blue activity icon
  and explicit localized `Running` pill; inactive pending remains gray, passed
  remains green, and failed remains red. The Environment Goal strip reflects
  the same current activity without changing the result count.
- Reviewed screenshots:
  - `.scratch/goal-group-compact-rows.png`
  - `.scratch/goal-group-header-button-primitive.png`
  - `.scratch/goal-status-environment-progress.png`
- `git diff --check` passed.
- Historical-links, document-health, and product-docs single-source coverage
  passed against a task-only Git index: 93 passed, 0 failed.
