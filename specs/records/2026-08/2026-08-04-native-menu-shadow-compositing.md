# Native menu shadow compositing repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The supplied desktop screenshot marks the broad, hard-edged shadow bands around the Right Dock `+` menu. The user reports that the Browser component's ellipsis menu has the same incorrect shadow. |
| Acceptance criteria | The Right Dock add menu and Browser ellipsis menu retain one shared rounded surface, but their elevation fades naturally without a visible rectangular cutoff at the popup-window edge. Both menus remain correctly anchored, readable, interactive, and above the unchanged live Browser page. |
| Hard constraints | Repair the shared native menu presentation owner rather than either caller. Preserve the parent-owned Tauri WebviewWindow, native Browser child, menu model, actions, placement, focus, and dismissal. Do not add a second shadow source, fallback, compatibility route, gate, state machine, worktree, or User Interface (UI) automated test. Verify through real desktop interaction, screenshots, and personal visual review. Preserve the existing uncommitted native-menu toolbar layout work. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; current panel architecture; shared-native-menu, Browser-continuity, popup-convergence, workspace-corner, and native-menu-toolbar records; `native-menu.tsx`; native-menu surface service and contract; `native-menu.css`; shared popup and theme elevation tokens; installed and official Tauri 2 window-shadow documentation. |
| Whole-repository grep | Right Dock add, Browser ellipsis, Environment, and overflow callers all resolve through `openNativeMenuSurface`. One `.native-menu-card` rule owns their shadow. Its large `0 12px 32px` light-theme shadow is rendered inside a transparent WebviewWindow with only 16 scaled pixels of shell inset while the document clips overflow, so the lower blur is still materially opaque when it reaches the window boundary and is cut into a rectangle. No caller-specific shadow exists. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | Branch `work-v0.0.30beta-yr-0804` has pre-existing uncommitted native-menu toolbar and documentation changes. They are preserved as user-owned work. The shadow repair uses separate hunks and files, and only its own changes will be staged. |

## Causal chain

1. The shared native menu is a transparent, undecorated operating-system
   window whose measured size includes a 16-pixel shell inset around the card.
2. The card currently uses the large surface shadow token. In the light theme,
   that shadow extends 32 pixels with a 12-pixel downward offset.
3. The WebviewWindow and its document clip the compositor at the measured
   window bounds. The shadow is therefore still visible when it reaches the
   left, right, and especially bottom edge, where it ends abruptly as the
   rectangular bands marked in the screenshot.
4. Both reported menus share this card, so caller-specific CSS or placement
   changes would duplicate the fix and leave the actual owner wrong.
5. Tauri's native shadow option is not a suitable replacement contract here:
   official Tauri 2 documentation says an undecorated Windows window gains a
   platform-owned one-pixel white border, which would compete with the existing
   theme-aware semantic border. The existing bounded medium elevation token
   supplies the required depth inside the current transparent inset without a
   second border or a new platform-specific source.

## Implementation and verification plan

1. Change only the shared `.native-menu-card` elevation from the large surface
   shadow to the existing medium elevation token, whose blur fits inside the
   current shell inset and preserves the theme's canonical depth language.
2. Record in current panel architecture that native menu elevation must remain
   bounded by its transparent window inset, and that callers do not own
   shadows.
3. Run Overlay typecheck, localization, production build, documentation health,
   and `git diff --check`; do not add, modify, or run UI automated tests.
4. Launch the real desktop application with a live Browser page, open the Right
   Dock add menu and Browser ellipsis menu, capture both, and personally inspect
   the left/right/bottom fade, rounded boundary, anchoring, and page continuity.
5. Perform a second code and visual review, update this record with evidence,
   commit only the shadow repair with the `dsw-33987` prefix, reconcile the
   tracked git-cc branch, and push through the normal hook.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product and architecture changes complete.
- [x] Non-UI/static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and git-cc push complete.

## Acceptance evidence

- The shared card now resolves in the real light-theme popup to
  `0px 4px 12px rgba(32, 38, 40, 0.08)` plus the canonical inset highlight.
  Its card begins 16 CSS pixels inside a 16-pixel transparent shell on every
  side, so the 12-pixel external blur is already below the visible boundary
  before the operating-system window clips it.
- A real isolated Tauri desktop client loaded the complete Overlay through the
  current Vite source. Opening the Right Dock add menu produced the six canonical
  Browser, Review, Files, Screenshots, Requirements, and Goals actions in
  `.scratch/native-menu-shadow-qa/add-menu-shadow.png`. Manual inspection at
  original resolution confirmed a continuous rounded fade with no hard left,
  right, or bottom rectangle.
- Choosing Browser and opening its ellipsis menu produced the shared zoom and
  selection surface in `.scratch/native-menu-shadow-qa/browser-menu-shadow.png`.
  Manual inspection confirmed the same bounded fade, complete rounded border,
  readable segmented zoom toolbar, and unchanged spacing. The Browser menu
  measured 257.14 by 109.71 CSS pixels inside a 291 by 143 viewport, leaving the
  same 16-pixel compositor inset around it.
- Closing the Browser menu through its real trigger changed `aria-expanded`
  back to `false`, while the existing native child page remained at
  `https://www.baidu.com/`. The isolated desktop process and its managed
  sidecar were then stopped by their exact process identifiers.
- Overlay typecheck, localization validation, production Vite build, historical
  documentation links, and `git diff --check` passed. This shadow task did not
  add, modify, or run any UI automated test.
