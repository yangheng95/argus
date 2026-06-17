# Overlay mature UI primitives refactor

Date: 2026-06-01
Status: phase 3 batch complete; phase 2 and phase 4 remain open

## Problem

The overlay has several custom UI interaction implementations where mature Solid-compatible primitives already exist. The most urgent risk is not only visual polish: keyboard behavior, focus management, popover/dialog dismissal, resize/drag behavior, and large-content rendering are spread across component-local code.

## Evidence scan

| Area                    | Existing implementation                                                                                                  | Callsites / owners                                                                                                                                                                                                                          | Replacement direction                                                                                                                                 | Phase |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Dialog                  | `src/components/primitives/Dialog.tsx` manually drives native `<dialog>`, backdrop click, drag offset, and close events. | `AppDialogHost`, `ConfigDialogHost`, `GoalDialogHost`, `SessionDialogHost`, `InteractionDialogHost`, `LogViewer`; tests under `dialog-primitive.test.ts`, `dialog-service-single-source.test.ts`, `controls.test.ts`, provider OAuth tests. | Introduce `@kobalte/core/dialog` inside the primitive while preserving `.dialog`, `.dialog-form`, `.dialog-header`, ids, and existing store contract. | 1     |
| Tabs                    | `src/components/ui/Tabs.tsx` only emits `role="tablist"` / `role="tab"` and data attributes.                             | `RightPanelTabs`, workspace/file editor toggles, tests under `tabs-primitive.test.ts`, `right-panel-tabs-flat.test.ts`, titlebar visual checks.                                                                                             | Replace primitive internals with `@kobalte/core/tabs`, preserving `.oc-tabs`, `.oc-tab`, and `data-*` styling contract.                               | 1     |
| Menubar / menus         | `TitlebarMenubar.tsx` hand-rolls Alt key handling, outside click, `role="menu"`, and focus movement.                     | Titlebar only, but high visibility.                                                                                                                                                                                                         | Later migrate to Kobalte Menubar/Menu after Dialog/Tabs stabilize.                                                                                    | 2     |
| Popovers / model picker | `ExecutorSelector.tsx` and `WorkspaceSplitLauncher.tsx` hand-roll outside click, portal positioning, and tab semantics.  | Executor selector, workspace launchers.                                                                                                                                                                                                     | Later migrate to Kobalte Popover/Tabs.                                                                                                                | 2     |
| File editor             | `FileEditorPane.tsx` used raw `<textarea>` for file editing.                                                             | File workbench editor.                                                                                                                                                                                                                      | Replaced with a CodeMirror 6-backed `CodeEditor` primitive.                                                                                           | 3     |
| Diff view               | `DiffView.tsx` implemented an LCS dynamic-programming diff and guard.                                                    | Changes panel and workspace diff preview.                                                                                                                                                                                                   | Replaced with `diffLines` from the existing `diff` package as the single diff engine.                                                                 | 3     |
| Logs                    | `LogViewer.tsx` duplicated log parsing also present in `utils/log.ts` and rendered every row directly.                   | Log viewer.                                                                                                                                                                                                                                 | Moved parser/formatter usage to `utils/log.ts` and replaced direct row rendering with `virtua/solid` virtual list.                                    | 3     |
| Icons                   | `Icon.tsx` keeps a large local SVG registry.                                                                             | Whole overlay.                                                                                                                                                                                                                              | Later replace commodity icons with a mature icon library; keep only product-specific icons.                                                           | 4     |

## Phase 1 constraints

- Do not change dialog ids, CSS class names, or existing store/service contracts.
- Do not remove draggable dialog support in this phase because visual tests and layout affordances depend on it.
- Do not rewrite callsites individually unless the primitive API requires it.
- Add focused tests that prove the mature primitive dependency is the single owner of Tabs/Dialog semantics.
- Preserve current visual CSS contracts: `.dialog-form`, `.dialog-header`, `.oc-tabs`, `.oc-tab`, `data-size`, `data-tone`, and `data-active`.

