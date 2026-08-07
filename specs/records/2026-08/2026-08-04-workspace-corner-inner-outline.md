# Workspace Corner Inner Outline

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User correction       | The previous shadow removal still leaves a pointed shadow-like shape at the Workbench upper-left corner. Adjust it again while retaining the requested Codex-style outline.                                                                                                                                                                                                                                                                                     |
| Current evidence      | The prior real-page crop `.scratch/workspace-corner-border-crop.png` was enlarged four times with nearest-neighbor sampling and personally inspected. `box-shadow` is already `none`; the remaining gray wedge follows the antialiased outer edge of the physical top/left border where it blends with the pale rail.                                                                                                                                           |
| Acceptance criteria   | Keep the desktop Workbench's single 24-pixel upper-left radius and square remaining corners. The pale rail must meet the white curve directly with no gray wedge, pointed remnant, diffuse wash, or second layer. A quiet continuous outline remains visible entirely inside the white Workbench surface. Layout coordinates, clipping, child surfaces, and interactions remain unchanged.                                                                      |
| Hard constraints      | Desktop-only. Keep `.workspace-main` as the sole radius, clipping, fill, and outline owner. Use mature CSS outline geometry and existing `--oc-border-width`, `--border`, and `--oc-radius-xl` tokens. Do not add a pseudo-element, mask, wrapper, shadow, theme branch, fallback, state, gate, or UI automated test. Preserve every concurrent change. Use Node-backed headed Chromium for screenshot review and stop the isolated server in the same command. |
| Sources read          | `AGENTS.md`; user comparison screenshot; prior current-source full screenshot and exact crop; four-times nearest-neighbor crop; `workspace.css`; `design-language.css`; `App.tsx`; current panel architecture; and the August 3 border-convergence record.                                                                                                                                                                                                      |
| Whole-repository grep | `App.tsx` still mounts one `#workspaceMain`; `workspace.css::.workspace-main` remains the only production macro-frame owner and the only relevant top/left physical-border consumer. The retired workspace-shadow tokens have no production consumers. Existing outline recipes use tokenized offsets, but no second Workbench outline owner exists.                                                                                                            |
| Independent review    | The previous Codex review correctly confirmed there was no remaining `box-shadow`; the user's new evidence supersedes its visual acceptance of the physical border. A new Codex read-only review will examine the inner-outline replacement after real-page verification.                                                                                                                                                                                       |

## Cause Chain

1. The observable pointed shape remains even though computed `box-shadow` is
   `none`, so the previous diagnosis is no longer sufficient.
2. The current physical top and left borders occupy the rounded outer edge.
   Chromium antialiases that edge against the pale rail, producing a translucent
   gray wedge outside the white visual surface.
3. Completing the other two physical border sides cannot alter the top-left
   arc, because that arc is composed only from the top and left border edges.
4. A closed outline with a negative one-border-width offset follows the same
   radius but paints inside the white surface. Transparent top and left borders
   retain the exact native border-box geometry without mixing gray paint into
   the rail. This removes the external gray wedge while preserving a Codex-style
   boundary line and the original child coordinates.

## Complete Call-Site Disposition

| Owner or consumer                                                     | Decision                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/App.tsx`                             | Preserve the sole Workbench shell and sibling order.                                                                                                                                                       |
| `packages/overlay/src/styles/surfaces/workspace.css::.workspace-main` | Make the physical top/left borders transparent so their native box geometry remains; draw one closed semantic outline offset inward by its own width; preserve radius, fill, clip, and `box-shadow: none`. |
| `packages/overlay/src/styles/tokens/design-language.css`              | Preserve canonical width, color, and radius tokens; add no local geometry token.                                                                                                                           |
| `specs/current/architecture/07-panel.md`                              | Clarify that the macro-frame outline is closed and inset inside the curved surface.                                                                                                                        |
| Existing UI tests                                                     | Do not search further, add, modify, or run. Visual acceptance is real-page screenshot review only.                                                                                                         |

## Verification Plan

1. Commit and push this correction plan before product edits.
2. Replace the physical partial border with the inward closed outline and update
   the current architecture source of truth.
3. Run Overlay typecheck, production build, documentation health, and static
   integrity checks without running UI tests.
4. Open a real current-source 1440-by-900 desktop page, capture the full shell
   and exact corner crop, enlarge the crop, and personally compare the outside
   arc pixels with the previous evidence.
5. Run a bounded Codex read-only review, commit with the required prefix, push
   to `myhexin`, and verify local/remote convergence.

## Progress

- [x] Reproduce the remaining pointed shape in the prior exact crop and inspect
      its nearest-neighbor pixels.
- [x] Re-enumerate the production owner and outline/border consumers.
- [x] Record the revised cause, call-site disposition, and verification plan.
- [x] Commit and push the pre-change correction plan.
- [x] Implement and visually verify the inner outline.
- [x] Complete independent review, final commit, and git-cc push.

## Real-Page Visual Evidence

The current-source Overlay was opened in headed Chromium through the Vite
JavaScript API at a 1440-by-900 desktop viewport. The browser and isolated
server were closed in the same command. No fixture, query override, local state
injection, or UI automated test was used.

The final full page, exact corner crop, and nearest-neighbor four-times crop were
personally inspected:

- `.scratch/workspace-corner-inner-outline-final-full.png`
- `.scratch/workspace-corner-inner-outline-final-crop.png`
- `.scratch/workspace-corner-inner-outline-final-crop-4x.png`

Compared with `.scratch/workspace-corner-border-crop-4x.png`, the final crop has
no translucent gray wedge at the outside arc or pointed continuation where the
curve meets the left edge. The pale rail meets the white curve directly, while
the quiet outline remains inside the Workbench.

Browser-computed geometry confirms the original border-box relationship is
preserved: the Workbench remains at `x=281`, `y=36`; its Conversation child
starts at `x=281.5714416503906`, `y=36.57143020629883`; the transparent top and
left borders resolve to `0.571429px`; the outline resolves to `0.571429px` with
`-0.571429px` offset; the upper-left radius remains `24px`; `box-shadow` remains
`none`; and clipping remains `hidden`.

## Verification

| Check                                                                 | Result                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overlay TypeScript typecheck                                          | Passed.                                                                                                                                                                                                                                                                                                |
| Overlay production Vite build                                         | Passed after transforming 7,061 modules; existing dependency-directive and large-chunk warnings remained informational.                                                                                                                                                                                |
| Historical links, document health, and product-document single source | Task-owned plan state passed 70 tests and 1,188 assertions. The final rerun was blocked only by two unrelated concurrent untracked records already linked from the shared monthly index: `2026-08-04-streaming-conversation-dom-identity.md` and `2026-08-04-browser-menu-live-surface-continuity.md`. |
| Static integrity                                                      | `git diff --check` passed.                                                                                                                                                                                                                                                                             |
| Real-page visual review                                               | Passed at original and four-times nearest-neighbor resolution.                                                                                                                                                                                                                                         |
| UI automated tests                                                    | None added, modified, or run.                                                                                                                                                                                                                                                                          |

## Independent Review

Codex CLI `0.146.0` first identified that replacing physical borders with a
non-layout outline alone changed child geometry. The implementation was revised
to retain transparent native borders as exact geometry owners. The final
read-only review reported no high, medium, or blocking findings and confirmed
that the transparent borders preserve the border box, the inward outline
follows the 24-pixel curve, `box-shadow: none` remains, and `.workspace-main`
is still the single boundary owner. Its only low finding was the then-stale
verification section, corrected above.
