# Work Ledger Row Alignment

## Recall

User report:

- Screenshot shows the left Projects / Work Ledger list still looks misaligned and visually odd.
- The visible surface is the left project group plus nested task rows, including task kind icons, task titles, status chips, timestamps, and hover action icons.

Acceptance criteria:

- Default task rows align kind icon, title text, status chip, and timestamp on one visual centerline.
- Hover action rows align action buttons on the same centerline as the title and kind icon.
- Project group rows and child task rows keep intentional hierarchy indentation without accidental vertical drift.
- Add browser geometry coverage for row center alignment, not just text/action non-overlap.
- Use isolated browser tests and screenshots; do not restart, refresh, or interfere with the user's running OpenCorvus / overlay window.

Hard constraints:

- No fallback, no compatibility branch, no second layout source.
- Preserve unrelated dirty overlay changes already in the worktree.
- Use existing Button/Icon primitives and existing CSS token sources.
- Playwright/browser verification must run through Node on Windows, not Bun.
- Specs remain under `specs/records/2026-07/` and the monthly README must be updated.

Sources read:

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`
- `specs/records/2026-07/2026-07-08-cwd-project-control-right-toolbar.md`
- `specs/records/2026-07/2026-07-08-right-toolbar-runtime-status-panel-merge.md`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ProjectLedgerGroup.tsx`
- `packages/overlay/src/styles/surfaces/work-ledger.css`
- `packages/overlay/src/styles/surfaces/sidebar.css`
- `packages/overlay/test/work-ledger-consolidation.test.ts`
- `packages/overlay/test/browser/hover-action-geometry.test.ts`
- `packages/overlay/test/browser-runner.mjs`
- `packages/overlay/test/launch.ts`

Whole-repository search evidence:

- `rg -n "WorkLedger|project delete task|Completed|Idle|task-card|project|ledger|card-row|status" packages/overlay/src packages/overlay/test -g "*.tsx" -g "*.ts" -g "*.css" -g "*.html"` found `WorkLedger.tsx`, `ProjectLedgerGroup.tsx`, `work-ledger.css`, `sidebar.css`, and existing focused tests as the relevant owners.
- `rg -n "task-row-mini|global-task-row|task-row-body|task-row-main|task-row-right|task-row-actions|task-row-stamp|task-row-head" packages/overlay/src/styles -g "*.css" -C 5` showed base task row grid and right rail rules live in `sidebar.css`; Work Ledger overrides live in `work-ledger.css`.
- `rg -n "ledger|row|align|baseline|project.*group|work-ledger|visual" specs/records/2026-07/... packages/overlay/test -g "*.ts" -g "*.md"` showed prior browser coverage checks action rail overlap but not default row centerline alignment.

## Diagnosis

The existing browser test `Work Ledger action rails do not overlap inline metadata or status` proves hover action rails do not cover text/status. It does not prove the resting row is visually aligned.

The screenshot exposes a different class of bug: text, kind icon, status chip, timestamp, and hover actions are independently sized inline elements inside a grid row. The base `.task-row-mini` grid uses `align-items: center`, but descendant controls use mixed line-height, `display: block`, baseline alignment, and status-chip height rules. Without explicit Work Ledger centerline assertions, a row can pass overlap tests while still looking vertically odd.

The follow-up screenshot review also exposed the right-side hover action rail itself as the most visible defect: download / rename / delete buttons were allocated using the old 20px button rhythm and 24px-per-action rail widths. Three or more actions therefore appeared crammed against the row edge even when they technically did not overlap the title text.

Another follow-up visual review exposed an unintended red block in the action rail. The source was not task status data: `Icon name="stop"` maps to the lucide `Square` line icon, but Work Ledger CSS forced the stop / cancel SVG children to `fill: currentColor` and `stroke: none` while also coloring the action warning-red on row hover. That turned a line icon into a solid warning-colored square.

## Plan

