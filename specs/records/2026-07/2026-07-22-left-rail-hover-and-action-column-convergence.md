# Left-Rail Hover and Action-Column Convergence

Status: complete

## Recall

| Item | Detail |
| --- | --- |
| User request | Remove the vertical line that appears when the pointer hovers the boundary beside the left rail, and make the right-side icons the same size and align them. |
| Acceptance criteria | Hovering the live left pane resize target leaves it visually transparent while pointer resize remains usable; keyboard focus and active resize keep accessible feedback. Workspace Search/Mailbox, Projects toolbar, Project hover actions, Work Ledger running indicators, and visible Mission/Chat/Task actions use the existing standard Icon tier. Every two-action left-rail cluster shares the same two visible centerlines and the trailing status/action column remains aligned. Focused tests, Overlay typecheck/build, Node-launched browser checks, task-scoped screenshots, original-resolution visual review, second review, commit, and legacy remote push pass. |
| Hard constraints | Desktop-only scope. Reuse the existing Button and Icon primitives and left-rail geometry tokens. Do not remove or replace `#leftPaneResizer`, weaken keyboard focus, change pane state/persistence, add masks, fallbacks, compatibility selectors, mobile/tablet work, or a second alignment source. Playwright runs through Node.js in an isolated fixture. Do not restart, refresh, close, or reuse the user's running OpenCorvus/Overlay. Preserve unrelated dirty files and stage only this task. Commit subjects start with `dsw-33987`, and pushes go to `legacy-remote`. |
| Supplied evidence | `codex-clipboard-7ac06543-c7cc-49b5-9f0a-c5d440f4f717.png` shows an accent-colored full-height line at the left/workspace boundary under pointer hover. `codex-clipboard-43f09608-c3a1-4443-8fb0-889b49f011a1.png` highlights the entire trailing action area: Search/Mailbox, Projects `more`/`plus`, Project actions, and Work Ledger status/actions do not form one consistent visual grid. Both originals were inspected. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/99-principles.md`; `2026-07-20-left-rail-resting-seam-retirement.md`; `2026-07-20-desktop-left-rail-and-mailbox-refinement.md`; `2026-07-21-work-ledger-visible-action-right-edge-alignment.md`; current App, WorkLedger, ProjectLedgerGroup, Icon/Button primitives, Lucide registry, design tokens, workspace/titlebar/sidebar/work-ledger CSS, pane tests, action-alignment tests, and Node browser fixtures. |
| Whole-repository grep | `App.tsx` is the only Search/Mailbox renderer and `titlebar.css` is its only geometry owner. `WorkLedger.tsx` is the only Projects toolbar, running-indicator, and Task/Mission/Chat action renderer; it explicitly assigns `compact` only to the toolbar icons and loading glyph. `ProjectLedgerGroup.tsx` is the only Project `more`/`plus` renderer. `workspace.css` is the only `.pane-resizer` paint owner and currently groups `:hover`, `:focus-visible`, and `[data-active="true"]` into the same accent background. `design-language.css`, `titlebar.css`, `sidebar.css`, and `work-ledger.css` own the trailing-axis tokens and cluster gaps. Existing source tests cover primitive ownership and the trailing centerline; `titlebar-toolbar-toggle-browser.test.ts` covers Search/Mailbox/Project SVG geometry, and `left-pane-resizer-browser.test.ts` covers real pointer/keyboard resize, but neither asserts the newly reported hover/no-line and complete two-column geometry. No route, service contract, alternate renderer, or responsive owner is involved. |
| Baseline evidence | After `git fetch legacy-remote`, `HEAD...legacy-remote/work-v0.0.15beta-yr-0722` is `0 0`. The pre-change Node browser fixture passes, proving the regression escapes current coverage; its screenshot reproduces the ragged first action column while the trailing column passes. The shared worktree contains unrelated Expert Squad, build-test, Cargo, and MirrorTest-plan edits, which remain untouched. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. |

## Causal chain

1. The full-height hover line is not the previously retired resting seam. It is the real one-pixel pane resize element changing from transparent to an accent background under `.pane-resizer:hover`.
2. Search/Mailbox use 32px icon-button boxes with a 2px gap, Projects toolbar uses 20px boxes with a 6px gap, Project actions use 20px boxes with a 1px gap, and Work Ledger actions use 18px boxes with a 2px gap. Their trailing centers are intentionally aligned, but their first centers cannot align because each two-action cluster has a different pitch.
3. The Projects toolbar `more`/`plus` glyphs and the running spinner explicitly select the 12px compact Icon tier, while the other highlighted glyphs use the 14px standard tier. The running indicator additionally occupies only a 14px slot followed by a hidden 6px row gap, moving its center away from the trailing action centerline.
4. Prior regressions asserted only the trailing centerline and selected SVG sizes. They therefore pass while the first action column is ragged and compact glyphs remain mixed into the same visual rail.
5. The root repair is to keep the resize target interactive but remove pointer-hover paint, preserve focus/active feedback, apply the existing 20px left-rail action pitch to all two-action clusters, and remove the two explicit compact tiers so the shared Icon primitive supplies one standard size.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/styles/surfaces/workspace.css` | Remove `:hover` from the accent-paint selector. Keep transparent resting/hover paint, the expanded `::after` hit target, focus-visible outline/background, and `[data-active="true"]` drag feedback. |
| `packages/overlay/src/styles/surfaces/titlebar.css` | Size Search/Mailbox buttons with the existing left-rail project-action token and remove the private two-pixel cluster gap so both icon centers join the canonical action columns. |
| `packages/overlay/src/styles/surfaces/work-ledger.css` | Remove the Projects-toolbar six-pixel gap; retain the 20px tokenized buttons. Keep the 18px Work Ledger action button plus two-pixel action-to-action gap because its pitch already equals the canonical 20px column pitch. Remove the separate right-column gap and center the standard loading glyph inside the existing 18px action slot so resting and hover states use the same trailing centerline. |
| `packages/overlay/src/styles/surfaces/sidebar.css` | Remove the Project action group's one-pixel gap; retain its 20px tokenized buttons and hover disclosure behavior. |
| `packages/overlay/src/components/WorkLedger.tsx` | Remove explicit `compact` from Projects `more`/`plus` and the loading glyph so they inherit the shared 14px standard Icon tier. Keep every action, label, callback, and status source unchanged. SVG (Scalable Vector Graphics) sizing remains owned by the shared Icon primitive. |
| Source regressions | Extend pane CSS, Projects toolbar, and left-rail density/alignment coverage to assert hover transparency ownership, one standard tier, and one action-column pitch. |
| Node browser regressions | Extend the existing titlebar/Work Ledger fixture to measure Search, Mailbox, Projects toolbar, Project actions, running status, and Mission actions. Require standard SVG boxes and both two-action centerlines within one rendered pixel. Extend the pane fixture to hover the separator, assert transparent paint, and capture a task-scoped screenshot before keyboard focus. |
| Other pane, icon, and service owners | Keep unchanged. They remain the single interaction, registry, and callback sources. |