## Phase 1 checklist

- [x] Grep Dialog callsites and tests.
- [x] Grep Tabs callsites and tests.
- [x] Check dependency availability.
- [x] Add overlay dependency on `@kobalte/core`.
- [x] Replace Tabs primitive internals with Kobalte Tabs root/list/trigger.
- [ ] Replace Dialog primitive root/title with Kobalte Dialog while preserving current CSS hooks.
  - Revised: blocked and reverted. `@kobalte/core/dialog` 0.13.11 dist declarations fail this repository's `tsc --noEmit` with `TS2693` because the package's `Dialog` namespace declaration treats type-only props as values. Importing only `Root`/`Content`/`Title` still loads the failing barrel; `@kobalte/core/src/dialog` is not resolvable by the current TypeScript resolver. Do not bypass with `skipLibCheck`; revisit by upgrading/patching Kobalte or choosing a dialog primitive whose declarations pass strict typecheck.
- [x] Update primitive tests to reject the previous hand-only Tabs implementation.
- [x] Run targeted overlay tests for Dialog/Tabs.
- [x] Run overlay typecheck.
- [x] Review diff for unintended unrelated changes.
- [x] Replace `FileEditorPane` raw `<textarea>` with a CodeMirror-backed `CodeEditor` primitive.
- [x] Run targeted file explorer/editor test.
- [x] Replace `DiffView` hand-written LCS with `diffLines` from `diff`.
- [x] Add regression coverage rejecting the previous `diffMiddle` / `Uint32Array` implementation.
- [x] Replace `LogViewer` duplicated parser helpers with imports from `utils/log.ts`.
- [x] Replace direct log row rendering with `virtua/solid` `VList`.
- [x] Commit and push only this refactor's files.

## Remaining follow-up

- Menubar / menus: migrate `TitlebarMenubar.tsx` to a mature menubar/menu primitive after a focused keyboard and visual QA pass.
- Popovers / model picker: migrate `ExecutorSelector.tsx` and `WorkspaceSplitLauncher.tsx` to mature popover/menu primitives.
- Icons: replace commodity entries in `Icon.tsx` with a mature icon library, keeping only product-specific custom shapes.

## Phase 4 Icon primitive plan

Evidence scan:

