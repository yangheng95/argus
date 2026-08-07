# Composer Mention Keyboard Scroll

## Recall

### User requirement

- When the Composer reference picker is navigated with Arrow Up or Arrow Down,
  the scrollable list must follow the selected option so the active content
  never disappears outside the visible popup.

### Acceptance criteria

- Repeated Arrow Down navigation crosses the popup's lower visible boundary and
  keeps the selected reference visible.
- Repeated Arrow Up navigation crosses the popup's upper visible boundary and
  keeps the selected reference visible.
- Existing wraparound, pointer highlighting, Enter/Tab selection, Escape close,
  exact directive insertion, and textarea focus behavior remain unchanged.
- Overlay typecheck/build and document health checks pass.
- A real page is opened, the picker is driven with the keyboard, screenshots are
  inspected after lower- and upper-boundary navigation, and the selected option
  is visibly inside the list viewport.
- No UI automated test is added, changed, updated, or run.

### Hard constraints

- Root `AGENTS.md` applies.
- Keep the Kobalte-backed `Listbox` as the interaction primitive and
  `ChatComposer` as the single keyboard-navigation owner.
- Do not introduce a second selection source, a route gate, fallback behavior, a
  state machine, or a repeatable UI assertion/screenshot baseline.
- Playwright/browser interaction is started through Node.js, never Bun.
- Commit subjects begin with `dsw-33987`; push the completed current delivery
  branch to `legacy-remote`.

### Hard-disk sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-27-chat-explicit-skill-mention.md`
- `specs/records/2026-07/2026-07-29-code-work-composer-and-grouped-references.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ComposerMentionMenu.tsx`
- `packages/overlay/src/components/ui/Listbox.tsx`
- `packages/overlay/src/styles/surfaces/composer.css`
- Kobalte's installed `listbox-root.tsx` and `listbox-item.tsx`
- The user-provided screenshot

### Whole-repository search result

Repository-wide searches covered `ComposerMentionMenu`, all `ListboxRoot`
callers, `ArrowDown`, `ArrowUp`, `scrollIntoView`, `scrollTop`, and every
Composer mention selector/class.

| Owner / call site | Finding | Disposition |
| --- | --- | --- |
| `ChatComposer.tsx` | The textarea owns Arrow Up/Down, computes the next enabled option, and updates `highlightedMentionKey`. It intentionally retains focus so typing and exact directive insertion continue naturally. | Preserve this single selection and keyboard owner. |
| `ComposerMentionMenu.tsx` | The controlled `selectedKey` is projected into Kobalte's selected value, but the Listbox itself never receives the textarea's keyboard event. The selected row therefore changes without invoking Kobalte's focused-key scroll path. | Observe the existing selected key after rendering and reveal its real Listbox item with nearest-edge scrolling. |
| `ui/Listbox.tsx` and installed Kobalte Listbox | The shared primitive already owns semantics, selection, pointer behavior, and native keyboard scrolling when it receives keyboard events. Virtualized `scrollToItem` is not applicable because this short grouped list is not virtualized. | Keep the primitive unchanged; do not add a parallel Listbox abstraction. |
| `composer.css` | `.composer-mention-listbox` is the only mention scroll container (`overflow-y: auto` with bounded height). | No styling change is required. |
| Other `ListboxRoot` callers | Model selector and file changes use their own focus/keyboard paths and do not consume Composer's externally controlled selected key. | Preserve unchanged. |
| Existing `scrollIntoView` callers | Selected sub-agent tabs and focused Goal/config surfaces already use nearest-edge reveal after render. | Follow the established selected-element reveal pattern locally in the mention component. |
| Overlay UI tests | Historical tests cover mention rendering/interaction, but the current independent UI-test prohibition forbids adding, changing, updating, or running them. | Leave them untouched; use real-page interaction and inspected screenshots only. |

### Independent-agent feedback

- No sub-agent was requested or used.

### Git baseline

- Branch: `work-v0.0.24beta-yr-0729`.
- Starting commit: `9c6d917dc8`.
- Before implementation, `HEAD` matched
  `legacy-remote/work-v0.0.24beta-yr-0729`, the worktree was clean, and the pre-push
  hook completed successfully.

## Root cause

The observable symptom is that the selected row changes while the scroll
position remains fixed. The direct trigger is the textarea intercepting Arrow
Up/Down and updating a controlled selection without sending the event to the
Listbox. Kobalte correctly scrolls its own focused key during native Listbox
keyboard navigation, but no Listbox focused-key transition occurs in this
architecture. The deeper ownership mismatch is therefore between
textarea-owned keyboard navigation and Listbox-owned automatic focus scrolling,
not a missing scrollbar or incorrect overflow style.

## Implementation plan

1. Add a render-synchronized selected-option reveal inside
   `ComposerMentionMenu`, using the actual Listbox item and nearest-edge
   scrolling while preserving the textarea as keyboard owner.
2. Run non-UI static verification only: Overlay typecheck/build,
   internationalization, document health, and `git diff --check`.
3. Start a real isolated page, navigate beyond both visible boundaries with
   Arrow keys, inspect screenshots, and correct any visual or focus regression.
4. Perform a second source/diff review, record evidence here, commit, push to
   `legacy-remote`, and verify zero remote divergence.

## Progress

- [x] Reproduce from the supplied screenshot and trace the causal chain.
- [x] Inventory all call sites and read the prior design records.
- [x] Implement selected-option reveal.
- [x] Complete static verification and the available real-page visual checks.
- [x] Complete the source/diff second review.
- [ ] Obtain a post-sticky-padding screenshot after the browser navigation
      policy allows the local page to be loaded again.
- [x] Commit, push, and verify remote divergence.

## Verification

- Overlay TypeScript typecheck passed.
- Overlay production Vite build passed after both the behavior and sticky
  heading corrections.
- Overlay internationalization check passed.
- Historical document health: 22 passed, 0 failed.
- `git diff --check` passed.
- No UI automated test was added, changed, updated, or run.
- A real Node-started Vite page connected to the real OpenCorvus server on port
  7878 and loaded the real project reference catalog. After eleven Arrow Down
  presses, `skill-installer` was selected, `scrollTop` was `272`, and its bottom
  edge matched the list viewport bottom; the inspected screenshot showed the
  complete selected row.
- After eight Arrow Up presses, `research-report` was selected and the list
  scrolled back to `170.857`. The inspected screenshot exposed that the sticky
  Skill heading covered the selected row's label when nearest-edge scrolling
  aligned it with the raw viewport top.
- The follow-up correction makes the existing sticky heading height a shared
  CSS custom property and applies it as the list's
  `scroll-padding-block-start`, so the same browser-native
  `scrollIntoView({ block: "nearest" })` path reserves the heading space.
- Final visual acceptance is not complete: immediately after this correction,
  the in-app browser rejected the local page reload under its URL security
  policy and also blocked further inspection of that tab. The browser session,
  temporary viewport, Vite process, and OpenCorvus server were cleaned up; no
  alternate browser-control path was used to bypass the policy. The unresolved
  requirement is the post-correction screenshot proving the upward-selected
  label is no longer obscured.
- Implementation commit `5bd2020b33` passed the full pre-push hook and was
  pushed to `legacy-remote/work-v0.0.24beta-yr-0729`; the immediate post-push
  divergence check was `0 0`.
