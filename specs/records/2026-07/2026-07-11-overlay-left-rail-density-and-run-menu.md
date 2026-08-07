# Overlay Left Rail Density And Run Menu Repair

## Recall

| Item | Detail |
| --- | --- |
| User request | Remove the rounded/square overlap at the message panel's upper-left corner; remove the OpenCorvus brand background and dropdown mark; tighten the upper-left navigation and every project/Mission/task/Chat row; keep project indentation within the Projects heading alignment; restore the titlebar Run menu in the current design language; and make only the project list below Pinned scroll. |
| Acceptance criteria | The workspace corner has one clipped radius with no rectangular child overpaint. The brand remains a text-first accessible guide trigger but has transparent resting/hover chrome and no chevron. Primary left-rail actions and Work Ledger rows use a tighter vertical rhythm. Project rows start on the Projects heading axis and descendants remain visibly nested. Navigation plus Pinned stay fixed while the Projects region alone owns vertical scrolling. The titlebar exposes File, Edit, View, Run, Help; Run reuses the live Executor and current settings surfaces instead of restoring retired configuration fields. Real desktop browser screenshots verify the result. |
| Hard constraints | No fallback, compatibility alias, duplicate scroll owner, static fake menu action, deprecated Run configuration resurrection, global zoom, mobile scope, new worktree, or intervention in the user's running OpenCorvus process. Preserve the existing dirty worktree. Use the existing Kobalte Menubar/Popover, Button/Icon primitives, Executor selector, settings dialog, and Work Ledger source. Playwright/browser verification runs through Node on Windows. |
| Sources read | `AGENTS.md`; Browser skill; the supplied 822×1538 screenshot; `2026-07-08-codex-message-panel-titlebar-toolbar.md`; `2026-07-08-message-pane-rail-header-scrollbar-repair.md`; `2026-07-08-message-pane-agent-rail-geometry-toolbar-alignment.md`; `2026-07-08-projects-panel-and-codex-composer-polish.md`; `2026-07-08-work-ledger-row-alignment.md`; `2026-07-09-overlay-codex-full-style-parity.md`; `2026-07-10-overlay-codex-strict-parity-remediation.md`; current `App.tsx`, `WorkLedger.tsx`, `ProjectLedgerGroup.tsx`, `LedgerList.tsx`, `TitlebarBrandGuide.tsx`, `TitlebarMenubar.tsx`, and relevant workspace/sidebar/titlebar/work-ledger/conversation styles and tests. |
| Whole-repository search evidence | `rg` covered the Work Ledger labels and owners, all `project-group`/`work-row` geometry, every titlebar menu identifier and historical Run implementation, brand-guide selectors, workspace corner radii, and scrollbar/overflow owners. `git log -S 'titlebar.menu.run'` showed the previous Run menu; current schema/search proved its `auto_question`, proposed-task confirmation, and direct titlebar config controls are retired, while `executor-chip-{mirror,external}`, `openConfigDialog`, Agent Models, Expert Squads, and Permissions remain real current surfaces. |
| Independent agent feedback | None. The user did not request sub-agents; focused source tests, an isolated Node browser fixture, screenshot inspection, and final diff review provide the independent verification layers. |

## Root Cause

1. `.workspace-main` owns the rounded top-left background but does not clip its square child surfaces, allowing the inner conversation surface to visually stack a right angle over the radius.
2. `TitlebarBrandGuide` renders a chevron and `titlebar.css` gives the trigger a filled pill in every visible state.
3. `.session-list-panel` is the scroll owner around the entire `WorkLedger`, so New chat, settings shortcuts, Pinned, and Projects all move together.
4. Row geometry is spread across the canonical action, project-group, and work-row owners but currently uses 36px actions and 30–34px ledger rows with comparatively large section margins.
5. The current titlebar menu set removed Run entirely. The historical menu mixed the valid Executor focus action with retired configuration controls, so restoring the old file verbatim would violate current single-source configuration boundaries.

## Implementation Plan