| API / file                                                  | Current behavior                                                                                   | Replacement decision                                                                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/Icon.tsx`                  | One large local `ICON_PATHS` registry contains both commodity glyphs and product-specific glyphs.  | Keep `Icon` as the single callsite API, add a `lucide-solid` adapter for commodity glyphs, and retain local SVG only for product-specific brand / agent / workflow glyphs. |
| `packages/overlay/package.json`                             | `lucide-solid` is available in `node_modules` but is not declared by the overlay package.          | Add `lucide-solid` as an explicit overlay dependency so the icon source is a real package contract.                                                                        |
| `packages/overlay/src/components/ConfigDialogHost.tsx`      | Configuration navigation uses eleven inline 24px SVG definitions.                                  | Replace with `Icon` names backed by Lucide; keep the existing `.config-nav-icon` CSS hook.                                                                                 |
| `packages/overlay/src/index.html`                           | Sidebar Mission / New Chat buttons embed inline 16px SVG.                                          | Remove inline SVG; leave `data-oc-icon` placeholders hydrated by `Icon` HTML from `main.tsx`.                                                                              |
| `packages/overlay/src/main.tsx` `renderRecentDirPanel`      | Recent directory remove action embeds an inline close SVG string.                                  | Use `iconHtml("close")`, generated through the same `Icon` primitive.                                                                                                      |
| `packages/overlay/src/utils/dom-utils.ts` `pathIcon`        | Directory breadcrumb buttons return inline SVG strings for browse/new/close.                       | Use `iconHtml("folder")`, `iconHtml("plus")`, and `iconHtml("close")`.                                                                                                     |
| `packages/overlay/src/utils/markdown.ts` code-copy button   | Markdown code blocks embed a copy SVG string.                                                      | Use `iconHtml("copy")` so markdown HTML keeps the same icon source.                                                                                                        |
| `packages/overlay/test/flat-redesign-icon-coverage.test.ts` | Allows `main.tsx` inline template SVG and requires every `IconName` to have an `ICON_PATHS` entry. | Update the guard to accept Lucide-backed icons, reject inline 16px/24px SVG across `src`, and assert commodity icons come from Lucide.                                     |
| `packages/overlay/test/icon-affordance-computed.test.ts`    | Test fixture hand-writes a send SVG.                                                               | Replace fixture with a class shell or generated `Icon` HTML so tests no longer normalize inline SVG usage.                                                                 |

Callsite decisions:

| Icon family                    | Names                                                                                                                                                                                                                                                                                                                                            | Decision                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Commodity controls             | `close`, `chevron*`, `caret-*`, `plus`, `minimize`, `maximize`, `restore`, `panel-*`, `terminal*`, `folder*`, `attach`, `web-search`, `send`, `stop`, `copy`, `check`, `inspect`, `cancel`, `edit`, `rewind`, `search`, `refresh`, `external-link`, `file-document`, `info-circle`, `log-lines`, `drag-handle`, `download`, `upload`, `status-*` | Back with `lucide-solid`.                                                            |
| Config navigation              | `config-general`, `config-permissions`, `config-prompt`, `config-channel`, `config-skill`, `config-skill-market`, `config-mcp`, `config-memory`, `config-providers`, `config-agent-models`, `config-about`                                                                                                                                       | Add as `IconName`s backed by Lucide.                                                 |
| Product / brand / agent glyphs | `editor-*`, `coding-*`, `avatar-*`, `overview`, `spec`, `plan`, `goals`, `executor`, `criteria`, `acceptance`, `github`, `mission`, `channel-link`                                                                                                                                                                                               | Keep local custom SVG records because these carry product semantics or brand shapes. |

Constraints:

- Preserve the public `Icon` component API and existing `IconName` callsites.
- Preserve current CSS hooks: `.oc-button`, `.config-nav-icon`, `.sidebar-btn-icon`, `.recent-dir-remove`, `.task-dir-tool`, and markdown copy classes.
- Do not introduce a second icon component for callers; `Icon` remains the only JSX icon primitive.
- Do not hand-write new SVG paths outside `Icon.tsx`.
- Keep icon-only buttons accessible with existing `title` / `aria-label` coverage.

Checklist:

- [x] Grep `Icon` callsites and inline SVG escapes.
- [x] Grep existing icon/button primitive tests.
- [x] Add explicit `lucide-solid` dependency.
- [x] Convert `Icon.tsx` into a Lucide adapter plus custom registry.
- [x] Replace inline SVG escape hatches with `Icon`-generated HTML or `Icon` JSX.
- [x] Update tests to reject inline 16px/24px SVG and require Lucide-backed commodity icons.
- [x] Run targeted overlay icon/button tests.
  - `flat-redesign-icon-coverage.test.ts`, `icon-affordance-computed.test.ts`, `button-primitive.test.ts`, and `sidebar-header-buttons-primitive.test.ts` passed.
- [x] Run overlay typecheck and i18n check.
  - `bun run --cwd packages/overlay typecheck` and `bun run --cwd packages/overlay check:i18n` passed.
- [x] Run browser visual smoke.
  - Vite served `http://127.0.0.1:5173/`; Chrome smoke verified two sidebar icon SVGs and eleven config navigation Lucide SVGs with no relevant console errors.
- [x] Review diff for user-change preservation.
- [ ] Commit and push only this phase's files.

## Phase 2A Workspace Split Launcher plan

