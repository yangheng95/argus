# Left Rail Resting Seam Retirement

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Hide the extra vertical line highlighted between the left rail and the conversation workspace in `codex-clipboard-7721531d-3ff8-4c8a-bcf0-a980d319f965.png`. |
| Acceptance criteria | The left rail has no permanent hard vertical seam at rest; the workspace keeps its established soft ambient edge and rounded top-left corner; the existing left-pane resize hit target remains transparent at rest and retains pointer, hover, focus, keyboard, persistence, and accessibility behavior; focused source tests, a Node-launched real browser fixture, screenshot review, Overlay TypeScript, documentation health, second review, commit, and legacy remote push succeed. |
| Hard constraints | Visual-only desktop scope. Do not remove or replace `#leftPaneResizer`, change pane geometry/state, add a covering mask, theme override, fallback, compatibility selector, gate, mobile/tablet work, or worktree. Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Playwright starts through Node in an isolated fixture. Preserve unrelated dirty Agent Rail and Memory work. |
| Supplied evidence | The supplied 252-by-1554 crop was inspected at original resolution. Pixel sampling shows a persistent dark two-pixel band at x=58..59 across y=54, 95, 200, 500, 1000, and 1500, between the pale rail and white workspace. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/current/architecture/99-principles.md`; the 2026-07-10 two-region shell, 2026-07-14 workspace surface continuity, 2026-07-17 rail/shadow parity, 2026-07-18 Windows titlebar/Dock continuity, 2026-06-17 left-pane accessibility, and 2026-06-23 pane legal-size records; current `App.tsx`, `activity.css`, `workspace.css`, `conversation.css`, pane service, static tests, and real browser fixtures. |
| Whole-repository grep | `App.tsx` is the only production owner of `#leftActivityShell`, `#leftPaneResizer`, and `#workspaceMain`. `activity.css` is the only production rule that gives `.left-activity-shell` the resting inset edge. `workspace.css` is the only owner of the transparent pane-resizer box/hit area and the established workspace ambient shadow. `left-work-ledger-shell.test.ts`, `left-dock-opaque-shell.test.ts`, and architecture guards cover rail ownership; `pane-config.test.ts`, `pane-resizer-css.test.ts`, and `left-pane-resizer-browser.test.ts` cover interaction and geometry; `workspace-surface-continuity.test.ts` and its Node browser fixture cover material/shadow/seam behavior. No route, schema, API, or runtime state writer is involved. |
| Git/toolchain baseline | `HEAD` and `legacy-remote/work-v0.0.11beta-yr-0720` were both `9e63b5fe5` after fetch. The first pre-push exposed a missing installed `property-information`; `bun install --frozen-lockfile` restored it without tracked changes. The second exposed stale Software Development Kit (SDK) `dist` declarations; rebuilding the canonical SDK artifacts made Overlay typecheck pass without tracked SDK changes. Concurrent unrelated Agent Rail and Memory edits appeared afterward and are excluded from this task. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |

## Causal chain

