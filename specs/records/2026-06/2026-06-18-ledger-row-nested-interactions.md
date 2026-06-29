# Ledger Row Nested Interaction Cleanup

Date: 2026-06-18
Status: implemented

## Problem

Independent GUI review found Mission and Coding Assistant ledger rows expose the
outer row as `role="button"` with `tabindex=0` while rendering a real
`.task-row-main` button and row action buttons inside. That creates an invalid
nested interactive structure for assistive tech and keyboard users.

## Evidence Sweep

| Sweep                                                                                                                                            | Evidence                                                                                                                                        | Decision                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------- | ------------- | --------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `rg -n 'MissionList                                                                                                                              | CodingAssistantSessionList                                                                                                                      | task-row-main                                                                                                                   | mission-row-main | coding-assistant-row-main | role="button" | data-ui="mission-row" | data-ui="coding-assistant-row"' packages/overlay/src packages/overlay/test specs/new-arch specs` | `MissionList.tsx` and `CodingAssistantSessionList.tsx` are the only ledger rows with `data-ui` row hooks plus outer `role="button"` and inner `.task-row-main` buttons. | Remove outer interactive semantics from these rows; keep the row hooks for tests and styling. |
| `TaskList.tsx::TaskRow`                                                                                                                          | The canonical task ledger keeps the outer `.task-row-mini` as a non-semantic container and makes `.task-row-main` the primary selection button. | Match this pattern instead of inventing a new ledger row primitive in this small fix.                                           |
| `specs/records/2026-06/2026-06-12-mission-new-launcher-stale-session-fix.md` and `specs/records/2026-06/2026-06-13-coding-assistant-restore-selection-race.md` | Row selection remains the explicit path into Mission/Assistant center content.                                                                  | Preserve row selection behavior on the main button and existing mouse double-click behavior; do not alter load/restore sources. |

## Constraints

- Do not change mission/session API calls.
- Keep `data-ui="mission-row"` and `data-ui="coding-assistant-row"` as row
  hooks for existing browser tests.
- Only `.mission-row-main` and `.coding-assistant-row-main` should be keyboard
  activatable row selection controls.
- Row action buttons must remain siblings, not descendants of another button.

## Tests

- Add source guards that forbid `role="button"` / `tabindex={0}` on these row
  containers and require the main buttons to own selection.
- Add a browser fixture checking Tab order and activation isolation for Mission
  and Coding Assistant rows.

## Verification

- `bun test packages/overlay/test/ledger-row-interactions.test.ts packages/overlay/test/mission-session-source.test.ts packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/coding-assistant-panel.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-reporter=dot --test-timeout=60000 packages/overlay/test/browser/ledger-row-interactions.test.ts`
- Screenshot reviewed: `.scratch/ledger-row-interactions.png`
