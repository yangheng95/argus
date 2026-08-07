# Composer Mention Menu Adaptive Height

Date: 2026-08-03

Status: implemented and visually verified

## Recall

| Item                    | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement        | In the initialization dialog, typing `@` opens a command/reference menu whose upper content is obscured. Make the popup adapt to the available space.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Acceptance criteria     | The complete menu shell stays inside the visible initialization surface; when the full catalog is taller than the available space, the existing Listbox is the only vertical scroller; the same menu remains correctly anchored above the Composer in ordinary conversations; resizing the window or changing Composer geometry recomputes the available height; a real isolated Overlay page is opened, `@` is typed on the initialization home surface, and a fresh screenshot is manually inspected.                                                                            |
| Hard constraints        | Keep the native textarea, visible mention query, grouped Kobalte Listbox, and current catalog as the single interaction/data path. Do not add a Portal, fallback placement, second menu, fixed home-only height, route gate, or state machine. Do not add, modify, update, or run User Interface (UI) automated tests. Preserve concurrent work, do not restart the running OpenCorvus/Overlay, commit only task-owned changes with the `dsw-33987` prefix, and push to `legacy-remote`.                                                                                                 |
| Sources read            | User screenshot; `AGENTS.md`; `CLAUDE.md`; `specs/current/architecture/12-overlay-card-system.md`; prior Composer mention and reference records; `ComposerMentionMenu.tsx`; `ChatComposer.tsx`; `Conversation.tsx`; `App.tsx`; `composer.css`; `conversation.css`; shared animation-frame and Kobalte primitive usage.                                                                                                                                                                                                                                                             |
| Whole-repository search | `ComposerMentionMenu` has one implementation and one production call site in `ChatComposer`. Its selectors occur only in `composer.css`. `ChatComposer` has one application mount in `main.tsx`; the same instance serves initialization and active conversations. `.chat-home-composition` is the initialization-only positioned container and owns `overflow: hidden`. No test references `ComposerMentionMenu`, `composer-mention-menu`, or `solidChatComposer` in the affected menu surface. Existing pure mention-service tests do not assert rendering and remain untouched. |
| Independent review      | A bounded read-only child review completed but did not project review text into this parent session, so no implementation claim relies on it. The required Claude Code review was attempted with read-only tools and bounded budget; CLI version `2.1.147` returned `loggedIn: false`, changed no files, and cannot provide review evidence until external authentication exists.                                                                                                                                                                                                  |

## Causal chain

1. `ComposerMentionMenu` is absolutely positioned above `.chat-textarea-wrap`.
2. Its grouped Listbox allows up to `328px * --ui-scale` regardless of the anchor's actual distance from the top visible boundary.
3. On the initialization home surface, `.chat-home-composition` vertically centers the prompt, Composer, and suggestions while clipping overflow.
4. Catalog size, window height, UI scale, and Composer growth can therefore make the menu taller than the space between the textarea and that clipping boundary.
5. The parent correctly clips the home composition, but the menu never converts the available geometry into its own Listbox maximum height, so upper rows are obscured instead of becoming reachable through the existing scroll owner.

## Design

Keep the current in-place autocomplete and Kobalte Listbox. When the menu mounts,
measure the fixed bottom edge produced by its existing `bottom: calc(100% + ...)`
anchor and the highest relevant top boundary: viewport top plus every vertically
clipping ancestor. Subtract the non-scrolling menu chrome and expose the remaining
Listbox height through one menu-local Cascading Style Sheets (CSS) custom property.

Use the existing animation-frame scheduler to coalesce geometry reads. A
`ResizeObserver` watches the anchor and menu chrome, while capture-phase scroll and
window resize events cover movement of clipping ancestors and the viewport. The
Listbox retains its current visual maximum but shrinks below it when necessary;
`overflow-y: auto` remains its single scrolling owner.

## Implementation inventory

| Surface                                                   | Decision                                                                                                                             |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/components/ComposerMentionMenu.tsx` | Measure viewport/clipping-ancestor geometry on mount and relevant layout changes, then publish one adaptive Listbox-height variable. |
| `packages/overlay/src/styles/surfaces/composer.css`       | Combine the current catalog-height cap with the measured available height; keep the Listbox as the only scroller.                    |
| `packages/overlay/src/components/ChatComposer.tsx`        | Preserve the sole production call site and textarea/menu interaction unchanged.                                                      |
| `packages/overlay/src/styles/surfaces/conversation.css`   | Preserve initialization clipping; it is a legitimate composition boundary, not the sizing owner to remove.                           |
| UI tests                                                  | None directly cover the touched menu surface. Add, modify, update, and run none.                                                     |

## Verification plan

1. Run Overlay typecheck, production Vite build, internationalization integrity,
   documentation-health checks, and `git diff --check`; do not run UI tests.
2. Start a separate Vite Overlay service without touching the user's existing
   process.
3. Use Node-driven browser interaction to type `@` on the initialization home
   Composer, inspect menu/ancestor geometry and the Listbox scroll range, and
   capture a fresh screenshot.
4. Repeat at a constrained desktop window height and after resizing, then manually
   inspect that the full shell remains visible and rows are reachable through the
   Listbox.
5. Re-read the final diff and screenshot, commit only task-owned paths, fetch the
   current legacy remote branch, integrate if required, push to `legacy-remote`, and verify
   local/remote convergence.

## Progress

- [x] Reproduce the visual symptom from the supplied screenshot and identify the single menu/call site.
- [x] Complete the root-cause, clipping-owner, call-site, test-surface, and prior-design investigation.
- [x] Implement adaptive geometry and Listbox sizing.
- [x] Complete static and real-page visual verification.
- [ ] Complete second review, commit, push, and remote convergence.

## Visual acceptance evidence

The production Vite build was served in an isolated preview process and opened
with Node-driven Playwright in a visible Chromium window. The real Project-scoped
`New chat` action opened the initialization home surface; the browser then focused
the canonical textarea and typed `@`. No UI test, fixture, baseline, or automated
visual assertion was created or run.

- `specs/artifacts/2026-08-03-composer-mention-menu-adaptive-height.png`
  shows the 1208×852 user-reference viewport. The menu top measured `36.31px`
  against the initialization boundary at `36px`; its `297px` Listbox exposes an
  `847px` scroll range while keeping the complete panel visible.
- `specs/artifacts/2026-08-03-composer-mention-menu-adaptive-height-compact.png`
  shows the same live menu after reducing the desktop viewport height to `640px`.
  The Listbox recomputed from `297px` to `226px`, the menu top remained at
  `36.04px`, and the complete upper border, heading, first category, and first
  option stayed visible.

Both screenshots were manually inspected. The menu remains attached to the
Composer, the input and suggestion geometry is unchanged, and only the existing
Listbox receives the constrained scroll range. The isolated preview process was
terminated by its recorded process ID and ports `4174` and `5174` have no listener.

## Verification evidence

- Overlay TypeScript typecheck passed.
- Overlay production Vite build passed after transforming 7,061 modules.
- Overlay internationalization integrity passed.
- Historical specification links passed: 2/2.
- Document health passed: 60/60 with 1,142 expectations.
- `git diff --check` passed.
- No UI automated test was added, modified, updated, or run.
