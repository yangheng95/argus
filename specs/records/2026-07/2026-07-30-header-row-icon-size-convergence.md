# Header Row Icon Size Convergence

Status: implementation complete; final screenshot acceptance blocked

## Recall

| Item | Detail |
| --- | --- |
| User request | “这一排的图标大小保持一致。” The supplied screenshot shows the left workspace context actions, Conversation header actions, and Right Dock tab controls on one horizontal desktop row. |
| Acceptance criteria | Every visible `Icon` in that row uses the existing `medium` size tier, so its rendered box is the same 16px design-token size. Existing button boxes, spacing, labels, callbacks, menus, selected/hover/focus states, Browser tab identity, native WebView ownership, and the blue task-status dot remain unchanged. Overlay typecheck and production build pass. A real desktop page is opened and the affected row is captured and personally inspected twice. No UI automated test is added, modified, updated, deleted, or run. The task-owned diff is committed with the `dsw-33987` prefix and pushed to `myhexin`. |
| Hard constraints | Desktop-only visual correction. Reuse the shared `Icon` primitive and its closed `medium` tier; do not introduce arbitrary pixel sizes, CSS transforms, duplicated SVGs, compatibility selectors, fallback behavior, a second icon source, responsive/mobile scope, or UI automated tests. Preserve existing control geometry and state ownership. Work only in the current main worktree. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-de06dd79-e731-468a-ad24-24a13ac08375.png` was inspected at original resolution. Search, Mailbox, selected Conversation identity, title overflow, selected editor plus caret, runtime, panel toggle, Right Dock tab identities, per-tab closes, add, and Dock close are visibly presented as one row but currently occupy four different shared size tiers. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/99-principles.md`; `specs/current/architecture/07-panel.md`; `2026-07-29-left-rail-command-icon-optical-size.md`; `2026-07-29-right-dock-codex-parity-and-browser-tab-instances.md`; `2026-07-29-codex-task-header-and-ledger-actions.md`; `2026-07-08-message-pane-rail-header-scrollbar-repair.md`; `2026-07-08-codex-message-panel-titlebar-toolbar.md`; current `App.tsx`, `WorkspaceEditorLaunchers.tsx`, `ChatHeaderRightDockToggle.tsx`, `TaskDirBar.tsx`, `RightDock.tsx`, `Icon.tsx`, `Icon.types.ts`, `icon.css`, `design-language.css`, `header.css`, `conversation.css`, `titlebar.css`, and `workspace.css`. |
| Whole-repository grep evidence | Searches for `workspace-contextbar`, `chat-header-actions`, `solidChatHeaderRuntimeActions`, `right-dock-tabs`, every `<Icon` in their component owners, and all icon-size tokens show one renderer per visible control. The shared tiers resolve to compact 12px, standard 14px, medium 16px, and large 20px. Search, Mailbox, Conversation identity, Visual Studio Code, and panel toggle already use medium; title overflow, runtime, Right Dock overflow/add/Dock close default to standard; selected editor caret and Right Dock tab identity/close use compact; non-Visual-Studio-Code selected editor brands can use large through `EDITOR_ICON_SIZES`. Menu-body and empty-state icons are not part of the photographed row. |
| Git baseline | Existing unrelated formatting/index changes were reviewed, checkpointed separately as `c0869ecd23`, and pushed before this task. The task begins from a clean `work-v0.0.24beta-yr-0729` worktree tracking `myhexin/work-v0.0.24beta-yr-0729`. |
| Independent review | Claude Code 2.1.147 was invoked in the repository with `Read,Grep,Glob` only and no session persistence. It returned `Not logged in · Please run /login` before reading files, so it produced no review evidence and made no changes. No sub-agent was requested or used. |

## Causal Chain

1. All affected controls already share the same 40px panel-header centerline and
   mature Button/Icon primitives, so the defect is not row height, alignment,
   hit target, or a missing layout primitive.
2. Their `Icon` calls select different size tiers or omit `size`, which resolves
   to the 14px standard default. The editor launcher additionally allows 20px
   selected brand icons while adjacent controls remain 12–16px.
3. The screenshot therefore exposes a real multi-tier rendering inconsistency
   inside one semantic chrome row.
