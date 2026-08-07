# Environment Popover And Right Dock Responsive Coexistence

Date: 2026-07-23
Status: Implemented
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and presentation language.
- DOM: Document Object Model, the browser's rendered element tree.
- VCS: Version Control System, the canonical repository status source.

## Recall

### User requirement

The supplied desktop screenshot shows the Right Dock tool region open while the
chat-header Environment Information control is highlighted. In that state the
Environment Popover can no longer open and is visually absent. The requested
behavior is:

1. Environment Information remains openable while the Right Dock is visible.
2. When the remaining conversation width is sufficient, the open Environment
   Popover keeps a dedicated lane and does not cover conversation content.
3. When the remaining conversation width is insufficient, the same Popover
   renders above the conversation content layer instead of being suppressed.

### Acceptance criteria

- Hovering or clicking the existing Environment toolbar button can open the one
  existing Kobalte Popover while the canonical Right Dock is open.
- Opening or closing the Right Dock does not mutate Environment Popover open
  state. Empty-home anchor teardown and explicit Environment-button dismissal
  remain unchanged.
- At or above the existing `--ui-breakpoint-lg` chat-container width, the open
  Popover reserves the existing tokenized chat clearance. The message pane and
  composer remain outside the Popover bounds.
- Below that width, the chat frame reserves no Popover clearance and the
  portaled Popover remains visible above conversation content through the
  canonical overlay layer.
- Selecting a child feature from Environment may still close Environment while
  it opens that feature in the canonical Right Dock.
- Focused source tests, Overlay typecheck/build/i18n, a Node-launched real
  browser test at wide and narrow desktop widths, screenshot inspection,
  document health, and a second diff review pass.

### Hard constraints

- Reuse the current `Popover`, `Button`, `Icon`, Right Dock store, portal,
  layout tokens, and named `chat-workbench` container.
- Do not add a second Popover, open-state store, ResizeObserver, viewport media
  query, width signal, DOM observer, positioning fallback, iframe, or hidden
  message.
- This is a desktop behavior correction. Do not add tablet/mobile deliverables.
- Do not restart, reload, close, or otherwise interfere with the operator's
  running OpenCorvus/Overlay process. Browser verification uses an isolated
  fixture launched with Node.
- Preserve unrelated working-tree changes and do not create a worktree.

### Material read before implementation