1. Add Work Ledger row-specific CSS that makes the row grid, icon, main button, right rail, status chip, stamp, and action buttons share a consistent centerline and fixed row rhythm.
2. Avoid changing project group indentation or replacing existing primitives.
3. Extend the Node browser test with a default-state geometry assertion that measures `centerY` deltas between kind icon, title, status, timestamp, and action buttons.
4. Capture an updated isolated screenshot under `.scratch/` and inspect it before reporting.
5. Run focused source/browser tests, overlay typecheck/i18n where needed, docs link test, and `git diff --check`.

## Implementation Notes

- `packages/overlay/src/styles/surfaces/work-ledger.css` now defines one Work Ledger action geometry source:
  - action button size: `--work-row-action-size: calc(22px * var(--ui-scale))`
  - action gap: `--work-row-action-gap: calc(4px * var(--ui-scale))`
  - rail side padding: `--work-row-action-rail-pad: calc(4px * var(--ui-scale))`
  - rail widths by action count: `30 / 56 / 82 / 108 / 134px`
- The hover rail is static in normal flow, clipped at width zero by default, then expands to the count-derived width with explicit padding and gap.
- `.work-row-head`, `.work-row-right`, `.work-row-stamp`, and action buttons now share explicit centerline sizing so titles, chips, timestamps, and hover actions align visually.
- Stop / cancel icons keep their original SVG line geometry; Work Ledger no longer fills SVG children or turns stop actions warning-red just because the row is hovered. Warning color remains limited to direct stop-button hover / focus.
- `packages/overlay/test/browser/hover-action-geometry.test.ts` now covers:
  - default completed-row centerline deltas for kind icon, title, status chip, and timestamp
  - default action invisibility and zero-width rail
  - completed-row hover rail width, action gaps, right padding, row-edge containment, and action/title centerline deltas
  - five-action queued rail width and cancel icon line fill/stroke behavior
  - screenshot artifacts:
    - `packages/overlay/.scratch/work-ledger-default-row-alignment.png`
    - `packages/overlay/.scratch/work-ledger-action-rail-alignment.png`
    - `packages/overlay/.scratch/work-ledger-action-geometry.png`
    - `packages/overlay/.scratch/work-ledger-queued-stop-line-icon.png`

## Verification Results

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts`: pass, 5 tests.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/hover-action-geometry.test.ts`: pass, 2 tests.
- `bun run --cwd packages/overlay typecheck`: pass.
- `bun run --cwd packages/overlay check:i18n`: pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: pass, 20 tests.
- `git diff --check`: pass.
- Raw color scan over `packages/overlay/src/styles/surfaces/work-ledger.css`, `packages/overlay/test/browser/hover-action-geometry.test.ts`, `packages/overlay/test/work-ledger-consolidation.test.ts`, and this record: no raw hex / rgb / hsl / Tailwind arbitrary color matches.

## Review Notes

- The visible button-cluster defect is fixed in the current worktree evidence: hover screenshot shows three actions separated by the configured gap and held inside the row edge.
- The unintended red stop block is fixed in the current worktree evidence: queued-row hover screenshot shows the stop icon as a line icon, not a filled warning square.
- The default-row screenshot shows the kind mark, title, completed chip, and timestamp on one visual centerline.
- The current worktree already contained broad uncommitted Overlay changes before this repair, including `WorkLedger.tsx`, `work-ledger.css`, and related tests. This repair intentionally preserves those changes and does not attempt to reset or rewrite them.

