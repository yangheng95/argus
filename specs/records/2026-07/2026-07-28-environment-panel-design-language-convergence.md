# Environment Panel Design-Language Convergence

Date: 2026-07-28
Status: In progress
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.
- VCS: Version Control System, the canonical repository status source.
- DOM: Document Object Model, the rendered browser element tree.

## Recall

### User requirement

- The supplied Environment panel looks like several unrelated systems placed
  together. Converge it on one design language and visual style.

### Acceptance criteria

- Keep the existing single Environment surface and every canonical action,
  count, disclosure, task resource, Tool, Source, and Subagent data source.
- Preserve the semantic green/red additions and deletions. Decorative chrome,
  typography, spacing, icon geometry, row geometry, right-side metadata, and
  interaction feedback must otherwise read as one system.
- Keep exactly two structural tiers: one primary Environment title and one
  shared compact category-title recipe for Subagents, Task, Requirements,
  Architecture, Workspace, Tools, and Sources.
- Every category title uses the same font size, weight, color, row height, left
  axis, and quiet interaction treatment. Direct launchers and disclosures use
  the same trailing glyph column instead of mixing adjacent and far-edge
  indicators.
- All retained functional icons use the shared 16 pixel Icon primitive and one
  neutral leading-icon color. The redundant target icon before the Goals
  launcher is removed; individual Goal state icons remain because they encode
  canonical status.
- Disclosure direction follows one semantic rule: collapsed points right and
  expanded points down. Direct navigation also points right. The unrelated
  `Open in` control retains its existing styling and behavior.
- Every fact, count, Goal, Worktree, Tool, Source, and Subagent row retains the
  existing content type tier and icon/text axes. Passive hover must not leak a
  one-off rounded selection plate into only one classification.
- Every sibling region divider reads from one panel-owned color token and uses
  the same one-pixel thickness and six-pixel block inset.
- Verify with focused source tests, Overlay typecheck, a Node-launched isolated
  Vite page, real browser geometry, and an original-resolution screenshot
  review. Desktop is the only visual target.

### Hard constraints

- Preserve every unrelated staged, unstaged, and untracked change in the shared
  main worktree. Do not reset, restore, stash, create another worktree, or
  broadly stage files.
- Do not restart, refresh, close, or otherwise interfere with the operator's
  running OpenCorvus or Overlay processes.
- Reuse the existing Kobalte HoverCard, Section, Button, Icon, TaskProgressBar,
  and shared Overlay tokens. Do not introduce a second renderer, local state
  copy, fallback, compatibility branch, gate, or state machine.
- Do not delete canonical capabilities to simplify the screenshot.
- New delivery commits use the `dsw-33987` prefix and push to `legacy-remote`.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control Skill.
- Supplied screenshot
  `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-8b729307-0cc7-4416-a287-3c51bc7f0abd.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-26-environment-menu-subagents-and-radius-refinement.md`.
- Current `packages/overlay/src/components/TaskDirBar.tsx`.
- Current `packages/overlay/src/components/TaskProgressBar.tsx`.
- Current `packages/overlay/src/styles/surfaces/conversation.css`.
- Current focused Environment source and browser tests.

### Whole-repository search

The pre-change search enumerated `ProjectRuntimeStatusPanel`, every
`project-runtime-category-*` launcher, the Environment, Subagent, Task, Goal,
Worktree, Tool, and Source row selectors, all current architecture references,
and every focused source/browser assertion.

| Owner / call point | Current evidence | Disposition |
| --- | --- | --- |
| `TaskDirBar.ProjectRuntimeStatusPanel` | The sole renderer already composes one primary header, sibling regions, Section disclosures, direct Button launchers, and canonical content rows. | Preserve composition and behavior; add no renderer or data source. |
| `conversation.css` Environment block | The same surface mixes 42, 36, 28, and 24 pixel rows; Section titles override the menu tier with the primary title tier; direct links and disclosures place indicators differently; generic Button chrome can leak a rounded hover plate. | Define one primary title tier, one 32 pixel category tier, and existing compact content tiers. Normalize indicator columns and explicitly own transparent category chrome. |
| `TaskProgressBar` | Goals is the canonical Task child and already exposes the shared fold control and summary. | Preserve the component and align its header to the content-row geometry. |
| `task-cwd-row-layout.test.ts` | Guards CSS ownership, axes, disclosure geometry, and complete capability composition. | Update exact unified category geometry and chrome contracts. |
| `task-dirbar-keyboard.test.ts` | Runs the real Vite fixture, measures every visible row, and captures the Environment screenshot. | Replace mixed category expectations with one shared tier and assert no classification-only background wash. |
| `specs/current/architecture/07-panel.md` | Still specifies mixed 15/13 pixel category sizes and adjacent disclosure indicators. | Replace that contract with the two-tier system and one trailing indicator axis. |

No server route, API schema, database model, VCS behavior, board projection,
task-scoped preview target, Subagent session projection, or Right Dock identity
changes.

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration
boundary forbids unrequested Subagents.

## Root cause

The panel is already one component and one data flow, but its presentation
contract is not one system. The primary title tier leaks into some Section
classification titles while direct classification Buttons remain on the menu
tier. Category indicators are sometimes adjacent to the label and sometimes
right aligned. Content rows use several intentional densities, but category
rows do not establish a stable shared rhythm above them. Finally, direct
classification Buttons can inherit generic rounded Button feedback that the
Section headings explicitly suppress. The screenshot therefore makes one
surface look assembled from unrelated menus even though the data ownership is
already canonical.

## Implementation plan

1. Keep the primary Environment header at the existing title tier.
2. Converge all classification labels on one 13 pixel, regular, muted, 32 pixel
   title row with one far-edge 16 pixel indicator column.
3. Keep semantic content rows compact and preserve their canonical information,
   but normalize font metrics, retained leading-icon geometry/color, divider
   tokens, and classification hover/focus chrome. Remove the redundant Goals
   launcher icon without removing per-Goal status icons.
4. Update current architecture and exact source/browser assertions.
5. Run focused tests and Overlay typecheck, then launch the isolated Vite
   fixture with Node, inspect the real screenshot, correct any remaining visual
   inconsistency, and repeat.
6. Perform a second diff and screenshot review, commit only task-owned changes,
   fetch/reconcile the main delivery branch, and push to `legacy-remote`.

## Status

- [x] Baseline screenshot diagnosis, architecture read, and whole-repository search.
- [x] Architecture, CSS, and regression implementation.
- [x] Isolated Vite geometry and screenshot acceptance.
- [x] Second review, commit, and push.

## Verification evidence

- Focused source contracts:
  `bun test packages/overlay/test/task-progress-collapse.test.ts
  packages/overlay/test/task-cwd-row-layout.test.ts` — 13 passed, zero failed.
- Overlay TypeScript:
  `bun run --cwd packages/overlay typecheck` — passed.
- Isolated real browser:
  `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test
  --test-name-pattern='environment hover is transient, click toggles pin, and
  Project New Chat never presents it'
  test/browser/task-dirbar-keyboard.test.ts` — passed under Node against the
  real Vite page.
- Original-resolution screenshot:
  `.scratch/environment-click-pinned-open.png` — visually accepted with the
  existing `Open in` control unchanged, one 15 pixel primary title, one 13
  pixel classification/content typography system, shared 16 pixel neutral
  icons, consistent region dividers, 32/28 pixel category/content rhythm, no
  Goals launcher icon, expanded disclosures pointing down, and direct
  navigation pointing right.
