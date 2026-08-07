# Conversation Scroll-Bottom Panel Center Alignment

Date: 2026-07-30
Status: Complete
Owner: Codex

## Glossary

- CSS: Cascading Style Sheets, the browser presentation language.
- DOM: Document Object Model, the rendered browser element tree.
- UI: User Interface, the visible application surface.

## Recall

### User requirement

The supplied desktop screenshot shows the floating scroll-to-bottom Button
moving to the right when the upper-right Environment Information panel is
open. The Button must remain horizontally centered within the conversation
dialog at every Environment panel visibility state.

### Acceptance criteria

- With the Environment Information panel closed, the Button stays on the
  conversation dialog's current horizontal center axis.
- With that panel open at the existing desktop breakpoint, the Button moves
  with the same Environment-aware start/end inset contract used by the message
  cards and Composer instead of remaining centered in the complete viewport.
- Opening and closing the panel uses the existing slow transition and does not
  introduce a second width, panel-state, or positioning source.
- Vertical placement, visibility, click behavior, bottom following, Composer
  clearance, full-height native scrollbar, and compact overlay behavior remain
  unchanged.
- The visible Button receives pointer hits through the real Solid Portal
  wrapper and still scrolls the transcript to its bottom.
- The correction is visually inspected on a real rendered page at the desktop
  delivery surface with the panel open and closed.

### Hard constraints

- Desktop-only scope; no mobile or tablet deliverable is added.
- Reuse `--conversation-message-start-inset` and
  `--conversation-message-end-inset`, which already project the current
  Environment panel clearance.
- Do not add a gate, fallback, compatibility selector, hard-coded panel width,
  duplicate panel state, custom scrollbar, iframe, query override, or UI
  automation test.
- Do not add, modify, update, or run UI automation tests. Historical records
  name two scroll-bottom UI automation files, but the current branch has
  already retired both files; no replacement test is introduced.
- Preserve the unrelated user modification in
  `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md`.
- Commit subjects use `dsw-33987`, and delivery pushes the current primary
  branch to `legacy-remote`.

### Material read before implementation

- Root `AGENTS.md`.
- `browser:control-in-app-browser` skill.
- User screenshot
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-940cdda6-a7ac-4146-b5b6-fce59e756cf6.png`,
  inspected at original resolution.
- `specs/README.md`.
- `specs/current/architecture/07-panel.md`.
- `2026-07-08-overlay-finished-message-collapse-scroll-bottom.md`.
- `2026-07-09-message-composer-scrollbar-alignment.md`.
- `2026-07-17-chat-composer-fixed-layer.md`.
- `2026-07-17-chat-composer-opaque-layer-alignment.md`.
- `2026-07-28-conversation-full-height-scrollbar-composer-alignment.md`.
- `packages/overlay/src/components/App.tsx`.
- `packages/overlay/src/components/Conversation.tsx`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/src/styles/tokens/design-language.css`.

### Whole-repository search

The pre-change search enumerated every `conversation-scroll-bottom`,
`chat.scroll_bottom`, `scrollToBottom`, `solidChatComposer`,
`conversation-environment-content-clearance`,
`conversation-message-start-inset`, and
`conversation-message-end-inset` reference across production code, tests,
current architecture, and July records.

| Owner / consumer | Disposition |
| --- | --- |
| `Conversation.tsx` | Keep the one Button, its existing portal into `#solidChatComposer`, visibility signal, label, icon, and click handler. Real-page inspection confirmed the Portal renders one wrapper between the mount and Button. |
| `conversation.css` `.conversation-body` | Keep the one Environment-aware asymmetric content-inset calculation. |
| `conversation.css` `#solidChatComposer` | Keep the three-track grid that applies those exact insets to the one Composer stack. |
| `conversation.css` `.conversation-scroll-bottom` | Replace complete-host `50%` positioning with the explicit midpoint between the inherited start/end inset edges; preserve the current vertical offset. A first real-page pass proved that absolute grid placement does not derive this static inline position, so the accepted implementation uses the exact track-midpoint expression instead. |
| `conversation.css` Button detail selectors | Match the unique portaled `data-ui` descendant below the real Solid Portal wrapper. The obsolete direct-child selector left `pointer-events: none` inherited from the fixed Composer host, so the visible control could not receive clicks. |
| `design-language.css` | Keep the canonical Environment panel width and clearance tokens; introduce no local duplicate. |
| Environment panel container rule | Keep the desktop container-query projection and compact overlay behavior unchanged. |
| Historical scroll-bottom UI tests | The two historical file paths are absent from the current branch; keep them retired and introduce no replacement test. |
| `specs/current/architecture/07-panel.md` | Record that the Button shares the same content-axis source as messages and Composer. |

