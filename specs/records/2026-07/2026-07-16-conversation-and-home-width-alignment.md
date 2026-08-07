# Conversation And Home Width Alignment

## Recall

| Item | Detail |
| --- | --- |
| User request | (1) At the supplied desktop resolution, make the bottom input box match and align with the visible conversation card width. (2) Reduce the width of the home input and the three suggestion cards. |
| Acceptance criteria | Populated desktop conversations use one Chat-owned width source for the Assistant card lane and composer; their left/right edges match at both 1600px and the supplied large-desktop geometry. The home composer, title, and three-card row remain mutually aligned and use a narrower 900px maximum on wide desktops while preserving the existing 84% compact behavior below the 1200px workbench breakpoint. Focused source tests, Node-launched browser geometry checks, production build, documentation health, and manually reviewed screenshots pass. |
| Hard constraints | Desktop-only scope; preserve the existing message lane, scrollbar gutter, empty-home state owner, real composer instance, three shared Button cards, and responsive behavior. Do not add a fallback, compatibility selector, query override, iframe, duplicate composer, local layout signal, ResizeObserver, or handwritten interaction. Do not restart or refresh the user's running OpenCorvus process. Use Node, not Bun, for Playwright. Preserve concurrent shared-worktree changes. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-b373f9f1-6fea-451b-84f6-afbf88135298.png` is 2839x1659 and shows a full-width composer extending roughly 64 image pixels beyond each edge of the populated conversation card. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/README.md`; `specs/current/architecture/{07-panel,12-overlay-card-system}.md`; prior July records for composer/dialog parity, message/composer scrollbar alignment, and empty-home ownership; `App.tsx`; `Conversation.tsx`; `base.css`; `conversation.css`; `composer.css`; `chat-bubble.css`; focused source and browser tests. |
| Whole-repository search | `rg` enumerated every `ui-chat-message-content-width`, `ui-chat-message-scroll-width`, `conversation-message-content-width`, `conversation-message-lane-width`, `chat-composer-stack`, `chat-home-composition-width`, `chat-home-compact-width`, and conversation/card browser-geometry reference. Production owners are `base.css` for global size tokens, `conversation.css` for the Chat/message/home layout, and `composer.css` for the composer stack. Regression owners are `workspace-composer-density.test.ts`, `conversation-empty-state-source.test.ts`, `overlay-architecture-guards.test.ts`, `command-palette.test.ts`, `conversation-agent-rail-scroll-browser.test.ts`, and the focused `agent-card-separation-browser.test.ts` fixture. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | After fetching `legacy-remote`, `HEAD` and `legacy-remote/work-v0.0.7beta-yr-0716` were both `01944f687`, and the pre-change push reported up to date. Unrelated concurrent CardHeader/message/style/test/spec edits appeared afterward and must remain excluded. |

## Root cause

The ordinary message lane and composer currently resolve the same global
1040px token independently in sibling layout branches. The message card reads
the derived scroll-lane geometry under `.conversation-body`, while the composer
reads the global token directly from `composer.css`. Although the current
source values match, that duplicated projection is exactly the merge/package
regression surface that allows the composer to return to the full workbench
width shown in the screenshot.

The empty home intentionally reuses the ordinary 1040px message-content
maximum. That is larger than needed for a short prompt and three launch cards
on the supplied wide desktop. Its compact branch already reduces the shared
composition to 84%, so only the wide-desktop maximum needs a dedicated
home-layout value.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `.chat` in `conversation.css` | Own `--conversation-message-content-width` and the derived lane width so the message track and sibling composer inherit one Chat-local source. |
| `.conversation-body` | Consume the Chat-owned variables; remove its duplicate declarations. |
| `.chat-composer-stack` in `composer.css` | Consume `--conversation-message-content-width` instead of reading the global token independently. |
| Empty-home composition | Add a single 900px semantic wide-home variable, shared by title, real composer, notice, and suggestion grid; retain the existing 84% compact rule. |
| Components and shared primitives | Keep `App`, `Conversation`, `ChatComposer`, and the existing Button suggestion cards unchanged. |
| Source tests | Pin Chat ownership, composer consumption, the 900px home maximum, alignment, and the compact branch without adding selector alternatives. |
| Browser tests | Measure message card/composer equality at normal and large desktop widths; measure home composer/suggestion equality and its reduced wide maximum; capture screenshots for manual review. |

## Verification plan

1. Update the focused source/browser regressions so the ownership and wide-home
   geometry are explicit.
2. Move the ordinary width projection to `.chat`, consume it from both layout
   branches, and reduce the home maximum through its existing composition
   owner.
3. Run focused tests, Overlay typecheck/build, and required documentation
   health checks.
4. Run the isolated browser fixtures through Node, inspect the target desktop
   screenshots at original resolution, and iterate if the visual result does
   not match the request.
5. Review the diff twice, stage only task-owned changes, commit with the
   `dsw-33987` prefix, and push the current branch to `legacy-remote`.

## Result

- `.chat` now owns the ordinary message-content and scroll-lane width
  projection. The message track inherits it through `.conversation-body`, and
  the sibling composer consumes the same Chat-local value instead of reading
  the global size token independently.
- The empty-home composition now uses a dedicated 900px wide-desktop maximum.
  Its title, real composer, notice, and three-card row remain on the same
  geometry owner, while the existing 84% compact branch remains intact.
- The Node-launched production browser fixture passed at 1600x760 and
  1902x1110; Assistant card, composer, and input-shell bounds matched within
  the 1.5px tolerance. The large screenshot is
  `.scratch/conversation-agent-rail-scroll-browser/composer-message-card-1902x1110.png`.
- The home fixture passed at 1440x900 and 1920x1050. On the wide viewport, the
  title, composer, and three-card row matched within one pixel and the measured
  width was 900px. The reviewed screenshot is
  `.scratch/overlay-empty-home-composer-1920x1050.png`.
- Second review exposed a component visual fixture that mounted its composer
  outside the production `.chat` owner. Its pre-correction geometry failed at
  1160px for the composer versus 1040px for the card. The fixture now reuses
  the production ownership boundary; its light/dark geometry and screenshots
  pass without adding a fallback width source.
- The same call-site audit found the standalone Button primitive fixture still
  encoded a retired inline budget separator and an accent tone for the visually
  neutral black send action. The fixture keeps its explicit screenshot inset,
  the retired separator assertion is removed, and `ChatComposer` now selects
  the existing neutral solid Button tone so its shared hover behavior is real
  rather than overridden by mismatched semantics.
