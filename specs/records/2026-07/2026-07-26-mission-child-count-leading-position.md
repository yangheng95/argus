# Mission Child Count Leading Position

Date: 2026-07-26
Status: Complete
Owner: Codex

## Recall

### User requirement

- “mission的子任务的计数为什么被塞到最后面的，改回前面”
- Restore the Mission child-Task count to the leading metadata position
  before the Mission title.

### Acceptance criteria

- A Mission with child Tasks renders the existing count and chevron after the
  Mission kind glyph and before the title.
- The title, pending-interaction badge, status/loading projection, row actions,
  hover/focus child reveal, nested Task order, and canonical
  `taskStats.total` data source remain unchanged.
- The same production-shaped ordering is covered by focused source tests and a
  real Vite browser fixture with a task-scoped screenshot.

### Hard constraints

- Preserve every unrelated staged, unstaged, and untracked worktree change.
  Do not reset, restore, stash, broadly stage, or create another worktree.
- Do not restart, close, refresh, or otherwise interfere with the running
  OpenCorvus or Overlay process. Browser verification uses an isolated Vite
  fixture launched with Node.
- Reuse the existing disclosure, Work Ledger row, Button, Icon, Tooltip, and
  hover-reveal behavior. Do not add a second count, local state, fallback,
  compatibility branch, gate, or route.
- Desktop is the only visual acceptance target.
- Commit subjects use `dsw-33987`; delivery goes to `legacy-remote`.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control skill.
- `specs/records/2026-07/2026-07-16-mission-disclosure-row-inset-alignment.md`.
- `specs/records/2026-07/2026-07-25-left-dock-hierarchical-grid-alignment.md`.
- `packages/overlay/src/components/WorkLedger.tsx`.
- `packages/overlay/src/styles/surfaces/work-ledger.css`.
- Focused Work Ledger source and browser tests.

### Whole-repository search evidence

Searches covered `mission-task-disclosure`, `work-row-task-disclosure`,
`taskStats.total`, `hasMissionTasks`, `WorkLedgerKindMark`, and every focused
source/browser assertion that encodes their ordering or geometry.

| Owner / call point | Current fact | Disposition |
| --- | --- | --- |
| `WorkLedgerRowView` | The only live disclosure renderer currently places the count after the title inside `work-row-head`. | Move that same disclosure before the title in the same row head; keep its source and behavior unchanged. |
| `work-ledger.css` | The row head already owns the required inline flex layout and gap; the disclosure already owns stable size and hover chevron motion. | Keep unchanged; no second layout path is needed. |
| `work-ledger-top-level-alignment.test.ts` | Explicitly requires title-before-count ordering introduced on 2026-07-25. | Reverse only the ordering oracle while preserving the shared outer row grid contract. |
| `work-ledger-consolidation.test.ts` | Also requires title-before-count and kind-before-count. | Require kind-before-count-before-title and retain all existing disclosure/reveal assertions. |
| `left-dock-compact-browser.test.ts` | Its production-shaped Mission fixture still models title-before-count. | Match production count-before-title markup and assert rendered horizontal order before saving the scoped screenshot. |
| Other browser consumers | Locate the disclosure or validate child reveal/status without encoding title/count order. | Keep unchanged and rerun the production Work Ledger browser owner. |

### Independent agent feedback

None. The user did not request delegation, and the active collaboration policy
forbids unrequested Subagents.

## Causal chain

The 2026-07-25 hierarchy change intentionally moved the one Mission disclosure
from between the kind glyph and row body to the end of the row head. That
preserved a shared Mission/Chat/Task title axis, but it also changed the visible
semantic reading order to `Mission title -> child count`, which is the reported
regression. The count source, child ordering, and backend projection are
correct; only the renderer order is wrong for the requested UI.

The direct repair is to keep the disclosure in the existing row-head flex
layout but render it before the title. This restores the visible
`Mission glyph -> child count -> title` order without recreating the former
conditional grid columns or introducing a second layout source.

## Implementation plan

1. Reverse the disclosure/title DOM order in the sole `WorkLedgerRowView`
   renderer.
2. Update focused source contracts and the production-shaped Vite fixture to
   enforce kind-before-count-before-title.
3. Run focused tests, Overlay typecheck/build, and documentation health.
4. Launch the isolated Vite fixture with Node, inspect the scoped screenshot at
   original resolution, and correct any visual regression.
5. Perform a second diff/test review, commit only task-owned files with the
   required prefix, reconcile the remote branch, and push to `legacy-remote`.

## Progress

- [x] Root-cause diagnosis, prior-record review, and whole-repository call-site search.
- [x] Renderer and regression updates.
- [x] Vite geometry and screenshot review.
- [x] Validation and second review.
- [x] Commit and push.

## Verification results

- Focused Work Ledger source tests passed: 38 tests, 643 assertions.
- The Node-launched compact browser fixture passed and preserved row bounds,
  nesting, density, hover behavior, and the shared outer row grid.
- The real Vite `project-ledger-group-browser.test.ts` passed against the
  production Overlay bundle. Its new geometry assertion proves the rendered
  order `Mission kind glyph -> child count/chevron -> title`.
- The original-resolution task-scoped screenshots were inspected:
  `.scratch/work-ledger-mission-children-collapsed.png` shows `3 ›` before
  `Ledger mission 1`, and `.scratch/mission-disclosure-inset-alignment.png`
  shows the same leading count at the narrow 350-pixel Project width.
- Overlay TypeScript, production Vite build, historical documentation links,
  product-documentation single-source checks, and `git diff --check` passed.
- The complete document-health suite remains blocked by unrelated concurrent
  worktree state: another fixture lacks the current conversation hydrate
  contract, and three other July records are already indexed but still
  untracked. The checks related to this record and its links pass once the
  task-owned record is tracked.

## Codex review feedback

The first compact-browser run reached the new ordering checks but found that
the same fixture still expected the previous 8-pixel large-radius token. The
current shared token is 10 pixels, producing 15 pixels at the fixture's
`--ui-scale: 1.5`; the fixture expectation was synchronized without changing
radius implementation. A concurrent log-support Button also lacked the
already-required explicit tone and blocked Overlay typecheck, so that caller
was corrected to `accent`. Neither correction adds a second UI source or
changes the Mission count implementation.
