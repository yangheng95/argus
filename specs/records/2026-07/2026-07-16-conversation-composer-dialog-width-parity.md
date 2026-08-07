# Conversation Composer And Dialog Width Parity

## Recall

| Item | Detail |
| --- | --- |
| User request | Ensure the bottom input box has the same width as the conversation dialog shown in the supplied desktop screenshot. |
| Acceptance criteria | In an ordinary populated conversation, the outer composer stack and `chat-content-frame` share the same left and right bounds; the input shell remains `width: 100%` of that stack; the empty-home composition retains its existing centered message-width contract; focused source tests, a Node-launched browser geometry check, typecheck/build, documentation health, and manually reviewed desktop screenshot pass. |
| Hard constraints | Desktop-only scope; preserve the existing conversation, composer, scrollbar, and empty-home owners; do not add a fallback, compatibility path, local signal, query override, iframe, duplicate composer, or handwritten interaction; do not disturb unrelated dirty-worktree edits or the user's running OpenCorvus process; browser verification uses the existing isolated fixture and Node launcher. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-cc3d31bc-7ee4-4b58-8fbc-5b726128bfe4.png` shows the populated conversation frame spanning the workbench while the composer remains visibly inset on both sides. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/README.md`; July records for message/composer scrollbar alignment, empty-home layout, and Settings/search/composer visual convergence; `App.tsx`; `ChatComposer.tsx`; `base.css`; `workspace.css`; `conversation.css`; `composer.css`; focused static and browser tests. |
| Whole-repository search | `rg` enumerated every `chat-composer-stack`, `chat-content-frame`, `chat-message-pane`, `conversation-message-content-width`, `ui-chat-message-content-width`, `chat-home-composition-width`, `chat-composer-max-width`, and `width: min(...76%)` reference. Production width owners are `workspace.css` for the full conversation frame, `composer.css` for the ordinary composer stack, and the more-specific empty-home rule in `conversation.css`. Regression owners are `workspace-composer-density.test.ts`, `overlay-architecture-guards.test.ts`, and `conversation-agent-rail-scroll-browser.test.ts`. No other production caller defines the ordinary composer width. |
| Independent agent feedback | None. The user did not request sub-agents; repository policy keeps this tightly coupled layout repair single-agent. |
| Git baseline | After fetching legacy remote, `HEAD` `84cc83693` equals `origin/work-v0.0.6beta-yr-0716`. Existing dirty Overlay, Expert Squad, test, and spec changes are preserved and excluded from this task's staged delivery. |

## Root cause

The conversation frame and composer are sibling surfaces under `.chat`. The
conversation frame already fills the available width through `width: 100%`, but
`.chat-composer-stack` independently applies `width: min(..., 76%)` and a
`1100px`-derived maximum. That historical message-lane constraint makes the
composer visibly narrower even though its inner `.chat-input` correctly fills
its own stack. The empty-home screen intentionally applies a more-specific
message-width rule and is a separate layout contract.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `workspace.css` `.chat-content-frame` | Keep as the canonical full-width conversation dialog boundary. |
| `composer.css` `.chat-composer-stack` | Replace the independent 76%/maximum-width cap with `width: 100%` and `max-width: 100%`. |
| `conversation.css` empty-home override | Keep the more-specific centered `--chat-home-composition-width` projection unchanged. |
| Static tests | Replace assertions that preserve the retired 76% cap with ordinary-dialog parity and empty-home isolation assertions. |
| Browser fixture | Measure `.chat-content-frame`, `.chat-composer-stack`, and `.chat-input`; require matching frame/stack edges and a full-width input shell, then capture the current desktop delivery screenshot. |

## Verification plan

1. Add failing source and browser geometry assertions for the requested equality.
2. Replace the ordinary stack cap at its single CSS owner.
3. Run focused Bun tests, Overlay typecheck and production build, and documentation health checks.
4. Run the existing isolated Playwright fixture through Node, inspect its screenshot at original resolution, and correct any visual mismatch.
5. Review the exact diff twice, stage only task-owned hunks, commit with the `dsw-33987` prefix, and push the current branch to legacy remote.

## Result

- Removed the ordinary composer's independent `76%`/`1100px` width cap. The
  stack and its `.chat-input` shell now fill the same full-width boundary as
  `.chat-content-frame`; the more-specific empty-home width override remains
  unchanged.
- Added source-level regression coverage in the Composer density and Overlay
  architecture suites, plus real browser geometry assertions for frame/stack
  and stack/input edge equality.
- The Node-launched isolated browser fixture passed and produced
  `.scratch/conversation-agent-rail-scroll-browser/chat-section-ambient-dark.png`.
  Original-resolution review confirms equal left/right bounds without overflow,
  clipping, or toolbar displacement.
- Focused tests passed for Composer density, empty-home ownership, Agent Rail,
  and the Composer-specific architecture guard. Overlay TypeScript checking and
  the production Vite build passed; the existing large-chunk advisory remains
  informational.
- The full architecture-guard file still reports six failures owned by other
  concurrent dirty-worktree changes (terminal module/style registration,
  Settings search ownership, brand guide, focused-popup token indirection, and
  Agent bubble styling). The documentation-health aggregate likewise sees
  other untracked July records linked by the concurrently edited monthly index.
  These files and failures were not changed or staged by this delivery.

## Follow-up correction: message-card width and borderless hover actions

### Recall

