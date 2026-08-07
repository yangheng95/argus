# Run menu runtime-control rebuild

> Superseded on 2026-07-12: the Run menu was removed and runtime controls were consolidated into the composer. See `2026-07-12-composer-runtime-controls-redesign.md`.

## Recall

| Item | Detail |
| --- | --- |
| User request | Delete and rebuild the incorrect Run tab after moving Agent parallelism and unattended policy to the composer. |
| Acceptance criteria | Run contains Executor, Parallelism, and Unattended in the current design language. Every item navigates focus to the corresponding composer control. The menu shows current authoritative values but cannot mutate or duplicate configuration. Keyboard and pointer interaction close the menu and land focus on the selected control. A real desktop browser screenshot and interaction test verify the result. |
| Hard constraints | No retired Run fields, settings shortcuts, duplicated switches, local shadow state, fallback value, compatibility alias, live-process restart, or unrelated dirty-worktree changes. The composer remains the sole interactive owner of runtime controls. |
| Sources read | `AGENTS.md`; Browser control skill; `2026-07-11-overlay-left-rail-density-and-run-menu.md`; `2026-07-11-composer-parallelism-unattended-controls.md`; current `TitlebarMenubar.tsx`, `ChatComposer.tsx`, `composer-run-controls.ts`, i18n, primitive tests, and Node browser fixture. |
| Whole-repository search evidence | `rg` covered all `titlebar-run-*` identifiers, Run menu labels, focus helpers, `composerRunControlState`, and the three composer control selectors. The current Run implementation has only Executor; the composer is the sole interactive owner of Executor, Parallelism, and Unattended. Historical Agent Models, Expert Squads, and Permissions Run shortcuts remain explicitly rejected. |
| Independent agent feedback | None; the user did not request sub-agent delegation. |

## Design

Delete the one-item Run content and replace it with a runtime-control navigation group. Menu rows are read-only mirrors: Executor shows the selected executor label, Parallelism shows the server-materialized positive integer, and Unattended shows its combined on/off state. Selecting a row closes Run and focuses the canonical composer control. Configuration changes remain exclusively in the composer controls and existing `/config` service.

## Verification

- Focused source tests assert the exact three Run entries and rejected stale shortcuts.
- The Node browser fixture opens Run, validates current values, selects every entry, and proves focus transfer.
- Overlay typecheck/build and a desktop screenshot provide implementation and visual evidence.

## Result

- Deleted the incomplete one-entry Run content and rebuilt it with exactly Executor, Parallelism, and Unattended.
- All three entries are navigation-only and focus the canonical composer controls; configuration writes remain solely owned by the composer.
- The menu reads `assistant.max_executor_groups` and the combined unattended state from `appStore.config` through `composerRunControlState`, without a guessed default.
- Passed focused source tests, Overlay TypeScript, production Vite build, and the Node browser menu interaction suite.
- Visual review of `.scratch/titlebar-run-runtime-controls.png` confirmed three equal-height rows, aligned value metadata, and consistent titlebar/menu styling.