1. Clip `.workspace-main` to its existing radius and add a regression assertion for the single rounded owner.
2. Remove the brand chevron, make the trigger background transparent at rest/hover/expanded state, and update focused brand tests.
3. Restructure `WorkLedger` into a fixed navigation/Pinned header and one `.work-ledger-projects-scroll` region containing the Projects heading, list, and pagination. Remove scrolling from the outer Work Ledger mount.
4. Tighten shared left-rail action, section, project, Mission, task, and Chat row geometry; align project-row leading padding with the Projects heading while retaining the existing descendant nesting source.
5. Restore a Run top-level Kobalte menu between View and Help. Its actions focus the current Executor selector or open Agent Models, Expert Squads, and Permissions through their existing real owners. Keep all retired Run keys absent.
6. Update focused static and Node browser tests, run Overlay typecheck/build plus documentation health, then inspect isolated desktop screenshots and the final diff.

## Validation Targets

- `bun test packages/overlay/test/titlebar-brand-strip.test.ts packages/overlay/test/titlebar-brand-guide-primitive.test.ts packages/overlay/test/titlebar-compaction-threshold.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/sidebar-header-buttons-primitive.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/ledger-scrollbar-browser.test.ts packages/overlay/test/browser/titlebar-menubar.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `git diff --check`

## Result

- The message workspace now clips square child surfaces to its existing single top-left radius. Browser-computed evidence showed `border-radius: 21.072px 0 0` with `overflow-y: hidden`, and the inspected desktop screenshot no longer showed a square layer over the rounded corner.
- The OpenCorvus workspace mark remains an accessible Kobalte Popover trigger but renders with a transparent background and no dropdown chevron.
- New chat, search, Expert Squads, and Channel use the compact 32px source. Project rows use 28px source geometry; Mission/Chat rows use 30px; nested task rows use 28px. Browser rendering at the default desktop viewport measured approximately 24.6px, 26.3px, and 25.7px after the active UI scale was applied.
- The project folder icon and Projects heading both rendered at `x=19.3036px`. Descendant Mission/task indentation remains visible through the existing project-body and child-list sources.
- `#workLedgerPanel` now reports hidden overflow while `#workLedgerProjectsScroll` reports real `overflow-y: auto`, `clientHeight=434`, and `scrollHeight=816`. The Node browser regression proved scrolling the Projects region leaves New chat and Pinned at unchanged coordinates.
- The titlebar now exposes File, Edit, View, Run, Help. Run contains Executor, Agent Models, Expert Squads, and Permissions. Visual review caught and repaired an initial stale target: the historical `executor-chip-*` control is no longer mounted, so Run → Executor now focuses the current single `composer-model-selector-trigger`. Both Node and in-app browser checks proved the menu closes and focus lands on that trigger.
- Passed: 43 focused Overlay source tests, Overlay TypeScript, repeated Vite production builds, the Work Ledger scrollbar browser test, the full titlebar menu-order browser test, the full titlebar menubar browser suite on isolated rerun, in-app browser geometry/interaction/screenshot review, historical docs link resolution except its pre-existing fixed-timeout scratch scan, and `git diff --check`.
- At the time of this UI change, documentation health exposed unindexed July records, a formal-record dependency on a local planning draft, and two fixed-timeout repository scans. The later integrity recovery formally indexed the records, removed the draft-path dependency, and reran the checks with their supported execution budget.

## Correction — composer runtime controls

The initial restoration incorrectly substituted Agent Models, Expert Squads, and Permissions for the historical runtime-policy entries. Those settings links do not belong under Run. The composer runtime-control repair removes them from Run, keeps the real Executor focus action, and places current parallelism/unattended policy controls beside the input where they affect task submission and ongoing operation context.

## 2026-07-12 High-Zoom Workbench Correction

### Recall

