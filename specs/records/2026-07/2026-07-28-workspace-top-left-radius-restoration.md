# Workspace Top-Left Radius Restoration

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Restore a rounded corner at the visible top-left boundary between the left Work Ledger rail and the Workbench; the supplied screenshot explicitly rejects the current right angle. |
| Acceptance criteria | The desktop Workbench has one visibly clipped, tokenized top-left corner; the other three outer corners remain square; child conversation and Right Dock surfaces cannot paint over the clip; left-rail collapse/expand geometry, the shared 40-pixel header plane, and all existing interactions remain unchanged; focused source tests, a real Vite render, a Node-launched browser run, and personally inspected post-change screenshots pass. |
| Hard constraints | Desktop-only scope; preserve all pre-existing uncommitted changes; keep `.workspace-main` as the single radius owner; reuse the existing `--oc-radius-xl` design token; add no fallback, duplicate shell, local override, gate, temporary iframe, or synthetic preview; do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay; launch Playwright through Node.js, never Bun. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-0f24e42e-6d6f-4d42-aea7-9f991e2cae6f.png`, inspected at its original 522-by-191 resolution. The highlighted Workbench/rail boundary is visibly square and the user asks for a rounded corner. |
| Sources read | Root `AGENTS.md`; Browser control skill; `2026-07-27-overlay-header-plane-and-brand-alignment.md`; `2026-07-20-desktop-left-rail-and-mailbox-refinement.md`; `2026-07-14-overlay-workspace-surface-continuity.md`; current `App.tsx`, `workspace.css`, `titlebar.css`, `activity.css`, design-language radius tokens, focused source tests, and existing Node browser fixtures. |
| Whole-repository grep | `rg` enumerated every `.workspace-main`, `workspaceRadius`, `--oc-radius-xl`, top-left-radius assertion, and production border-radius owner across Overlay source, tests, current architecture, and July records. `App.tsx` mounts one `#workspaceMain`; `workspace.css` is the sole production root owner; `design-language.css` is the sole radius-token owner. Existing source and browser tests overwhelmingly require `var(--oc-radius-xl) 0 0 0`; only the latest header-plane test and one assertion in `titlebar-toolbar-toggle-browser.test.ts` require the conflicting zero radius. |
| Independent agent feedback | None. The user did not request sub-agents and this tightly coupled CSS/test correction remains with the primary agent. |
| Git baseline | `work-v0.0.23beta-yr-0728` at `f3c1b38948`, already aligned with `legacy-remote/work-v0.0.23beta-yr-0728`. The main worktree contains extensive pre-existing uncommitted Overlay and spec changes, including `App.tsx`, shared styles, tests, and indexes. A pre-change commit/push would incorrectly absorb unrelated work, so this repair must remain hunk-scoped and preserve that baseline. |

## Cause chain

1. **Observable symptom:** the Workbench begins with a square top-left edge beside the left Work Ledger rail.
2. **Direct trigger:** the sole production owner, `.workspace-main`, currently declares `border-radius: 0`; `overflow: hidden` therefore clips children to a square rather than the requested curve.
3. **Deeper cause:** the 2026-07-27 header-plane change equated a continuous, aligned header row with removing the macro Workbench frame corner. That interpretation conflicts with the established design-language rule reserving `--oc-radius-xl` for macro workspace framing and with the existing shell/continuity/collapse contracts.
4. **Why the prior path did not cure it:** it updated only the new header-plane source test and one browser assertion. Multiple existing source and browser tests still require and visually inspect the rounded single-corner owner, leaving the repository with contradictory acceptance criteria while production rendered the wrong square geometry.
5. **Root repair:** restore the one tokenized top-left radius on `.workspace-main`, keep its existing clip and shadow ownership, and replace only the two zero-radius assertions introduced by the flattening change.

## Complete call-site disposition

