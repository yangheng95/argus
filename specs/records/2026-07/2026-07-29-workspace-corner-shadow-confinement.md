# Workspace Corner Shadow Confinement

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Remove the dark-looking background around the Workbench's rounded top-left corner and align the result with Codex. |
| Acceptance criteria | The desktop light-theme corner keeps the existing tokenized top-left radius and pale-blue Codex rail; the rail paint remains continuous outside the curve instead of being covered by a broad neutral-gray shadow; a restrained workspace separation remains along the left edge; the Workbench surface, clipping, header geometry, rail width, and interactions remain unchanged; a real isolated page is opened, captured, and personally reviewed at desktop size. |
| Hard constraints | Desktop-only scope; preserve the unrelated existing `packages/opencorvus/src/skill/builtin-payload.ts` change; keep `.workspace-main` as the single raised-surface owner; reuse the current shadow composition instead of adding a mask, pseudo-element, local color patch, fallback, or second background source; do not add, modify, update, or run UI automated tests; do not touch the user's running OpenCorvus process; use Node, never Bun, for browser control. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-e54d59c3-f3ca-49df-8283-c33e3e38be8c.png`, inspected at its original 118-by-102 resolution. Pixel sampling separates the pale-blue rail near `rgb(239,247,249)` from the neutral-gray shadow band near `rgb(244,244,244)` around the curve. |
| Sources read | Root `AGENTS.md`; Browser control skill; `2026-07-28-workspace-top-left-radius-restoration.md`; `2026-07-27-overlay-header-plane-and-brand-alignment.md`; `2026-07-27-overlay-radius-and-input-weight-convergence.md`; `2026-07-24-light-rail-reference-gradient.md`; `2026-07-17-left-rail-scrollbar-width-workspace-shadow-parity.md`; `2026-07-14-overlay-workspace-surface-continuity.md`; current `App.tsx`, `workspace.css`, `activity.css`, `titlebar.css`, `design-language.css`, all three theme cascades, and relevant historical UI-test references. |
| Whole-repository grep | The complete search for `.workspace-main`, `--ui-workspace-left-shadow-*`, `--ui-workspace-top-shadow-*`, `--ui-workspace-edge-shadow-*`, `--rail-background-image`, and `--workspace-ambient-fill` found one production surface composer in `workspace.css`, one geometry/token owner in `design-language.css`, and the two visible rail-paint owners in `activity.css` and `titlebar.css`. Existing source/browser UI tests still pin the earlier broad-shadow contract; the 2026-07-29 prohibition requires leaving those historical UI tests untouched and unrun. |
| Independent agent feedback | None. The user did not request sub-agents, and this task has one tightly coupled visual owner. |
| Git baseline | Branch `work-v0.0.24beta-yr-0729` at `49c40cff1b`, exactly aligned with `legacy-remote/work-v0.0.24beta-yr-0729` after fetch. The unrelated tracked modification remains unstaged and outside this task. |

## Cause chain

1. **Observable symptom:** the white Workbench curve is surrounded by a gray patch instead of revealing the same pale-blue rail visible farther from the corner.
2. **Direct trigger:** the first `.workspace-main` `box-shadow` channel uses a 24-pixel blur with no negative spread, so its neutral shadow tone expands above and around the rounded boundary.
3. **Deeper cause:** the prior shadow refinement centralized offset, blur, and strength but only constrained the inset top channel with negative spread. The exterior left channel therefore still paints a broad two-dimensional halo even though its intended role is a narrow left-edge separation.
4. **Why the radius restoration exposed it:** restoring `var(--oc-radius-xl)` correctly clipped the Workbench, but the exterior shadow is painted outside that clip. The correct radius therefore made the unconstrained halo visible inside the newly exposed corner.
5. **Root repair:** add one semantic left-shadow spread token beside the existing left-shadow geometry and consume it in the existing first shadow channel. This confines the current shadow rather than covering the corner with another paint layer.

