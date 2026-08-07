# Project Ledger Group Toggle Button Primitive

Date: 2026-06-19

## Problem

The 2026-06-18 project ledger extraction made `ProjectLedgerGroup` the single
JSX owner for grouped Task, Mission, and Coding Assistant ledgers. The shared
component still rendered its visible collapse/expand control as a raw
`button.project-group-heading`, and `sidebar.css` owned the full button chrome
for that selector.

That means the shared component fixed markup duplication while preserving a
second button construction path.

## Recall

| Source                                         | Evidence                                                                          | Decision                                                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `2026-06-18-project-ledger-group-primitive.md` | `ProjectLedgerGroup` is the canonical grouped ledger component.                   | Keep the component boundary.                                                                    |
| `ProjectLedgerGroup.tsx`                       | Renders a raw `<button class="project-group-heading">`.                           | Replace the visible toggle with `Button`.                                                       |
| `sidebar.css`                                  | `.project-group-heading` defines appearance, layout, hover, and focus chrome.     | Move layout to `.oc-button[data-ui="project-group-toggle"]`; let `Button` own primitive chrome. |
| `mission.css`                                  | Mission density overrides target `.mission-project-group .project-group-heading`. | Retarget to the same Button data hook.                                                          |
| `project-ledger-group-browser.test.ts`         | Browser test focuses and keyboard-toggles `.project-group-heading`.               | Preserve keyboard behavior through the Button node and retarget selectors.                      |

## Fix

- Import `Button` in `ProjectLedgerGroup`.
- Render the group toggle as `<Button variant="ghost" size="mini"
tone="neutral" data-ui="project-group-toggle">`.
- Retire `.project-group-heading` from production CSS and source.
- Retarget Mission density overrides and browser/static tests to
  `[data-ui="project-group-toggle"]`.

## Acceptance

- No production source or stylesheet contains `.project-group-heading`.
- Task, Mission, and Coding Assistant grouped ledgers still expose one
  keyboard-focusable toggle per project group.
- The toggle node renders with `.oc-button`, `data-variant`, `data-size`, and
  `data-tone` from the shared `Button` primitive.
- Existing project ledger browser coverage still verifies visible screenshots
  and Enter/Space collapse behavior.

## Verification

- `bun test packages/overlay/test/task-list-buttons-primitive.test.ts packages/overlay/test/sidebar-list-heading-single-source.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/mission-session-source.test.ts packages/overlay/test/coding-assistant-panel.test.ts packages/overlay/test/mission-launcher-component.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/project-ledger-group-browser.test.ts`
- Visual review:
  - `.scratch/project-ledger-group-tasks.png`
  - `.scratch/project-ledger-group-mission.png`
  - `.scratch/project-ledger-group-coding-assistant.png`