| Item | Detail |
| --- | --- |
| Original requirement | Continue platformization without accepting known Overlay defects. The identity-projection visual pass exposed a high-zoom chat-header/workbench overlap and a Screenshot Browser whose card geometry did not react to the active zoom. |
| Acceptance criteria | At `zoom=1.6` and the canonical 1120px legal minimum, the conversation header and adjacent Screenshot Browser remain inside their own panel and viewport bounds with no text/control overlap. The center workbench retains the current responsive contract: open panels share available width and do not introduce horizontal workbench scrolling. Screenshot card width, row estimate, and column calculation react to the canonical settings zoom. The compact legal-minimum fixture remains visible. The separate 960px pressure probe remains a narrow-panel test, not a full-window screenshot acceptance. Fresh Node Playwright screenshots are inspected after the fix. |
| Hard constraints | No fallback, viewport gate, second panel sizing source, restored natural-layout minimum width, horizontal workbench scroller, mobile scope, Bun-launched Playwright, new worktree, or interference with the user's running Overlay. Preserve the existing center-workbench weight source and use CSS container responsiveness plus the Solid settings store. |
| Sources reread | This record; `2026-07-06-right-toolbar-responsive-panels.md`; `2026-07-10-dynamic-expert-squad-agent-identity.md`; `workspace.css`; `header.css`; `conversation.css`; `design-language.css`; `App.tsx`; `main.tsx`; `ScreenshotBrowserPanel.tsx`; `layout-tokens.ts`; `settings.ts`; `theme.ts`; the Screenshot Browser, center-workbench separator, compact stress, toolbar, window-size, workspace-surface, and architecture-guard tests; and the fresh high-zoom screenshot. |
| Whole-repository search | `rg` covered `--ui-workbench-panel-min-width`, every `center-workbench-body/view` owner, all `chat-header-main/meta/status` rules and assertions, `currentUIScale`, `settingsStore.zoom`, `applyZoom`, `ScreenshotBrowserPanel`, workbench overflow assertions, and existing `chat-workbench` container queries. The DOM has two direct header children (`main`, `meta`); status is nested inside `main`, while CSS incorrectly declares and reasserts three grid tracks. |
| Independent audit feedback | The read-only audit confirmed the screenshot overlap, the erroneous three-track header, non-shrinking launch controls, and non-reactive `currentUIScale()` memos. Its suggestion to restore the scaled panel minimum and horizontal reveal is rejected because the current `2026-07-06` architecture explicitly supersedes that old natural-layout contract and tests six panels without horizontal overflow. The accepted correction keeps flex sharing and repairs the children themselves. |

### Plan

1. Make the chat header's grid match its real two-child DOM and give both regions explicit shrink/overflow ownership.
2. Use the existing named `chat-workbench` container to collapse the editor launcher's visible label before its controls can overlap the title/status region; keep the command accessible through its existing button label and tooltip.
3. Make Screenshot Browser scale memos depend directly on the canonical reactive `settingsStore.zoom`; retain `currentUIScale()` for imperative DOM/token readers only.
4. Replace static assertions for the obsolete three-track/non-reactive contract, add high-zoom geometry assertions to the real browser fixture, rerun focused tests and typecheck, inspect fresh screenshots, then request a separate read-only review before commit and push.

The compact-stress rerun exposed an invalid fixture assertion: it required a 1,590px compact card and a later validation card to be simultaneously viewport-visible inside an 844px legal-minimum window. The card tree and zero-overflow geometry were correct. The first attempted correction was independently rejected because `scrollMarkerIntoView` searched ancestor `textContent`, silently ignored an unmaterialized target, and `assertVisible` only searched the whole document text. The green test was deceptive: its fresh screenshot still stopped inside the long Evidence card.

The accepted test design uses the real `opencorvus:conversation-card-scroll` protocol with the exact top-level card ID, requires the virtualizer handler to return true, requires the exact card and marker text node to exist, scrolls the marker's owning element, and asserts the marker `Range` is fully inside `#chatScroll`. Missing listeners, cards, markers, or geometry now fail immediately. The regenerated 1120px `07-minimum-layout.png` visibly contains `AGC-VALIDATION-FAILURE`; the earlier document-wide check is renamed `assertRendered` and no longer claims viewport visibility.

### Result and independent acceptance

- Overlay typecheck and 161 focused static/architecture assertions passed.
- Node Playwright passed Screenshot Browser high zoom, center-workbench separator, message-header toolbar, and compact stress. The Screenshot Browser run also retained its 960px narrow-panel pressure probe without horizontal grid/card escape.
- Manual review accepted the fresh 1120px high-zoom full-window image, the 960px narrow Screenshot panel image, the desktop validation image, and the corrected 1120px compact validation image. Titles, controls, count, cards, marker evidence, and composer remain distinct and unobscured.
- The independent reviewer initially rejected the deceptive compact assertion, then accepted the corrected exact-card/Range protocol after rerunning both compact and Screenshot Browser Node tests and inspecting the regenerated images. It found no remaining blocker in this batch.
