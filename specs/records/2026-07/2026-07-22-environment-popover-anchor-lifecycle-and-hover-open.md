# Environment Popover Anchor Lifecycle And Hover Open

## Recall

### User requirement

The supplied desktop screenshot shows the Environment Information Popover
remaining open after the Project-row **New chat** action. Once the empty Chat
home hides the chat header, the Popover moves to the far left of the window.
The user also requires the Environment toolbar button to reveal the Popover
immediately on hover.

### Acceptance criteria

1. Hovering the existing Environment toolbar button opens the existing
   Kobalte Popover without a click.
   A pointer click that enters the closed button first keeps the newly revealed
   Popover open instead of immediately toggling it closed; later explicit
   button clicks retain the established close behavior.
2. The established persistent presentation contract remains intact: pointer
   movement, outside interaction, focus movement, and Escape do not dismiss an
   open Environment Popover; the toolbar button and Right Dock remain explicit
   close paths.
3. When the canonical empty-home projection hides the chat header, the
   Environment Popover closes in the same reactive lifecycle. Its Portal cannot
   survive with a hidden/zero-geometry anchor and cannot relocate to the left
   viewport edge.
4. Creating an empty Chat through a real Project-row New Chat action results in
   `data-empty-chat-home="true"`, a hidden chat header, no Environment Popover,
   and no residual chat-clearance padding.
5. Focused source tests, Overlay TypeScript and build checks, a Node-launched
   real browser interaction test, a reviewed desktop screenshot, document
   health, and a second diff review pass.

### Hard constraints

- Keep the existing shared `Popover`, `Button`, Work Ledger Project action,
  coding-assistant session lifecycle, and `launcherHomeActive()` projection.
- Do not add a second Popover, anchor, open-state store, positioning fallback,
  DOM observer, iframe, hidden message, gate, compatibility path, or responsive
  scope.
- Do not restart, refresh, close, or reuse the operator's running
  OpenCorvus/Overlay process. Browser verification uses an isolated fixture
  launched with Node.
- Preserve the unrelated Expert Squad implementation, tests, and documentation
  changes already present in the working tree.

### Material read before implementation

- `AGENTS.md` and the Browser control skill.
- `specs/current/architecture/07-panel.md` and
  `specs/current/architecture/07-panel-reactivity.md`.
- `specs/records/2026-07/2026-07-21-environment-popover-task-start-and-chat-clearance.md`.
- `specs/records/2026-07/2026-07-18-environment-popover-goal-and-dock-convergence.md`.
- `specs/records/2026-07/2026-07-21-workspace-editor-hover-dropdown.md`.
- `packages/overlay/src/components/App.tsx`, `TaskDirBar.tsx`,
  `ProjectLedgerGroup.tsx`, and `ui/Popover.tsx`.
- `packages/overlay/src/main.tsx`, `services/coding-assistant.ts`, and
  `store/board.ts`.
- `packages/overlay/src/styles/surfaces/conversation.css` and the focused
  source/browser tests.

### Whole-repository search and call-point disposition

The pre-implementation search is recorded in
`.scratch/environment-popover-anchor-audit.txt` and covered
`ProjectRuntimeStatusPanelProps`, both Environment component exports, every
Environment trigger consumer, empty-home derivation/selectors, the Project New
Chat action, and all focused browser/source assertions.

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `main.tsx launcherHomeActive()` | Sole content-state owner for the empty Chat/Mission home. | Keep unchanged. |
| `App.tsx .chat[data-empty-chat-home]` | Projects that canonical state and hides the entire chat header with CSS. | Pass the same boolean as Environment anchor visibility; do not infer visibility from the DOM. |
| `App.tsx -> ProjectRuntimeToolbarActions` | The only Environment mount. | Keep the mount and thread the typed visibility fact. |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Owns the one controlled Kobalte Popover open signal; currently does not react when its anchor is hidden and has no hover-open handler. | Close the same signal when the header anchor is not visible; open it on trigger hover through the existing open function. |
| `ProjectLedgerGroup` / `main.createWorkLedgerProjectChat` | Own the Project-row New Chat action and canonical coding-assistant selection. | Keep production behavior unchanged; exercise it in the browser regression. |
| `conversation.css` | Hides the header for empty home; Portal content remains outside that subtree and therefore survives today. | Keep styling unchanged; lifecycle is fixed at the component ownership boundary. |
| `task-cwd-row-layout.test.ts` | Guards Environment mount, open lifecycle, and CSS clearance. | Add explicit anchor-visibility threading and hover-open assertions. |
| `task-dirbar-keyboard.test.ts` | Owns the real Environment interaction fixture but does not cross from an open Popover into Project New Chat. | Add a focused real-browser regression for hover open, Project New Chat, empty-home header hiding, Popover teardown, clearance removal, and screenshot evidence. |
| Other Environment browser tests | Inspect stable trigger/panel styling or unrelated worktree failure paths. | Keep unchanged; they consume the same single component. |

