# Native menu toolbar layout repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The first supplied desktop screenshot shows the Browser menu's zoom controls overlapping the visible `Preview zoom` heading. The user asked to adjust the layout so button backgrounds no longer cover text, then supplied a second reference with a single-row left label and a rounded `minus | percentage | plus` segmented control. |
| Acceptance criteria | Match the reference's compact single-row information hierarchy: the complete zoom heading remains readable on the left; zoom out, current percentage, and zoom in share a bordered rounded segmented control on the right; hover/focus paint stays inside that control and never crosses the heading; the selection row remains separated and readable. |
| Hard constraints | Preserve the shared parent-owned native styled menu window and the unchanged live Browser WebView. Fix the shared toolbar layout at its presentation owner without changing Browser navigation, zoom behavior, menu actions, placement, or lease ownership. Do not add or run User Interface (UI) automated tests. Verify through a real desktop page, interaction, screenshots, and personal visual review. Do not create a worktree, fallback, compatibility route, gate, or second menu renderer. |
| Sources read | Root `AGENTS.md`; Browser control skill; both supplied screenshots, including `codex-clipboard-f2a80f7b-5949-4d9f-a1d1-f3665d9cb6de.png`; `2026-08-04-shared-native-styled-menu-surface.md`; `2026-08-04-browser-menu-live-surface-continuity.md`; current panel architecture; `BrowserPreviewPanel.tsx`; `native-menu.tsx`; native-menu surface contract/service; `native-menu.css`; recent native-menu Git history. |
| Whole-repository grep | `BrowserPreviewPanel.tsx` supplies one `toolbar` group with a visible heading and three zoom items. `native-menu.css` fixes the standard card at 208 scaled pixels, gives the toolbar heading `flex: 1 1 auto; min-width: 0; white-space: nowrap`, and keeps the three-item group non-shrinking. The heading therefore shrinks below its rendered text width while its un-clipped glyphs continue under the first button. No second Browser zoom-menu renderer exists. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | `work-v0.0.30beta-yr-0804` was clean at `c385f8d8bb`, synchronized with `legacy-remote/work-v0.0.30beta-yr-0804` (`0 0` divergence), and fetched before implementation. |

## Causal chain

1. The menu card has a fixed shared width, while the zoom toolbar currently
   places its heading and all three controls on one flex row.
2. The control group is non-shrinking, so the heading receives the remaining
   width even when that width is smaller than the localized label.
3. `white-space: nowrap` keeps the label on one line, but the heading has no
   overflow boundary. The excess glyphs therefore paint beneath the first
   button and become obscured by its hover/focus background.
4. Truncating or shrinking the heading would hide useful menu structure. The
   toolbar needs enough single-row width plus a bounded segmented-control
   surface that owns every action background and separator.

## Implementation and verification plan

1. Give shared native-menu cards containing a `toolbar` the compact width
   required by the reference's single-row label-and-control arrangement.
2. Render the three actions as one rounded segmented control. Keep the two icon
   actions at the canonical square density, center the percentage between
   separators, and clip all hover/focus paint at the control boundary. Preserve
   current tokens, actions, focus order, and menu placement.
3. Update current panel architecture to record the toolbar geometry and retain
   the parent-owned native menu as the only Browser-crossing popup surface.
4. Run Overlay typecheck/build, localization and documentation health checks,
   plus `git diff --check`. Do not run UI automated tests.
5. Launch a real desktop Browser page, open the menu, hover/focus the zoom
   controls, capture and personally review screenshots, correct any remaining
   visual issue, and repeat the review.
6. Record evidence here, commit with the `dsw-33987` prefix, fetch/reconcile the
   tracked legacy remote branch, and push through the normal hook.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Non-UI/static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and legacy remote push complete.

## Real-page visual evidence

- Launched the current debug Tauri desktop client against the current Vite
  source with an isolated `OPENCORVUS_HOME` and WebView2 data directory. The
  real Browser child navigated to `https://www.baidu.com/`, and its visible
  `More browser actions` button opened the parent-owned native menu window.
- At Windows 175% display scale and `en-US`, the complete `Preview zoom`
  heading measured 100.86 CSS pixels wide. The segmented control began 8 CSS
  pixels after the heading and measured 123.14 CSS pixels wide; the hovered
  zoom-out segment remained within the control from x=138 to x=170 while its
  theme hover background resolved to `rgb(240, 240, 240)`.
- Personal review of
  `.scratch/native-menu-layout-qa/browser-menu-segmented-final.png` confirms
  the reference-aligned single-row hierarchy, centered percentage, visible
  separators, rounded clipping, and readable lower selection action. The
  screenshot is task evidence only, not a baseline or User Interface (UI)
  automated test.

## Verification

- `bun run typecheck` in `packages/overlay`: passed in 26.5 seconds.
- `bun run check:i18n` in `packages/overlay`: passed with catalog hash
  `ca3dd2196dd8b3e9`.
- `bun run build:vite` in `packages/overlay`: passed; Vite transformed 7,073
  modules and completed the production build in 1 minute 34 seconds.
- The first documentation-health run completed 69 positive contracts and
  exposed two concurrently authored August record links whose files were not
  yet tracked. A verification-only Git index represented those two owners'
  intended tracked records without changing the shared working index; the rerun
  passed all 70 contracts with 1,188 expectations and zero failures.
- `git diff --check` passed for the five task-owned delivery files.
- No UI automated test was added, modified, or run.

## Delivery

Implementation commit `fe76947728` was pushed to
`legacy-remote/work-v0.0.30beta-yr-0804`. The pre-push hook passed Software
Development Kit (SDK) imports, Artificial Intelligence (AI) runtime validation,
all scoped package typechecks, route inventory, generated documentation,
Overlay internationalization, and secret scanning. The task-owned commit
contains only the native-menu toolbar primitive and its four documentation
owners; concurrent Browser context-menu and native-menu elevation work remains
outside this delivery.
