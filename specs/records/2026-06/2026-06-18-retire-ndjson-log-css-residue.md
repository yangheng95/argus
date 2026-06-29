# Retire NDJSON Log CSS Residue

Date: 2026-06-18

CSS means Cascading Style Sheets. NDJSON means newline-delimited JSON.

## Problem

`index.html` still loaded `styles/surfaces/ndjson-log.css`, but the live log
viewer no longer renders `.ndjson-*` or `.log-divider` elements. `LogViewer.tsx`
renders the unified `.log-viewer` / `.log-line` surface, and `settings.css`
owns that visual contract.

Keeping a shipped stylesheet for a retired structured event panel creates a
second diagnostics styling source and makes the runtime graph imply a UI that
does not exist.

## Recall

| Source                                                | Existing decision                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | LogViewer moved to `utils/log.ts` parsing and a virtual list instead of a separate direct row renderer. |
| `2026-06-17-log-viewer-select-style-single-source.md` | LogViewer uses Kobalte Select and shared `.oc-select-*` trigger/content styling.                        |
| `2026-06-15-help-open-logs.md`                        | Logs open through the single `oc:open-logs` event and the existing LogViewer dialog.                    |

## Impact Sweep

| Sweep              | Result  |
| ------------------ | ------- | ----------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "ndjson-log | ndjson- | log-divider | LogViewer" packages/overlay/src packages/overlay/test specs` | `ndjson-log.css` was linked by `index.html`, but live LogViewer code uses `.log-viewer` / `.log-line`; `.ndjson-*` selectors had no production DOM owner. |

## Fix

- Remove the `ndjson-log.css` stylesheet link from `index.html`.
- Delete `packages/overlay/src/styles/surfaces/ndjson-log.css`.
- Update architecture guards so the retired stylesheet stays absent from both
  the runtime graph and surface stylesheet inventory.
- Refresh the surface stylesheet duplicate-budget inventory to the clean source
  baseline while adding the already-loaded `coding-assistant.css` surface.

## Acceptance

- The runtime HTML does not load `styles/surfaces/ndjson-log.css`.
- The retired stylesheet file is absent.
- LogViewer behavior remains owned by existing `LogViewer.tsx`,
  `utils/log.ts`, and `settings.css` paths.
- Targeted architecture and LogViewer tests pass, plus typecheck/docs/diff
  checks.