No backend route, API schema, database model, task identity, message renderer,
localization key, Right Dock state, or responsive target participates in this
repair.

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration policy
forbids unsolicited sub-agents.

## Causal analysis

1. **Observable symptom:** with Environment Information open, message cards
   and the Composer shift left while the floating bottom Button remains near
   the complete conversation viewport center.
2. **Direct trigger:** `.conversation-scroll-bottom` uses
   `inset-inline-start: 50%` relative to the full-width
   `#solidChatComposer` host.
3. **Root cause:** the Button ignores the canonical asymmetric inset pair that
   already expresses the currently visible conversation content region.
   Opening the Environment panel increases only the inherited end inset, so
   the hard-coded host midpoint becomes a different axis from the dialog
   midpoint.
4. **Why the prior path did not prevent this:** the fixed-Composer work
   correctly retained the Button portal and vertical offset but assumed that
   the Composer host center and readable-content center were identical. The
   later Environment clearance deliberately made the content tracks
   asymmetric, invalidating that assumption.
5. **Related interaction finding:** the same real-page pass showed the visible
   Button did not receive pointer hits. Its detail selector assumed the Button
   was a direct Composer child, but Solid Portal renders a wrapper; therefore
   the Button inherited `pointer-events: none` from the fixed layer.
6. **Root correction:** compute the Button's inline start from the exact
   midpoint between the existing start and end inset edges. This consumes the
   same source as the dialog rather than adding panel awareness to the Button.
   Match the unique portaled Button below its wrapper so the existing
   interaction styling and click handler are actually reachable.

## Implementation plan

1. Land this Recall, causal chain, full call-site audit, and the required spec
   indexes before changing production code.
2. Correct only the Button's inline coordinate so it consumes the current
   Environment-aware layout variables.
3. Confirm the obsolete scroll-bottom UI automation files remain absent; do
   not recreate or replace them.
4. Run non-UI verification: formatting/diff checks, Overlay TypeScript and
   production build, localization, and document-health suites.
5. Start an isolated real application page through Node-based tooling, inspect
   the closed/open Environment states, and capture task-scoped screenshots for
   manual visual review.
6. Perform a second source/diff and screenshot review, record exact results,
   commit only task-owned files, reconcile the current branch, and push to
   `legacy-remote`.

## Status

- [x] Recall, root-cause chain, call-site audit, and pre-change remote
      verification recorded.
- [x] Production correction complete and obsolete UI-test paths confirmed
      absent.
- [x] Non-UI verification and real-page visual acceptance complete.
- [x] Second source/diff and screenshot review complete; commit and `legacy-remote`
      delivery are recorded by Git.

## Verification evidence

- `git diff --check` passes.
- `bun run --cwd packages/overlay typecheck` passes.
- `bun run --cwd packages/overlay check:i18n` passes with localization digest
  `6aa073ad759b98c7`.
- `bun run --cwd packages/overlay build:vite` passes after transforming 7,062
  modules; only the established third-party directive and chunk-size
  advisories remain.
- The historical links, document-health, and product-document single-source
  suites pass together with a 30-second per-test allowance: 72 pass, 0 fail.
- The historical scroll-bottom UI automation paths are absent. No UI
  automation test was added, modified, or run.
- A real OpenCorvus page was opened at a 1,554 px desktop viewport with a
  persisted long conversation. With Environment closed, the Button center was
  `769.6428833007812` and the Composer content center was
  `769.6429138183594` (absolute delta `0.000030517578125` px).
- With Environment open and the canonical 316 px clearance active, the Button
  center was `611.6428833007812` and the Composer content center was
  `611.6428985595703` (absolute delta `0.0000152587890625` px). Manual review
  of the task-scoped open/closed screenshots confirmed the Button remains
  centered above the dialog and clear of the panel.
- Pointer inspection in both states resolved the Button itself. Clicking it in
  the open-panel state moved the transcript to `2418.857177734375` of `2419`
  px (remaining delta `0.142822265625` px) and dismissed the control, proving
  the Portal-selector repair restored the intended interaction.
