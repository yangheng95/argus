# Retire Solid Changes Panel Empty State

Date: 2026-06-22
Status: Implemented

## Acronyms

- CSS: Cascading Style Sheets, the overlay styling language.
- DOM: Document Object Model, the browser element tree.
- UI: User Interface, the visible overlay surface.

## Task Definition

Remove the high-confidence dead `#solidChangesPanel > .empty-hint` CSS branch
from `empty-state.css` and keep the current file changes surface on the live
`#solidFileChangesMount` / `FileChangesPanel` path.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | Clean high-confidence dead CSS, but do not delete still-owned component paths. |
| `2026-06-05-vscode-style-activity-toolbars.md` | File changes moved to `FileChangesPanel` mounted at `#solidFileChangesMount`; old right-panel naming is retired. |
| `2026-06-18-retire-workspace-panel-residue.md` | The live diff owner is `FileChangesPanel`; stale workspace/right-panel style contracts should be removed. |
| `2026-06-19-retire-section-body-residue.md` | Empty-state CSS should target live card/cluster selectors, not obsolete direct section body selectors. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Runtime mount | `packages/overlay/src/index.html` contains `#solidFileChangesMount`; no `#solidChangesPanel` owner exists. | Keep the live mount and do not introduce a replacement ID. |
| File changes components | `main.tsx` renders `FileChangesPanel`; `FilesSection` still owns `#changesSection` for its component path. | Do not delete `FilesSection` or `#changesSection` in this round. |
| Empty-state CSS | `empty-state.css` is the only source file with `#solidChangesPanel > .empty-hint`. | Delete the retired ID selectors and keep `.empty-hint--card`, `.sidebar-list-cluster`, and `.diff-preview-empty`. |
| Tests | `overlay-architecture-guards.test.ts` asserted the old selector density. | Convert the guard to assert the retired ID stays absent while live empty-state selectors remain. |

## Root Cause

The old right-panel file changes surface was renamed and remounted, but one
container-specific empty-state selector and its guard remained. That preserved a
second style contract for an element that no longer exists, increasing CSS
selector work and hiding the actual live owner.

## Acceptance

- `empty-state.css` contains no `#solidChangesPanel` selector.
- `src/index.html` keeps `#solidFileChangesMount` as the live mount and does not
  contain `#solidChangesPanel`.
- Live empty-state selectors remain present.
- Focused overlay architecture tests pass.

## Verification

- `rg -n "solidChangesPanel|#solidChangesPanel" packages/overlay/src packages/overlay/test specs/new-arch/2026-06-22-retire-solid-changes-panel-empty-state.md`
- `bun test packages/overlay/test/overlay-architecture-guards.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- Node-owned browser screenshot:
  `.scratch/retire-solid-changes-panel-empty-state.png`, reviewed on the
  live Diff/Files empty state with `#solidFileChangesMount` present and
  `#solidChangesPanel` absent.
