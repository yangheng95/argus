# Workspace Corner Layer Removal

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Remove the visible pointed/layered shape at the upper-left boundary of the Workbench. The rail-to-Workbench transition should not expose a curved cutout or corner layer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Supplied evidence          | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-d8fbcf7e-35db-46b3-a01b-934345e60073.png` was inspected at its original 2048-by-272 resolution. The highlighted region shows the pale rail through the Workbench's clipped upper-left corner beside the conversation document icon.                                                                                                                                                                                                                                                                                                                                                      |
| Acceptance criteria        | At the desktop Work Ledger/Workbench boundary, the Workbench begins on one straight vertical edge with no curved cutout, pointed remnant, or rail-colored wedge. Conversation and Right Dock content remain clipped by the single Workbench shell; the aligned header plane, left resizer, rail width, workspace fill, restrained edge separation, and all interactions remain unchanged. The real page is opened, captured at the task-owned region, and personally reviewed after the change.                                                                                                                                             |
| Hard constraints           | Desktop-only scope. Replace the obsolete rounded macro-corner decision directly at its single production owner; do not add another layer, mask, pseudo-element, fallback, compatibility rule, theme override, state, gate, iframe, local signal, query override, or handwritten primitive. Preserve unrelated dirty-worktree changes. Do not add, modify, update, delete, or run User Interface (UI) automated tests. Browser control uses the Browser skill through Node.js, never Bun.                                                                                                                                                    |
| Sources read               | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`; `2026-07-28-workspace-top-left-radius-restoration.md`; `2026-07-29-workspace-corner-shadow-confinement.md`; `2026-07-29-conversation-edge-to-edge-surface.md`; `App.tsx`; `workspace.css`; `activity.css`; `titlebar.css`; `header.css`; `sidebar.css`; and the radius/shadow tokens in `design-language.css`.                                                                                                                                                                                                                      |
| Whole-repository grep      | Searches enumerated every `.workspace-main`, Workbench radius statement, `--oc-radius-xl` consumer, workspace shadow token, rail paint owner, architecture statement, historical record, and UI-test assertion. `App.tsx` mounts one `#workspaceMain`; `workspace.css` is the sole production radius/shadow/clip compositor; `design-language.css` remains the token owner; `activity.css` and `titlebar.css` remain the two rail-paint consumers. Several historical UI tests and records intentionally assert the now-obsolete rounded corner, but the current UI-test prohibition requires leaving those test files untouched and unrun. |
| Independent agent feedback | None. The user did not request sub-agents, and this correction has one tightly coupled visual owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Git baseline               | Delivery branch is `work-v0.0.24beta-yr-0729` at `085a674192`, aligned with `legacy-remote/work-v0.0.24beta-yr-0729` before this record. Existing modifications in Overlay source and architecture records belong to ongoing work and remain outside this task except for the exact architecture hunk required below.                                                                                                                                                                                                                                                                                                                             |

## Cause Chain

1. **Observable symptom:** the rail-colored area is visible as a curved/pointed
   shape between the left Work Ledger and the white conversation header.
2. **Direct trigger:** the single `.workspace-main` shell declares
   `border-radius: var(--oc-radius-xl) 0 0 0` and `overflow: hidden`, so its
   upper-left corner clips away the white Workbench and reveals the rail below.
3. **Deeper cause:** the 2026-07-28 correction treated a visible macro corner as
   desirable and the 2026-07-29 correction only confined its shadow. The current
   user evidence explicitly rejects the remaining cutout itself, not its shadow.
4. **Why another paint layer is wrong:** covering the exposed area with a
   pseudo-element or color patch would create a second corner owner and would
   break whenever the rail palette or theme changes.
5. **Root correction:** replace the obsolete radius at the existing
   `.workspace-main` owner with a square boundary. Keep its existing background,
   clipping, isolation, and restrained shadow composition.

## Complete Call-Site Disposition

