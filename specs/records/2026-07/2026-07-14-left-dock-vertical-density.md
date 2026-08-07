# Left Dock Vertical Density

## Recall

### User requirement

- “把左侧dock的纵向排列整体compact一点儿”。
- The supplied 515 × 1253 screenshot shows excessive vertical rhythm across the four static navigation rows, the Projects heading/project row, and the visible Chat/Mission rows.

### Acceptance criteria

- The left Dock keeps its current information architecture, horizontal grid, typography, icons, footer, hover, focus, and selection semantics.
- At UI scale 1, static navigation/search rows use a 36px height, project headers use 26px, top-level Work Ledger rows use 34px, and nested rows use 26px.
- The Projects heading uses an 8px top margin and 4px bottom margin; row-family gaps remain visually distinct without the current loose blocks.
- A single sidebar density contract owns these four heights; `sidebar.css` and `work-ledger.css` must not retain independent numeric row-height authorities.
- A Node-driven isolated browser fixture measures rendered geometry and captures the whole left Dock at desktop width. Manual screenshot review must confirm the rail is visibly denser without clipping, overlap, or loss of hit targets.

### Hard constraints

- No fallback, compatibility rule, second density override, component-local inline geometry, or responsive/mobile scope.
- Keep `sidebar.css` as the sidebar rhythm owner; `work-ledger.css` consumes its custom properties.
- Do not restart, reload, close, or otherwise affect the user's running OpenCorvus/Overlay process.
- Preserve the dirty worktree and existing staged index; no reset, restore, stash, or new worktree.
- Playwright is launched with Node. Benchmark timeout is 120 seconds of output inactivity, not elapsed time since process start.

### Sources read

- `AGENTS.md`
- `benchmark-debug-template` skill
- `browser:control-in-app-browser` skill and complete browser documentation
- `specs/records/2026-07/2026-07-13-sidebar-surface-continuity.md`
- `specs/records/2026-07/2026-07-14-overlay-neutral-codex-chrome-repair.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `packages/overlay/src/styles/surfaces/sidebar.css`
- `packages/overlay/src/styles/surfaces/work-ledger.css`
- `packages/overlay/test/overlay-left-rail-density.test.ts`
- `packages/overlay/test/work-ledger-consolidation.test.ts`
- `packages/overlay/test/browser/neutral-chrome-wash-browser.test.ts`
- `packages/overlay/test/browser/multica-import-browser.test.ts`

### Whole-repository search evidence

`rg` covered every `sidebar-codex-*`, `sidebar-body`, `sidebar-list`, `work-ledger-section-title`, `work-ledger-projects-scroll`, `ledger-list`, `project-group*`, `task-row-mini`, `work-row*`, left-rail screenshot, and density-test call site across `packages/overlay/src`, `packages/overlay/test`, and July records.

| Current owner/call site | Decision |
| --- | --- |
| `.sidebar-codex-action` and `.sidebar-codex-search-toggle` | Replace independent 42px values with the shared static-nav height. |
| `.project-group [data-ui="project-group-toggle"]` | Replace independent 28px value with the shared project height. |
| `.task-row-mini` | Consume the shared nested-row height for generic task rows. |
| `.work-row` | Consume the shared top-level Work Ledger height instead of 40px. |
| `.work-row-child .work-row` | Consume the same shared nested-row height instead of its separate 28px literal. |
| `.work-ledger-section-title` | Tighten only its vertical margins; preserve the common 14px horizontal rail grid. |
| `.project-group-body`, `.ledger-list`, row grids and action rails | Preserve horizontal indentation, alignment, hover actions, and selection ownership. |
| `overlay-left-rail-density` and `work-ledger-consolidation` | Update contracts to assert the shared variables and new values. |
| New browser density benchmark | Measure all row families, assert monotonic non-overlapping layout, and save a scoped screenshot. |

### Independent agent feedback

- None. The user did not request delegation and collaboration policy forbids spawning an unrequested sub-agent.

## Root cause

The rail does not have one vertical-density model. Static navigation (42px), project headers (28px), top-level work rows (40px), nested rows (28px), and the Projects heading margins were tuned independently. At the active UI scale these values expand into visibly separate blocks, so reducing only one selector would leave the overall cadence inconsistent.

## Design

- Define four semantic height custom properties on `.sidebar`: static navigation, project header, top-level Work Ledger row, and nested row.
- Consume those properties from the existing canonical rules in `sidebar.css` and `work-ledger.css`.
- Tighten the Projects heading margins and the static navigation's bottom spacing while preserving horizontal gutters and all interaction states.

## Benchmark

- Input: the supplied left-Dock screenshot plus a deterministic desktop fixture containing four navigation actions, Projects heading, one project, and three Work Ledger rows.
- Output: the same information architecture rendered with the compact single-source geometry above.
- Environment: repository CSS loaded by `packages/overlay/test/launch.ts`; browser launched by Node through the existing sidecar.
- Timeout: `script/run-with-inactivity.ts --inactivity-ms 120000`; the timer resets whenever the test emits output.
- Pass conditions: exact computed row heights, no overlap, preserved left/right alignment, screenshot written, zero browser errors, focused source tests/typecheck pass, and manual screenshot review passes.

## Current external blocker

The mandatory pre-change push found the branch already synchronized, then the hook failed in unrelated dirty `packages/opencorvus/src/task-artifact/snapshot.ts` and `src/tool/plugin-tool-host.ts` changes. This task does not modify those backend files and will not bypass the hook.

## Result

- PASS: the source contract defines one sidebar authority for 36px static navigation, 26px project headers, 34px top-level Work Ledger rows, and 26px nested rows at UI scale 1.
- PASS: the visible Node browser benchmark ran at UI scale 1.5 and measured 54/39/51/39px respectively, 12/6px scaled Projects margins, monotonic non-overlapping rows, a 900px desktop Dock, and a valid PNG.
- PASS: screenshot evidence is `.scratch/left-dock-compact.png`; manual second review confirmed compact continuous rhythm, preserved hierarchy, an intact selected-row wash, aligned timestamps, and an anchored footer.
- PASS: 19 focused sidebar/project/task-row tests plus the focused Work Ledger density test; Overlay `tsc --noEmit`; historical-doc links; product-doc single source; scoped `git diff --check`.
- External document-health failures: 75/77 passed. The two failures are pre-existing concurrent dirty-worktree drift in the provider schema source assertion and monthly README links to several untracked July records. This record will cease being one of those untracked links once committed; the other records and provider refactor are outside this visual task.
- The in-app Browser accepted setup and complete documentation but blocked direct `file://` navigation to the local PNG by security policy. No workaround was attempted; the required visual review used the Node-rendered page screenshot and direct local image inspection.
- No dead or retired production code was found or deleted.

