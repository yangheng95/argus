# Right Dock Stable Active Tab Surface

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Make the active Right Dock tab visually obvious with a background color. Switching tabs must not move the selected tab to the right edge; existing tab positions stay fixed and selection is expressed only through the active surface.                                                                                                                                                                                                                                                                                                                                                      |
| Supplied evidence          | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-301c857b-4003-4474-847a-d94c9833ece6.png` was inspected at original resolution. The Requirements page is visible, but the selected `需求` tab is visually indistinguishable from its peers.                                                                                                                                                                                                                                                                                                                                               |
| Acceptance criteria        | On the real desktop page, switching among at least three open Right Dock tabs keeps their left-to-right order byte-for-byte stable. The selected tab alone has a clearly visible, restrained theme-aware background with readable icon, label, and close action. Opening a new tab appends it once and selects it without later switches reordering any tab. Closing remains coherent.                                                                                                                                                                                                       |
| Hard constraints           | Desktop-only scope. Keep the Kobalte Tabs and shared Button/Icon primitives. Use one open-tab-order source and one selected-tab-ID source; do not retain selection encoded in array order. Do not add a fallback, compatibility branch, gate, state machine, timer, query override, local fixture, screenshot baseline, or User Interface (UI) automated test. Do not add, modify, update, delete, or run existing UI tests. Preserve unrelated dirty-worktree changes. Browser interaction uses the Node.js Browser workflow, never Bun.                                                    |
| Sources read               | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; `2026-07-30-right-dock-new-tab-active-selection.md`; `2026-07-29-right-dock-active-tab-hover.md`; `2026-07-29-right-dock-chrome-adaptive-tab-width.md`; `2026-07-29-right-dock-codex-parity-and-browser-tab-instances.md`; `packages/overlay/src/main.tsx`; `RightDock.tsx`; shared `Tabs.tsx`; and Right Dock styles in `workspace.css` and `design-language.css`.                                                                                                                  |
| Whole-repository grep      | `main.tsx` is the sole production owner of `centerWorkbenchPanels`, `selectedCenterWorkbenchTab`, `activateCenterWorkbenchTab`, fixed-panel open/close, Browser-instance open/close, and the `RightDock` active projection. `RightDock.tsx` preserves parent tab order in `props.tabs()` and forwards the controlled active ID to Kobalte. `workspace.css` is the sole production owner of `--right-dock-tab-active-bg` and the selected Right Dock tab paint. Existing source-string, DOM, browser, and screenshot tests were identified but are prohibited from modification or execution. |
| Independent agent feedback | None. The user did not request sub-agents, and the behavior has one tightly coupled state/style ownership path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Git baseline               | Branch `work-v0.0.24beta-yr-0729` and `myhexin/work-v0.0.24beta-yr-0729` were aligned at `e0ac759ab6` before this record. Existing Overlay, architecture, record, and screenshot changes belong to other ongoing work and remain excluded from this task's selective commits.                                                                                                                                                                                                                                                                                                                |

## Cause Chain

1. `centerWorkbenchPanels` currently serves two unrelated meanings: array order
   is both open-tab placement and activation history.
2. `activateCenterWorkbenchTab` removes the selected entry and appends it.
   `selectedCenterWorkbenchTab` then reads the last entry. Every selection
   therefore changes tab placement by construction.
3. `RightDock` preserves the order it receives, so the visible movement is not
   caused by Kobalte or Cascading Style Sheets (CSS).
4. The selected CSS rule is present, but its local active token resolves to
   `surface-strong`, which is too close to the current light `chat-canvas`
   background to communicate selection in the supplied composition.
5. The root correction is to let the ordered collection own membership and
   placement only, let one selected-ID signal own activation only, and let the
   existing Kobalte `data-selected` state paint a restrained accent wash.

## Complete Call-Site Disposition

| Owner or consumer                                               | Decision                                                                                                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `centerWorkbenchPanels` and every writer in `main.tsx`          | Preserve insertion order. Existing fixed tabs stay in place when reopened or selected; new fixed and Browser tabs append once. Reset writes the canonical conversation collection. |
| `selectedCenterWorkbenchTab` and active consumers in `main.tsx` | Read one selected-tab ID and resolve it against the open collection. Remove the previous last-entry selection meaning.                                                             |
| `activateCenterWorkbenchTab`                                    | Validate membership, then update only the selected ID and reveal the corresponding panel. Never rewrite the tab array.                                                             |
| Fixed/Browser open paths                                        | Append only when absent and select the exact opened ID.                                                                                                                            |
| Fixed/Browser/file close paths                                  | Remove the requested entries. If the selected entry closes, select the nearest remaining tab by stable position; otherwise preserve selection.                                     |
| `RightDock.tsx` and shared `Tabs.tsx`                           | Keep unchanged. They already preserve input order and project the controlled selected ID through Kobalte.                                                                          |
| `workspace.css`                                                 | Replace the indistinct active fill token with one theme-aware accent/canvas mix; retain the existing selected selector, radius, hover semantics, and shared primitive geometry.    |
| Existing Overlay UI tests                                       | Do not add, modify, update, delete, or run. UI acceptance uses real-page interaction, stable-order inspection, screenshots, and personal visual review.                            |
| `specs/current/architecture/07-panel.md`                        | Record stable insertion order, independent selected-ID ownership, and the visible accent-wash selected surface. Preserve unrelated concurrent edits through selective staging.     |

## Implementation And Verification Plan

1. Commit and push this Recall and both canonical indexes before product edits.
2. Separate stable open-tab order from the selected-tab ID in the sole
   `main.tsx` owner, including coherent selection after close.
3. Strengthen the existing selected tab fill through the Right Dock local
   semantic token in `workspace.css`.
4. Run Overlay typecheck, localization validation, production Vite build,
   historical-document links and document health, Markdown formatting, and
   `git diff --check`; do not run UI tests.
5. Open the real desktop page, switch among at least three existing tabs,
   compare exact tab ID order before and after each switch, inspect computed
   selected/background state, capture the affected Dock, and personally review
   the screenshot.
6. Re-grep all owners, review the exact diff and screenshot a second time,
   update this record with evidence, selectively commit task-owned hunks, fetch,
   push to `myhexin`, and verify remote convergence.

## Progress

- [x] Screenshot, current architecture, historical records, production owners,
      complete call-site grep, Git baseline, and dirty-worktree boundaries
      inspected.
- [x] Pre-change plan committed and pushed.
- [x] Stable selection ownership and active surface implemented.
- [x] Static checks and real-page visual acceptance completed.
- [x] Second review, final commit, git-cc push, and remote convergence completed.

## Visual Evidence

The current-source Vite Overlay at `http://127.0.0.1:5173/` was connected to
the real OpenCorvus backend on port `7878`; no fixture, temporary frame, query
override, local signal, synthetic tab, or manufactured state was used. Through
the real Dock empty state and add menu, Requirements, Goals, and Files were
opened in that order. The exact production tab IDs were
`requirements, goals, explorer`.

