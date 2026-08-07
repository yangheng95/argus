# Native menu and Environment HoverCard typography convergence

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The supplied screenshots show the Environment branch popup, the Environment `Local` child popup, the Right Dock add/tab dropdowns, and the Browser ellipsis popup with visibly inconsistent typography. Make their font and line height match the Environment HoverCard. |
| Acceptance criteria | All five parent-owned native-menu caller paths load the same bundled Geist and Noto Sans Simplified Chinese (SC) variable fonts as the main Overlay. Ordinary labels, Browser zoom heading/percentage, and compact branch/local rows use the Environment HoverCard's compact-row font size and tight line height. Existing icons, grouping, dimensions, placement, Browser-overlap behavior, actions, and dismissal remain intact. |
| Hard constraints | Keep `native-menu.tsx` plus `native-menu.css` as the single presentation owner; do not add caller-specific overrides, a second popup renderer, fallback fonts, a gate, a state machine, a worktree, or UI automation. Start a real page, interact with every affected surface, capture screenshots, and personally review the result. Playwright, if needed for interaction, must run with Node rather than Bun. |
| Supplied evidence | Three screenshots were inspected: the Environment panel with its long branch popup, the Right Dock add menu, and the Browser zoom/element-selection popup. The branch/right-dock/browser popup text visibly differs from the Environment HoverCard typography beside it. |
| Sources read | Root `AGENTS.md`; Browser control skill; `2026-08-04-shared-native-styled-menu-surface.md`; `2026-08-03-git-branch-menu-viewport-scroll.md`; `2026-08-05-native-menu-typography-icon-restoration.md`; `main.tsx`; `native-menu.tsx`; `native-menu.html`; `native-menu.css`; `design-language.css`; `conversation.css`; native-menu service/contract; `TaskDirBar.tsx`; `RightDock.tsx`; `BrowserPreviewPanel.tsx`; font dependency/license declarations. |
| Whole-repository grep | The main Overlay imports Geist, Noto Sans SC, and JetBrains Mono before rendering. The independent native-menu entry imports none of them, although its CSS asks for Geist/Noto, so the WebView falls through to a host font. All requested popups share this entry. The Environment HoverCard establishes `--ui-font-compact-row` with `--ui-line-height-tight`; native menus instead use `--ui-font-control`, and compact-list rows override line height to `1.2`. |
| Existing test audit | `packages/overlay/test/font-family-assets.test.ts` reads frontend source files and asserts font import strings. It is a prohibited UI/source-string automation test under the current repository policy. Because this task inspected that exact path, it must be deleted and must not be run; it has no dedicated fixture, baseline, runner, or configuration. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.31beta-yr-0805` was clean after fetch and had zero divergence from `legacy-remote/work-v0.0.31beta-yr-0805`. The pushed pre-change checkpoint is `4fd282c182` (`dsw-33987 checkpoint native menu typography repair`). |

## Causal chain

1. The Environment HoverCard renders inside the main Overlay document, where
   `main.tsx` loads the packaged Geist and Noto Sans SC font faces.
2. Browser-crossing child menus render in the independent `native-menu.tsx`
   Vite entry. It uses the same family tokens but never registers the packaged
   font faces, so the WebView resolves another host font.
3. The same native stylesheet selects the 14-pixel control tier and gives
   compact lists a separate `1.2` line height, while the adjacent Environment
   HoverCard uses the 13-pixel compact-row tier and shared tight `1.35` line
   height.
4. Since every reported popup consumes this single native document, repairing
   its font loading and typography tokens fixes the complete surface without
   per-caller rules.

## Implementation and verification plan

1. Load the bundled proportional variable fonts in the independent native-menu
   entry before application imports, mirroring the main Overlay entry's font
   registration boundary.
2. Replace native-menu control-tier and compact-list line-height overrides with
   the Environment HoverCard's existing compact-row and tight-line-height
   tokens at the shared native-menu stylesheet.
3. Delete the inspected prohibited frontend source-string UI test without
   replacing it with another UI test.
4. Run only allowed checks: Overlay typecheck, production Vite build,
   localization, historical-document links, documentation health, and
   `git diff --check`. Do not run Overlay UI tests.
5. Start an isolated real desktop page, inspect Environment Local/branch, Right
   Dock add/overflow, and Browser ellipsis menus, capture screenshots, and
   personally review font family, size, line height, clipping, and retained
   interaction behavior. Iterate if visual evidence disagrees.
6. Re-read this Recall, review the final diff and screenshots a second time,
   record evidence, commit with the `dsw-33987` prefix, reconcile the tracked
   legacy remote branch, and push to `legacy-remote` through normal hooks.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Shared native-menu typography repair complete.
- [x] Prohibited inspected UI test removed.
- [x] Allowed static checks complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Final commit and legacy remote push complete.

## Verification evidence

- `bun run typecheck`, `bun run check:i18n`, and `bun run build:vite`
  completed successfully in `packages/overlay`. The production build emitted
  the native-menu entry together with the packaged Geist and Noto Sans
  Simplified Chinese (SC) variable-font assets.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  completed with two passing tests, `bun run docs:check` completed all 312
  documentation operations across 24 groups, and `git diff --check` passed.
  No User Interface (UI) automation was run.
- An isolated real Tauri desktop application was driven through Node and
  Playwright. The Right Dock add menu exercised the ordinary-list layout and
  the Browser ellipsis menu exercised the toolbar layout. Current computed
  typography on both was the shared `"Geist Variable", "Noto Sans SC
  Variable"` stack at 13 pixels with a 17.55-pixel line box. Both screenshots
  were personally reviewed: Chinese and Latin glyphs were visually coherent,
  rows retained their intended density, the zoom control remained centered,
  and no label or icon clipped.
- Environment Local and branch menus route through that same native-menu
  document. Source review confirmed they add only the compact-list density
  marker; the former compact-list `1.2` line-height override is gone, so these
  callers now inherit the same 13-pixel compact-row size and 1.35 tight line
  height verified in the real native WebView. No caller-specific typography
  remains.
- The final diff was reviewed a second time against the HoverCard token source.
  Concurrent work in the shared workspace was left untouched and excluded from
  this task's delivery boundary.
