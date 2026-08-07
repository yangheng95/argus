# Conversation Full-Height Scrollbar Containment

Date: 2026-08-03
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser layout and styling language.
- DOM: Document Object Model, the rendered element tree.
- UI: User Interface, the visible Overlay application surface.

## Recall

| Source                                                                                      | Constraint carried forward                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request 2026-08-03                                                                     | The Conversation scrollbar at the right edge must extend to the bottom, while the outer page must not scroll downward into blank space.                                                                                                                                                                       |
| User screenshot                                                                             | The native Conversation scrollbar ends above the Composer, leaving the highlighted trailing gutter without the requested full-height track. The outer surface must not acquire a second vertical range.                                                                                                       |
| `AGENTS.md`                                                                                 | Fix the root cause without a gate, fallback, custom scrollbar, or second source; do not add, modify, or run UI automation tests; inspect a real page and screenshot; commit and push to `legacy-remote`.                                                                                                            |
| `specs/records/2026-07/2026-07-28-conversation-full-height-scrollbar-composer-alignment.md` | The accepted full-height contract keeps one `#chatScroll`, measures the real Composer, and uses that height as transcript bottom clearance.                                                                                                                                                                   |
| `specs/records/2026-08/2026-08-02-conversation-scroll-owner-regression-repair.md`           | The later overlay implementation regressed pointer scrolling because the full Composer paint band participated in hit testing; ordinary message-region input must continue to reach the transcript scroll owner.                                                                                              |
| `specs/records/2026-08/2026-08-03-overlay-root-scroll-blank-space-repair.md`                | `html` is the clipped viewport boundary and fixed `body` preserves the generated shell geometry; this root containment must remain unchanged.                                                                                                                                                                 |
| Current source                                                                              | `App.tsx` already owns one sibling `#chatScroll` and `#solidChatComposer`; `conversation.css` currently shortens the scrollport above the Composer; `Conversation.tsx` already observes Composer resize but no longer projects its rendered height; `base.css` owns root clipping and native scrollbar paint. |
| Full-repository search                                                                      | Runtime owners and consumers are `App.tsx`, `Conversation.tsx`, `conversation.css`, `workspace.css`, `base.css`, and `main.tsx`. No current Overlay UI test references the affected scroll-shell/Composer selectors; historical records are evidence only.                                                    |
| Independent agent feedback                                                                  | A read-only child investigation was requested for the same bounded surface; final integration and verification remain owned by this session.                                                                                                                                                                  |

## Causal Chain

1. **Observable symptom:** the Conversation scrollbar stops at the Composer's top instead of reaching the panel bottom.
2. **Direct trigger:** `.conversation-scroll-shell` is a flex column and the non-shrinking Composer consumes real layout height after `#chatScroll`.
3. **Deeper cause:** the August bounded-scroll repair solved overlay hit testing by shortening the native scrollport, which contradicts the now explicit full-height scrollbar requirement.
4. **Outer blank-space risk:** a full-height transcript must not transfer boundary scroll input to a document range. The current clipped `html` and fixed `body` already remove that range; the transcript should additionally contain vertical overscroll at its own boundary.
5. **Root correction:** make `#chatScroll` fill the shell again, place the one real Composer in the shell's bottom layer, project its rendered height as transcript bottom clearance, and keep decorative Composer paint pointer-transparent so only real controls intercept input.

## Call-Site Disposition

| Owner / consumer                                        | Disposition                                                                                                                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/App.tsx`               | Keep the existing single scroll element followed by the single Composer mount; no DOM duplication or wrapper is required.                                              |
| `packages/overlay/src/styles/surfaces/conversation.css` | Restore full-height grid ownership, measured bottom clearance, bottom Composer positioning, pointer-transparent decorative paint, and vertical overscroll containment. |
| `packages/overlay/src/components/Conversation.tsx`      | Reuse the existing Composer `ResizeObserver` and animation-frame scheduler to project the real rendered block size and notify the existing follow controller.          |
| `packages/overlay/src/styles/cascade/base.css`          | Keep the fixed, clipped root and the sole native `#chatScroll` paint owner unchanged.                                                                                  |
| `packages/overlay/src/styles/surfaces/workspace.css`    | Keep the bounded `min-height: 0` / `overflow: hidden` ancestor chain unchanged.                                                                                        |
| `packages/overlay/src/main.tsx`                         | Keep measured native scrollbar gutter ownership unchanged.                                                                                                             |
| `specs/current/architecture/07-panel.md`                | Replace the superseded shortened-scrollport statement with the combined full-height and pointer-safe containment contract.                                             |
| Existing UI automation tests                            | None were found for the affected selectors in `packages/overlay/test`; no UI test will be added, changed, or run.                                                      |

