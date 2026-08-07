# Overlay Root Scroll Blank-Space Repair

Date: 2026-08-03
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser layout and styling language.
- DPI: Dots Per Inch, the operating-system display-scaling basis that changes the effective browser viewport.
- OS: Operating System, the desktop window manager that owns maximize and display scaling.
- UI: User Interface, the visible Overlay application surface.

## Task Definition

Prevent the maximized Overlay from sliding upward and exposing blank space below
the application when the user scrolls the Conversation scrollbar. Preserve the
Conversation transcript as the sole primary vertical scroller and keep the
existing minimum native window size and square-aspect contract unchanged.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| User request 2026-08-03 | In fullscreen, dragging the scrollbar can move the entire page upward and reveal blank space below; adjust the layout. |
| User screenshot | The titlebar has moved above the viewport, the sidebar and Composer terminate before the screenshot bottom, and the Conversation scrollbar remains visible at the right edge. This proves the whole document moved rather than the Composer merely gaining bottom margin. |
| `AGENTS.md` | Fix the root cause without a gate or fallback; preserve unrelated worktree changes; do not add, update, or run UI automation tests; verify UI changes in a real page with screenshots and a second visual review; commit and push to git-cc. |
| `specs/records/2026-07/2026-07-08-overlay-square-aspect-window.md` | Keep the `1120px` minimum width, `720px` minimum height, square aspect legality, and generated size-contract ownership. |
| `packages/overlay/src/styles/cascade/base.css` | `body` owns the generated minimum size and hides its own overflow, but the `html` root scroll container has no overflow contract. |
| Real-page reproduction | At a `2048x650` effective viewport, `body` remains `720px` high, `documentElement.scrollHeight` becomes `720px`, and scrolling outside the transcript moves `documentElement.scrollTop` to about `70px`; the titlebar and whole application move upward exactly like the supplied screenshot. |
| Full-repository grep | Primary relevant owners are `base.css`, `conversation.css`, `workspace.css`, `App.tsx`, and `Conversation.tsx`; the Conversation already has the canonical bounded `#chatScroll`, so the missing root-page containment is the direct fault. |
| Independent agent feedback | Not requested or used: the user did not authorize sub-agents, delegation, or parallel agent work. |

## Root Cause

`body { overflow: hidden; }` only contains the body box. The browser's root
scrolling element remains `html`, whose default overflow is scrollable. When
the effective WebView height is below the generated `720px` layout floor, the
body makes the root document taller than the viewport. Wheel or scrollbar
input can then scroll the root document in addition to the intended bounded
Conversation scroller. Because the root canvas has no Overlay material, the
translated application exposes a white area at the bottom.

## Fix Plan

1. Make `html` the explicit non-scrolling viewport boundary with clipping,
   full viewport geometry, and the canonical body background.
2. Retain the current generated body width, minimum-size, and aspect formulas;
   do not create a second viewport-height source or resize listener.
3. Build and typecheck the Overlay without running UI automation tests.
4. Reload the real Vite page, reproduce the short effective viewport, scroll,
   and manually verify through screenshots and measured geometry that only the
   Conversation scroller moves.
5. Repeat the visual check at the supplied `2048x967` fullscreen size and run a
   second source/diff review.

## Acceptance

- Root document `scrollTop` remains zero while scrolling at a viewport shorter
  than the `720px` body floor.
- The titlebar, sidebar footer, workspace, and Composer remain fixed to the
  viewport with no lower blank band.
- `#chatScroll` remains independently scrollable and retains its persistent
  native scrollbar.
- The `1120x720` native minimum size and square-aspect contract are unchanged.
- Overlay typecheck and production Vite build pass.
- Real-page screenshots at the short reproduction viewport and `2048x967`
  fullscreen are visually reviewed; no UI automation test is added or run.

## Implementation

- `base.css` now makes `html` an explicit full-viewport clipped canvas with the
  canonical Overlay background.
- `body` is fixed at the viewport origin while retaining the generated shell
  width, height, minimum-width, minimum-height, and square-aspect formulas.
  Removing the body from normal root-document flow eliminates the unintended
  page scroll range instead of intercepting wheel events or resetting scroll
  position after the fault occurs.
- The existing bounded `#chatScroll` implementation, scrollbar geometry,
  virtualizer, Composer sibling layout, and native window constraints are
  unchanged.

## Verification

- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `bun run --cwd packages/overlay build:vite`; existing third-party
  module-directive and large-chunk warnings remain non-failing.
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`.
- The first combined document-health run reported both this new record and the
  unrelated existing `2026-08-03-chat-queue-concurrency-100.md` record as
  untracked links. This is an index-state check rather than a product failure;
  the final isolated committed-tree check is performed after staging this
  record without including the unrelated queue work.
- No UI automation test was added, changed, or run.

## Visual QA

- Reproduced the fault before the fix at `2048x650`: the `720px` body floor
  made the root document scrollable, and scrolling moved the whole application
  upward by about `70px`.
- After the fix at the same short effective viewport, root scroll height equals
  the viewport, root `scrollTop` stays `0`, and the titlebar remains at `top: 0`
  after scrolling.
- At the user-supplied `2048x967` fullscreen size, manually scrolled the real
  Conversation upward and downward. `#chatScroll.scrollTop` changed from about
  `3315` to `2622` and then `3502`, while root `scrollTop` stayed `0`, the
  titlebar stayed at `top: 0`, and both the sidebar and Composer remained flush
  with the viewport bottom at about `967px`.
- Inspected both fullscreen screenshots: the persistent Conversation scrollbar
  moves normally, the titlebar and left rail remain visible, the Composer stays
  anchored, and no blank band appears below the application.

## Self Review

- Re-read the final CSS diff and confirmed the change has one owner in the base
  cascade; it does not add a resize listener, scroll-reset callback, fallback,
  gate, or second viewport-height calculation.
- Confirmed the generated `1120x720` size contract, square-aspect token, native
  window sizing, Conversation virtualizer, and Composer layout are untouched.
- Confirmed the unrelated scheduler, scheduler test, queue record, and their
  existing index additions remain outside this implementation boundary.
