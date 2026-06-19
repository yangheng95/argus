# Task Row Children Toggle Button Primitive

## Context

Independent GUI review found the task tree child-toggle control still rendered
as a raw `<button class="task-row-children-toggle">` while neighbouring task row
actions already use the shared `Button` primitive.

The control is an expand/collapse operation button. Keeping a private button
class in `sidebar.css` duplicates hover, focus, size, border, background, and
status chrome outside `.oc-button`.

Browser verification found a second root cause in the same surface: task tree
rows were rendered from fresh flattened entry objects, so Solid keyed row DOM by
transient object identity. Expanding a parent remounted the focused row, which
let Enter expand the tree but dropped focus before Space could collapse it.

## Recall

| Source | Constraint |
| --- | --- |
| `packages/overlay/src/components/ui/Button.tsx` | `.oc-button` owns button semantics, size, variant, tone, and focus-visible ring. |
| `packages/overlay/test/task-list-buttons-primitive.test.ts` | Task row operation buttons already route through the shared `Button` primitive. |
| `packages/overlay/test/browser/task-list-tree-click.test.ts` | The task tree is active UI and already has a real browser regression flow for row selection/click trapping. |
| `packages/overlay/src/components/taskTree.ts` | `flattenGroup` returns new entry objects on each expand-state change; render identity must not depend on those objects. |
| `specs/retired-reference-ledger.md` | The old task tree external note is historical; current behavior must be pinned by local tests and source contracts. |

## Fix

- Replace the raw child-toggle button in `TaskList.tsx` with
  `<Button variant="ghost" size="mini" tone="neutral">`.
- Add `data-ui="task-row-children-toggle"` as the stable owner selector.
- Preserve `aria-expanded`, `draggable={false}`, `onMouseDown` stop propagation,
  `onDragStart` prevention, and click stop propagation.
- Replace `.task-row-children-toggle` CSS with
  `.oc-button[data-ui="task-row-children-toggle"]` variable/geometry rules.
- Keep only task-tree-specific state visuals in `sidebar.css`: active pulse,
  failed danger tone, count typography, and pointer-event placement.
- Key rendered rows by stable task id through `taskTreeEntryKey` and
  `entriesByKey`, so parent/sibling DOM and row-local state survive subtree
  expansion even though flattened entry objects are recreated.

## Tests

- Static source tests now reject `class="task-row-children-toggle"` and require
  `data-ui="task-row-children-toggle"` on the Button primitive.
- Right-column tests inspect the `.oc-button[data-ui="task-row-children-toggle"]`
  rule instead of the retired private class.
- Browser task tree test verifies the toggle is `.oc-button`, supports
  keyboard Enter/Space expand/collapse, keeps `aria-expanded` synchronized, and
  captures focus screenshot evidence.
- Static TaskList integration tests reject rendering rows directly from
  `props.entries` transient objects and require stable task-id keys.

## Acceptance

- Child toggles render as `.oc-button`.
- Private `.task-row-children-toggle` CSS no longer exists.
- Existing drag/click isolation behavior remains intact.
- Browser evidence confirms focus-visible rendering, focus retention across
  expand/collapse, and keyboard toggling.
