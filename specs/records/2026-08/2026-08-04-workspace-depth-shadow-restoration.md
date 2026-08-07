# Workspace Depth Shadow Restoration

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Match the visible depth in the supplied Codex comparison: OpenCorvus's white Workbench must cast a soft shadow at the upper-left boundary instead of reading as a flat panel. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-e0c67648-62bc-4d98-8397-efd4bdc2e8f5.png`, inspected at its original resolution. The Codex Workbench has a restrained diffuse transition into the pale rail around the rounded upper-left edge; the OpenCorvus comparison has only a thin outline. |
| Acceptance criteria | Preserve the existing single 24-pixel upper-left radius, inward closed outline, transparent border-box geometry, clipping, layout, and interactions. Add a visible but restrained theme-aware left/outside and top/inside depth treatment owned only by `.workspace-main`. The shadow must not recreate the former broad neutral-gray corner block or pointed antialiasing wedge. Verify the real current-source desktop page and exact corner crop by personal screenshot review. |
| Hard constraints | Desktop-only. Keep `.workspace-main` as the sole Workbench radius, fill, outline, clip, and shadow compositor. Use one semantic design token driven by `--ui-scale` and the theme-owned `--ui-shadow-tone`; do not add a wrapper, pseudo-element, mask, second background, theme branch, fallback, state, gate, or User Interface (UI) automated test. Use Node-backed browser control for visual review. Preserve all concurrent changes. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied comparison; current `workspace.css`, `design-language.css`, `App.tsx`, and `specs/current/architecture/07-panel.md`; the July 14 workspace-continuity, July 29 shadow-confinement, August 3 border-convergence, and August 4 inner-outline records; relevant Git history before the shadow removal. |
| Whole-repository grep | `App.tsx` mounts one `#workspaceMain`. `workspace.css::.workspace-main` is the sole production macro-frame compositor. The current `box-shadow: none` is the direct flatness trigger. The old eight workspace-shadow parameter tokens have no remaining consumers. Theme cascades already provide the shared `--ui-shadow-tone`, so a single composite semantic token can restore depth without theme-specific duplicate implementations. |
| Independent review | None. The user did not request sub-agents, and the change has one tightly coupled visual owner. |
| Git baseline | Branch `work-v0.0.29beta-yr-0803` began at `4f4317e38e`, exactly aligned with `myhexin/work-v0.0.29beta-yr-0803`. A pre-change push entered the repository hook but was blocked by unrelated concurrent native-menu work with an incomplete `setBranchSelectorOpen` reference; those files remain outside this task. |

## Cause Chain

1. The observable OpenCorvus Workbench boundary is flat while the supplied
   Codex boundary has soft depth.
2. `.workspace-main` explicitly sets `box-shadow: none`, so its inward outline
   is the only remaining separation from the rail.
3. Earlier broad shadow geometry painted around the whole rounded corner and
   created a neutral-gray block; removing every shadow fixed that artifact but
   also removed the desired elevation cue.
4. The earlier confined geometry already demonstrated the correct physical
   model: a narrow outside-left channel supplies rail separation, while a
   clipped inset-top channel keeps the top cue visible inside the
   overflow-hidden Workbench parent.
5. Restoring those two channels as one current semantic token preserves a
   single source and the clean inner outline while avoiding the obsolete
   multi-token parameter surface.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/overlay/src/styles/tokens/design-language.css` | Add one complete `--ui-workspace-depth-shadow` semantic token using scale-aware confined geometry and the existing theme shadow tone. Do not restore the retired eight-parameter token family. |
| `packages/overlay/src/styles/surfaces/workspace.css::.workspace-main` | Consume the one semantic shadow token while preserving transparent borders, the inward outline, radius, fill, clipping, and isolation. |
| `packages/overlay/src/styles/cascade/*.css` | Preserve the single theme-owned `--ui-shadow-tone`; no workspace-specific theme branches are needed. |
| `packages/overlay/src/components/App.tsx` | Preserve the sole Workbench shell and sibling order. |
| `specs/current/architecture/07-panel.md` | Replace the obsolete no-shadow statement with the current single-owner confined-depth contract. |
| Existing UI tests | Do not search further, add, modify, update, or run. Visual acceptance uses a real page and manual screenshot inspection only. |

## Verification Plan

1. Commit and push this plan before product edits once the repository hook is
   no longer blocked by the unrelated concurrent change.
2. Add the single depth token, consume it on `.workspace-main`, and update the
   current architecture source of truth.
3. Run Overlay typecheck, production build, documentation health, and static
   integrity checks without running UI tests.
4. Open a real current-source desktop page through Node-backed browser control,
   capture the full shell and exact upper-left Workbench crop, personally
   inspect them, and tune the semantic token if the shadow is absent, too broad,
   square, or visually detached.
5. Recheck the exact diff and task-owned files, commit with the required
   `dsw-33987` prefix, push to `myhexin`, and verify local/remote convergence.

## Progress

- [x] Inspect the supplied comparison and current production owner.
- [x] Trace the removed shadow history and identify the direct flatness cause.
- [x] Record Recall, causal chain, call-site disposition, and verification plan.
- [x] Commit and push the pre-change plan.
- [x] Implement the single-owner depth shadow and architecture update.
- [x] Complete non-UI checks and real-page visual review.
- [x] Complete final review, commit, and git-cc push.

## Real-Page Visual Evidence

The current-source Overlay was opened from an isolated Node-started Vite server
at `http://127.0.0.1:41789/` in the Codex in-app Browser. The real 1280-by-720
desktop page was reloaded for a second review. No temporary iframe, local
signal, query override, synthetic preview, or UI automated test was used. The
isolated tab and exact server process were closed after review.

The final full page, exact upper-left Workbench crop, and four-times
nearest-neighbor crop were personally inspected:

- `.scratch/workspace-depth-shadow-final-full.png`
- `.scratch/workspace-depth-shadow-final-crop.png`
- `.scratch/workspace-depth-shadow-final-crop-4x.png`

The crop shows a continuous soft depth transition along both the left and top
Workbench edges. The shadow follows the rounded surface without painting a
square gray block or pointed continuation into the pale rail. The inward
outline remains crisp inside the white surface.

Browser-computed geometry confirms the Workbench remains at `x=281`, `y=36`
with a 24-pixel upper-left radius, hidden overflow, and the unchanged
0.571429-pixel inward outline. The resolved shadow is one outside-left channel
at `-6px 0 24px -14px` with 0.048 alpha plus one inset-top channel at
`0 6px 20px -14px` with 0.042 alpha.

## Verification

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed. |
| Overlay production Vite build | Passed after transforming 7,071 modules; existing third-party directive and large-chunk warnings remained informational. |
| Historical links and product-document single source | Passed. |
| Document health | 69 checks passed. The only failure is an unrelated concurrent monthly-index entry for the untracked `2026-08-04-browser-overlap-and-review-tab-close.md`; this task neither owns nor changes that record. |
| Static integrity | `git diff --check` passed. |
| Real-page visual review | Passed twice at 1280 by 720, including the exact four-times crop. |
| UI automated tests | None added, modified, updated, or run. |