Evidence scan:

| API / file                        | Current behavior                                                                                                                                           | Replacement decision                                                                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceSplitLauncher.tsx`      | Manually stores trigger/menu refs, computes fixed `top/right`, portals menu content, tracks `document.pointerdown`, `window.resize`, and scroll listeners. | Replace with `@kobalte/core/dropdown-menu` root/trigger/portal/content so placement, dismissal, Escape handling, and menu roles are owned by Kobalte. |
| `WorkspaceLayoutControls.tsx`     | Uses `WorkspaceSplitLauncher` for terminal profile menu; items are raw `button role="menuitem"`.                                                           | Replace item buttons with exported `WorkspaceSplitLauncherItem` so Kobalte owns item selection semantics.                                             |
| `WorkspaceEditorLaunchers.tsx`    | Uses the same split launcher for editor choices.                                                                                                           | Same item replacement.                                                                                                                                |
| `WorkspaceCodingCliLaunchers.tsx` | Uses the same split launcher for coding CLI choices.                                                                                                       | Same item replacement.                                                                                                                                |
| `pane-collapse-layout.test.ts`    | Verifies portaled dropdown alignment and item click behavior for terminal/editor/coding CLI launchers.                                                     | Keep existing behavioral coverage and add a source-level primitive guard.                                                                             |

Constraints:

- Preserve CSS class contracts: `.workspace-split-launcher-primary`, `.workspace-split-launcher-menu-button`, `.workspace-terminal-menu`, `.workspace-editor-menu`, `.workspace-coding-cli-menu`, and option classes.
- Preserve `data-ui` and `data-*` attributes used by tests and launch actions.
- Do not touch `ExecutorSelector` in this phase; it has separate dual-popover state and needs its own migration.

Checklist:

- [x] Grep `WorkspaceSplitLauncher` callsites and dropdown tests.
- [x] Replace manual portal/position/outside-click with Kobalte `DropdownMenu.Root` / `Trigger` / `Portal` / `Content`.
- [x] Replace raw menu item buttons in terminal/editor/coding CLI launchers with `WorkspaceSplitLauncherItem`.
- [x] Add primitive guard rejecting the previous manual listener/geometry implementation.
- [x] Run targeted tests, overlay typecheck, and i18n.
- [x] Run browser smoke.
  - Loaded `http://127.0.0.1:5173/` after restarting Vite dev server: title `OpenCorvus`, no Vite error overlay, and the three workspace split menu buttons rendered. The only console error was the pre-existing no-workspace `DirectoryRequiredError` from the file explorer.
- [x] Commit and push only this phase's files.

## Phase 2B Executor Selector popover plan

Evidence scan:

| API / file                          | Current behavior                                                                                           | Replacement decision                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExecutorSelector.tsx`              | Each chip uses `useDisclosure`, refs, `document.pointerdown`, and `useHotkey(Escape)` to dismiss popovers. | Keep the two-disclosure single source for mutual exclusion, but delegate trigger/content/dismissal/Escape behavior to `@kobalte/core/popover`. |
| `executor-selector-dualbar.test.ts` | Guards dual-chip callsite behavior, provider filtering, and task/session write semantics.                  | Extend coverage with a primitive guard that rejects direct document pointer listeners and asserts Kobalte Popover usage.                       |
| `composer.css`                      | `.executor-popover` is currently positioned above each chip from the slot's left edge.                     | Preserve class contracts and let Kobalte provide runtime positioning/dismissal.                                                                |

Constraints:

- Preserve `data-ui="executor-chip-mirror"` / `data-ui="executor-chip-external"`.
- Preserve dual-disclosure mutual exclusion: opening mirror closes external and vice versa.
- Preserve task-root session write rules and provider filtering.

Checklist:

- [x] Grep `ExecutorSelector` callsites and tests.
- [x] Replace manual document pointer and Escape dismissal with Kobalte Popover root/trigger/content.
- [x] Add primitive guard rejecting the previous manual listener.
- [x] Run targeted tests, overlay typecheck, i18n, browser smoke.
  - `executor-selector-dualbar.test.ts`, `executor-selector-redesign.test.ts`, overlay `typecheck`, and overlay i18n passed. Browser smoke loaded `http://127.0.0.1:5173/` with no Vite overlay and both executor chips rendered.
