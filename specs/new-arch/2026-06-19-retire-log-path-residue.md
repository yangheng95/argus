# Retire Log Path Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model. NDJSON means
newline-delimited JSON.

## Problem

Rawls found `.log-path` in `settings.css` with no production DOM owner, while
`overlay-architecture-guards.test.ts` still listed it as a required LogViewer
selector. This makes the test suite protect a dead style hook.

## Recall

| Source                                                | Relevant constraint                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-retire-ndjson-log-css-residue.md`         | LogViewer now renders the unified `.log-viewer` / `.log-line` surface, and retired log CSS must be removed rather than preserved. |
| `2026-06-17-log-viewer-select-style-single-source.md` | LogViewer should stay on shared `SelectControl` and existing `.oc-select-*` popup styling.                                        |
| `log-viewer-primitive.test.ts`                        | LogViewer tests already cover virtual list height and mature primitive ownership.                                                 |
| `overlay-architecture-guards.test.ts`                 | The guard currently requires `.log-path`, which is the incorrect owner contract.                                                  |

## Evidence Sweep

| Command                                                                      | Result                                                                 | Decision                                                           |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `rg -n "log-path" packages/overlay/src packages/overlay/test specs/new-arch` | `.log-path` appears in `settings.css` and the architecture guard only. | Delete the CSS rule and remove it from the required selector list. |
| `rg -n "log-line                                                             | log-msg                                                                | log-detail                                                         | LogViewer" packages/overlay/src/components/LogViewer.tsx packages/overlay/src/styles/surfaces/settings.css` | Live LogViewer rows render `.log-line`, `.log-line-head`, `.log-level-*`, `.log-msg`, `.log-chip`, and `.log-detail*`. | Keep live log selectors unchanged. |
| `Get-Content specs/new-arch/2026-06-18-retire-ndjson-log-css-residue.md`     | Existing decision already rejects preserving retired log styling.      | Treat `.log-path` as residue, not compatibility.                   |

## Fix Plan

1. Delete `.log-path` from `settings.css`.
2. Remove `"log-path"` from the architecture guard required selector list.
3. Add a LogViewer primitive guard proving `LogViewer.tsx` no longer renders `log-path`.
4. Use existing LogViewer browser coverage to open the real dialog and confirm no `.log-path` DOM remains.

## Acceptance

- `packages/overlay/src` has no `.log-path` production selector or owner.
- Architecture guards no longer protect `.log-path`.
- LogViewer still renders the live virtual list and log detail selectors.
- Real LogViewer screenshot remains readable after the removal.
