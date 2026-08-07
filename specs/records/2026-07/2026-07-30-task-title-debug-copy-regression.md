# Task Title Debug Copy Regression

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Restore copying Task debug information by double-clicking the selected Task name. |
| Acceptance criteria | Double-clicking the selected Task title in the Conversation header refreshes the Task board, writes the canonical `buildTaskDebugBlob` result to the clipboard, and shows visible success or failure feedback; standalone Chat title copying keeps using `buildChatDebugBlob`; Work Ledger row double-click continues to open Rename; the real Overlay page is exercised and visually inspected. |
| Hard constraints | Keep `debug-info.ts` as the single debug-payload source; do not add fallback clipboard paths, a second title renderer, a gate, a UI automated test, a fixture, or a screenshot baseline; use the existing Solid title component and browser clipboard API; do not restart or mutate the user's running packaged Overlay; preserve concurrent work; commit subjects use `dsw-33987` and push to `myhexin`. |
| Sources read | Root `AGENTS.md`; Browser control skill; `packages/overlay/src/components/App.tsx`; `packages/overlay/src/main.tsx`; `packages/overlay/src/components/WorkLedger.tsx`; `packages/overlay/src/utils/debug-info.ts`; the 2026-06-13 debug-blob record; the 2026-07-29 Task-header/Work-Ledger record; the 2026-07-29 rename-dialog-title record; commit `1d3352faad` and its parent. |
| Whole-repository search evidence | `debug-info.ts` still owns `buildTaskDebugBlob`, `buildChatDebugBlob`, and `writeDebugClipboard`; no production caller remains. `App.tsx` is the sole Conversation-header title renderer. `main.tsx` owns board refresh and active source state. `WorkLedger.tsx` is the sole row renderer and intentionally maps row double-click to Rename. `packages/overlay/test/task-debug-info.test.ts` contains stale UI source-string assertions for the removed production calls alongside non-UI payload tests. |
| Independent agent feedback | None; the user did not request sub-agents. |

## Cause Chain

1. Commit `1d3352faad` replaced the imperative `#chatViewTitle` projection with
   the declarative `ChatViewTitle` component.
2. That refactor correctly moved Pin, Rename, and Archive into component props,
   but deleted the mounted double-click listener and removed all production
   imports of the debug clipboard utilities.
3. The payload builders and clipboard writer remain intact, so clipboard
   capability and diagnostic compilation are not the fault.
4. The root repair is to project one explicit debug-copy callback from
   `main.tsx` into the sole title component, retaining fresh Task-board loading
   and Chat payload selection without reintroducing imperative DOM ownership.

## Complete Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/utils/debug-info.ts` | Keep the canonical Task/Chat payload builders and clipboard writer unchanged. |
| `packages/overlay/src/main.tsx` | Restore the sole debug-copy coordinator: refresh Task state, select the Task or Chat payload, write it, and return visible result text. |
| `packages/overlay/src/components/App.tsx` | Add the explicit callback to `AppProps` and bind it to double-click on the sole Conversation title; render transient feedback through Solid state rather than mutating DOM text. |
| `packages/overlay/src/components/WorkLedger.tsx` | Keep row double-click Rename unchanged. |
| `packages/overlay/test/task-debug-info.test.ts` | Delete the stale UI source-string assertions encountered in this task; retain only non-UI payload-contract tests and do not run UI automation. |

## Implementation And Verification Plan

1. Commit and push this Recall before production changes.
2. Restore the declarative title callback and visible feedback while preserving
   the existing canonical payload and fresh-board semantics.
3. Remove the encountered stale UI source assertions; run only non-UI payload
   tests, typecheck, i18n/static integrity checks, and the production build.
4. Open a real isolated Overlay page with Node-backed browser control,
   double-click a real selected Task title, inspect the visible feedback and
   clipboard payload, capture and personally inspect a task-scoped screenshot,
   and confirm row double-click still opens Rename without turning this
   acceptance flow into a UI test.
5. Re-grep all owners, review the diff and screenshot a second time, commit only
   task-owned paths, fetch/converge the current branch, and push to `myhexin`.

## Progress

- [x] Inspect history, current production owners, all call sites, and git baseline.
- [x] Commit and push the Recall.
- [x] Implement the root repair and stale UI-test cleanup.
- [x] Complete non-UI verification and real-page visual acceptance.
- [x] Complete second review, commit, and git-cc push.

## Verification Evidence

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed; Vite transformed
  7,058 modules and emitted the complete production bundle.
- `bun test packages/overlay/test/task-debug-info.test.ts`: 6 passed, 0
  failed. These are positive, non-UI payload-contract tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  22 passed, 0 failed.
- A task-owned backend at `http://127.0.0.1:47899` used isolated
  `OPENCORVUS_HOME`, database, and Git project paths. A real queued Task
  `tsk_faee93c4a001LA5bbBr2aabOWU` was selected in the built Overlay.
- Double-clicking the real Conversation header title produced visible
  `Copied` feedback. Reading the browser clipboard returned the canonical
  `# Task Debug Info` blob containing the exact Task ID, title, and runtime
  database fact.
- Double-clicking the same Task's Work Ledger row still opened the existing
  `Rename this task.` dialog, proving the title-copy and row-rename
  interactions remain separate.
- The personally inspected screenshot is
  [`2026-07-30-task-title-debug-copy-regression.jpg`](../../artifacts/2026-07-30-task-title-debug-copy-regression.jpg).
  It shows the selected Task context and green copied feedback on the sole
  Conversation title surface.
- No UI automated test, fixture, screenshot baseline, or pixel assertion was
  added or run. The encountered source-string UI assertions and negative
  assertions were deleted; the remaining test file verifies only positive
  debug-payload contracts.
