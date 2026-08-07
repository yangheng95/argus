# Workspace Corner Border Convergence

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement      | Remove the remaining shadow around the OpenCorvus Workbench upper-left corner and add a visible border like the supplied Codex reference. Reuse the previous implementation history rather than inventing another surface layer.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Supplied evidence     | The attached 1992-by-529 comparison screenshot was inspected at original resolution. The marked OpenCorvus corner shows a diffuse gray interior edge; the Codex surface is defined by a crisp, quiet gray outline along the rounded top and left edges.                                                                                                                                                                                                                                                                                                                                                                                                             |
| Acceptance criteria   | The desktop `.workspace-main` keeps its single 24-pixel upper-left radius and square remaining corners. No diffuse shadow remains at the top or left edge. One semantic one-pixel border follows the top and left edge, including the rounded arc, without adding a wrapper, pseudo-element, mask, second background, theme branch, or layout gap. The real current-source desktop page is captured and personally reviewed at the marked corner.                                                                                                                                                                                                                   |
| Hard constraints      | Desktop-only scope. Keep `.workspace-main` as the sole radius, clipping, fill, and outline owner. Reuse `--oc-border-width`, `--border`, and `--oc-radius-xl`. Delete retired workspace-shadow tokens instead of leaving dead configuration. Do not add, modify, update, or run UI automated tests; delete the related UI test files discovered in the touched paths. Use Node-backed browser tooling, not Bun, for visual inspection. Do not restart or close the user's running OpenCorvus/Overlay.                                                                                                                                                               |
| Sources read          | `AGENTS.md`; supplied screenshot; `specs/current/architecture/07-panel.md`; the July 29 shadow-confinement and July 30 rounded-corner records; `App.tsx`; `workspace.css`; `design-language.css`; all three theme palettes; and every related current UI test.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Whole-repository grep | `App.tsx` mounts the sole `#workspaceMain`. `workspace.css::.workspace-main` is the only production radius, clipping, fill, and shadow compositor. `design-language.css` is the only owner of the eight `--ui-workspace-*-shadow-*` tokens, and those tokens have no other production consumers. The theme cascades already define `--border` for light, dark, and VS Code dark. Related UI-only assertions exist in `header-plane-convergence.test.ts`, `design-density-tokens.test.ts`, `left-dock-opaque-shell.test.ts`, `workspace-surface-continuity.test.ts`, and the two named browser fixtures; they must be removed under the current UI-test prohibition. |
| Historical cause      | The July 29 correction narrowed a broad exterior shadow, and the July 30 correction moved both channels inside the clipped macro frame. That solved the earlier background band but intentionally retained edge diffusion. The new Codex reference supersedes that depth treatment with a border-defined surface.                                                                                                                                                                                                                                                                                                                                                   |
| Independent review    | A bounded Claude Code review was attempted with read-only tools but could not authenticate. A session-local read-only review was dispatched against the same owner and constraints; final integration remains with this session.                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Cause Chain

1. The visible gray wash at the marked corner is the computed result of two
   `inset` `box-shadow` channels on `.workspace-main`.
2. Their 24-pixel blur and 24-percent shadow tone intentionally diffuse inward
   from the top and left edges, so changing radius or rail paint cannot remove
   the symptom.
3. Codex uses a boundary line rather than ambient depth at this surface. The
   correct replacement is therefore a real top and left border at the existing
   macro owner, not another shadow tuning pass.
4. Once the shadow composition is removed, its eight geometry and strength
   tokens become dead configuration and must be deleted to preserve one source.

## Complete Call-Site Disposition

| Owner or consumer                                                     | Decision                                                                                                         |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/App.tsx`                             | Preserve the sole `#workspaceMain` element and sibling order.                                                    |
| `packages/overlay/src/styles/surfaces/workspace.css::.workspace-main` | Preserve radius, fill, clipping, and isolation; replace both shadow channels with semantic top and left borders. |
| `packages/overlay/src/styles/tokens/design-language.css`              | Delete all eight retired workspace-shadow tokens; retain canonical border width and radius tokens.               |
| `packages/overlay/src/styles/cascade/{light,dark,vscode-dark}.css`    | Preserve. Their existing `--border` values are the one theme-aware outline source.                               |
| `specs/current/architecture/07-panel.md`                              | Replace the inset edge-depth contract with the border-defined macro-frame contract.                              |
| Related UI automated tests and fixtures                               | Delete the six touched UI-test files; do not run them or create replacements.                                    |
| Historical records                                                    | Preserve as dated evidence; this record supersedes only their retained-shadow visual decision.                   |

## Implementation And Verification Plan

1. Commit and push this Recall before product edits.
2. Replace the single production shadow compositor with the semantic border,
   delete its dead tokens, update current architecture, and remove the related
   prohibited UI tests.
3. Run Overlay typecheck, production build, documentation health checks, and
   `git diff --check`; do not run UI tests.
4. Start an isolated current-source desktop page, capture the exact corner, and
   personally inspect the arc, top line, left line, and surrounding rail.
