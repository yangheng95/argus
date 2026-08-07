# Workspace Rounded Corner Without Background Layer

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Restore the rounded upper-left Workbench corner in the highlighted region, but remove the rectangular-looking background or shadow behind the curve so the result reads like the Codex desktop surface. The user explicitly rejects both prior outcomes: a square corner and a rounded corner backed by a straight layer.                                                                                                                                                                                                                                                                                |
| Supplied evidence          | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-3dfc172f-7695-49a3-80fe-a3c474e5b4d3.png` was inspected at its original 1304-by-284 resolution together with the earlier 2828-by-376 crop `codex-clipboard-d8fbcf7e-35db-46b3-a01b-934345e60073.png`. The marked boundary is the upper-left edge of the complete Workbench beside the Work Ledger, not a Right Dock tab or the document icon.                                                                                                                                                                                                         |
| Acceptance criteria        | The desktop Workbench has one visibly rounded, tokenized upper-left corner; its three other outer corners stay square. The pale rail material remains continuous outside the curve with no neutral rectangular band, square child overpaint, pointed remnant, or second background layer. Conversation and Right Dock children are clipped by the same Workbench owner. Header alignment, rail resizing, body geometry, themes, and interactions remain unchanged. A real current-source page is captured and personally reviewed at the exact region.                                                   |
| Hard constraints           | Desktop-only scope. Keep `.workspace-main` as the only radius, clipping, ambient-fill, and edge-depth compositor. Reuse the existing extra-large radius and semantic shadow tokens. Do not add a wrapper, pseudo-element, mask, theme-specific color patch, fallback, compatibility path, gate, state, iframe, local signal, query override, mobile/tablet work, or User Interface (UI) automated test. Do not add, modify, update, delete, or run existing UI tests. Preserve unrelated dirty-worktree changes. Browser control must use Node.js.                                                       |
| Sources read               | Root `AGENTS.md`; Browser control skill; supplied screenshots; `specs/current/architecture/07-panel.md`; `2026-07-11-overlay-left-rail-density-and-run-menu.md`; `2026-07-20-desktop-left-rail-and-mailbox-refinement.md`; `2026-07-28-workspace-top-left-radius-restoration.md`; `2026-07-29-workspace-corner-shadow-confinement.md`; `2026-07-30-workspace-corner-layer-removal.md`; current `App.tsx`, `workspace.css`, `activity.css`, `titlebar.css`, design-language tokens, and all three theme cascades.                                                                                         |
| Whole-repository grep      | Searches enumerated every `.workspace-main`, Workbench radius statement, `--oc-radius-xl` consumer, workspace edge-shadow token, rail/background paint owner, historical plan, and current/historical test consumer. `App.tsx` mounts one `#workspaceMain`; `workspace.css` is the only production radius/clip/shadow compositor; `design-language.css` is the only geometry-token owner; `activity.css` and `titlebar.css` consume the one rail paint; the three theme cascades preserve rail/workspace material separation. Existing UI tests are historical consumers and remain untouched and unrun. |
| Independent agent feedback | None. The user did not request sub-agents, and the single visual compositor plus real-page/manual review keep this correction tightly scoped.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Workspace preservation     | Existing dirty changes in Conversation cards, Progressive List, primitives, Inspector, current card architecture, and their dated records are unrelated and must remain unstaged and unmodified by this task.                                                                                                                                                                                                                                                                                                                                                                                            |

## Cause Chain

1. **Observable symptom:** earlier revisions alternate between a square
   Workbench corner and a visible curve surrounded by a straight neutral band.
2. **Direct geometry trigger:** the current canonical `.workspace-main` owner
   declares `border-radius: 0`, so current source cannot render the requested
   curve.
3. **Direct paint trigger behind the earlier curve:** the same owner draws its
   left depth as an exterior `box-shadow`. `overflow: hidden` clips children and
   background to the radius, but exterior shadow paint remains outside that
   clip and can read as a rectangular backing band beside the exposed rail.
4. **Why prior paths did not converge:** restoring only the radius fixed the
   square geometry but retained exterior paint; deleting the radius removed the
   exposed paint symptom by deleting the desired curve.
5. **Root direction:** restore the single tokenized radius and keep edge depth
   inside that clipped surface rather than behind it. The rail must be the only
   material visible outside the curve.

## Complete Call-Site Disposition

| Owner or consumer                                                     | Decision                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/App.tsx`                             | Preserve the sole `#workspaceMain` shell, sibling order, and resizers.                                                                                                                                               |
| `packages/overlay/src/styles/surfaces/workspace.css::.workspace-main` | Restore the existing extra-large upper-left radius and keep `overflow: hidden`; replace exterior left-edge paint with an interior tokenized edge channel if real-page review confirms the supplied rectangular band. |
| `packages/overlay/src/styles/tokens/design-language.css`              | Preserve the canonical radius and shadow geometry tokens; do not add a parallel local radius or raw color.                                                                                                           |
| `activity.css`, `titlebar.css`, and the three theme cascades          | Preserve the continuous rail material and semantic workspace fill. They are the desired materials revealed by the curve.                                                                                             |
| `specs/current/architecture/07-panel.md`                              | Replace the superseded square-boundary statement with the single rounded/clipped compositor contract and explicitly forbid exterior backing layers at the corner.                                                    |
| Historical dated records                                              | Retain as history. This record supersedes the conflicting square-corner acceptance while explaining why radius-only restoration was insufficient.                                                                    |
| Existing Overlay UI tests and browser fixtures                        | Do not add, modify, update, delete, or run. Visual acceptance uses a real current-source page, screenshot, and personal inspection only.                                                                             |
| `specs/README.md` and `specs/records/2026-07/README.md`               | Index this record and validate the canonical documentation graph with non-UI checks.                                                                                                                                 |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Restore the one semantic Workbench radius and confine the left-edge depth to
   the clipped Workbench instead of painting behind its corner; update current
   panel architecture.