## Verification plan

1. Add focused assertions and real-browser geometry checks that fail against the current hover paint, compact tiers, and mismatched first-column centers.
2. Apply the CSS and Icon-tier convergence at the owners listed above without changing behavior or pane geometry.
3. Run focused unit tests, Overlay typecheck and production build, then the isolated Node browser fixtures for left-rail geometry and pane resize behavior.
4. Inspect the task-scoped screenshots at original resolution and iterate until no hover line or right-column drift remains.
5. Run required documentation health, re-grep all owners, review the exact diff and screenshots a second time, commit only task-owned files, fetch/converge, and push the current branch to `legacy-remote`.

## Progress

- [x] Supplied screenshots, relevant architecture/history, production owners, test owners, and git baseline inspected.
- [x] Pre-change isolated browser fixture run and screenshot reviewed.
- [x] Failing regressions added.
- [x] Production repair complete.
- [x] Focused verification and original-resolution visual acceptance complete.
- [x] Second review complete; the recorded delivery commit is pushed to legacy remote from the current branch.

## Codex review feedback

The first post-change browser geometry run rejected the initial implementation: converting the loading glyph to the standard tier still left its rendered center 3.57px left of the canonical trailing center. Computed geometry proved that `.work-row-right` retained a six-pixel gap after a 14px raw loading slot. The repair was revised at the owning row layout: the resting right-column gap is now zero, the loading container uses the existing 18px action slot, and the shared Icon primitive renders its 14px glyph centered inside that slot. The rerun placed the loading indicator and visible Mission action columns on the same canonical axes.

## Verification results

- `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/pane-resizer-css.test.ts packages/overlay/test/projects-toolbar.test.ts packages/overlay/test/overlay-left-rail-density.test.ts packages/overlay/test/task-row-right-alignment.test.ts packages/overlay/test/project-delete-button.test.ts packages/overlay/test/mailbox-contextbar-launcher.test.ts packages/overlay/test/titlebar-brand.test.ts packages/overlay/test/pill-control-convergence.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/overlay-startup-chrome-parity.test.ts --timeout 30000`: 52 pass, 0 fail.
- `bun run --cwd packages/overlay typecheck`: pass.
- `node test/browser-runner.mjs test/browser/titlebar-toolbar-toggle-browser.test.ts`: 2 pass, including the real Vite production build and complete two-column geometry.
- `node test/browser-runner.mjs test/browser/left-pane-resizer-browser.test.ts`: 1 pass, including transparent pointer hover and retained keyboard/drag interaction.
- Original-resolution review passed for `.scratch/workspace-search-mailbox-project-plus-alignment.png`, `.scratch/work-ledger-running-loading-icon.png`, `.scratch/work-ledger-mission-actions-without-pin.png`, and `.scratch/left-pane-resizer-hover-transparent.png`. No hover seam, mixed icon tier, or visible centerline drift remains.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 pass, 0 fail.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 61 pass, 0 fail after the new indexed record entered the Git index, as required by the tracked-record contract.
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`: 5 pass, 0 fail.
- `git diff --check`: pass.