1. **Observable:** a permanent dark vertical line separates the rail from the conversation surface, most visible at the rounded workspace corner.
2. **Direct trigger:** `.left-activity-shell` paints `inset calc(-1px * var(--ui-scale)) 0 0 ...` on its right edge while the adjacent `.workspace-main` already paints the intended soft left ambient shadow.
3. **Deep cause:** commit `1a4b735b2` replaced the glass underlay with opaque surfaces and converted the former platform edge into a new unconditional rail-local inset edge. That duplicated boundary ownership: the rail paints a hard line and the workspace paints the elevated edge.
4. **Why the prior path did not prevent it:** current continuity coverage asserts the workspace shadow and right-dock resting seams, but does not assert that the left shell itself is shadowless. The real fixture therefore passed while still rendering the newly added rail-local seam.
5. **Root repair:** remove the unconditional rail-local inset shadow. Keep the existing workspace ambient shadow as the single resting visual boundary and keep the real pane-resizer box and expanded `::after` hit area unchanged.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/styles/surfaces/activity.css` | Remove the sole resting `box-shadow` from `.left-activity-shell`; keep width, material, color, collapse, and overflow unchanged. |
| `packages/overlay/src/styles/surfaces/workspace.css` | Keep `.workspace-main` left/top ambient diffusion and `.pane-resizer` geometry, transparent resting background, hover/focus/active feedback, and `::after` hit area unchanged. |
| `packages/overlay/src/components/App.tsx` and `packages/overlay/src/services/pane.ts` | Keep the single DOM and pane semantics owners unchanged. |
| `packages/overlay/test/left-work-ledger-shell.test.ts` | Add a source regression asserting that the left shell has no local `box-shadow`, while the workspace remains the ambient-edge owner. |
| `packages/overlay/test/browser/workspace-surface-continuity-browser.test.ts` | Measure the production shell relationship in all three desktop themes; wait for the transitioning `body` background to equal the token-resolved `--body-bg` paint before measurement; assert the left shell and resting pane-resizer have no box shadow/background line, preserve the workspace ambient shadow, and regenerate screenshots for visual review. |
| Pane interaction tests | Re-run the canonical Node `left-pane-resizer-browser.test.ts`; do not rewrite its interaction contract unless a real regression is observed. |
| Other rail/material tests and unrelated dirty files | Preserve. They do not create this resting seam and must not receive a second styling source or be folded into this task's commit. |

## Implementation and verification plan

1. Add focused failing source/browser assertions for a shadowless left shell and transparent resting resize handle.
2. Remove the duplicated rail-local inset edge at its sole production owner.
3. Run focused source tests, Overlay TypeScript and internationalization checks, and Node browser fixtures for three-theme continuity and left-pane keyboard/pointer resize.
4. Inspect the regenerated task-scoped screenshots at original resolution; iterate if a hard seam remains or the workspace edge/corner/resizer regresses.
5. Run historical/document-health checks, re-grep owners, review the exact diff and screenshots a second time, then commit only task-owned files with the `dsw-33987` prefix and push the current branch to `legacy-remote` after fetch/convergence checks.

## Progress

- [x] Supplied screenshot, pixel evidence, history, architecture decisions, production owners, tests, and full call surface inspected.
- [x] Regression tests and production source updated.
- [x] Real browser and visual acceptance complete.
- [ ] Second review, documentation health, commit, and legacy remote push complete.

## Verification evidence

- The new source regression failed before production changed and identified the exact remaining declaration: `.left-activity-shell { box-shadow: inset ... }`.
- Focused source coverage passes: 18 tests / 280 expectations across left-shell ownership, workspace continuity, pane semantics, and retired right-handle coverage.
- Overlay `typecheck` and `check:i18n` pass after the canonical SDK build refreshed stale ignored `dist` declarations; no SDK source or compatibility type was changed.
- The Node-launched three-theme workspace continuity fixture passes. Computed styles prove `.left-activity-shell` has `box-shadow: none`, the resting `.pane-resizer-left` has transparent background and no shadow, and `.workspace-main` retains both independent ambient shadow channels. Screenshots reviewed at original 1500-by-900 resolution: `.scratch/workspace-surface-continuity-{light,dark,vscode-dark}.png` show no hard rail-local seam, while the rounded workspace corner and soft edge diffusion remain coherent.
- The canonical Node-launched left-pane separator test passes after a production Vite build. Keyboard focus, Home/End/arrow resizing, pointer dragging, live Accessible Rich Internet Applications (ARIA) values, legal minimum/maximum widths, restoration, and screenshot output remain intact. `.scratch/left-pane-resizer-{accessibility,desktop-resize,illegal-narrow-legal-frame,restored-desktop-resize}.png` were reviewed at original resolution; the blue focused/active indicator remains intentionally visible only during separator interaction.
- Historical links and product-document single-source tests pass. The combined document-health run currently has one external shared-workspace failure because the monthly index also links two other agents' untracked July records (`delegated-context-disclosure-alignment` and `memory-row-actions-visual-convergence`). This task's record will be tracked before the original check is rerun; the unrelated records are not folded into this task.

## Codex review feedback

The first post-fix screenshot review found a bright one-pixel dark-theme boundary even though computed styles proved that the left shell and resize handle were both unpainted. A geometry and theme-paint probe showed that this was not a second production seam: the three-theme fixture changed `data-theme` and captured immediately while the production `body { transition: background ... }` was still displaying the preceding light-theme background underneath the transparent one-pixel handle. The plan and browser owner were revised explicitly instead of accepting that screenshot as a theme variance. The fixture now resolves the canonical `--body-bg` through a probe, waits until the actual body paint equals it, asserts that equality, and only then measures and captures. Re-rendered dark and Visual Studio Code (VS Code) Dark screenshots have no bright transitional line; light keeps only the intended low-contrast ambient diffusion.