| Owner / call site | Disposition |
| --- | --- |
| `src/styles/tokens/design-language.css --oc-radius-xl` | Retain as the sole macro-frame radius value; no new token or literal radius. |
| `src/components/App.tsx #workspaceMain` | Preserve the single production shell and existing DOM order; no markup change. |
| `src/styles/surfaces/workspace.css .workspace-main` | Replace `border-radius: 0` with `border-radius: var(--oc-radius-xl) 0 0 0`; retain `overflow: hidden`, ambient fill, shadow, and isolation. |
| `test/header-plane-convergence.test.ts` | Replace the obsolete flattening assertion with the corrected single top-left macro-corner contract while retaining shared header-row/control convergence coverage. |
| `test/browser/titlebar-toolbar-toggle-browser.test.ts` | Replace the zero-radius computed-style assertion with the existing scaled non-zero/top-left-only geometry contract; retain the same real Vite fixture and all toolbar behavior assertions. |
| `test/left-work-ledger-shell.test.ts` | Retain; already requires the correct single rounded workspace owner. |
| `test/overlay-left-rail-density.test.ts` | Retain; already requires the tokenized radius plus child clipping. |
| `test/browser/pane-collapse-rail.test.ts` | Retain; already requires the expanded Workbench to expose a non-zero top-left-only computed radius. |
| `test/browser/workspace-surface-continuity-browser.test.ts` | Retain; already checks the non-zero corner in all three themes and produces the most focused visual evidence. |
| `specs/current/architecture/07-panel.md` | Clarify that the macro Workbench frame owns one `--oc-radius-xl` top-left corner while the aligned header rows retain one shared height. |
| Spec indexes and document-health tests | Add this record to both canonical indexes and run the required historical/document health checks. |

## Implementation and verification plan

1. Add this Recall, causal chain, exhaustive disposition, and acceptance plan to the canonical July record tree and both indexes.
2. Restore the single tokenized `.workspace-main` top-left radius and update only the two contradictory flattening assertions.
3. Run the focused unit contracts, Overlay TypeScript, production Vite build, required spec link health, and document-health checks.
4. Run the existing Node-launched real Vite browser fixtures for the header plane, collapse geometry, and three-theme workspace continuity.
5. Inspect fresh task-scoped desktop screenshots at original resolution; if the corner is still visually square or child paint covers it, continue repairing the sole owner and rerun the same evidence path.
6. Review the final task-owned diff against every call site, then commit with the required `dsw-33987` prefix and push the current branch to `legacy-remote` without staging unrelated pre-existing changes.

## Progress

- [x] Inspect supplied evidence, repository state, prior decisions, canonical owners, all radius assertions, and browser fixtures.
- [x] Record Recall, causal chain, complete call-site disposition, and verification plan.
- [x] Restore the single top-left macro corner and correct contradictory tests/architecture.
- [x] Complete focused unit, type, build, documentation, and real-browser visual acceptance.
- [x] Perform the second review and prepare the exact hunk-scoped commit; commit and legacy remote push are the next repository actions.

## Verification

- Focused radius ownership and continuity tests passed: 9 tests, 0 failures across `left-work-ledger-shell.test.ts`, `workspace-surface-continuity.test.ts`, and the radius-only case in `overlay-left-rail-density.test.ts`.
- Overlay TypeScript passed with `bun run --cwd packages/overlay typecheck`.
- The production Vite build passed after transforming 7,057 modules; existing third-party `use client` and large-chunk warnings remained non-fatal.
- Node-launched real-browser acceptance passed: `pane-collapse-rail.test.ts` plus `workspace-surface-continuity-browser.test.ts` produced 3 passing tests and 0 failures. The three-theme fixture proved a non-zero top-left radius, rail-colored pixels outside the clip, workspace-colored pixels inside it, and unchanged left-rail collapse geometry.
- Personally inspected `.scratch/pane-collapse-titlebar-expanded.png` and `.scratch/workspace-surface-continuity-dark.png` at original resolution. The Workbench exposes a clear rounded top-left corner in both light and dark compositions; its child conversation surface does not repaint the corner square.
- Historical links and product-document single-source checks passed. Document health passed 92 of 93 checks; the only failure is the repository-wide tracked-record assertion, which also lists nine unrelated concurrent untracked July records. This record is expected to leave that list once committed, while the unrelated records remain outside this task.
