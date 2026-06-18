# Project Ledger Group Primitive

Date: 2026-06-18

UI means User Interface. CSS means Cascading Style Sheets. ARIA means
Accessible Rich Internet Applications.

## Problem

Task, Mission, and Coding Assistant ledgers all render project-directory
groups with the same visible grammar, but each component owns its own section
JSX, heading button, collapsed-state map, folder icon, count, chevron, and body
wrapper.

The shared `.project-group*` CSS reduces styling drift, but the component
contract is still a triple source. Any future ARIA, focus, count-label, or icon
fix can land in one ledger and miss the other two.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-01-mission-panel-mission-list.md` | Mission rows moved to neutral ledger naming and away from task-row CSS, but project grouping was not extracted. |
| `2026-06-11-coding-assistant-session-history.md` | Coding Assistant sessions should reuse mature ledger grammar rather than invent a separate task-like surface. |
| `sidebar.css` | `.project-group*` is already the visual single source for grouped project ledgers. |
| McClintock explorer report, 2026-06-18 | Identified three live JSX implementations and recommended a `ProjectLedgerGroup` primitive. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "project-group-heading|project-group-icon|project-group-count|project-group-chevron|project-group-body" packages/overlay/src/components packages/overlay/test` | Live component JSX exists in `TaskList.tsx`, `MissionList.tsx`, and `CodingAssistantSessionList.tsx`; tests pin those local strings. | Move the JSX to one component and update tests to assert all ledgers use it. |
| `rg -n "collapsedDirectories|projectDirectoryKey" packages/overlay/src/components` | The same collapsed-directory map/toggle pattern appears in the three ledger components. | Export a small collapse-state helper from the primitive owner. |
| `rg -n "mission-project-group|coding-assistant-project-group|data-ui=\"mission-project-group\"|data-ui=\"coding-assistant-project-group\"" packages/overlay/src packages/overlay/test` | Mission and Coding Assistant need stable `data-ui` and class extensions for browser tests and domain styling. | Keep extension props on `ProjectLedgerGroup`. |
| `rg -n "mission-project-group \\.project-group" packages/overlay/src/styles packages/overlay/test` | `mission.css` contains local density overrides. | Keep CSS untouched in this narrow pass; the double source being fixed is markup/state ownership, not row density. |

## Fix Plan

- Add `ProjectLedgerGroup.tsx`:
  - renders the canonical `section.project-group`
  - renders the canonical `button.project-group-heading`
  - owns folder/chevron icon choice
  - owns project name/parent/count markup
  - owns default expand/collapse/count ARIA labels
  - exposes `class` and `dataUi` extension props
  - exports `createProjectLedgerGroupCollapseState()`
- Replace hand-written group markup in:
  - `TaskList.tsx`
  - `MissionList.tsx`
  - `CodingAssistantSessionList.tsx`
- Keep row rendering, load-more buttons, task compact quota, and existing
  Mission download changes intact.
- Update source guards so component files cannot directly render
  `class="project-group-heading"` again.

## Acceptance

- Only `ProjectLedgerGroup.tsx` renders `class="project-group-heading"`,
  `project-group-icon`, `project-group-count`, `project-group-chevron`, and
  `project-group-body`.
- Task, Mission, and Coding Assistant lists all import and use
  `ProjectLedgerGroup`.
- The three ledgers no longer own local `collapsedDirectories` maps.
- Existing project-group CSS remains the visual single source.
- Targeted tests and a browser visual test verify grouped ledger rendering
  remains visible and collapsible.
