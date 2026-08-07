# Browser Preview Header And Project Action Visibility Repair

## Recall

- User request on 2026-07-09:
  - Unify the Browser Preview header height with the rest of the Overlay header chrome.
  - The new-Mission action is still hidden by default; that is wrong.
- Acceptance criteria:
  - Browser Preview command/header chrome uses the same `--oc-header-height` height contract as `sidebar-header`, `chat-header`, and `sections-header`.
  - Browser Preview address input and action buttons fit inside that shared header height without increasing it.
  - Project group actions are visible by default when project actions exist; the new-Mission `plus` action is not hover-only.
  - Project Mission count, chevron, and new-Mission action remain visible together by default, on hover, and on keyboard focus.
  - Keep the single `ProjectLedgerGroup` project action source and the single task-scoped Browser Preview target/evidence surface.
  - No fallback display, duplicate header source, iframe/local preview workaround, or hover-only replacement state is introduced.
- Hard constraints:
  - No fallback or compatibility branch.
  - Preserve unrelated dirty worktree and staged index contents.
  - Do not restart, refresh, or kill the user's running OpenCorvus or overlay process.
  - Browser/visual verification must use isolated Node-driven browser fixtures.
  - Use existing Button, Icon, Work Ledger, Browser Preview, and shared header density tokens.
- Sources read before implementation:
  - `AGENTS.md`
  - `C:/Users/chuan/.codex/plugins/cache/openai-bundled/browser/26.623.101652/skills/control-in-app-browser/SKILL.md`
  - `specs/records/2026-07/2026-07-08-project-actions-budget-capsule-repair.md`
  - `specs/records/2026-07/2026-07-08-browser-preview-dom-selection-sync.md`
  - `specs/records/2026-07/2026-07-08-message-pane-rail-header-scrollbar-repair.md`
  - `packages/overlay/src/components/BrowserPreviewPanel.tsx`
  - `packages/overlay/src/styles/surfaces/inspector.css`
  - `packages/overlay/src/styles/surfaces/header.css`
  - `packages/overlay/src/styles/surfaces/sidebar.css`
  - `packages/overlay/test/browser-preview-panel.test.ts`
  - `packages/overlay/test/project-delete-button.test.ts`
  - `packages/overlay/test/browser/browser-preview-header-browser.test.ts`
  - `packages/overlay/test/browser/project-directory-new-chat-browser.test.ts`
- Whole-repository grep evidence:
  - `rg -n 'project-group-actions|project-group-new-chat|project-group-count|project-group-chevron|data-project-actions|message-add|Icon name="plus"' packages/overlay/src/components packages/overlay/src/styles packages/overlay/test -S`
  - `rg -n 'browser-preview-(shell|header|toolbar|address|url|actions|title|nav|stage|native|panel)|BrowserPreviewPanel|browserPreview' packages/overlay/src/components/BrowserPreviewPanel.tsx packages/overlay/src/styles/surfaces packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser/browser-preview-visual-stress.test.ts packages/overlay/test/browser/browser-preview-live-input-batch.test.ts -S`
  - `rg -n 'oc-surface-header|--ui-panel-header-height|panel-header-height|header-height|sections-header|chat-header|sidebar-header|task-scope-panel__header' packages/overlay/src/styles packages/overlay/src/index.html packages/overlay/src/components packages/overlay/test -S`
- Diagnosis:
  - `.project-group-actions` still sets `opacity: hidden`, `visibility: hidden`, and `pointer-events: none` by default; hover/focus only repairs visibility after interaction. That directly violates default visibility.
  - Browser Preview command chrome uses a local `.browser-preview-chrome-grid { min-height: calc(52px * var(--ui-scale)); }` contract instead of the shared `--oc-header-height` contract used by canonical surface headers.
- Plan:
  1. Make `.project-group-actions` visible and interactive by default.
  2. Delete the hover/focus-only visibility reveal contract for project actions.
  3. Bind `.browser-preview-command-surface` to `var(--oc-header-height)` for height/min-height/max-height.
  4. Make `.browser-preview-chrome-grid` fill that height instead of owning a separate `52px` minimum.
  5. Update source tests to reject hidden project actions and local Browser Preview header height.
  6. Update browser fixture assertions/screenshots to prove default project action visibility and header-height parity.

## Validation Targets

- `bun test packages/overlay/test/project-delete-button.test.ts packages/overlay/test/task-list-buttons-primitive.test.ts packages/overlay/test/browser-preview-panel.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-directory-new-chat-browser.test.ts packages/overlay/test/browser/browser-preview-header-browser.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
