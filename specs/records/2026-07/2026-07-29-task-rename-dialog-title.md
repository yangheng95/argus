# Task Rename Dialog Title

## Recall

- User request: remove `（也可双击标题）` from the title shown by the task-rename dialog opened from the task title.
- Reference evidence: `C:\Users\10132\AppData\Local\Temp\codex-clipboard-4aba4d12-3e98-430e-986c-41def3e4ddac.png` shows the current title `重命名此任务（也可双击标题）。`.
- Acceptance criteria:
  - the Chinese dialog title is exactly `重命名此任务。`;
  - the English locale carries the same concise meaning, `Rename this task.`;
  - rename behavior and the existing double-click interaction remain unchanged;
  - the real Overlay page is opened, the dialog is exercised, and the rendered result is inspected in a screenshot.
- Hard constraints:
  - this is a UI copy change, so no UI automated test may be added, changed, updated, or run;
  - verification uses the existing i18n checker, typecheck/build checks, and manual real-page visual inspection;
  - preserve unrelated worktree changes and do not introduce a second title source.
- Materials read before implementation:
  - repository `AGENTS.md` instructions supplied in the task;
  - Browser skill instructions;
  - the supplied screenshot;
  - `packages/overlay/src/main.tsx`, `packages/overlay/src/components/App.tsx`, and both locale files.
- Full-repository grep:
  - `packages/overlay/src/main.tsx:801` supplies `task.rename_button_title` to the real rename dialog;
  - `packages/overlay/src/components/App.tsx:45` reuses the same key for the task rename action label;
  - `packages/overlay/src/i18n/zh-CN.json:1294` and `packages/overlay/src/i18n/en-US.json:1294` are the only locale definitions;
  - no other occurrence of `重命名此任务`, `也可双击标题`, `Rename this task`, or `rename_button_title` exists outside those owners.
- Independent-agent feedback: none; the user did not request sub-agent delegation, and this bounded copy correction does not require parallel ownership.

## Call-site decision

| Owner | Current role | Decision |
| --- | --- | --- |
| `packages/overlay/src/main.tsx` | Dialog title consumer | Keep the consumer and shared i18n key unchanged. |
| `packages/overlay/src/components/App.tsx` | Task rename action-label consumer | Keep the consumer and shared i18n key unchanged. |
| `packages/overlay/src/i18n/zh-CN.json` | Chinese source | Replace the value with `重命名此任务。`. |
| `packages/overlay/src/i18n/en-US.json` | English source | Replace the value with `Rename this task.` to keep locale semantics aligned. |

## Implementation and verification

1. Update the two canonical locale values without changing dialog or interaction code.
2. Run the Overlay i18n checker, Overlay typecheck, and Overlay production build; do not run UI tests.
3. Start the real Overlay frontend, open the rename dialog through the real interaction path, inspect the screenshot, and correct any visual discrepancy.
4. Re-read the diff, stage only this task's files and index hunks, commit with the required `dsw-33987` prefix, fetch the git-cc remote, and push the current delivery branch.

## Verification evidence

- `bun run overlay:i18n-check`: passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed after the competing build exited; Vite transformed 7,055 modules and produced the complete production bundle. Only the repository's existing third-party directive and large-chunk advisories were emitted.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 22 passed, 0 failed after the contention-free rerun.
- A dedicated OpenCorvus backend on port `47899` used a task-owned temporary home and Git project. The real Vite Overlay connected to it, loaded a real queued Task, switched to Simplified Chinese through Settings, and opened the rename dialog by double-clicking the real Task row.
- The dialog's accessible and visible title was exactly `重命名此任务。`; the existing task-title field, Cancel action, Confirm action, and double-click entry path remained intact.
- The personally inspected desktop screenshot is [`2026-07-29-task-rename-dialog-title.png`](../../artifacts/2026-07-29-task-rename-dialog-title.png). It shows the correction in the complete task-scoped dialog rather than a fabricated iframe, local state override, or screenshot baseline.
- No UI automated test was added, modified, updated, deleted, or run.