| Owner or consumer                                                                           | Decision                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/App.tsx`                                                   | Preserve the single `#workspaceMain` shell, DOM order, and left resizer.                                                                                    |
| `packages/overlay/src/styles/surfaces/workspace.css .workspace-main`                        | Replace only the upper-left macro radius with `border-radius: 0`; retain ambient fill, `overflow: hidden`, isolation, and both existing shadow channels.    |
| `packages/overlay/src/styles/tokens/design-language.css`                                    | Preserve `--oc-radius-xl` for dialogs and other legitimate extra-large rounded surfaces; the token is not defective.                                        |
| `packages/overlay/src/styles/surfaces/activity.css` and `titlebar.css`                      | Preserve the canonical rail paint. With a square Workbench boundary it no longer appears through a corner cutout.                                           |
| `packages/overlay/src/styles/surfaces/header.css`, `sidebar.css`, and conversation children | Preserve shared header geometry and child square-edge composition. They do not own the exposed corner.                                                      |
| `specs/current/architecture/07-panel.md`                                                    | Replace the obsolete single-rounded-corner contract with the current square macro-frame boundary while retaining single-owner clipping and token ownership. |
| `2026-07-28-workspace-top-left-radius-restoration.md` and later dependent records           | Retain as dated history. This record documents that the current user decision supersedes their rounded-corner acceptance criterion.                         |
| Existing Overlay UI tests and browser fixtures                                              | Do not add, modify, update, delete, or run. Their radius assertions are historical UI automation and ordinary UI work may not repair them.                  |
| Spec index and document-health checks                                                       | Add this record to the canonical index and run only non-UI documentation/static integrity checks.                                                           |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Square the single `.workspace-main` macro boundary and update the current
   architecture source of truth without touching unrelated dirty hunks.
3. Run Overlay typecheck, production build, required documentation health,
   formatting/static integrity, and `git diff --check`; do not run UI tests.
4. Start a real current-source page, open the same Workbench region, capture a
   task-scoped desktop screenshot, and personally inspect the boundary. Continue
   correcting the single owner if any curved cutout or pointed remnant remains.
5. Re-grep all production owners and historical consumers, review the exact
   task-owned diff and screenshot a second time, commit with the required
   `dsw-33987` prefix, push to `legacy-remote`, and verify remote convergence.

## Progress

- [x] Inspect the supplied screenshot, repository state, current architecture,
      prior radius/shadow decisions, production owners, and every call site.
- [x] Record Recall, cause chain, complete disposition, and verification plan.
- [x] Commit and push the pre-change plan.
- [x] Implement the single-owner visual correction.
- [x] Complete non-UI verification and real-page visual acceptance.
- [x] Complete second review and final record update.
- [x] Complete the final commit and legacy remote push.

## Visual Evidence

The existing current-source Vite process on `http://127.0.0.1:5173/` was
connected to the real OpenCorvus backend on port `7878`; no fixture, temporary
frame, query override, local signal, synthetic message, or manufactured state
was used. The live Workbench resolved to `x=281`, `y=36`, while the left rail
resolved to `x=0`, `y=36`, `width=280`. The shared conversation header also
started at `x=281`, `y=36`, proving that the retained one-pixel resizer is the
only horizontal separation.

The real `.workspace-main` computed `border-radius: 0px`,
`border-top-left-radius: 0px`, `overflow: hidden`, a white workspace fill, and
the unchanged restrained two-channel edge shadow. The target boundary was
captured through the Node-backed Browser workflow and then cropped by the same
Node sidecar to the exact rail/header region:
[`2026-07-30-workspace-corner-layer-removed.png`](../../artifacts/2026-07-30-workspace-corner-layer-removed.png).
The screenshot was personally inspected at original resolution. The pale rail
ends on one straight vertical edge; the white conversation header begins flush
beside it, with no curved cutout, pointed remnant, or exposed rail-colored
wedge.

## Verification

| Check                                                                 | Result                                                                                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay TypeScript typecheck                                          | Passed                                                                                                                                |
| Overlay localization validation                                       | Passed                                                                                                                                |
| Overlay production Vite build                                         | Passed after transforming 7,055 modules; existing dependency-directive and chunk-size warnings remained informational                 |
| Historical links, product-document single source, and document health | Passed: 93 tests, 1,448 assertions                                                                                                    |
| Task-owned Markdown formatting                                        | Passed                                                                                                                                |
| `git diff --check`                                                    | Passed                                                                                                                                |
| Real-page computed geometry                                           | Passed: rail and Workbench share `y=36`; Workbench and header share `x=281`; top-left radius is `0px`                                 |
| Real-page screenshot and personal visual review                       | Passed                                                                                                                                |
| UI automated tests                                                    | None added, modified, updated, deleted, or run                                                                                        |
| Git and legacy remote convergence                                            | Product, architecture, record, and visual evidence landed in `d7d72f7aa1`; `legacy-remote/work-v0.0.24beta-yr-0729` reached the same commit |

## Second Review

A second whole-repository grep confirmed that `App.tsx` still mounts one
`.workspace-main`, `workspace.css` remains its only production radius/shadow
compositor, and the rail/titlebar retain their existing single paint tokens.
The final production correction changes one declaration at that owner. No mask,
pseudo-element, theme branch, alternate background, extra shell, fallback,
state, or interaction change was introduced. The current architecture now
states the square Workbench boundary; the 2026-07-28 rounded-corner record
remains dated history and this record explicitly supersedes its visual
acceptance criterion.
