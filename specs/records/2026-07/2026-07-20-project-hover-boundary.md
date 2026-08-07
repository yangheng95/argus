# Project Hover Boundary

## Recall

### User requirement

- When a Task row is hovered, its parent Project row must not also display a hover state.
- Preserve the Project row's own hover feedback when the pointer is actually over the Project header.

### Acceptance criteria

- Hovering a nested Task paints only the Task row surface; the Project header remains transparent.
- Hovering the Project header still paints the complete Project header, including its action rail.
- Keyboard focus inside a nested Task does not paint the Project header; focus inside the Project header keeps the shared navigation-row feedback.
- Focused source tests, Overlay TypeScript, spec-health checks, and a real isolated Node/Playwright screenshot review pass.

### Hard constraints

- Keep `ProjectLedgerGroup` markup and the shared `oc-navigation-row` primitive as the single Project-header interaction source.
- Do not add component state, JavaScript hover listeners, fallback selectors, or a second Project-row implementation.
- Desktop-only scope. Playwright must run through Node, never Bun.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process; use an isolated test page.
- Preserve all unrelated staged and unstaged work already present in the main worktree.

### Supplied visual evidence

- `codex-clipboard-683af52f-8efd-4ad0-babb-b54341967a10.png`: hovering the nested `Phase 01` Task simultaneously paints the `nova-vibecoding-template` Project row.

### Sources read

- `AGENTS.md`, `specs/README.md`, `specs/records/2026-07/README.md`, and `specs/current/architecture/99-principles.md`.
- `specs/records/2026-07/2026-07-15-project-row-surface-and-search-alignment.md`.
- `packages/overlay/src/components/ProjectLedgerGroup.tsx`.
- `packages/overlay/src/styles/primitives/navigation-row.css` and `packages/overlay/src/styles/surfaces/sidebar.css`.
- `packages/overlay/test/{navigation-row-primitive,overlay-left-rail-density,project-delete-button}.test.ts` and related browser fixtures.
- Git history for `sidebar.css` and the Project-row tests, including the original full-row surface change and later navigation-row ownership convergence.

### Whole-repository search evidence

Searches covered every `.project-group:hover`, `.project-group:focus-within`, `.project-group-head`, and `oc-navigation-row` source/test owner.

| Owner / call site                                                        | Decision                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProjectLedgerGroup.tsx`                                                 | Preserve `.project-group-head oc-navigation-row`; no markup or state change is required.                                                                                                                                                        |
| `navigation-row.css`                                                     | Preserve the canonical direct header `:hover` / `:focus-within` wash.                                                                                                                                                                           |
| `sidebar.css` parent `.project-group:hover` / `:focus-within` projection | Delete; descendant Task interaction currently leaks into the Project header through the parent pseudo-class.                                                                                                                                    |
| `navigation-row-primitive.test.ts`                                       | Preserve its existing assertion that the sidebar must not duplicate the parent hover projection.                                                                                                                                                |
| `project-delete-button.test.ts`                                          | Preserve its existing assertion that the parent hover projection must not exist.                                                                                                                                                                |
| `overlay-left-rail-density.test.ts`                                      | Replace the stale assertion that requires parent projection with the canonical navigation-row ownership assertion.                                                                                                                              |
| Project-row browser fixtures                                             | Reuse an isolated Node-launched production fixture to prove Project-own hover and nested-Task hover are visually independent.                                                                                                                   |
| `Tooltip.tsx`, `tooltip.css`, and all `Tooltip.Content` consumers        | Browser review exposed Kobalte's runtime `pointer-events: auto` overriding two feature-local inline declarations. Keep the wrapper markup and make the canonical non-interactive Tooltip primitive own pointer pass-through for every consumer. |
| `work-ledger-consolidation.test.ts` and `tooltip-primitive.test.ts`      | Replace feature-local inline-style expectations with one primitive-level pointer pass-through contract.                                                                                                                                         |

### Independent agent feedback

- None. The user did not request sub-agents, and the affected ownership is a single tightly coupled CSS interaction boundary.

### Codex review feedback

- The first production browser run reached the Project hover surface, then failed before the new nested-Task assertion because the existing Project tooltip checker observed `pointer-events: auto` despite feature JSX requesting `none`.
- Inspection proved the shared Kobalte Tooltip wrapper is the real ownership boundary and that only the Project and Work Ledger summary consumers attempted local inline overrides. The implementation therefore removes those duplicate declarations and pins non-interactive pointer behavior once in `tooltip.css`; this is required to let the original production checker reach the requested hover-boundary verification without weakening or deleting its existing assertion.
- The focused Work Ledger regression then exposed one stale assertion left by the already-committed left-sidebar Mailbox projection: `App.tsx` now renders the sidebar title through `t(...)` based on the active Work Ledger/Mailbox surface, so the former static `data-i18n="work_ledger.title"` marker no longer exists. The regression is updated to assert the current single dynamic title owner instead of restoring retired static markup.

## Root cause

The Task list is rendered inside `.project-group`. CSS `:hover` matches an ancestor whenever the pointer is over any descendant, so `.project-group:hover .project-group-head` paints the Project header while a nested Task is hovered. The same leak exists for `:focus-within`. This is not required for Project-header feedback because `.project-group-head` already composes the shared `oc-navigation-row` primitive, which paints only when the header itself is hovered or contains focus.

## Implementation

1. Remove the parent Project-group hover/focus projection from `sidebar.css` so interaction ownership remains on the actual navigation row.
2. Update the stale left-rail density regression to assert the shared primitive owner and explicitly reject descendant-to-parent projection.
3. Restore the shared Tooltip primitive's non-interactive pointer contract exposed by the production checker and remove the two feature-local duplicates.
4. Run focused source tests, Overlay TypeScript, required spec checks, and an isolated Node/Playwright browser check that captures and reviews Project-header and nested-Task hover screenshots.

## Verification

- `bun test packages/overlay/test/navigation-row-primitive.test.ts packages/overlay/test/overlay-left-rail-density.test.ts packages/overlay/test/project-delete-button.test.ts`.
- `bun run --cwd packages/overlay typecheck`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`.
- Node-launched browser fixture with scoped screenshots for direct Project hover and nested Task hover.
- `git diff --check` and a second diff review before commit/push.

## Result

- Removed the descendant-sensitive `.project-group:hover` / `:focus-within` projection. The canonical `.project-group-head.oc-navigation-row` now paints only when the Project header itself is hovered or contains focus.
- The production Node/Playwright checker proves the two states independently: direct Project hover yields a non-transparent Project background, while nested Task hover yields a transparent Project background and a non-transparent Task background.
- Restored the canonical descriptive-only Tooltip pointer contract in `tooltip.css` after the original browser checker proved Kobalte's inline runtime layer overrode feature-local styles; the two duplicate consumer declarations were removed.
- PASS: 21 focused Project-row, Tooltip, and Work Ledger source tests.
- PASS: Overlay TypeScript (`tsc --noEmit`).
- PASS: 87 documentation health and single-source checks.
- PASS: production `project-ledger-group-browser.test.ts` through the Node runner, including the existing Project/Task/Mission/Chat interaction chain and the new hover-boundary assertion.
- Manual screenshot review passed: `packages/overlay/.scratch/work-ledger-project-single-hover-surface.png` shows the direct Project hover surface; `packages/overlay/.scratch/work-ledger-task-hover-without-project-surface.png` shows only the nested Task surface while the Project header remains transparent.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, stopped, or used as the test target.
