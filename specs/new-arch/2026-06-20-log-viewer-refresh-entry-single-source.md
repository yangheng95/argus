# Log Viewer Refresh Entry Single Source

Date: 2026-06-20

UI means User Interface. DOM means Document Object Model.

## Problem

`LogViewer` renders `Load server logs` and `Refresh` next to each other, but both
buttons call the same `refreshAction.run()` path. The action itself only loads
server logs and bumps the local sequence counter, so the two visible controls do
not represent different behavior.

This is a UI double-source problem: users see two actions, while the code has one
real action.

## Recall

| Source                                                | Constraint                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                           | Remove double-source UI instead of preserving compatibility controls. Add tests and visual evidence.                       |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | LogViewer is already on mature primitives for parsing, Select, and virtualized rendering. Do not add a new primitive path. |
| `2026-06-15-help-open-logs.md`                        | Logs open through the existing `oc:open-logs` event and use `/log/tail`; do not change opening or fetch semantics.         |
| `2026-06-17-log-viewer-select-style-single-source.md` | Keep the severity Select on shared `SelectControl`; this fix must not touch Select styling.                                |
| `2026-06-19-retire-log-path-residue.md`               | Remove LogViewer residue when it has no production owner.                                                                  |

## Evidence Sweep

| Command                   | Result     | Decision          |
| ------------------------- | ---------- | ----------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `rg -n "btnLog(ServerLogs | Refresh)   | log\\.load_server | refreshAction\\.run\\(\\)" packages/overlay/src packages/overlay/test -S`    | `LogViewer.tsx` renders both `btnLogServerLogs` and `btnLogRefresh`; both call `refreshAction.run()`. `dom.ts` exposes both refs. `log.load_server` only labels the duplicate button. | Keep `btnLogRefresh` and `common.refresh`; delete `btnLogServerLogs` and `log.load_server`. |
| `rg -n "LogViewer         | log viewer | btnLog(ServerLogs | Refresh)" specs packages/overlay -g "_.md" -g "_.tsx" -g "_.ts" -g "_.json"` | Existing LogViewer specs cover opening, virtual list sizing, Select single source, and residue removal; none require a separate server-log button.                                    | Treat the extra button as residue, not a compatibility contract.                            |

## Fix Plan

1. Remove the `btnLogServerLogs` header action from `LogViewer.tsx`.
2. Remove `btnLogServerLogs` from `DomRefs` and `getDomRefs()`.
3. Remove unused `log.load_server` keys from both locale files.
4. Add a static LogViewer guard that permits only one click entry to
   `refreshAction.run()` and rejects the retired DOM/i18n hooks.
5. Extend the browser LogViewer test to open the real dialog, assert one refresh
   button, assert no server-log duplicate button, and save a dialog screenshot.

## Acceptance

- Real LogViewer dialog exposes one refresh action.
- `btnLogServerLogs` is absent from production DOM refs and browser DOM.
- `log.load_server` is absent from English and Chinese locale files.
- The existing `oc:open-logs` event, `/log/tail` fetch, Copy, Clear, Close, and
  virtual list behavior are unchanged.
