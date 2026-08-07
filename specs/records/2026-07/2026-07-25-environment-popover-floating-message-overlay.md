# Environment Popover Floating Message Overlay

Date: 2026-07-25
Status: Implemented
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and presentation language.
- DOM: Document Object Model, the browser's rendered element tree.
- VCS: Version Control System, the canonical repository status source.

## Recall

### User requirement

The supplied desktop screenshot shows the Environment Information card on the
right side of the conversation. Change that card into a floating card above the
message panel instead of reserving a separate lane that squeezes message
content.

### Acceptance criteria

- The existing Environment Information Popover remains anchored to the existing
  chat-header control and continues to use the canonical Kobalte Portal.
- Opening the card never changes the message panel's inline padding or usable
  width at either compact or wide desktop conversation widths.
- The visible card overlaps the message panel through the canonical overlay
  layer, remains within the viewport, and retains its current width, styling,
  contents, disclosure, and interactions.
- Opening or closing the Right Dock remains independent from Environment
  visibility.
- Focused source tests, Overlay typecheck/build, a Node-launched real Vite
  browser fixture, geometry assertions, task-scoped screenshot review,
  documentation health, and a second diff review pass.

### Hard constraints

- Reuse the current `Popover`, `Button`, Portal, panel-width token, header
  anchor, and overlay z-index. Do not add a second card, open-state source,
  iframe, positioning fallback, viewport signal, ResizeObserver, or gate.
- Remove the obsolete dedicated-lane source completely; do not retain a
  breakpoint-specific compatibility path.
- This is a desktop-only correction. Do not add tablet or mobile scope.
- Do not restart, reload, close, or otherwise interfere with the operator's
  running OpenCorvus/Overlay process. Browser verification uses an isolated
  fixture launched with Node.
- Preserve unrelated working-tree changes and do not create a worktree.
- Commit subjects use `dsw-33987`; delivery goes to `myhexin`.

### Material read before implementation

- `AGENTS.md`.
- Browser control skill.
- Supplied screenshot.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-21-environment-popover-task-start-and-chat-clearance.md`.
- `specs/records/2026-07/2026-07-23-environment-popover-right-dock-responsive-coexistence.md`.
- `specs/records/2026-07/2026-07-25-environment-information-text-axis-alignment.md`.
- `packages/overlay/src/components/TaskDirBar.tsx`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/test/task-cwd-row-layout.test.ts`.
- `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.

### Whole-repository search evidence

Repository-wide searches covered `Environment information`,
`project-runtime-status-panel`, `body:has(.project-runtime-status-panel)`,
`--ui-runtime-environment-panel-gutter`,
`--ui-runtime-environment-chat-clearance`, `TaskDirBar`, and the Right Dock
layout owners in Overlay source, tests, and specs.

| Call point / owner                          | Current fact                                                                                                                          | Disposition                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.tsx`                            | Owns the one Kobalte Popover and portals it from the chat-header anchor.                                                              | Keep markup, state, placement, contents, and interaction unchanged.                                                                          |
| `conversation.css` panel rule               | Gives the portaled card a bounded width, height, overflow, and canonical overlay z-index.                                             | Keep unchanged.                                                                                                                              |
| `conversation.css` large-container rule     | Adds inline-end padding to `#chatContentFrame` whenever the card DOM exists, creating the visible squeeze.                            | Delete completely so the Portal overlays messages at every desktop width.                                                                    |
| `design-language.css`                       | Defines one card-width token plus gutter and composite chat-clearance tokens used only by the deleted reservation rule and its tests. | Keep the card-width token; delete the two dead reservation tokens.                                                                           |
| `task-cwd-row-layout.test.ts`               | Requires the wide-only dedicated lane and its tokens.                                                                                 | Replace with a no-reservation contract that rejects layout coupling.                                                                         |
| `task-dirbar-keyboard.test.ts`              | Proves compact overlay but expects wide message clearance and non-overlap.                                                            | Assert unchanged frame padding and message/card overlap at both widths; retain viewport and z-index checks; capture the wide floating state. |
| `RightDock.tsx`, `App.tsx`, `workspace.css` | Own the canonical tool panel and its flex width independently of the Environment Portal.                                              | Keep unchanged.                                                                                                                              |

