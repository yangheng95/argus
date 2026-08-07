# Left Dock Normal Typography Restoration

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Determine whether the left Dock typography became smaller, identify when it changed, and restore its primary text to the application's normal size. |
| Acceptance criteria | Primary navigation labels, Project names, Chat titles, Mission titles, and child Task titles compute to the existing 14px body tier at the base scale; secondary metadata remains on its smaller hierarchy; focused tests, a Node-launched Vite browser fixture, and a task-scoped screenshot pass. |
| Hard constraints | Desktop-only scope; preserve the existing Work Ledger and navigation primitives; use semantic typography tokens rather than new literals; do not add a fallback or parallel typography source; do not restart, refresh, or otherwise interfere with the user's running OpenCorvus/Overlay process; preserve unrelated dirty-worktree changes and stage only task-owned hunks. |
| Sources read | `AGENTS.md`; the supplied desktop screenshot; `design-language.css`; `sidebar.css`; `work-ledger.css`; `WorkLedger.tsx`; `ProjectLedgerGroup.tsx`; left-Dock source and Node browser tests; the 2026-07-16 titlebar/sidebar typography record. |
| Whole-repository search evidence | `rg` enumerated every `--ui-font-navigation`, `--work-row-font-size`, `.sidebar-codex-action`, `.project-group-name`, `.project-group-toggle`, and `.work-row-title` owner. The primary left-Dock surfaces split across one 13px navigation token and two local 13px declarations; 12px metadata owners are semantically secondary and remain unchanged. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |

## Evidence-Backed Cause Chain

1. The supplied screenshot shows left-Dock primary labels one type tier below the 14px conversation and Environment body text.
2. Commit `84cc83693f` on 2026-07-16 introduced a local 13px `--work-row-font-size` for Chat, Mission, and child Task rows.
3. Commit `42943e7f34` later on 2026-07-16 introduced a 13px `--ui-font-navigation` and projected it into the static left navigation.
4. Project controls and names retained two additional local 13px declarations, so changing only the navigation token would leave a mixed-size Dock.
5. The direct trigger is therefore the July 16 primary-label reduction; the deeper design defect is that equivalent left-Dock primary labels do not all consume the existing normal body-size source.

## Call-Site Disposition

| Owner / call site | Decision |
| --- | --- |
| `design-language.css` `--ui-font-navigation` | Alias the semantic navigation tier to the existing 14px body tier. |
| `sidebar.css` static navigation | Keep consuming `--ui-font-navigation`; it now resolves to the normal tier. |
| `sidebar.css` Project toggle and Project name | Replace both local 13px declarations with `--ui-font-navigation`. |
| `work-ledger.css` `--work-row-font-size` | Replace its local 13px declaration with `--ui-font-navigation`, covering Chat, Mission, child Task, count, and disclosure text through the existing single row owner. |
| Footer, timestamps, counts, and other metadata | Preserve the existing small/meta tokens unless they inherit the primary row token by established row semantics. |
| Source and Node browser tests | Assert the single token chain and actual 14px computed size across static navigation, Project, Chat, Mission, and child Task labels. |

## Benchmark

- Run focused Overlay source tests for token ownership and Work Ledger convergence.
- Launch the isolated left-Dock Vite fixture through Node, measure every primary label at the desktop acceptance viewport, and require exact 14px base-scale equality.
- Save and inspect a task-scoped screenshot for density, clipping, hierarchy, and alignment.

## Progress

- [x] Inspect the user screenshot and trace the July 16 history.
- [x] Enumerate every primary left-Dock typography owner and test call site.
- [x] Implement the single normal-size token chain.
- [x] Add regression coverage and run focused verification.
- [x] Inspect the screenshot and perform second review.
- [x] Commit and push to legacy remote.

## Verification Evidence

- Passed 16 focused typography and titlebar/sidebar token regressions plus the focused left-rail ownership regression.
- Passed the production Vite build across 7,052 transformed modules.
- Passed all 22 historical-document link and consolidated-spec-tree checks.
- Started an isolated Vite 6.4.3 server through Node and inspected the real Overlay in the in-app browser without touching the user's running native OpenCorvus process.
- Real computed values are 14px for New Chat, Project names, Chat titles, and Mission titles; section headings remain 15px and footer/version metadata remains 12px. The browser reported no console warnings or errors.
- Visual review of `.scratch/left-dock-normal-typography-vite.png` confirms the restored labels are readable, preserve the existing desktop row rhythm, and retain intentional ellipsis without new clipping or overlap.
- The older all-in-one compact-Dock browser fixture reached and passed every new typography measurement, then hit its pre-existing 15px radius expectation against the current concurrent 18px radius token. That unrelated assertion was not rewritten or presented as a typography failure.
