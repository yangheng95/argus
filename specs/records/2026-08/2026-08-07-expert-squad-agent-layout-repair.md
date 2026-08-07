# Expert Squad Agent Layout Repair

Date: 2026-08-07

Status: Implemented and visually reviewed.

## Recall

| Item                       | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Fix the visible User Interface (UI) defects in Squad Market and Installed Agent Squads, remove Agent internal identifier/name metadata, and make the layouts less cramped.                                                                                                                                                                                                                                                                                          |
| Acceptance criteria        | Market installation state and actions remain inside the detail surface at desktop width; Market master rows, detail sections, and Installed Agent rows have clear spacing; Agent rows show the readable Agent label but not the internal Agent ID or base-role metadata; existing package and capability behavior is unchanged; the real desktop pages are opened, interacted with, captured, and manually reviewed.                                                |
| Hard constraints           | Desktop-only. Preserve the existing Registry, Manager, Resolver, catalog, installation, activation, and capability contracts. Reuse the established Settings, Button, Badge, Dropdown Menu, Tabs, and Disclosure primitives. Do not add, modify, update, or run User Interface automation tests. Use a real page and manual screenshot review. Preserve unrelated worktree changes. Commit only task-owned changes with a `dsw-33987` subject and push to legacy remote. |
| Sources read               | Root `AGENTS.md`; `specs/current/architecture/07-panel.md`; `2026-08-06-expert-squad-settings-information-architecture.md`; the current `ExpertSquadPanel.tsx`; the Expert Squad block in `settings.css`; both user-provided screenshots.                                                                                                                                                                                                                           |
| Whole-repository grep      | `ExpertSquadPanel.tsx` is the sole production renderer for both affected pages. The internal Agent ID/base-role line is rendered once in the Market roster and once in the Installed Agents disclosure. The horizontal overflow originates in the shared Market installation row. No User Interface test directly targeting `ExpertSquadPanel.tsx` or the affected Expert Squad style selectors was found.                                                          |
| Independent agent feedback | None requested. The root Agent owns implementation, visual review, and final diff review.                                                                                                                                                                                                                                                                                                                                                                           |

## Root cause and decision

The Market detail combines a non-wrapping compound status badge and two text
actions in one horizontal flex row. At the captured Settings width their
intrinsic widths exceed the detail column, so the actions escape the card. The
Market master row repeats the same horizontal competition between the selector,
status, and install action. The Installed Agents rows then spend a second text
line on internal Agent ID and base-role metadata, leaving less space for the
human-readable label and compressing the roster.

Keep the existing master-detail information architecture, but make crowded
content vertical at the row level: Market master actions sit on their own aligned
line, and installation actions sit below the installation status. Increase the
shared detail and Agent-row spacing. Agent identity remains the readable manifest
label; internal Agent ID/base-role metadata is removed from both visible rosters.
Capability identifiers inside expanded technical details remain visible because
those values are the content being inspected, not duplicate Agent identity.

## Validation plan

1. Review the exact component/style diff and confirm that no service or runtime
   contract changed.
2. Run Overlay typecheck, internationalization validation, and production build;
   do not run User Interface tests.
3. Open an isolated real Overlay page, inspect Squad Market and Installed Agent
   Squads at desktop size, exercise the Agents tab and relevant actions, and
   capture task-bound screenshots.
4. Inspect screenshots at original resolution and iterate until there is no
   overflow, internal Agent metadata, clipping, or cramped row rhythm.
5. Run the required documentation health checks, commit only task-owned paths,
   push the current branch to legacy remote, and perform a final diff/status review.

## Implementation result

- Removed the visible internal Agent ID and base-role subtitle from the Market
  roster and Installed Agents disclosure while preserving the readable manifest
  label and all expanded capability data.
- Moved Market master actions and installation lifecycle actions onto their own
  aligned rows, so intrinsic button and status widths no longer compete with the
  selectable identity content or escape the detail surface.
- Increased row, detail, disclosure, and capability spacing while keeping the
  master column proportionally shrinkable so the detail remains readable across
  ordinary desktop window widths.
- Removed the now-unused `expert_squad.base_role` locale entry from both locale
  catalogs.

## Validation evidence

- `bun run typecheck` in `packages/overlay`: passed after the final change.
- `bun run check:i18n` in `packages/overlay`: passed.
- `bun run build:vite` in `packages/overlay`: passed. Existing third-party
  `use client` and bundle-size warnings remained unchanged.
- `bun run docs:check`: passed with 315 Application Programming Interface (API)
  operations across 24 groups.
- The historical documentation test files named in the older repository rule
  were intentionally removed by prior commit `8ae01ff289`; they do not exist on
  this branch and were not restored. Both attempted invocations failed closed
  before running any test. No User Interface automation test was run.
- A real source Overlay connected to the existing backend on port 7878 and was
  exercised through Installed Agent Squads, Deep Research, Agents & Capabilities,
  Squad Market, the Installed filter, and the selected Deep Research detail.
  Visible roster text contains only the six readable Agent labels. Measured
  Market detail and installation rows have equal `clientWidth` and `scrollWidth`,
  confirming no horizontal overflow.
- Original-resolution screenshots were inspected and iterated twice: the first
  pass caught an over-wide master minimum; the second caught a stretched status
  badge. Final evidence:
  - `../../artifacts/2026-08-07-expert-squad-installed-agents-layout.png`
  - `../../artifacts/2026-08-07-expert-squad-market-layout.png`
- Browser diagnostics contained no errors. Two identical development-only Solid
  disposal warnings were emitted at initial application startup before the
  Settings interaction; the affected page interactions added no further warning.