No backend route, API contract, database model, translation key, Right Dock
width source, panel catalog, resource loader, or task identity changes.

### Independent agent feedback

None. The user did not request sub-agents or parallel audits.

## Root cause

The Environment card is already a portaled floating Popover. The perceived
space occupation comes from one later CSS rule: at a 900-pixel named
`chat-workbench` width, the actual open Popover DOM triggers a large
`padding-inline-end` on `#chatContentFrame`. That rule deliberately converts
the floating surface into a reserved conversation lane. Removing only visual
chrome or changing Popover placement would leave the squeeze intact.

The root correction is to keep the single canonical Popover and delete the
layout coupling and its now-dead composite tokens. This produces one behavior
at all desktop widths: Environment floats above the message panel, while the
Right Dock remains the only right-side surface that participates in workspace
width allocation.

## Implementation plan

1. Update the current architecture to make floating overlap the single
   Environment layout contract.
2. Remove the large-container chat-clearance rule and its unused gutter and
   clearance tokens.
3. Replace focused source and browser expectations with unchanged message-width
   and overlap assertions at compact and wide desktop widths.
4. Run focused tests, Overlay typecheck/build, document health, and the
   Node-launched browser fixture. Inspect the generated screenshot at original
   resolution and correct any remaining visual defect.
5. Perform a second diff review, commit only task-owned files with the required
   prefix, reconcile the delivery branch, and push to `myhexin`.

## Status

- [x] Baseline diagnosis, architecture review, and whole-repository call-point search.
- [x] Architecture, CSS, and regression implementation.
- [x] Vite geometry and screenshot review.
- [x] Validation and second review.
- [x] Commit and push.

## Validation evidence

- `bun test packages/overlay/test/task-cwd-row-layout.test.ts`: 7 passed,
  0 failed, including the no-reservation source contract.
- `bun run --cwd packages/overlay typecheck`: passed.
- The first complete Node-launched browser-file run built the real Vite bundle
  after transforming 7,036 modules. The Environment layout scenario passed,
  and a second Environment scenario exposed one stale 280-pixel clearance
  assertion; that call point was corrected. The same complete run also kept an
  unrelated existing Worktree error-text alignment failure visible rather than
  expanding this layout task into Worktree redesign.
- Focused post-correction browser rerun:
  `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test
--test-concurrency=1 --test-name-pattern="chat header environment panel
matches|environment hover opens directly"
packages/overlay/test/browser/task-dirbar-keyboard.test.ts`: 2 passed,
  0 failed.
- Browser geometry proved both the compact and wide card-open states retain the
  exact closed-state `#chatContentFrame` width within one CSS pixel, keep zero
  inline-end padding, overlap the message panel, remain within the viewport,
  and render above messages with a positive overlay z-index.
- Visual inspection at original resolution of
  `.scratch/environment-popover-right-dock-wide-overlay.png` and
  `.scratch/environment-popover-right-dock-narrow-overlay.png` confirmed the
  card floats above the message/Composer surface with intact border, shadow,
  content hierarchy, and independent Right Dock. No visual correction remained.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
packages/opencorvus/test/script/document-health.test.ts`: 83 passed,
  0 failed.
- `bun run --cwd packages/overlay check:i18n`: passed with catalog hash
  `0762a4bc7c9590d2`.
- `git diff --check`: passed.

Second review re-read the component owner, deleted CSS rule, deleted tokens,
focused source and browser assertions, current architecture, and both screenshots.
It confirmed that the Kobalte Popover remains the only Environment surface and
the Right Dock remains the only right-side surface that participates in
workspace width allocation. No compatibility rule, fallback, duplicate state,
or unrelated working-tree change is included.
