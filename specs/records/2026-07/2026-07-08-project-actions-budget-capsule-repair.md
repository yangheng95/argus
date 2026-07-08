# Project Actions And Hexin Budget Capsule Repair

## Recall

- User request on 2026-07-08:
  - The left Projects toolbar row must not make the project Mission count and the new-Mission action mutually exclusive.
  - The new-Mission icon must use the same visual line height as normal text.
  - The Hexin gateway remaining budget must be displayed inside the Hexin gateway model capsule.
- User follow-up on 2026-07-08:
  - The new-Mission action icon must be a plain plus sign.
- Acceptance criteria:
  - Project group count, chevron, and project creation action remain visible together on hover and keyboard focus.
  - The project creation icon uses the existing `plus` icon and is sized to the normal text line-height rhythm instead of a smaller custom glyph.
  - The Hexin budget request remains keyed only by the selected OpenCorvus Hexin model and active project directory.
  - The Hexin budget value renders inside the composer model selector capsule when the selected model provider is `hexin`.
  - No fallback display, duplicate budget source, duplicate project action source, or hover-only replacement state is introduced.
- Hard constraints:
  - No fallback or compatibility branch.
  - Preserve unrelated dirty worktree changes and the existing staged index.
  - Do not restart, refresh, or kill the user's running OpenCorvus or overlay process.
  - Browser verification must use an isolated Node-driven browser fixture on Windows.
  - Use existing Button, Icon, Popover, and Work Ledger primitives.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/records/2026-07/README.md`
  - `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`
  - `specs/records/2026-07/2026-07-08-work-ledger-row-alignment.md`
  - `packages/overlay/src/components/WorkLedger.tsx`
  - `packages/overlay/src/components/ProjectLedgerGroup.tsx`
  - `packages/overlay/src/components/ChatComposer.tsx`
  - `packages/overlay/src/components/ExecutorSelector.tsx`
  - `packages/overlay/src/styles/surfaces/sidebar.css`
  - `packages/overlay/src/styles/surfaces/work-ledger.css`
  - `packages/overlay/src/styles/surfaces/composer.css`
  - `packages/overlay/test/project-delete-button.test.ts`
  - `packages/overlay/test/task-list-buttons-primitive.test.ts`
  - `packages/overlay/test/executor-selector-dualbar.test.ts`
  - `packages/overlay/test/browser/project-ledger-group-browser.test.ts`
  - `packages/overlay/test/browser/project-directory-new-chat-browser.test.ts`
  - `packages/overlay/test/browser/executor-selector-redesign.test.ts`
- Whole-repository grep evidence:
  - `rg -n "mission-new|sidebar-new-task-button|mission_task_count|project-group|work-ledger|WorkLedger|missionCount|taskCount|count" packages/overlay/src/components packages/overlay/src/styles packages/overlay/src/main.tsx packages/overlay/test -S`
  - `rg -n "hexin_budget|hexin|remaining|budget|mirror|composer-model-selector|Executor|ModelSelector|model-selector|capsule" packages/overlay/src/components packages/overlay/src/styles packages/overlay/src/main.tsx packages/overlay/test -S`
  - `rg -n "executor-hexin-budget|hexin_budget|composer-model-selector|project-group-count|project-group-new-chat|project-group-actions" packages/overlay/test -S`
- Existing worktree risk:
  - `git status --short --branch` shows many pre-existing staged and unstaged files unrelated to this user request, including existing `MM` files and staged spec records.
  - This repair must only edit the current UI ownership files and tests, and must not reset or unstage unrelated content.
- Independent agent feedback:
  - None requested. The change is localized to the Projects group row and composer model selector ownership, with direct browser-test coverage.

## Diagnosis

The Projects row currently makes count and actions mutually exclusive in CSS:

- `.project-group-actions` is a separate grid column.
- On hover/focus, `.project-group-actions` becomes visible.
- The same hover/focus state sets `.project-group-count` and `.project-group-chevron` to hidden and non-interactive.

That is the direct reason the count disappears when the project creation action appears.

The new project action icon is also explicitly forced to `10px`, while the project row text line-height is larger. This creates a small, visually weak icon in the row.

The Hexin budget fetch is already correctly modeled as a Hexin-only resource in `ExecutorSelector.tsx`, but the display is attached as `meta` on the dual executor chip label row. The active composer surface now uses `ComposerModelSelector`, so the budget value must be rendered by the composer model capsule rather than by an outside label-row adornment.

## Plan

1. Keep `ProjectLedgerGroup` as the single project-group row source.
2. Change the project group header layout so the toggle button and actions can coexist without hiding the count or chevron.
3. Render `project-group-new-chat` with the existing `plus` icon and size it to the normal text line-height token used by the group row.
4. Extract the Hexin budget resource setup into a shared local helper inside `ExecutorSelector.tsx`.
5. Render `HexinBudgetInline` inside `ComposerModelSelector` when the selected model is `hexin/...`.
6. Keep the existing `ExecutorSelector` mirror chip path using the same helper so old direct consumers do not get a second budget source.
7. Update source and browser tests for visible count/action coexistence and composer-capsule Hexin budget placement.

## Validation Targets

- `bun test packages/overlay/test/project-delete-button.test.ts packages/overlay/test/task-list-buttons-primitive.test.ts packages/overlay/test/executor-selector-dualbar.test.ts packages/overlay/test/workspace-composer-density.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts packages/overlay/test/browser/project-directory-new-chat-browser.test.ts packages/overlay/test/browser/executor-selector-redesign.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
