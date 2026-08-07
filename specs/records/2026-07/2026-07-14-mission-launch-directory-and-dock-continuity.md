# Mission launch directory and Dock continuity

## Recall

### User requirement

- Explain and repair the screenshot where starting the Multica import Mission appears to collapse the page and a Mission operation reports HTTP 500.
- Determine whether Mission creation has more than one source of truth instead of treating the visible error toast or title as causal evidence.

### Acceptance criteria

- Every Overlay Mission launch sends the selected project directory explicitly to `POST /mission/wake` and reuses that exact captured directory for conversation hydration and Server-Sent Events (SSE) subscription.
- The global API directory context is not the owner of Mission launch identity and cannot silently redirect a launch to another open project.
- A failed Multica Mission wake leaves the current composer mode, selected conversation, and workbench layout unchanged.
- Switching to a primary Mission, task, or chat conversation closes the right Dock while resetting its content panels, so an empty 360-pixel Dock cannot keep compressing the conversation.
- A real isolated Node-launched browser test starts with the right Dock open, launches Multica import, proves the explicit request directory, proves the Dock no longer reserves width, and saves a goal-scoped screenshot for manual review.
- The Mission deletion regression in `2026-07-14-mission-delete-settled-queue-reference-integrity.md` passes alongside the Overlay repair, because that deletion error is the HTTP 500 visible in the supplied screenshot.

### Hard constraints

- No fallback, compatibility path, query override, second directory source, hidden message, gate, or host workflow state machine.
- Preserve the existing right-Dock interaction model: visibility and selected tool content are distinct user facts. The repair is the shared primary-surface transition, not a synthetic default tab.
- Use the existing Mission service, workbench panel owner, right-toolbar store, and task/session deletion owners; do not create parallel APIs or stores.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process. Browser validation uses an isolated fixture and Node sidecar.
- Preserve the dirty worktree and all unrelated user changes; no reset, restore, stash, or new worktree.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/test/AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/records/2026-07/2026-07-08-composer-file-loader-right-toolbar-hover.md`
- `specs/records/2026-07/2026-07-13-sidebar-surface-continuity.md`
- `specs/records/2026-07/2026-07-14-mission-delete-settled-queue-reference-integrity.md`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/mission.ts`
- `packages/overlay/src/store/right-toolbar.ts`
- `packages/overlay/src/components/RightDock.tsx`
- `packages/overlay/src/styles/surfaces/workspace.css`
- focused Mission service, launcher, Multica, Dock, pane, and browser tests

### Whole-repository call-site audit

Searches covered `wakeMission`, `MissionWakeInput`, `openMissionSession`, `resetCenterWorkbenchToPrimaryPanel`, `centerWorkbenchPanels`, `rightToolbarOpen`, `setRightToolbarVisible`, `RightDock`, `deleteSettledForSessions`, `deleteExactTreeInProject`, and every Mission/task/session deletion caller.

| Surface | Observed ownership | Decision |
| --- | --- | --- |
| Regular Mission composer launch | `main.tsx` calls `wakeMission`, then opens the returned session with an implicit `activeDirectory()` default. | Capture one non-empty directory before the request and pass it to both operations. |
| Multica Work Ledger launch | Receives a row directory, but `wakeMission` relies on global API context while hydration uses the row directory. | Send the row directory explicitly and reuse it for hydration/SSE. |
| Mission service | `wakeMission` accepts no directory; shared API transport injects configured global directory. | Make directory required at this domain boundary and construct the request query explicitly. |
| Primary workbench reset | Resets `centerWorkbenchPanels` to conversation but does not close `rightToolbarOpen`. | Close the Dock in the same shared primary-surface operation. |
| Right Dock close/reopen | Visibility is user-controlled; tool tabs remain mounted and can be restored. | Preserve this behavior outside primary-surface transitions. |
| Mission/task/session delete | Shared physical delete now retires settled queue references before the message cascade in one transaction. | Keep the repair and validate it with the focused backend benchmark. |

### Independent agent feedback

- Not used. The user did not request sub-agents or parallel audits; this is a focused repair and repository instructions prohibit unrequested delegation.

## Causal chain

1. The captured runtime log proves `POST /mission/wake` created Mission `24b1cdcbf5be78e5` and returned HTTP 200.
2. The later `DELETE /mission/24b1cdcbf5be78e5` attempted to cascade-delete messages while settled queue rows still referenced their source/result message identifiers, producing the displayed foreign-key HTTP 500.
3. Independently, the Multica launch reset the center panel list to conversation but left the right-Dock visibility signal open. `RightDock` therefore rendered its intentional zero-tab chooser and retained its fixed width, which compressed the main surface.
4. Mission launch also split directory identity between global API context and the Work Ledger row. It happened to resolve to the same path in this capture, but it is a real multi-source defect and must be removed.

## Implementation plan

1. Require an explicit directory in the Mission wake client and capture/reuse it in both launcher paths.
2. Defer the Multica UI surface switch until the wake succeeds.
3. Make the shared primary-workbench reset close the right Dock.
4. Add service/source/browser regressions, including an open-Dock Multica launch and a rejected-wake no-mutation case.
5. Run focused backend and Overlay tests, Overlay typecheck, docs health, diff checks, and manual screenshot review; iterate until all acceptance criteria pass.

## Benchmark contract

- Input: a selected Work Ledger directory, an already-open empty right Dock, and the Multica import action; separately, a settled Mission session tree whose queue rows reference source/result messages.
- Output: exactly one wake request with the selected directory; the returned session hydrates from that directory; the right Dock is closed and main surface width is restored; deleting the settled tree removes queue/session/message rows atomically.
- Environment: isolated Overlay static fixture launched with Node (never Bun for Playwright) plus isolated temporary SQLite projects for backend tests.
- Timeout: test runners are observed for ongoing output/activity; no timeout is measured mechanically from process start. Existing browser assertions use bounded waits for concrete DOM/network evidence.
- Pass threshold: all focused assertions pass, browser error collector is clean, the saved screenshot visibly shows the restored main surface, and a second diff review finds no fallback or parallel source.

## Implementation

- `MissionWakeInput.directory` is required, trimmed, validated, and serialized directly into the wake query.
- The regular composer captures `activeDirectory()` once and passes the same value to wake, hydrate, and SSE.
- The Multica Work Ledger launcher sends its row directory explicitly and does not change mode or reset panels until wake succeeds.
- `resetCenterWorkbenchToPrimaryPanel` now closes the right Dock before resetting the center panel list to conversation.
- Focused service/source tests cover explicit-directory precedence, empty-directory rejection, required session hydration identity, deferred Multica mutation, and shared Dock closure.
- The Node browser fixture first proves a rejected wake preserves the open Dock and center width, then proves a successful wake closes the Dock, restores more than 250 pixels of center width, and hydrates the returned Mission from the selected directory.

## Validation

- Overlay focused unit/source suite: 48 passed, 0 failed.
- Backend inactivity-runner benchmark: 3 passed, 0 failed, including the Mission route with real queue message references and both shared physical-delete cases.
- Node browser test: 1 passed, 0 failed at 1440×900; output screenshot is `.scratch/mission-launch-directory-and-dock-continuity.png`.
- Manual screenshot review: Mission content spans the restored center surface and the right Dock/resizer no longer consume layout width.
- Overlay TypeScript and i18n checks passed.
- Historical link and product-doc single-source checks passed. The broader document-health suite still reports a pre-existing `provider/models.ts` schema expectation from unrelated dirty work; this repair does not modify that surface.