4. Selecting the existing 16px `medium` tier at every row call site removes
   that inconsistency without changing the global Icon default or unrelated
   denser menu/body surfaces.

## Complete Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `App.tsx` workspace Search and Mailbox | Preserve their existing `medium` tier and all left-rail behavior. |
| `App.tsx` Conversation identity | Preserve its existing `medium` tier. |
| `App.tsx` selected-title overflow | Change the row trigger from default `standard` to `medium`; menu-item icons remain independently sized. |
| `WorkspaceEditorLaunchers.tsx` selected editor brand | Always use `medium` in the header row. Retain the existing per-brand optical-size map only for dropdown-menu items. |
| `WorkspaceEditorLaunchers.tsx` selected editor caret | Change `compact` to `medium` so every visible header-row SVG has the same rendered box. |
| `TaskDirBar.tsx` runtime trigger | Change the default `standard` tier to `medium`; panel-body icons remain unchanged. |
| `ChatHeaderRightDockToggle.tsx` | Preserve the existing `medium` tier. |
| `RightDock.tsx` visible tab identity and per-tab close | Change `compact` to `medium`; preserve Kobalte tab ownership, close buttons, overflow measurement, and Browser instance identity. |
| `RightDock.tsx` overflow, add, and Dock close actions | Change the default `standard` tier to `medium`; menu-body and empty-state icons remain unchanged. |
| Blue task-status dot | Preserve; it is a status indicator, not an `Icon` call. |
| Shared `Icon` primitive, tiers, and global default | Preserve. The closed `medium` tier already supplies the required single source. |

## Implementation And Verification Plan

1. Land this Recall and index entries before product changes.
2. Apply only the listed `medium` tier selections; keep control geometry and
   non-row icon consumers unchanged.
3. Run Overlay typecheck, localization validation, production Vite build, and
   diff checks. Do not run UI tests.
4. Start or reuse a real Node-backed desktop Overlay page, inspect computed
   row-icon boxes, capture a task-scoped screenshot, and personally review it.
5. Re-read this plan, re-grep every owner, inspect the exact diff and screenshot
   a second time, run historical/document health checks, then commit and push
   only the task-owned files.

## Progress

- [x] Supplied screenshot, architecture/history, source owners, complete row
  call sites, Git baseline, and unavailable Claude review path inspected.
- [x] Recall, causal chain, call-site disposition, and verification plan
  recorded.
- [x] Shared medium tier applied at every remaining row icon call site.
- [x] Static/type/build validation completed.
- [ ] Real-page screenshot and first visual review completed.
- [x] Second review, documentation health, commit, and git-cc push completed.

## Verification Evidence

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run check:i18n` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed after 7,055 modules
  transformed. Existing third-party `"use client"` and large-chunk warnings
  remain non-blocking.
- A real source-built Overlay page served by the isolated backend at
  `http://127.0.0.1:7891/ui/` was opened through the Node-backed in-app Browser.
  A real Task was selected, the Right Dock was opened, and a real blank Browser
  tab was created through the existing UI controls.
- Read-only live DOM measurement found every visible affected SVG (Scalable
  Vector Graphics) box at exactly 16×16px with `data-size="medium"`: Search,
  Mailbox, title overflow, selected editor, selected-editor caret, runtime
  environment, Right Dock toggle, blank-Browser tab identity, tab close, add,
  and Dock close. All currently hidden tab identities, closes, and overflow
  also carry `medium`. The responsive Conversation identity glyph retained
  `medium` but was hidden in the measured center-panel width.
- The Browser was then set to the supplied reference width and the real page
  reloaded so the Conversation identity and full row could be captured
  together. The Browser URL safety policy blocked further inspection of that
  local URL. Per Browser safety requirements, no alternate Browser surface,
  temporary iframe, local state/query override, handwritten fixture, or fake
  screenshot was used to bypass the block.
- Therefore the product implementation, computed live geometry, typecheck,
  localization, and production build are verified, but the mandatory
  post-change screenshot and personal visual review remain explicitly
  unfulfilled under rule 28b.
- `bun test --timeout 60000
  packages/opencorvus/test/script/historical-docs-links.test.ts`: passed with
  22 tests and 0 failures.