## 2026-07-14 Descender clipping follow-up

### Recall

- User evidence shows the project label `project` with the lower stroke of `j` clipped.
- The compact 26px project row remains the accepted density authority; the repair must not increase row height.
- `button.css` gives every `.oc-button` `line-height: 1`, while `.project-group-name` inherits that line box and both it and `.project-group-copy` clip overflow.
- Repository search covered the project toggle, copy/name wrappers, Button primitive typography, compact browser fixture, and density contracts.

### Acceptance

- Project-name descenders (`g`, `j`, `p`, `q`, `y`) render inside a token-owned line box without clipping.
- The row remains 26px at UI scale 1 and 39px at the browser fixture's UI scale 1.5.
- The existing Node browser fixture must render `project gjpqy`, assert the computed text line box is taller than the font size, save a scoped screenshot, and pass manual review.

### Result

- PASS: `.project-group-name` now consumes the existing `--ui-line-height-tight` typography token while the canonical project-row height remains unchanged.
- PASS: the Node browser fixture rendered `project gjpqy`, retained the 39px scaled project row, passed its line-box assertion, and wrote `.scratch/left-dock-compact.png`.
- PASS: manual screenshot review confirmed all five descenders are visible without overlap or density regression.
- PASS: focused density tests (2 tests, 13 assertions), Overlay TypeScript, and scoped `git diff --check`.
- Unrelated evidence: `work-ledger-consolidation.test.ts` has one pre-existing source-string assertion for the retired `if (missionSubmitActive())` shape; the other 9 rows passed. This follow-up does not modify Mission submission behavior.

## 2026-07-14 Icon density follow-up

### Recall

- User evidence shows oversized, widely spaced project and Work Ledger action icons plus visually heavy Rocket/Target row-kind icons.
- Current CSS expands 22px action buttons with 4px gaps and 4px rail padding by `--ui-scale`; at scale 1.5 this becomes 33px buttons and 6px gaps.
- Project actions, Work Ledger actions, row-kind marks, central Icon names, hover/focus visibility, and browser geometry call sites were inventoried before implementation.

### Acceptance

- Project actions use a 16px semantic action box; Work Ledger actions use an 18px box with 2px gap/padding and formula-derived rail widths.
- Mission and Task kind marks use restrained Workflow and ListChecks registry icons; Chat keeps its established Sparkles identity.
- Row heights, accessible labels, tooltips, keyboard action opening, hover/focus/danger tones, and pin/unpin behavior remain unchanged.
- A Node browser fixture must measure the compact geometry and produce a left-Dock screenshot for manual review.

### Result

- PASS: project action boxes are 16px, Work Ledger action boxes are 18px with 2px gap/padding, and all six action-count widths use the derived compact formula.
- PASS: Mission uses the central Workflow icon and Task uses ListChecks; the existing Icon registry remains the only icon source.
- PASS: 15 focused source tests (149 assertions), production Vite build, and the real Work Ledger pin/unpin browser interaction passed.
- PASS: `.scratch/work-ledger-project-unpin-hover.png` and `.scratch/work-ledger-row-pin-hover.png` were manually reviewed; action clusters are compact, titles retain more width, and pin/edit/delete semantics remain legible.

## 2026-07-17 Merged-line density regression follow-up