- `AGENTS.md`.
- Browser control skill.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/07-panel-reactivity.md`.
- `specs/records/2026-07/2026-07-18-environment-popover-goal-and-dock-convergence.md`.
- `specs/records/2026-07/2026-07-21-environment-popover-task-start-and-chat-clearance.md`.
- `specs/records/2026-07/2026-07-22-environment-popover-anchor-lifecycle-and-hover-open.md`.
- `packages/overlay/src/components/App.tsx`.
- `packages/overlay/src/components/TaskDirBar.tsx`.
- `packages/overlay/src/components/RightDock.tsx`.
- `packages/overlay/src/components/ui/Popover.tsx`.
- `packages/overlay/src/store/right-dock.ts`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/src/styles/surfaces/workspace.css`.
- `packages/overlay/test/task-cwd-row-layout.test.ts`.
- `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.

### Whole-repository search evidence

The pre-implementation search was saved to
`.scratch/environment-popover-right-dock-call-sites.txt` and covered every
`rightDockOpen`, `setRightDockVisible`, `openRuntimePanel`,
`closeRuntimePanel`, `projectRuntimeStatusPanel`,
`.project-runtime-status-panel`, and
`--ui-runtime-environment-chat-clearance` call point in Overlay source and
tests.

| Call point / owner | Current fact | Disposition |
| --- | --- | --- |
| `TaskDirBar.openRuntimePanel` | Refuses to open while `rightDockOpen()` is true. | Remove the Dock predicate; anchor visibility remains the only availability condition. |
| `TaskDirBar.toggleRuntimePanel` | Treats an open Right Dock as a request to close Environment. | Toggle only the existing Environment open signal. |
| `TaskDirBar` Dock effect | Closes Environment whenever canonical Dock visibility becomes true. | Delete this obsolete mutual-exclusion effect. |
| `TaskDirBar` child-feature actions | Close Environment before opening or focusing canonical Right Dock content. | Retain; this is explicit navigation from the Popover, not global Dock visibility. |
| `App` / `ChatHeaderRightDockToggle` / `store/right-dock.ts` | Own the one Dock mount and shared visibility signal. | Keep unchanged; no callback or second Dock state is needed. |
| `conversation.css` | Always applies full chat clearance whenever the portaled Environment DOM exists. | Scope the existing clearance rule to the existing 900px named chat-container breakpoint. |
| `Popover` primitive | Portals one overlay with viewport fitting and canonical overlay z-index. | Keep unchanged; below the breakpoint it naturally overlays conversation content. |
| `task-cwd-row-layout.test.ts` | Guards the now-obsolete Environment/Dock mutual exclusion and unconditional clearance. | Replace with coexistence and responsive-container assertions. |
| `task-dirbar-keyboard.test.ts` | Real browser case expects Dock opening to remove Environment and clearance. | Exercise open Dock plus Environment at narrow and wide desktop widths, assert geometry, and capture both states. |

No backend route, API contract, database model, translation key, Right Dock
width source, panel catalog, resource loader, or task runtime identity changes.

### Independent agent feedback

No independent agents were requested, so none were started. The primary agent
performed the repository-wide call-point audit.

## Root cause

The missing Popover is intentional suppression in `TaskDirBar`, not a portal
clipping or z-index defect. `openRuntimePanel` rejects every open attempt while
the Right Dock is visible, `toggleRuntimePanel` treats Dock visibility as a
close condition, and a reactive effect closes the Popover as soon as the Dock
opens. The unconditional chat-clearance rule then assumes the two surfaces can
never coexist.

The correct single-source model is for Environment and Right Dock visibility to
remain independently owned while layout derives solely from the remaining
`chat-workbench` inline size. The existing 900px container breakpoint already
marks the conversation's compact transition. Above it, the current clearance
token creates a dedicated lane. Below it, removing that clearance leaves the
same portaled Popover visible above the conversation through the existing
overlay z-index.

## Implementation plan

1. Remove only the three global Environment/Right Dock mutual-exclusion paths
   while retaining hidden-anchor teardown and explicit child-navigation closes.
2. Move the existing chat-clearance selector into the named 900px
   `chat-workbench` container contract; keep panel width, placement, portal, and
   z-index unchanged.
3. Replace focused source assertions and extend the real browser fixture to
   prove narrow overlay geometry and wide dedicated-lane geometry with the
   Right Dock open.
4. Run focused tests, Overlay typecheck/build/i18n, document health, and
   Node-launched browser verification. Inspect both screenshots at original
   resolution and correct any visual defect.
5. Perform a second diff review, commit only this task's files with the required
   `dsw-33987` prefix, fetch/reconcile the delivery branch, and push to
   `legacy-remote`.

## Validation-discovered repository defect

The required broad Overlay window-size regression exposed an already-committed
`72vw` clamp in the Expert Squad configuration dialog. That surface is a
descendant of the canonical `overlay-shell` inline-size container, and the
existing architecture test explicitly rejects raw viewport-width units outside
the root shell. The root correction replaces only `72vw` with `72cqw`; it
preserves the exact 72-percent clamp while deriving it from the legal Overlay
container. The existing window-size architecture regression is the behavioral
test for this correction. The focused Expert Squad browser case also rendered
the configuration dialog and supplied current visual evidence after the unit
change.

The full Environment browser file then exposed a stale session-conversation
fixture. Its response omitted the now-required `pendingQuestions` array, so the
strict conversation parser rejected navigation after the New Chat request had
already succeeded. The same test also passed its project selector in the
Puppeteer options position instead of as the page-function argument. The
fixture now supplies the required empty array and waits for the visible project
actions with Puppeteer's existing selector primitive. No production
conversation contract was loosened.

## Verification ledger

- `bun test packages/overlay/test/task-cwd-row-layout.test.ts
  packages/overlay/test/overlay-architecture-guards.test.ts
  packages/overlay/test/overlay-window-size-contract.test.ts
  packages/overlay/test/composer-file-loader-right-dock.test.ts`:
  147 passed, 0 failed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed with catalog hash
  `0762a4bc7c9590d2`.
- `bun run --cwd packages/overlay build`: passed; Vite transformed 2,644
  modules. The existing bundle-size advisory remained informational.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
  packages/opencorvus/test/script/document-health.test.ts`: 82 passed, 0
  failed.
- `node packages/overlay/test/browser-runner.mjs
  packages/overlay/test/browser/task-dirbar-keyboard.test.ts`: 16 passed, 0
  failed under the required Node browser runner.
- Focused Expert Squad configuration browser case: 1 passed, 0 failed.
- `bunx biome check` on the changed TypeScript and TSX sources: passed.
- Narrow visual evidence:
  `.scratch/environment-popover-right-dock-narrow-overlay.png`. At 1,280 by
  760 pixels the Right Dock and complete Environment Popover coexist; the
  Popover overlays the conversation and composer without clipping.
- Wide visual evidence:
  `.scratch/environment-popover-right-dock-wide-clearance.png`. At 1,800 by
  900 pixels the conversation and composer end before the Environment Popover,
  which occupies a dedicated lane beside the open Right Dock.
- Container-unit visual evidence:
  `.scratch/expert-squad-configuration-current.png`. The configuration dialog
  remains centered, fully visible, and unclipped after the `cqw` correction.
- Original-resolution inspection was performed on all three screenshots. A
  second source/test/spec diff review found no second visibility source,
  viewport query, compatibility path, or unrelated staged file.
