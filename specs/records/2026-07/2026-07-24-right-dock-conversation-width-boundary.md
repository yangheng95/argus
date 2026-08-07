# Right Dock And Conversation Width Boundary

Date: 2026-07-24
Status: Implemented
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and presentation language.
- DOM: Document Object Model, the browser's rendered element tree.
- ARIA: Accessible Rich Internet Applications, the accessibility metadata used by the Dock resizer.

## Recall

### User requirement

Set a maximum width for the component on the right so it cannot squeeze the
middle conversation into an abnormal layout.

### Acceptance criteria

- The canonical Right Dock cannot consume space reserved by the existing
  conversation minimum-width contract.
- Restored persisted widths, pointer resizing, keyboard resizing, window
  resizing, and direct CSS layout all obey the same maximum boundary.
- The Dock remains resizable, keeps its current minimum and absolute maximum,
  and retains its existing tab/content behavior.
- The middle conversation remains at least the canonical chat minimum wherever
  the supported desktop shell has enough room for both minimums.
- Focused source tests, Overlay typecheck/build, a Node-launched real browser
  geometry test, screenshot inspection, documentation health, and a second
  diff review pass.

### Hard constraints

- Reuse `--ui-chat-min-width`, `--ui-workbench-panel-min-width`, the existing
  Dock maximum token, and the current persisted `rightDockWidth`; do not create
  a second width store, fallback, viewport listener, or component-local magic
  number.
- Keep the current desktop-only delivery boundary. Do not add tablet/mobile
  behavior.
- Do not restart, reload, close, or otherwise interfere with the operator's
  running OpenCorvus/Overlay process. Browser verification uses an isolated
  Node-launched page.
- Preserve unrelated working-tree changes and do not create a worktree.

### Material read before implementation

- `AGENTS.md`.
- Browser control skill.
- `specs/current/architecture/05-config.md`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-06/2026-06-23-overlay-panel-legal-size-contract.md`.
- `specs/records/2026-07/2026-07-23-environment-popover-right-dock-responsive-coexistence.md`.
- `packages/overlay/src/components/App.tsx`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/store/settings.ts`.
- `packages/overlay/src/utils/layout-tokens.ts`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/src/styles/surfaces/workspace.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- Focused Right Dock, pane, window-size, workspace, and browser tests.

### Whole-repository search evidence

The repository-wide search covered every `rightDockWidth`,
`--right-dock-width`, `--ui-right-dock-max-width`,
`--ui-right-dock-remaining-min-width`, `--ui-chat-min-width`,
`renderRightDockWidth`, and `clampRightDockWidth` reference.

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `design-language.css` | Defines a 960-pixel absolute Dock maximum and an independent 320-pixel remaining-content minimum even though the canonical chat minimum is 500 pixels. | Retire the duplicate 320-pixel source and derive Dock clearance from `--ui-chat-min-width`. |
| `workspace.css .right-dock` | Applies the persisted width as both flex basis and width, but has no CSS maximum. | Add a structural maximum derived from the existing Dock maximum and conversation clearance tokens. |
| `main.tsx#clampRightDockWidth` | Correctly handles pointer and keyboard adjustments, but reads the duplicate 320-pixel clearance. | Reuse the canonical chat minimum. |
| `main.tsx#renderRightDockWidth` | Writes a valid persisted width directly, so initial restore and window resize bypass the clamp. | Render the canonical clamped value without creating another persisted source. |
| `main.tsx#applyWindowResize` | Re-renders the persisted width after window changes. | Retain; the corrected renderer makes this path converge. |
| `store/settings.ts` and native settings | Persist one nullable positive width. | Keep unchanged. |
| `overlay-window-size-contract.test.ts` | Pins the obsolete 320-pixel token and runtime token read. | Replace with canonical chat-clearance and CSS-boundary assertions. |
| `workspace-surface-consistency.test.ts` | Guards shrink behavior but not Dock maximum geometry. | Add the single-source CSS boundary regression. |
| Right Dock browser tests | Exercise tabs and ad hoc widths, but do not prove an oversized persisted width cannot squeeze Chat. | Add focused real geometry and screenshot evidence. |

No backend route, database schema, API contract, localization key, panel
catalog, or Environment Popover width changes are required.

### Independent agent feedback

No independent agents were requested, so none were started. The primary agent
performed the repository-wide call-point audit.

## Root cause

The visible failure has two cooperating causes. First, the Right Dock has a
maximum token only in the JavaScript resize clamp; its CSS width and persisted
width renderer bypass that contract. Second, the clamp protects an independent
320-pixel remainder instead of the existing 500-pixel conversation minimum.
An old or user-expanded Dock width can therefore be restored after startup or a
window change and the middle conversation is legally shrunk below its own
layout boundary.

The root correction is one width model: the canonical chat minimum supplies
the remaining-content boundary, while both CSS and every runtime render consume
the same absolute Dock maximum and remaining-width contract.

## Implementation plan

1. Replace the duplicate remaining-width token with the existing
   `--ui-chat-min-width` source and add the derived CSS maximum to the Dock.
2. Clamp persisted values inside the existing renderer so startup and window
   resize cannot bypass pointer/keyboard behavior.
3. Update focused source tests and add a Node-launched browser case that injects
   an oversized persisted width, verifies Dock/Chat geometry, exercises window
   resize, and captures the delivery surface.
4. Run focused tests, Overlay typecheck/build, historical-link and document
   health checks, inspect the screenshot at original resolution, and perform a
   second diff review.
5. Confirm concurrent working-tree blockers separately without folding them
   into this task's commit, run hooks without bypassing them, commit with the
   required `dsw-33987` prefix, fetch/reconcile the delivery branch, and push
   to `legacy-remote`.

## Verification ledger

- Focused width-contract and workspace-source tests: 14 passed, 0 failed, 205
  assertions.
- Wider affected Overlay source-test set: 51 passed, 0 failed, 692 assertions.
- Overlay typecheck passed.
- Overlay production build passed across 4,952 modules; the existing chunk-size
  advisory remains non-blocking.
- The Node-launched browser suite
  `workspace-surface-continuity-browser.test.ts` passed both cases. The new
  case sets the Dock width to 2,000 pixels in a 1,120 by 900 desktop fixture
  and proves the 500-pixel Conversation minimum, one-pixel separator, Dock
  maximum, and zero workspace overflow.
- Screenshot
  `packages/overlay/.scratch/right-dock-conversation-width-boundary/oversized-width-clamped.png`
  was inspected at original resolution. Conversation renders at 500 pixels and
  the Dock at approximately 339 pixels, with the message wrapping normally and
  no clipped or overlapping content.
- Historical-document links and document-health checks passed: 82 tests, 0
  failed, 1,367 assertions.
- The final diff review confirms one persisted width source, one conversation
  minimum source, no fallback or viewport listener, and no OpenCorvus/Overlay
  process intervention.