## Complete call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/styles/tokens/design-language.css` | Add the single `--ui-workspace-left-shadow-spread` geometry token next to the existing left offset and shared blur/strength tokens. |
| `packages/overlay/src/styles/surfaces/workspace.css` | Insert the left spread into the existing first `box-shadow` channel; retain the radius, ambient fill, clipping, inset top channel, and isolation. |
| `packages/overlay/src/styles/cascade/light.css` | Preserve the pale-blue `--rail-background-image` and white `--workspace-ambient-fill`; they are the desired Codex paint sources, not the defect. |
| `packages/overlay/src/styles/surfaces/activity.css` and `titlebar.css` | Preserve the two continuous consumers of the single rail paint token. |
| `packages/overlay/src/components/App.tsx` | Preserve the single `.workspace-main` shell and DOM order. |
| Existing source/browser UI tests | Do not add, modify, update, or run them. They are historical UI automation and are explicitly outside an ordinary UI task under the 2026-07-29 prohibition. |
| Spec indexes and document-health checks | Add this record to both canonical indexes; run only documentation/static integrity checks that do not assert UI rendering or source presentation. |

## Implementation and verification plan

1. Record this Recall, causal chain, complete owner disposition, and acceptance plan in the canonical July record tree and indexes.
2. Constrain the existing left shadow at its token and `.workspace-main` composition owners.
3. Run Overlay typecheck and production Vite build only; do not run UI automated tests.
4. Start an isolated real Vite page with Node-backed tooling, open it in the browser, capture a task-scoped desktop screenshot, and personally inspect the corner. Iterate if the rail does not remain continuous or the workspace edge becomes visually detached.
5. Re-grep every shadow token/consumer, review the exact diff, run documentation health and `git diff --check`, then commit with the `dsw-33987` prefix and push the current branch to `legacy-remote`.

## Progress

- [x] Inspect supplied evidence, pixel colors, repository state, prior design records, production owners, and all call sites.
- [x] Record Recall, root-cause chain, complete call-site disposition, and verification plan.
- [x] Implement the single-owner shadow confinement.
- [x] Complete real-page screenshot review and non-UI verification.
- [x] Complete second review and prepare the exact task-owned commit for legacy remote push.

## Verification

- The production Vite page was started through Node at `http://localhost:5173/` and opened through the in-app browser. The real `.workspace-main` resolved to a 24-pixel top-left radius and the new confined exterior channel `-6px 0 24px -18px`; no temporary iframe, local signal, query override, or synthetic preview was used.
- Personally inspected `.scratch/workspace-corner-shadow-after.png` at its original 1280-by-720 resolution and `.scratch/workspace-corner-shadow-after-crop.png` at 150-by-130. The broad neutral-gray patch visible in the supplied crop is gone; the exposed corner now continues the pale-blue rail, the white Workbench curve is clean, and the remaining left-edge depth is restrained.
- Overlay TypeScript passed with `bun run --cwd packages/overlay typecheck`.
- The production Vite build passed after transforming 7,057 modules. Existing third-party `use client` and large-chunk warnings remained informational.
- Historical documentation links passed 22 of 22 checks. Product documentation single-source checks passed. Document health passed 70 of 71 checks; the only failure is the tracked-record assertion for two unrelated concurrent records already linked from the shared monthly index: `2026-07-29-tool-call-tone-and-rhythm-convergence.md` and `2026-07-29-composer-mode-selected-state-contrast.md`.
- In accordance with the 2026-07-29 prohibition, no UI automated test was added, modified, updated, or run.

## Second review

- A second whole-repository grep confirmed one production shadow-token owner, one `.workspace-main` compositor, two unchanged visible rail-paint consumers, and one unchanged ambient workspace fill. No mask, pseudo-element, raw corner color, duplicate shell, fallback, or alternate theme path was introduced.
- The final task-owned production diff is one semantic spread token plus its one `box-shadow` consumption. The existing radius, offsets, blur, strength, inset top channel, clipping, background, and isolation remain unchanged.
- Concurrent changes in OpenCorvus runtime, Settings, Composer, Messages, the shared spec indexes, and two other July records remain outside this task and will not be staged.