- [x] Commit and push only this phase's files.

## Phase 2C Titlebar Menubar plan

Evidence scan:

| API / file                                                                        | Current behavior                                                                                                                           | Replacement decision                                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `TitlebarMenubar.tsx` root                                                        | Manually renders `role="menubar"`, tracks `openMenu`, closes on `document.pointerdown`, and implements arrow/Enter/Space trigger handling. | Replace root/menu/trigger/content/item/group primitives with `@kobalte/core/menubar`; retain only project-specific Alt+access-key handling. |
| `MenuItem` / `RecentDirectoryMenuItem`                                            | Raw `button role="menuitem"` elements.                                                                                                     | Replace with `Menubar.Item as="button"` while preserving class, `data-testid`, title, disabled state, and click side effects.               |
| `MenuGroup`                                                                       | Raw `div role="group"` and title div.                                                                                                      | Replace with `Menubar.Group` / `Menubar.GroupLabel` while preserving CSS classes.                                                           |
| `titlebar-menubar.test.ts`, `pane-collapse-layout.test.ts`, titlebar source tests | Verify trigger classes, recent rows, settings/test ids, and menu layout.                                                                   | Add a primitive guard and run targeted titlebar tests after migration.                                                                      |
| View menu theme selector                                                          | Current menu shell uses `@kobalte/core/menubar`, but the theme selector still renders a local `div role="radiogroup"` with `button role="radio"`. | Replace with `Menubar.RadioGroup` / `Menubar.RadioItem` so menu radio semantics stay owned by the same primitive.                          |

Constraints:

- Preserve `data-menu-trigger`, `data-testid="titlebar-menu-..."`, `data-active`, class names, and Alt+access-key behavior.
- Do not rewrite titlebar command content in this phase.
- Do not remove range/toggle controls from menus; Kobalte owns menu shell and item semantics, while embedded form controls remain native.

Checklist:

- [x] Grep titlebar menubar callsites and tests.
- [x] Replace root/menu/trigger/content/item/group with Kobalte Menubar primitives.
  - Historical note superseded by the current implementation: an earlier attempt hit `@kobalte/core/menubar` declaration-file failures, but the current `TitlebarMenubar.tsx` imports `@kobalte/core/menubar` and `bun run --cwd packages\overlay typecheck` passes without `skipLibCheck`.
- [x] Replace View menu theme selector with Kobalte Menubar radio primitives.
- [x] Add primitive guard rejecting the previous document pointer listener and hand-written theme radio roles.
- [x] Run targeted titlebar tests, overlay typecheck, browser smoke, and a visual screenshot review of the View theme menu.
  - `bun test packages\overlay\test\titlebar-menubar-primitive.test.ts` passed.
  - `bun run --cwd packages\overlay typecheck` passed.
  - `node --test --test-concurrency=1 --test-name-pattern "titlebar menubar uses theme-adaptive text color" packages\overlay\test\browser\titlebar-menubar.test.ts` passed with `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1`.
  - Visual review passed for `.scratch/titlebar-view-theme-radio-menu.png`: View menu theme options are readable, current checked state and keyboard-highlighted state are visible, and option text does not overlap.
  - Full `titlebar-menubar.test.ts` still exposes unrelated failures: first responsive fixture timeout on `[data-menu-trigger="workspace"]`, no-directory workflow activity not active, and executor chip spacing over budget. Treat these as next-iteration candidates, not accepted variance.
- [ ] Commit and push only this phase's files.