3. Run Overlay TypeScript typecheck, localization validation, production build,
   required documentation health, task-owned formatting/static integrity, and
   `git diff --check`. Do not run UI tests.
4. Start a real current-source desktop page through the Browser skill, open a
   real conversation, capture the exact Work Ledger/Workbench corner, and
   personally inspect it at original resolution. Iterate if a square child,
   gray band, pointed remnant, or missing curve remains.
5. Re-grep the compositor and all consumers, review the exact task-owned diff
   and screenshot a second time, commit with the required `dsw-33987` prefix,
   fetch/converge, push to `legacy-remote`, and verify the remote branch.

## Progress

- [x] Inspect supplied evidence, current source, historical decisions, current
      architecture, production owners, and all repository consumers.
- [x] Record Recall, cause chain, complete call-site disposition, and the
      verification plan.
- [x] Commit and push the pre-change Recall.
- [x] Implement the single-owner rounded/clipped compositor correction.
- [x] Complete static/build verification and real-page visual acceptance.
- [x] Complete second review and the final delivery record.
- [x] Commit and prepare the final verified correction for legacy remote push.

## Real-Page Visual Evidence

The current-source Overlay at `http://127.0.0.1:5173/` was opened in a fresh
in-app Browser tab. It rendered the real OpenCorvus application shell and
canonical Work Ledger/Workbench composition; no fixture, temporary frame, query
override, local signal, synthetic record, or hidden state write was used. The
backend event stream remained in its visible Connecting state, which did not
alter the shell-owned corner geometry or paint being accepted here.

The full 1280-by-720 desktop page was inspected at original resolution. The
task region was then cropped from that same screenshot and inspected again at
its original 220-by-170 resolution:

- [`../../artifacts/2026-07-30-workspace-rounded-corner-clean.png`](../../artifacts/2026-07-30-workspace-rounded-corner-clean.png)

The screenshot shows one clean white curve against the continuous pale-blue
rail. There is no neutral-gray rectangle outside the curve, no square
Conversation child covering it, no pointed remnant, and no second background
layer. The visible resizer remains a transparent one-pixel layout boundary.

Bounded read-only inspection of the same rendered page reported:

| Surface or property    | Evidence                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Work Ledger rail       | `x=0`, `y=36`, `width=280`, `height=684`; semantic pale gradient over `rgb(247, 247, 247)`                                                    |
| Left resizer           | `x=280`, `y=36`, `width=1`, `height=684`; transparent resting background                                                                      |
| Workbench              | `x=281`, `y=36`, `width=999`, `height=684`; white semantic workspace fill                                                                     |
| Corner and clipping    | `border-top-left-radius: 24px`; `overflow: hidden`; all four canonical Workbench children remain under this owner                             |
| Edge-depth composition | `6px 0 24px -18px inset` left channel plus the existing `0 6px 24px -18px inset` top channel; no exterior Workbench shadow remains            |
| Material outside curve | The existing rail gradient is directly visible; the inspected crop contains no separate neutral paint band between the gradient and the curve |

## Verification

| Check                                           | Result                                                                                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Overlay TypeScript typecheck                    | Passed with `tsc --noEmit`                                                               |
| Overlay localization validation                 | Passed with the canonical panel checker                                                  |
| Overlay production Vite build                   | Passed; `dist-vite` completed with 281 emitted assets and a fresh entry bundle           |
| Historical documentation links                  | Passed                                                                                   |
| Document health                                 | Passed after the concurrent record became tracked; 63 checks and 1,314 assertions passed |
| Product-document single source                  | Passed                                                                                   |
| Task-owned Markdown formatting                  | Passed                                                                                   |
| Task-owned `git diff --check`                   | Passed                                                                                   |
| Real-page screenshot and personal visual review | Passed twice: full desktop page and task-region crop at original resolution              |
| UI automated tests                              | None added, modified, updated, deleted, or run                                           |

## Second Review

A final production grep reconfirmed that `App.tsx` mounts one
`.workspace-main`, `workspace.css` remains its sole radius/clip/shadow
compositor, `design-language.css` remains the only geometry-token owner,
`activity.css` and `titlebar.css` retain the single rail paint, and the theme
cascades retain semantic rail/workspace material separation.

The final product diff restores the existing extra-large corner token, changes
the existing left shadow channel from exterior to inset, and flips only that
channel's horizontal offset so its depth stays on the left interior edge. It
adds no wrapper, pseudo-element, mask, raw corner color, second background,
theme branch, state, fallback, compatibility path, gate, or interaction
change. Unrelated concurrent Conversation, Composer, Right Dock, Progressive
List, Inspector, architecture, record, and screenshot changes remain outside
this task and will not be staged.