| Item | Detail |
| --- | --- |
| User requests | (1) Make the bottom input box match the visible Assistant message card's left and right edges in `C:/Users/10132/AppData/Local/Temp/codex-clipboard-1131b050-942b-4103-b9fc-c15662dc34f3.png`. (2) Remove the outer background frame shown around the Assistant card's hover actions in `C:/Users/10132/AppData/Local/Temp/codex-clipboard-9eb07004-e03c-4adc-addb-04fbb204dbe6.png`. |
| Acceptance criteria | In a populated desktop conversation, `.chat-composer-stack` and the full-width Assistant `.chat-bubble` share the same centered message-content bounds; `.chat-input` fills that stack; the empty-home composer contract remains unchanged. On Agent-card hover/focus, `.chat-bubble__hover-actions` becomes operable without container padding, border, fill, radius, or shadow; existing icon actions, tooltips, click behavior, and keyboard focus remain intact. |
| Hard constraints | Desktop-only scope; reuse the canonical `--ui-chat-message-content-width`, `ChatBubble`, `CardHeaderChrome`, shared `Button`, and existing Node-started browser fixtures; no fallback, compatibility selector, alternate toolbar, query override, iframe, or running-process restart; preserve and exclude unrelated dirty-worktree edits. |
| Sources read | `AGENTS.md`; Browser control skill; this record; `2026-07-15-agent-card-time-and-action-chrome.md`; `2026-07-15-agent-message-card-reference-surface.md`; `App.tsx`; `ChatComposer.tsx`; `ChatBubble.tsx`; `base.css`; `workspace.css`; `conversation.css`; `composer.css`; `chat-bubble.css`; focused unit and browser tests; relevant commit history and line blame. |
| Whole-repository search | `rg` enumerated every `chat-composer-stack`, `chat-content-frame`, `ui-chat-message-content-width`, `conversation-message-content-width`, `conversation-card-inline-size`, `chat-home-composition-width`, and `chat-bubble__hover-actions` reference. The populated Assistant card receives its width through the centered message lane and `--ui-chat-message-content-width`; the ordinary composer width is owned only by `composer.css`, with a more-specific empty-home override in `conversation.css`. The hover-action frame is owned only by `chat-bubble.css`; `ChatBubble.tsx` and `CardHeaderChrome` own behavior and remain unchanged. Regression owners are `workspace-composer-density.test.ts`, `overlay-architecture-guards.test.ts`, `conversation-agent-rail-scroll-browser.test.ts`, `chat-bubble.test.ts`, and `chat-bubble-disclosure-button-browser.test.ts`. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Current branch `work-v0.0.6beta-yr-0716` is at pushed legacy remote commit `9f670edb9`. Existing staged/unstaged Overlay, Expert Squad, test, and spec edits are unrelated and will not be overwritten or included. |

### Corrected causal chain

The earlier width change treated `.chat-content-frame` as the requested
"conversation card" and expanded `.chat-composer-stack` to `100%`. The supplied
screenshot instead identifies the full-width Assistant bubble inside the
centered message-content lane. That bubble is exactly bounded by
`--ui-chat-message-content-width`, while the composer currently spans the full
frame, so both edges diverge.

The hover screenshot is caused by `.chat-bubble__hover-actions` itself. Commit
`f15641eaf` established the intended transparent, borderless, shadowless action
rail, but later commit `b719a5a30` reintroduced the old capsule padding, border,
fill, radius, and shadow and rewrote the source test to require them. The icon
buttons already use transparent ghost-button hover/focus styling, so the root
repair is to remove the regressed container chrome and restore the behavioral
test contract.

### Call-site disposition

| Surface | Decision |
| --- | --- |
| `composer.css` `.chat-composer-stack` | Reuse `--ui-chat-message-content-width` as the populated desktop maximum and center it; keep `.chat-input` at `100%`. |
| `conversation.css` empty-home override | Keep the existing, more-specific `--chat-home-composition-width` projection unchanged. |
| `workspace.css` `.chat-content-frame` | Keep the full workbench boundary; it is not the message-card width owner. |
| `chat-bubble.css` `.chat-bubble__hover-actions` | Remove container padding/border/radius/fill/shadow; retain opacity, pointer-events, transition, layout, and child button rules. |
| Component behavior | Keep `ChatBubble.tsx`, `CardHeaderChrome`, tooltips, actions, and keyboard behavior unchanged. |
| Focused tests | Replace the retired full-frame composer assertion with message-content/card parity, restore the borderless hover-container source contract, and measure both behaviors in existing real browser fixtures. |

### Verification plan

1. Update source and browser regression assertions so the current incorrect geometry and hover capsule fail.
2. Correct the two canonical CSS owners without adding selectors or alternate paths.
3. Run focused Bun tests, Overlay typecheck/build, and documentation health checks.
4. Run the existing browser fixtures through Node, inspect the populated conversation and Agent hover screenshots at original resolution, and correct any mismatch.
5. Review the scoped diff twice, stage only task-owned files/hunks, commit with the `dsw-33987` prefix, and push the current branch to `legacy-remote`.

### Follow-up result

- The populated composer now uses the canonical message-content width and its
  input shell fills that width. The Node-launched component fixture measured
  the Assistant card, composer stack, and input shell at matching left/right
  bounds within one pixel in both themes; the refreshed light and dark region
  screenshots were manually inspected.
- Agent hover actions retain their reveal, pointer, tooltip, and keyboard-focus
  behavior while the container computes to zero padding/border/radius,
  transparent fill, and no shadow. The refreshed light and dark hover
  screenshots were manually inspected.
- Focused Overlay tests passed (29/29), the combined browser fixture passed
  (1/1), Overlay typecheck/build and i18n checks passed, and historical/product
  documentation checks passed. The broader conversation-agent-rail fixture is
  independently flaky before target geometry at its task-selection wait; the
  passing focused real-browser fixture owns the final geometry evidence.
