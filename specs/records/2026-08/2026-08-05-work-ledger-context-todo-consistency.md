# Work Ledger, delegated-context, and Todo consistency repair

## Recall

- User request:
  1. remove the Work Ledger `加载更多` control shown below the Project list;
  2. reduce the oversized trailing disclosure icon beside `调度上下文`;
  3. make a subagent thumbnail Todo count agree with the Todo card inside the same conversation (observed `2/11` versus `4/11`).
- Acceptance indicators:
  - the Work Ledger reaches the complete active row set without presenting a manual load-more control;
  - the delegated-context trailing chevron uses the compact icon tier and remains aligned with the label;
  - a task-owned child Session's `todo.updated` event reaches the selected Task stream so the thumbnail consumes the same current Todo snapshot that hydrate exposes;
  - focused non-User-Interface (UI) contract tests, typecheck/build checks, a real page interaction, screenshots, and a second manual visual review pass succeed.
- Hard constraints:
  - no new, modified, or executed UI automation tests;
  - UI acceptance is real-page interaction plus manually reviewed screenshots;
  - no fallback or parallel Todo authority; `TodoStore` remains the canonical durable snapshot and `todo.updated` is only its live projection;
  - no Work Ledger pagination button replacement that leaves older rows inaccessible;
  - no new worktree; preserve current branch and push legacy remote with `dsw-33987` commit subjects.
- Read records and architecture evidence:
  - `AGENTS.md`;
  - `specs/README.md` and `specs/records/2026-08/README.md`;
  - `packages/overlay/src/components/WorkLedger.tsx` and `packages/overlay/src/services/work-ledger.ts`;
  - `packages/overlay/src/components/DelegatedContextDisclosure.tsx` and `packages/overlay/src/styles/surfaces/messages.css`;
  - `packages/overlay/src/components/SubagentProgressGrid.tsx`, `packages/overlay/src/store/conversation-agents.ts`, and `packages/overlay/src/utils/todos.ts`;
  - `packages/opencorvus/src/session/todo-store.ts`, `packages/opencorvus/src/conversation/view.ts`, `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`, and `packages/opencorvus/src/server/routes/orchestrator.ts`.
- Whole-repository grep evidence:
  - `work_ledger.load_more` is rendered by `WorkLedger.tsx` and the independent Archive panel;
  - the Work Ledger fetches 80-row cursor pages and only the manual button advances `nextCursor`;
  - delegated-context marker sizing resolves through `--transcript-activity-icon-size`, but that token is declared only on `.msg-work-details`, leaving the delegated marker's size override unresolved;
  - `TodoStore.update` publishes `todo.updated`, and hydrate reads the same store through `projectConversationView`;
  - the Task live stream subscribes only to `ProtocolStore`, while `message-bridge.ts` registers message and lifecycle Bus events but does not register `Todo.Event.Updated`; therefore the durable Todo snapshot advances while the already-mounted Task thumbnail can remain stale until hydrate.
- Independent agent feedback: none; the user did not request subagents or parallel audit, so no subagent was started.

## Causal chain

1. Work Ledger pagination is exposed as a second manual disclosure after the existing progressive Project list, so reaching the complete local ledger requires an unrelated extra control.
2. The delegated-context marker shares a selector that forces the icon to a surface token, but the component never defines that token; the Scalable Vector Graphics (SVG) icon therefore loses the intended closed icon size.
3. `TodoStore` is already the single durable Todo authority. Hydration reads it, but the selected Task's Server-Sent Events (SSE) stream only receives protocol-bridge events. Since `todo.updated` is not bridged, the in-card message Tool state can advance while the thumbnail's hydrated Todo snapshot does not. This is an event-projection omission, not a counting-algorithm error.

## Implementation plan

1. Replace Work Ledger's append/button state with one cancellable cursor-draining load that merges every page before publishing the rendered groups; remove the retired button style.
2. Define the delegated-context trailing marker's icon token with the existing compact icon tier.
3. Extend the task message protocol bridge with a live-only `Todo.Event.Updated` projection, including cross-Instance relay and a positive non-UI contract test that observes the exact task/session payload through `ProtocolStore`.
4. Run focused bridge/Work Ledger logic tests that do not assert UI presentation, Overlay and server typechecks, build/static checks, and required spec-link health checks.
5. Start the real application with Node-backed browser tooling, interact with the affected surfaces, capture goal-bound screenshots, inspect them manually, correct visual issues, and repeat once for second review.
6. Update this record with results, commit with the required prefix, fetch/merge current legacy remote branch state if needed, and push `legacy-remote/work-v0.0.30beta-yr-0804`.

## Verification record

- Implemented one cancellable cursor-draining Work Ledger load and removed the manual load-more control and its retired locale/style entries. The real page expanded and exposed records beyond the former 80-row page, then reached the bottom with only the normal show-less disclosure.
- Bound delegated-context marker sizing to the existing compact icon tier. Collapsed and expanded real-page measurements were both `12 × 12` pixels, and two manual screenshot reviews confirmed alignment with the label.
- Added the missing live-only Todo projection from `Todo.Event.Updated` through the existing Task protocol bridge, including cross-Instance relay. `TodoStore` remains the only durable Todo source.
- Added and passed the positive non-UI contract test `packages/opencorvus/test/protocol/todo-task-live-projection.test.ts` (`1` pass, `0` failures). No UI automation test was added, changed, or run.
- Passed Overlay and OpenCorvus TypeScript checks, Overlay locale integrity, Overlay Vite production build, `git diff --check`, and `packages/opencorvus/test/script/historical-docs-links.test.ts` (`2` passes, `0` failures).
- Real-page review used `http://localhost:5173/` against the running native backend on port `7878`. The final screenshot showed current subagent thumbnail progress `4/4` and `6/6`, matching the corresponding card progress; the exact Task stream projection was independently verified by the live protocol contract test.
- The first visual review exposed pre-existing missing `progress.goal.passed` and `progress.goal.failed` locale entries. Both locales now define them, and the final active Task page reported no warning or error logs.