No backend route, database record, Project action implementation, CSS placement
token, Right Dock owner, translation key, or second Environment mount requires a
production change.

### Independent agent feedback

No independent agents were requested, so none were started. The main agent
completed the repository-wide call-site audit required by the project rules.

## Root cause

The Popover and its anchor do not share a complete visibility lifecycle. The
anchor lives inside `.chat-header`, while `Popover.Portal` renders the content
outside that subtree. Project New Chat selects a real but empty coding-assistant
session; `launcherHomeActive()` then becomes true and CSS hides the chat header.
The controlled `panelOpen` signal remains true, so the portaled surface survives
after its anchor becomes `display: none`. Its positioning reference consequently
has zero usable geometry, and viewport fitting places the panel at the left
edge. The observed left movement is therefore a stale-open/hidden-anchor defect,
not a sidebar or Project-row positioning defect.

## Implementation plan

1. Thread the canonical chat-header visibility fact from `App` into the single
   Environment owner and close its existing open signal when the anchor becomes
   unavailable.
2. Add direct mouse-enter opening to the existing Environment button while
   retaining its current persistent dismissal contract and Right Dock mutual
   exclusion. Record only the immediate mouse-entry origin so the click event
   generated by that same pointer entry confirms the open surface instead of
   closing it; do not add a second reactive open source.
3. Update focused source assertions and add a Node-launched real browser case
   that opens by hover, creates a Project Chat, verifies Popover teardown and
   captures the resulting empty-home desktop state.
4. Update current architecture and documentation indexes, run focused and
   document-health verification, inspect the screenshot at original resolution,
   fix any visual mismatch, then perform a second diff review.

## Verification ledger

- `bun test packages/overlay/test/task-cwd-row-layout.test.ts`: 7 passed,
  205 assertions. The focused source guard proves the single Environment mount,
  canonical `homeActive` visibility threading, derived visible-open state,
  direct mouse-enter opening, click-entry reconciliation, and hidden-anchor
  teardown.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed with the canonical panel
  hash unchanged.
- The focused Node-launched browser case `environment hover opens directly and
  Project New Chat closes the hidden-anchor Popover` passed. It closed the
  Task-start presentation, opened it through actual mouse hover, retained it
  while traversing to the Work Ledger, invoked the real Project New Chat action,
  selected the returned coding-assistant Session, and proved the final state:
  `data-empty-chat-home="true"`, hidden chat header, zero trigger client rects,
  no portaled Environment panel, and zero chat-frame inline-end padding.
- The pre-existing full Environment interaction case `chat header environment
  panel matches the compact Codex information layout` passed after the hover
  change. Its first rerun exposed that a pointer click enters the button before
  dispatching click, so the initial implementation opened on enter and closed
  immediately on click. The final single-signal implementation records only
  that immediate mouse-entry origin; the same click confirms the new surface,
  while subsequent click, Right Dock, and hidden-anchor close behavior remains
  intact.
- Both focused browser cases ran against the production Vite bundle. The build
  completed with 2,648 transformed modules; the existing large-chunk notice is
  informational.
- Visual review at original 1280x760 resolution:
  `.scratch/environment-popover-hover-open.png` shows the Environment panel
  aligned below the top-right toolbar trigger with complete content and no
  clipping; `.scratch/environment-popover-project-new-chat-anchor-closed.png`
  shows the centered empty Chat home with no left-edge Popover, no residual
  overlay, and no layout indentation. No CSS correction was needed.
- The combined source/document run produced 225 passes. Four repository-wide
  scanners exceeded their five-second per-test budget only when run concurrently;
  every one passed when rerun in isolation. The monthly tracked-record assertion
  also passed with a disposable test index containing three unrelated concurrent
  records already linked by their owners; the real staging index contains only
  this task's record and index lines.
- `git diff --cached --check`: passed.

Second review re-read the complete staged component, parent projection, focused
source/browser tests, current architecture, and this Recall. It confirmed that
`launcherHomeActive()` remains the only empty-home source, `panelOpen` remains
the only reactive open signal, every asynchronous error-reopen path now respects
anchor visibility, resource requests follow the derived visible-open state, and
no CSS positioning fallback, duplicate Popover, second store, timer, DOM
observer, or running-process intervention was introduced.
