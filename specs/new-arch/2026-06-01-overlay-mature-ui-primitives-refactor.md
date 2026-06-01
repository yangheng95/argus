# Overlay mature UI primitives refactor

Date: 2026-06-01
Status: in progress

## Problem

The overlay has several custom UI interaction implementations where mature Solid-compatible primitives already exist. The most urgent risk is not only visual polish: keyboard behavior, focus management, popover/dialog dismissal, resize/drag behavior, and large-content rendering are spread across component-local code.

## Evidence scan

| Area | Existing implementation | Callsites / owners | Replacement direction | Phase |
| --- | --- | --- | --- | --- |
| Dialog | `src/components/primitives/Dialog.tsx` manually drives native `<dialog>`, backdrop click, drag offset, and close events. | `AppDialogHost`, `ConfigDialogHost`, `GoalDialogHost`, `SessionDialogHost`, `InteractionDialogHost`, `LogViewer`; tests under `dialog-primitive.test.ts`, `dialog-service-single-source.test.ts`, `controls.test.ts`, provider OAuth tests. | Introduce `@kobalte/core/dialog` inside the primitive while preserving `.dialog`, `.dialog-form`, `.dialog-header`, ids, and existing store contract. | 1 |
| Tabs | `src/components/ui/Tabs.tsx` only emits `role="tablist"` / `role="tab"` and data attributes. | `RightPanelTabs`, workspace/file editor toggles, tests under `tabs-primitive.test.ts`, `right-panel-tabs-flat.test.ts`, titlebar visual checks. | Replace primitive internals with `@kobalte/core/tabs`, preserving `.oc-tabs`, `.oc-tab`, and `data-*` styling contract. | 1 |
| Menubar / menus | `TitlebarMenubar.tsx` hand-rolls Alt key handling, outside click, `role="menu"`, and focus movement. | Titlebar only, but high visibility. | Later migrate to Kobalte Menubar/Menu after Dialog/Tabs stabilize. | 2 |
| Popovers / model picker | `ExecutorSelector.tsx` and `WorkspaceSplitLauncher.tsx` hand-roll outside click, portal positioning, and tab semantics. | Executor selector, workspace launchers. | Later migrate to Kobalte Popover/Tabs. | 2 |
| File editor | `FileEditorPane.tsx` uses raw `<textarea>` for file editing. | File workbench editor. | Later replace with CodeMirror 6 for syntax-aware editing and large file behavior. | 3 |
| Diff view | `DiffView.tsx` implements an LCS dynamic-programming diff and guard. | Changes panel and workspace diff preview. | Later use the existing `diff` package as the single diff engine. | 3 |
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
- [ ] Add overlay dependency on `@kobalte/core`.
- [ ] Replace Tabs primitive internals with Kobalte Tabs root/list/trigger.
- [ ] Replace Dialog primitive root/title with Kobalte Dialog while preserving current CSS hooks.
- [ ] Update primitive tests to reject the previous hand-only implementation.
- [ ] Run targeted overlay tests for Dialog/Tabs.
- [ ] Run overlay typecheck.
- [ ] Review diff for unintended unrelated changes.
- [ ] Commit and push only this refactor's files.
