# Overlay mature UI primitives refactor

Date: 2026-06-01
Status: phase 3 partial

## Problem

The overlay has several custom UI interaction implementations where mature Solid-compatible primitives already exist. The most urgent risk is not only visual polish: keyboard behavior, focus management, popover/dialog dismissal, resize/drag behavior, and large-content rendering are spread across component-local code.

## Evidence scan

| Area | Existing implementation | Callsites / owners | Replacement direction | Phase |
| --- | --- | --- | --- | --- |
| Dialog | `src/components/primitives/Dialog.tsx` manually drives native `<dialog>`, backdrop click, drag offset, and close events. | `AppDialogHost`, `ConfigDialogHost`, `GoalDialogHost`, `SessionDialogHost`, `InteractionDialogHost`, `LogViewer`; tests under `dialog-primitive.test.ts`, `dialog-service-single-source.test.ts`, `controls.test.ts`, provider OAuth tests. | Introduce `@kobalte/core/dialog` inside the primitive while preserving `.dialog`, `.dialog-form`, `.dialog-header`, ids, and existing store contract. | 1 |
| Tabs | `src/components/ui/Tabs.tsx` only emits `role="tablist"` / `role="tab"` and data attributes. | `RightPanelTabs`, workspace/file editor toggles, tests under `tabs-primitive.test.ts`, `right-panel-tabs-flat.test.ts`, titlebar visual checks. | Replace primitive internals with `@kobalte/core/tabs`, preserving `.oc-tabs`, `.oc-tab`, and `data-*` styling contract. | 1 |
| Menubar / menus | `TitlebarMenubar.tsx` hand-rolls Alt key handling, outside click, `role="menu"`, and focus movement. | Titlebar only, but high visibility. | Later migrate to Kobalte Menubar/Menu after Dialog/Tabs stabilize. | 2 |
| Popovers / model picker | `ExecutorSelector.tsx` and `WorkspaceSplitLauncher.tsx` hand-roll outside click, portal positioning, and tab semantics. | Executor selector, workspace launchers. | Later migrate to Kobalte Popover/Tabs. | 2 |
| File editor | `FileEditorPane.tsx` used raw `<textarea>` for file editing. | File workbench editor. | Replaced with a CodeMirror 6-backed `CodeEditor` primitive. | 3 |
| Diff view | `DiffView.tsx` implemented an LCS dynamic-programming diff and guard. | Changes panel and workspace diff preview. | Replaced with `diffLines` from the existing `diff` package as the single diff engine. | 3 |
| Logs | `LogViewer.tsx` duplicates log parsing also present in `utils/log.ts`. | Log viewer. | Later move parser to one module and virtualize visible rows. | 3 |
| Icons | `Icon.tsx` keeps a large local SVG registry. | Whole overlay. | Later replace commodity icons with a mature icon library; keep only product-specific icons. | 4 |

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
- [ ] Commit and push only this refactor's files.