Selecting Requirements changed only the controlled selected ID to
`requirements`; selecting Goals then changed only that ID to `goals`. After
each action, the exact open-tab sequence remained
`requirements, goals, explorer`. The selected element alone owned Kobalte's
`data-selected` attribute and resolved to
`color(srgb 0.884235 0.929412 0.982588)`; both unselected peers resolved to
transparent backgrounds.

The affected Dock was captured at
[`../../artifacts/2026-07-30-right-dock-stable-active-goals.png`](../../artifacts/2026-07-30-right-dock-stable-active-goals.png)
and inspected twice at original resolution. Goals remains in its original
middle position and has a clear pale-blue selected surface around its icon,
label, and close action. Requirements and Files remain in their original left
and right positions with transparent resting surfaces. Text and icons remain
legible, and the selected surface is visible without overpowering the compact
tab strip.

## Verification

| Check                                                                 | Result                                                                                                                |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Overlay TypeScript typecheck                                          | Passed                                                                                                                |
| Overlay localization validation                                       | Passed                                                                                                                |
| Overlay production Vite build                                         | Passed after transforming 7,054 modules; existing dependency-directive and chunk-size warnings remained informational |
| Historical links, product-document single source, and document health | Passed: 93 tests, 1,448 assertions                                                                                    |
| Task-owned formatting and `git diff --check`                          | Passed                                                                                                                |
| Real-page tab order                                                   | Passed across three opens and two later switches: `requirements, goals, explorer` remained unchanged                  |
| Real-page selected state                                              | Passed: exactly one `data-selected` tab; selected background was the accent wash and peers were transparent           |
| Screenshot and personal visual review                                 | Passed twice at original resolution                                                                                   |
| UI automated tests                                                    | None added, modified, updated, deleted, or run                                                                        |

## Second Review

A final whole-repository grep reconfirmed that `main.tsx` is the only production
writer for the open-tab collection and selected-tab identity, `RightDock.tsx`
preserves the parent collection order, Kobalte remains the only Tabs primitive,
and `workspace.css` remains the only Right Dock selected-surface owner. The
selection path now updates one selected ID and schedules the existing reveal;
it cannot reorder the tab collection. Fixed and Browser open paths append only
new identities, and the shared removal path chooses the preceding stable
neighbor only when the selected tab itself closes. No activation history,
alternate order, timer, retry, gate, compatibility path, state machine, or
second visual selector was introduced.

## Delivery Evidence

- Pre-change Recall commit `d7d72f7aa1` was pushed to the git-cc branch before
  product edits.
- Product commit `9b3dac9ad7` contains only the state owner, selected-surface
  token, current architecture statement, this record, and the reviewed Dock
  screenshot.
- The normal git-cc pre-push hook passed full-repository TypeScript,
  Application Programming Interface (API) route inventory, generated
  documentation, Overlay localization, and secret scanning without bypass.
- `myhexin/work-v0.0.24beta-yr-0729` converged to product commit
  `9b3dac9ad7`. Unrelated dirty-worktree edits remained unstaged and unmodified
  by this delivery.