## Validation Targets

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/hover-action-geometry.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`

## Follow-up Recall: Armed Confirm Hover Icon Leak

User correction:

- The red block behind the Work Ledger delete action appears on hover without clicking any button.
- The prior explanation that treated it as an already armed second-confirmation state was wrong.
- Even in an armed state, the visible red patch sitting between the delete and check icons is unacceptable; the button must show one icon state at a time.

Acceptance criteria:

- A Work Ledger delete action hover before click shows only the default delete icon, not both delete and check.
- First click arms the action and switches the same button surface to the confirmation icon.
- The fix must live in the shared `ArmedConfirmButton` primitive instead of duplicating Work Ledger-only CSS.
- Preserve existing `TaskList`, `MissionList`, `CodingAssistantSessionList`, and `ProjectLedgerGroup` adoption semantics.
- Do not edit or overwrite unrelated dirty Work Ledger files in the current worktree.

Sources read:

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-work-ledger-row-alignment.md`
- `packages/overlay/src/components/ui/ArmedConfirmButton.tsx`
- `packages/overlay/src/styles/primitives/button.css`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/TaskList.tsx`
- `packages/overlay/src/styles/surfaces/sidebar.css`
- `packages/overlay/src/styles/surfaces/work-ledger.css`
- `packages/overlay/test/solid-armed-confirm.test.ts`

Whole-repository search evidence:

- `rg -n "ArmedConfirmButton|confirmChildren|data-confirm|oc-armed-confirm" packages/overlay/src packages/overlay/test -g "*.tsx" -g "*.ts" -g "*.css"` found the shared primitive plus call sites in `TaskList.tsx`, `MissionList.tsx`, `CodingAssistantSessionList.tsx`, `ProjectLedgerGroup.tsx`, and `WorkLedger.tsx`.
- `WorkLedger.tsx` passes bare `<Icon name="delete" />` children and bare `<Icon name="check" />` `confirmChildren`.
- `TaskList.tsx`, `MissionList.tsx`, `CodingAssistantSessionList.tsx`, and `ProjectLedgerGroup.tsx` wrap their default and confirm icons in call-site classes that sidebar CSS hides and swaps.
- `ArmedConfirmButton.tsx` currently renders `{local.children}` and `{local.confirmChildren}` unconditionally as adjacent children. That is the direct cause of both icons participating in hover layout before click.
- `work-ledger.css` applies a danger hover background to the Work Ledger delete button on hover, so the unconditional adjacent icons make the button surface look like a red block wedged between icons.

Plan:

1. Add primitive-owned default and confirm icon slots inside `ArmedConfirmButton`.
2. Add primitive CSS that displays the default slot when disarmed and the confirm slot only when `data-confirm="true"`.
3. Keep call-site icon wrappers working inside the slots so existing sidebar-specific confirm rules remain compatible with the new single-source primitive behavior.
4. Add source tests proving the primitive owns the slots and CSS state switch.
5. Add Node browser coverage that renders a Work Ledger-shaped armed-confirm icon button, hovers it before click, and verifies only one visible icon slot is present before and after arming.

Follow-up implementation:

- `packages/overlay/src/components/ui/ArmedConfirmButton.tsx` now wraps `children` and `confirmChildren` in primitive-owned `oc-armed-confirm-slot` elements.
- `packages/overlay/src/styles/primitives/button.css` owns the display switch: confirm slot is hidden by default; default slot is hidden and confirm slot is shown only under `data-confirm="true"`.
- Work Ledger-specific files were not edited by this follow-up, preserving unrelated dirty worktree changes.
- `packages/overlay/test/browser/armed-confirm-button-browser.test.ts` renders a Work Ledger-shaped delete action with real primitive/work-ledger CSS and saves visual evidence:
  - `packages/overlay/.scratch/armed-confirm-button/work-ledger-delete-hover.png`
  - `packages/overlay/.scratch/armed-confirm-button/work-ledger-delete-armed.png`

Follow-up verification:

- `bun test packages/overlay/test/solid-armed-confirm.test.ts`: pass, 6 tests.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/armed-confirm-button-browser.test.ts`: pass, 1 test.
- `bun test packages/overlay/test/solid-armed-confirm.test.ts packages/overlay/test/task-list-buttons-primitive.test.ts packages/overlay/test/work-ledger-consolidation.test.ts`: pass, 15 tests.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/hover-action-geometry.test.ts packages/overlay/test/browser/armed-confirm-button-browser.test.ts`: pass, 3 tests.
- `bun run --cwd packages/overlay typecheck`: pass.
- `git diff --check` over the follow-up files: pass.
- Raw color scan over the follow-up files: no raw hex / rgb / hsl / Tailwind arbitrary color matches.
- Visual review: hover screenshot shows only the delete icon; armed screenshot shows only the check icon. The prior two-icon red block is not present.