## Acceptance

- The one native `#chatScroll` track reaches the bottom of `.conversation-scroll-shell`.
- The Composer remains fixed at the panel bottom at top, middle, and bottom transcript positions.
- At the bottom position, the final message clears the rendered Composer completely.
- Wheel input over the ordinary message region continues to move `#chatScroll`; decorative Composer paint does not create a blocking hit-test band.
- Boundary scrolling does not move `documentElement` or `body`, and no blank outer area appears.
- Empty-home composition, Environment inset projection, scrollbar gutter alignment, keyboard scrolling, and bottom-follow remain intact.
- Overlay typecheck/build and documentation health checks pass.
- A real isolated desktop page is scrolled and captured for manual visual review; no UI automation test is added, modified, or run.

## Plan

1. Commit and push this Recall and plan before implementation.
2. Restore the full-height scroll geometry with pointer-transparent paint and transcript overscroll containment.
3. Update the current architecture statement without reviving the old pointer-blocking surface.
4. Run non-UI static verification and an isolated real page, inspect screenshots, and correct any visible discrepancy.
5. Perform a second diff and visual review, record exact evidence, commit, and push to `legacy-remote`.

## Implementation

- `.conversation-scroll-shell` now overlays one full-height `#chatScroll` and
  the one bottom-positioned `#solidChatComposer` in the same bounded grid.
- `Conversation.tsx` measures the real Composer mount through its existing
  `ResizeObserver` and animation-frame scheduler, then projects that exact
  height into `--conversation-composer-block-size` as transcript bottom
  clearance while notifying the existing follow controller.
- Composer fade and canvas paint are pointer-transparent. The real Composer
  stack and existing scroll-to-bottom Button retain their own interaction
  surfaces, so decorative coverage no longer blocks ordinary transcript input.
- `#chatScroll` contains vertical overscroll at its own boundary. The existing
  clipped `html` and fixed `body` root geometry remains unchanged.

## Verification

- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `bun run --cwd packages/overlay build:vite`; only the existing
  third-party module-directive and large-chunk warnings were emitted.
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
packages/opencorvus/test/script/document-health.test.ts` — 62 tests and 1,144
  assertions passed.
- PASS: `git diff --check` before the implementation was incorporated into the
  shared branch checkpoint.
- No UI automation test was added, changed, or run.

## Real-Page Visual Review

- A headed Node Playwright browser loaded the current production Vite build at
  the supplied `2356x1701` desktop size through a same-process read-only proxy
  to the already running local backend. No existing OpenCorvus or Overlay
  process was restarted, refreshed, or stopped.
- At the transcript bottom, `#chatScroll` and `.conversation-scroll-shell`
  shared the exact rendered top (`76.5714px`) and bottom (`1701.1430px`) edges.
  The Composer bottom was `1701.1430px`, its rendered height was `153.1429px`,
  and transcript bottom padding was the matching `153.143px`.
- Upward wheel input in the ordinary message region moved `#chatScroll` from
  about `1549px` to `745px`. The element immediately above the Composer was the
  `chat-scroll session-content` owner, confirming decorative Composer paint did
  not cover that region.
- After additional downward boundary input, `documentElement.scrollTop` and
  `body.scrollTop` both remained `0`; root scroll height and viewport height
  both remained `1701px`. Computed transcript `overscroll-behavior-y` was
  `contain`.
- Original-resolution screenshots
  `.scratch/conversation-full-height-scrollbar-bottom.png` and
  `.scratch/conversation-full-height-scrollbar-middle.png` were inspected. The
  native scrollbar reaches the window bottom, the Composer remains fixed, the
  final complete message card stays above the Composer, and no outer blank band
  appears.
- The task-scoped preview service published a canonical
  `browser_preview_target` artifact. After evidence capture, its exact PID was
  stopped and port `5188` was verified to have no listening socket; the
  preview-only Task was then cancelled.

## Self Review

- The final source diff retains one transcript overflow owner, one real
  Composer, one rendered-height projection, and the existing root containment.
  It adds no custom scrollbar, guessed height, resize listener, fallback, gate,
  or second scroll state.
- A read-only child review completed against the task-owned source files and
  both screenshots. This session independently re-read the final commit diff
  and repeated the screenshot review.
- A concurrent Workspace verification checkpoint incorporated the implementation
  while this visual review was running. That already-pushed history was not
  rewritten; this record preserves the exact Conversation-specific intent and
  evidence in a separate task-owned completion commit.