### Recall

- User reports that the merged build's left Dock row spacing is still slightly too large and supplied a focused screenshot covering the Project, Mission, nested Task, and Chat rows.
- The user has identified `myhexin/work-v0.0.8beta-yr-0717` as the correct remote visual baseline for the surrounding merged UI. The current main branch and that remote branch share the same enlarged Dock tokens, so this follow-up is an additional density correction rather than a missing branch merge.
- Acceptance: Project, Mission, nested Task, and Chat retain their current information architecture, typography, icons, indentation, selected state, action rail, and keyboard behavior while returning to the already-established compact Dock rhythm.
- Hard constraints: `sidebar.css` remains the single height authority; `work-ledger.css` only consumes its semantic properties; no selector-local override, compatibility path, responsive scope, or intervention in the user's running OpenCorvus window.
- Sources read: this record; the supplied screenshot; `sidebar.css`; `work-ledger.css`; `WorkLedger.tsx`; `ProjectLedgerGroup.tsx`; `LedgerRowMainButton.tsx`; `overlay-left-rail-density.test.ts`; `project-ledger-group-browser.test.ts`; commits `26b0e9d654` and `0e8ae64d5a`; and the complete browser-skill instructions.
- Whole-repository search covered every sidebar height token and every `project-group`, `ledger-list`, `work-row`, `task-row-mini`, row gap, padding, minimum-height, source-test, and browser-fixture call site under `packages/overlay/src`, `packages/overlay/test`, and July records.
- Independent agent feedback: none; the user did not request delegation.

### Root cause

Commit `0e8ae64d5a` enlarged the four semantic Dock tokens from the previously accepted 30/24/26/24px static-nav/project/work/nested contract to 36/26/34/26px while converging icon semantics. At UI scale 1.5 this changes the visible row heights from 45/36/39/36px to 54/39/51/39px. The top-level Mission/Chat row therefore gains 12 rendered pixels, which creates the loose cadence visible in the supplied screenshot. The consumer rules and group gaps are already single-source and do not need another override.

### Design and benchmark

- Restore the existing four `.sidebar` properties to 30/24/26/24px; do not change consumer selectors or introduce a second density source.
- Update the source contract to protect those exact semantic values.
- Extend the existing Node-driven left-Dock fixture to measure Project, Mission, nested Task, and Chat rows together, assert non-overlap and the scaled 36/39px geometry at UI scale 1.5, and write a task-scoped screenshot.
- Pass conditions: focused source tests, Overlay typecheck/build, the real Node Playwright fixture, manual screenshot review, document-health checks, scoped diff review, commit, and push to `myhexin/v0.0.8beta`.

### 2026-07-17 Popup and hover-radius addition

- User additionally reports that popup and hover backgrounds do not have enough corner radius.
- Repository search confirms that the shared `.oc-navigation-row` primitive is the sole owner of Project/Work Ledger hover and selected washes, while `.oc-tooltip` is the mature primitive used by Work Ledger's hover summary popup. Dropdown and Popover outer shells already consume `--oc-radius-large`; feature CSS is intentionally forbidden from redefining their radius.
- Use the existing `--oc-radius-large` token for navigation-row feedback and Tooltip popup shells instead of changing the global radius scale or introducing feature-local values. This raises both affected backgrounds from the 4px soft radius to the established 8px large radius at scale 1, while menus/popovers remain on the same established popup radius.
- Extend primitive source tests and the Node Dock fixture to assert the computed 12px radii at scale 1.5 and capture both the selected/hover row wash and an open Work Ledger summary Tooltip in task-scoped screenshots.

### 2026-07-17 Result

- PASS: the single sidebar contract is restored to 30/24/26/24px at UI scale 1, and the nested Work Ledger consumer again uses the nested-row token. The task-scoped browser fixture measured 45px static navigation, 36px Project, 39px Mission/Chat, and 36px nested Task rows at UI scale 1.5 with no overlap.
- PASS: shared navigation hover/selected washes and Tooltip popup shells consume `--oc-radius-large`; the fixture measured both at 12px under UI scale 1.5. `.scratch/left-dock-compact.png` was manually reviewed and shows compact row cadence plus visibly rounder selected and popup backgrounds without clipping or hierarchy drift.
- PASS: 23 focused density/primitive/Work Ledger tests, 137 radius/architecture/owner tests, the Node Playwright Dock fixture, Overlay TypeScript, production Vite build, 21 historical-document health tests, and scoped diff checks.
- Existing external failures: the broader `project-ledger-group-browser` scenario stops before this task's popup checkpoint because its pre-existing Kobalte menu assertion expects DOM focus on `project-group-pin` while the current primitive retains focus on `project-group-more`. The repository-wide Overlay test-directory invocation also has 472 unrelated failures caused by shared global mock/store contamination and concurrent application changes; all task-owned tests pass when run in their intended focused processes. Neither failure was hidden or weakened in this task.
- The user's running OpenCorvus/Overlay process was not refreshed, restarted, closed, or otherwise modified.
