# Project Ledger Group Disclosure Controls

## Context

Independent accessibility review found that `ProjectLedgerGroup` exposes
`aria-expanded` on the shared project ledger toggle, but the toggle does not
identify the body region it controls. Task, Mission, and Coding Assistant
ledgers all reuse this primitive, so the missing relationship is systemic.

## Recall

| Source | Constraint |
| --- | --- |
| `2026-06-18-project-ledger-group-primitive.md` | `ProjectLedgerGroup` is the single grouped-ledger JSX owner for Task, Mission, and Coding Assistant. |
| `2026-06-19-project-ledger-group-toggle-button-primitive.md` | The toggle must remain the shared `Button` primitive with `data-ui="project-group-toggle"`. |
| `MemoryPanel.tsx` detail toggle | Existing pattern uses `aria-controls` only while the controlled detail element is mounted. |
| `project-ledger-group-browser.test.ts` | Browser coverage already verifies all three ledgers and captures screenshots. |

## Evidence

| File | Finding | Decision |
| --- | --- | --- |
| `ProjectLedgerGroup.tsx` | Toggle has `aria-expanded`, but no `aria-controls`; `.project-group-body` has no `id`. | Add one stable body id in the primitive and connect it from the toggle while expanded. |
| `TaskList.tsx`, `MissionList.tsx`, `CodingAssistantSessionList.tsx` | All three ledgers call the same primitive. | Do not touch call sites. |
| `project-directory.ts` | Existing `projectDirectoryKey()` is the directory identity source, but raw paths are not DOM id-safe. | Reuse it as input, then sanitize locally for an element id. |

## Implementation

- Add a local `projectLedgerGroupBodyElementID()` helper.
- Prefix the id with `props.dataUi` when present, otherwise the task ledger
  namespace, so the same directory can appear in multiple ledgers without
  duplicate DOM ids.
- Add `aria-controls={props.collapsed ? undefined : bodyElementID()}` to the
  shared toggle.
- Add `id={bodyElementID()}` to `.project-group-body`.

## Acceptance

- Static tests require `aria-controls` and `id` in `ProjectLedgerGroup`.
- Browser test verifies Task, Mission, and Coding Assistant expanded toggles
  point at an existing `.project-group-body` element.
- Collapsed behavior remains unchanged: body is unmounted and
  `aria-expanded="false"`.
