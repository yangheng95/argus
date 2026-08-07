# Project New Chat Lazy Persistence

## Recall

### User requirement

- “UI上点击项目+号直接创建了chat，即使不发任何消息切换到mission仍然会生成一个空chat”.
- Clicking a Project-row `+` must open that Project's blank Chat composer without persisting a Chat.
- Switching the blank composer to Mission without sending anything must leave the Work Ledger free of an empty Chat.

### Acceptance criteria

- Project-row `+` activates the row's owning directory, clears the selected work item, opens Chat mode, and focuses the shared Composer.
- The click performs no `POST /coding/session`, selects no session, and adds no Chat row.
- Switching the blank Composer from Chat to Mission still performs no `POST /coding/session` and adds no Chat row.
- The first actual Chat submission continues to create exactly one Coding Assistant session before sending the message through the existing submit path.
- Mission submission continues to call only `wakeMission` with the selected Project directory.
- A real Vite page driven by Node Playwright verifies the unsaved Chat-to-Mission interaction and produces a scoped screenshot for manual review.

### Hard constraints

- `composerMode` remains the only Chat/Mission mode source.
- `boardStore.selectedSource === null` plus the active Project directory remains the existing launcher representation; do not add draft-session state, a temporary row, a fallback route, or a second Project identity source.
- Reuse `applyDirectory` and the existing Assistant submit branch. Do not weaken the backend session contract or hide empty rows in the projection.
- Preserve unrelated worktree changes and do not restart, refresh, or close the user's running OpenCorvus/Overlay process.
- Playwright runs through Node.

### Sources read

- `AGENTS.md`.
- `specs/current/architecture/99-principles.md`.
- `specs/records/2026-06/2026-06-16-left-activity-composer-binding.md`.
- `specs/records/2026-07/2026-07-17-coding-assistant-project-context-switch.md`.
- `specs/records/2026-07/2026-07-25-composer-chat-mission-manual-switch-restoration.md`.
- `specs/records/2026-07/2026-07-27-fresh-temporary-project-per-global-launch.md`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/services/{coding-assistant,workspace,task,project-directory}.ts`.
- `packages/overlay/src/components/{WorkLedger,ProjectLedgerGroup,ChatComposer}.tsx`.
- Focused source and browser tests for Work Ledger consolidation, Coding Assistant creation, Project selection, and Project-row New Chat.

### Whole-repository search

Repository-wide searches enumerated every `createWorkLedgerProjectChat`, `selectWorkLedgerProject`, `onCreateChat`, `createCodingAssistantSession`, `POST /coding/session`, and Composer mode-switch reference.

| Owner / call site | Current evidence | Decision |
| --- | --- | --- |
| `ProjectLedgerGroup` | The `+` Button delegates the row directory through `onCreateChat`; it does not own persistence. | Keep the primitive and directory handoff unchanged. |
| `WorkLedger` | Passes the Project-row callback without creating a session. | Keep unchanged. |
| `main.createWorkLedgerProjectChat` | Immediately calls `createCodingAssistantSession`, which POSTs and selects a durable empty session before any message exists. | Remove this eager creation path. Route the action to the canonical Project selection/blank-composer lifecycle. |
| `main.selectWorkLedgerProject` | Sets Chat mode, clears the center conversation, and calls `applyDirectory(..., preserveSelection=false)`, which clears the selected work item for both same- and cross-directory selection. | Reuse as the single Project-scoped blank Composer path. |
| `main` Assistant submit branch | When Chat mode has no Coding Assistant source, creates the session and then calls `panelMessage`. | Keep as the single persistence boundary. |
| `main` Mission submit branch | Calls `wakeMission` before the Assistant branch and never calls `createCodingAssistantSession`. | Keep unchanged and verify after a Chat-to-Mission switch. |
| `coding-assistant.createCodingAssistantSession` | Owns durable session POST, directory claim, selection, hydrate, and stream startup. | Keep unchanged; it remains submission-time infrastructure. |
| `project-directory-new-chat-browser.test.ts` | Currently asserts that clicking `+` immediately creates and selects a row. | Replace with the user-observable no-POST/no-row/no-session contract across the Mission switch. |
| Static source tests | `work-ledger-consolidation` encodes eager creation; other callers verify submission-time creation and service behavior. | Correct only the stale eager-click assertion and preserve submission/service coverage. |

### Independent agent feedback

- None. The user did not request sub-agents, and the affected path has one tightly coupled UI lifecycle owner.

## Causal chain

Observed empty Chat after switching to Mission → Project-row `+` invokes
`createWorkLedgerProjectChat` → that function calls
`createCodingAssistantSession` immediately → `POST /coding/session` persists and
selects a durable session with an empty transcript → the later mode switch
correctly clears the selected source but cannot undo the already committed
session → Work Ledger projects the empty Chat row.

Mission switching is therefore not the creator. The defect is the click-time
persistence boundary. Filtering empty rows, deleting them on mode switch, or
adding a client draft-session flag would hide or duplicate the durable truth
instead of fixing that boundary.

## Implementation plan

1. Remove the Project-row eager session helper and route its `onCreateChat`
   callback to the existing Project selection/blank Composer lifecycle.
2. Correct the focused source contract so Project-row click-time behavior is
   distinguished from Assistant submission-time creation.
3. Update the production-shaped browser fixture to assert no coding-session
   POST, no selected source, and no Chat row after both `+` and Chat-to-Mission
   switching, while retaining Project-directory Mission ownership coverage.
4. Run focused unit/source tests, Overlay typecheck, i18n, real Vite/Node browser
   interaction, screenshot review, documentation-health tests, and a second
   diff review before committing and pushing through normal git-cc hooks.

## Verification record

- Production behavior: Project-row `onCreateChat` now calls the same
  `selectWorkLedgerProject(directory)` lifecycle as explicit Project selection.
  Click-time code contains no Coding Assistant session creation; the unchanged
  Assistant submit branch remains the only `createCodingAssistantSession`
  caller for a blank Chat composer.
- Focused source contract:

  ```text
  bun test test/work-ledger-consolidation.test.ts -t "left sidebar exposes one unified Work Ledger mount"
  1 pass, 0 fail
  ```

- Coding Assistant lifecycle regression:

  ```text
  bun test test/coding-assistant-service.test.ts
  15 pass, 0 fail
  ```

- Real Vite and Node Playwright regression:

  ```text
  node test/browser-runner.mjs test/browser/project-directory-new-chat-browser.test.ts
  1 pass, 0 fail
  ```

  The production-shaped page proved that clicking Project `+` while another
  Project is active selects the requested directory with
  `boardStore.selectedSource === null`, renders zero Chat rows, and sends no
  `POST /coding/session`. Switching the untouched composer to the Watch Mission
  path still rendered zero Chat rows and sent no Coding Assistant POST; the
  subsequent Mission submit reached `/mission/wake` with the requested Project
  directory.
- Manual screenshot review passed:
  `packages/overlay/.scratch/project-directory-new-chat-unsaved-composer.png`
  shows the focused Chat launcher with only the existing Task row, and
  `packages/overlay/.scratch/project-directory-new-chat-switched-to-mission.png`
  shows the Mission launcher with no empty Chat row.
- Historical documentation links passed 22/22. The full document-health suite
  reached 62 pass and one failure because three concurrently authored July
  records were still untracked, including this record before its task commit.
- The repository-wide Overlay typecheck and i18n check were temporarily blocked
  by concurrent message-card work in `CardHeaderChrome.tsx`: two event-handler
  signature errors and two locale keys removed from the component but not yet
  removed from the catalogs. Those files are outside this repair and were not
  overwritten.