5. Perform a second diff and visual review, then commit and push the verified
   result to `legacy-remote` with the required `dsw-33987` prefix.

## Progress

- [x] Inspect the supplied screenshot, current owner, token source, full call
      surface, related tests, and historical corner decisions.
- [x] Record Recall, cause chain, call-site disposition, and verification plan.
- [x] Commit and push the pre-change plan.
- [x] Implement the single-owner border convergence and retire UI-test debt.
- [x] Complete build/static checks and real-page visual acceptance.
- [x] Complete the earlier Codex read-only review and recorded legacy remote push.
- [ ] Complete the required Claude Code read-only re-review; the current attempt
      stopped before repository reads because Claude Code was not logged in.

## Real-Page Visual Evidence

The current-source Overlay was started through the Vite JavaScript API and
opened in headed Chromium through Playwright at a 1440-by-900 desktop viewport.
The server and browser were both closed in the same `finally` path. No fixture,
query override, local state injection, Browser Preview imitation, UI test file,
or interaction with the user's running OpenCorvus process was used.

The full page and exact Work Ledger/Workbench corner crop were personally
inspected at original resolution:

- `.scratch/workspace-corner-border-full.png`
- `.scratch/workspace-corner-border-crop.png`

The crop shows the pale rail directly outside one clean white curve. A single
quiet gray outline follows the complete rounded arc, top edge, and left edge;
there is no diffuse gray wash, rectangular backing layer, square child paint,
or second boundary. Browser-computed evidence for `.workspace-main` was
`x=281`, `y=36`, `border-top-left-radius: 24px`, semantic top and left borders
resolving to `0.571429px solid rgba(32, 38, 40, 0.14)` at the active UI scale,
`box-shadow: none`, and `overflow: hidden`.

## Verification

| Check                                              | Result                                                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Overlay TypeScript typecheck                       | Passed.                                                                                                                 |
| Overlay production Vite build                      | Passed after transforming 7,061 modules; existing dependency-directive and large-chunk warnings remained informational. |
| Overlay localization validation                    | Passed.                                                                                                                 |
| Historical documentation links                     | Passed: 2 tests.                                                                                                        |
| Document health and product-document single source | Passed: 68 tests and 1,186 assertions.                                                                                  |
| Static integrity                                   | `git diff --check` and committed `git show --check` passed.                                                             |
| Real-page screenshot and personal visual review    | Passed for the full desktop page and exact corner crop.                                                                 |
| UI automated tests                                 | None added, modified, or run; six discovered UI-only suites/fixtures were deleted.                                      |

## Second Review

Codex CLI `0.146.0` completed a read-only review of the task-owned hunks in
`cb968457ea`. It reported no blocking or other findings: the two semantic
borders form one continuous rounded boundary, `box-shadow: none` removes the
diffuse edge, the retired workspace-shadow tokens have no production residue,
the current architecture matches the implementation, and all six deleted files
contained prohibited CSS, DOM, browser screenshot, or pixel-presentation
assertions. The review ignored the concurrent Conversation scrollbar work in
the same commit and made no workspace changes.

## Base Developer Closure Revalidation

The current Base Developer closure preserved the already-correct production
owner without another Cascading Style Sheets (CSS) or Document Object Model
(DOM) edit. It removed the three additional touched-path source assertion
suites that still read `workspace.css`, `App.tsx`, or the radius token source:
`workspace-surface-consistency.test.ts`, `pane-config.test.ts`, and
`flat-redesign-radius-coverage.test.ts`. The already-pending deletion of
`acceptance-panel-mount.test.ts` was preserved. No replacement User Interface
(UI) test, fixture, baseline, or runner configuration was created or executed.

The current-source Overlay was then opened from an isolated Vite server at a
1280-by-760 desktop viewport through the task Browser. The full viewport and a
180-by-150 crop around the Work Ledger/Workbench upper-left boundary were
personally inspected. The quiet gray one-pixel border follows the rounded arc
and continues along the top and left edges; only rail material appears outside
the curve, with no diffuse wash, square child overpaint, or second surface.
These task-scoped screenshots are interactive review evidence, not repository
baselines. The isolated listener was stopped and its port was verified free.
The detached preview had no console or page errors; its expected unconnected
local event streams did not affect the rendered shell.

The current closure re-ran Overlay TypeScript typecheck, the production Vite
build, generated-document consistency, the historical-links,
product-document-single-source, and document-health contracts, plus
`git diff --check`. All completed successfully. No UI automated test was run.

Claude Code Command-Line Interface (CLI) `2.1.147` was located and its current
help was read before one bounded read-only invocation with only `Read`, `Grep`,
and `Glob`. The invocation returned `is_error=true` with `Not logged in` before
reading the repository. Therefore this required independent Claude Code review
remains an explicit external-authentication blocker and is not represented as
completed. This closure did not receive the user attachment through an
attachment reference and does not claim a new pixel-level comparison against
that source image.
