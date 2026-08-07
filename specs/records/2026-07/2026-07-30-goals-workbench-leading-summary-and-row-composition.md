# Goals Workbench Leading Summary And Row Composition

Date: 2026-07-30
Status: In progress
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.
- DOM: Document Object Model, the rendered browser element tree.
- API: Application Programming Interface, the typed request boundary used by clients and tools.

## Recall

### User requirement

- Move the Goals `passed/total` summary from the far right of the panel toolbar to the far left.
- Remove the Cancel button from the Goals workbench.
- Restyle the Goals list from the supplied reference as one compact row composed in this order:
  status icon, canonical full Goal revision identity such as `#G1V1`, then Goal title.
- Keep long titles on one line and truncate them instead of pushing the Goal identity to the far edge.
- 2026-07-30 follow-up: every equivalent Right Dock task-scope component
  with a numeric toolbar summary must place that number at the left edge, not
  only Goals.

### Acceptance criteria

- A non-empty Goals panel renders its progress summary against the left edge of the toolbar.
- Requirements `passed/total`, Architecture contract count, and Goals
  `passed/total` all render against the same leading toolbar edge.
- The Goals panel has no Cancel action or empty action-row spacing.
- Each collapsed Goal summary renders status icon, full revision identity, and title in that exact visual order.
- Revision identities align to one column and titles align to one column across the list.
- Long titles truncate inside the available desktop width.
- Existing Goal expansion, execution-record location, semantic status color, advisory marker, and worktree detail remain functional.
- The underlying Task cancellation API and the independent Work Ledger cancellation action remain available.
- A real desktop page is opened and manually inspected through task-scoped screenshots. No UI automation test is added, modified, updated, or run.

### Hard constraints

- Reuse the existing `SurfaceHeader`, `Button`, `Icon`, `GoalGroup`, and Goal-state projection.
- Keep `TaskBoard.goals` as the only Goals data source; add no fallback, compatibility branch, second renderer, gate, state machine, iframe, query override, or synthetic interaction.
- Desktop is the only visual target requested.
- Preserve the operator's unrelated uncommitted `RightDock.tsx` and Right Dock record edits.
- Do not reset, restore, stash, or create another worktree.
- Use Node for browser verification, not Bun.
- Delivery commits use the `dsw-33987` prefix and push to `legacy-remote`.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control Skill.
- User screenshots:
  - `C:/Users/10132/AppData/Local/Temp/codex-clipboard-d87f5af9-1d88-47f4-9eff-1ecbd6afc3dc.png`
  - `C:/Users/10132/AppData/Local/Temp/codex-clipboard-0dafbc53-a5da-42cf-81c4-bf29364c7d90.png`
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-28-goals-summary-navigation-and-row-convergence.md`.
- Current `Board.tsx`, `GoalGroup.tsx`, `main.tsx`, `SurfaceHeader.tsx`,
  `goal-label.ts`, `inspector.css`, `card.css`, and compact-row design tokens.

### Whole-repository grep evidence

Repository-wide searches covered `GoalsBoardPanel`, `TaskActionsPanel`,
`taskActionsBar`, `task-scope-actions`, `task-actions-buttons`, `goalsBadge`,
`cancelSelectedTask`, `cancelTask`, `task.action.cancel`,
`TaskScopePanelShell`, `goalRevisionLabelFromIndexes`, `gwg-revision`,
`gwg-header-meta`, `gwg-title-row`, and every `.gwg-*` selector.

| Owner / call point | Current evidence | Disposition |
| --- | --- | --- |
| `Board.tsx::TaskScopePanelShell` | The shared shell originally placed every badge in `SurfaceHeader.actions`; the first delivery added a Goals-only placement option. Requirements, Architect, and Goals are its only call sites. | Final follow-up contract: remove the placement option and project every task-scope numeric badge through the leading title slot. |
| `Board.tsx::TaskActionsPanel` | The only renderer of the Goals Cancel button and the only caller of `task.action.cancel*`. | Delete the component and its Goals mount; do not alter canonical cancellation services. |
| `Board.tsx::GoalsBoardPanel` | The only Goals workbench mount; it passes the progress badge and action row above the canonical `GoalList`. | Remove action props and render the metric through the leading header slot. |
| `main.tsx::cancelSelectedTask` | Called only by `GoalsBoardPanel`; other `cancelTask` call sites independently serve Work Ledger and task flows. | Delete this unused presentation callback and stop passing `onCancel`; retain the shared `cancelTask` import for remaining callers. |
| `GoalGroup.tsx::GoalGroup` | The sole detailed Goals list row. It currently renders icon, title, then a trailing `#GxVy` revision inside metadata. | Move the existing revision label immediately after the icon and before the title; preserve trailing runtime, priority, and branch metadata. |
| `goal-label.ts::goalRevisionLabelFromIndexes` | The canonical full revision formatter is also consumed by file-change and diff projections and returns `#GxVy`; both supplied screenshots retain `#` before their Goal identity. | Reuse it unchanged in its new leading position; do not fork or rewrite the identity formatter. |
| `inspector.css` | Owns the toolbar badge, Goal row, status, identity, title, trailing metadata, body, and list geometry. | Define an explicit icon/identity/title/trailing grid, compact aligned identity width, title truncation, and remove obsolete action-row rules. |
| `task.action.cancel*` locale keys | The Goals component is their only live caller; Work Ledger uses `task.cancel_button_title`. | Remove the now-unused English and Chinese Goals-action keys while preserving the Work Ledger key. |
| Existing UI tests | Several files assert source strings and rendered UI for the prior Cancel and trailing-revision layout. | Do not change or run them under the UI automation prohibition; use typecheck/build plus real-page visual review. |

No Board schema, Task lifecycle, Goal persistence, scheduler, cancellation
service, or backend route change is in scope.

### 2026-07-30 follow-up grep evidence

The follow-up repository search covered `badgeText`, `badgePlacement`,
`task-scope-panel__badge`, `data-ui="task-scope-toolbar"`, `SurfaceHeader`,
`requirementsBadge`, `architectBadge`, and `goalsBadge`.

| Owner / call point | Follow-up evidence | Revised disposition |
| --- | --- | --- |
| `RequirementsBoardPanel` | Projects the only Requirement numeric summary as `passed/total`; it omits `badgePlacement` and therefore still renders at the trailing edge. | Render through the shared leading slot. |
| `ArchitectBoardPanel` | Projects the only Architecture numeric summary as `contractCount`; it omits `badgePlacement` and therefore still renders at the trailing edge. | Render through the shared leading slot. |
| `GoalsBoardPanel` | Projects the Goal `passed/total` summary and explicitly selects the leading slot. | Preserve the rendered result while removing the now-redundant per-caller option. |
| Other `SurfaceHeader` consumers | File Explorer uses an action toolbar rather than a task-scope numeric summary; no other task-scope badge caller exists. | Preserve unchanged. |
| Historical UI tests | Source and rendered tests mention the three badge identities. | Do not modify or run under the UI automation prohibition. |

The follow-up makes the previous leading/trailing option obsolete. Keeping it
would preserve an unused visual branch and contradict the requested uniform
rule, so `TaskScopePanelShell` becomes the single leading-slot owner for all
three numeric summaries.

### Independent review

- A read-only Claude Code review was attempted with only `Read`, `Grep`, and
  `Glob`, but the installed CLI returned `Not logged in` before reading any
  files. This is an external authentication limitation, not repository
  evidence.
- Codex reviewed the proposed shape against `SurfaceHeader` CSS and all
  cancellation call sites: the title slot is the existing leading header
  primitive; `cancelSelectedTask` has one caller; `cancelTask` retains three
  independent callers; the canonical `#GxVy` label should stay unchanged
  because both screenshots show the leading `#`.
- No Subagent was requested, so no Subagent delegation is used.

## Root cause

The progress summaries were right-aligned because the generic panel shell
projected its badge into `SurfaceHeader.actions`, not because of badge CSS. The
first delivery corrected Goals through a per-caller option; the follow-up shows
that numeric summary alignment is a shell-wide invariant, so retaining that
option would preserve a needless visual branch. The Cancel button was a
separate presentation-only component mounted above the Goals list; its removal
did not require changing Task lifecycle data or cancellation services.

The Goal row looks fragmented because its title is the flexible center content
while the full revision identity sits inside the trailing metadata cluster.
That makes the identity visually detach at the far edge. The correct row
composition is a single leading sequence—semantic status icon, compact stable
revision identity, flexible title—with only genuinely auxiliary state retained
at the end.

## Implementation plan

1. Project every `TaskScopePanelShell` numeric badge through the leading
   `SurfaceHeader.title` slot, with no per-caller placement branch.
2. Remove `TaskActionsPanel`, the Goals `onCancel` prop, its main-entry callback,
   obsolete action CSS, and now-unused locale strings while retaining all other
   cancellation call sites.
3. Recompose `GoalGroup` as icon, `GxVy`, title, then optional auxiliary metadata
   through the existing shared primitives and canonical label formatter.
4. Refine the Goals row CSS into one compact aligned grid with single-line title
   truncation and unchanged semantic status colors.
5. Update the panel architecture and this record without modifying UI tests.
6. Run Overlay typecheck/build, i18n and documentation health checks; open a
   real desktop page, inspect the Goals interaction, and review task-scoped
   screenshots.
7. Perform a second diff and visual review, commit only task-owned files, fetch
   and reconcile the shared branch, then push to `legacy-remote`.
8. Follow-up: remove the badge-placement branch, route every task-scope numeric
   badge through `SurfaceHeader.title`, then visually inspect Requirements,
   Architecture, and Goals on the real desktop page.

## Status

- [x] User references, repository state, historical decisions, and all call points inspected.
- [x] Read-only independent review attempted; authentication limitation and Codex findings recorded.
- [x] Component, CSS, localization, and architecture implementation.
- [x] Static verification and real-page visual review.
- [x] Second review and task-owned commit.
- [x] Push to `legacy-remote`.
- [x] Follow-up shared leading-summary implementation and three-panel visual review.

## Verification

- `bun run typecheck` in `packages/overlay` passed.
- `bun run build:vite` in `packages/overlay` passed. Vite reported only the
  repository's existing large-chunk advisory.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  passed 22/22.
- `bun run check:i18n` initially reported three `image_preview.*` keys made
  unused by a concurrent Image Preview change. The pre-push hook repeated the
  same exact failure after typecheck, route, and docs checks passed. The three
  dead bilingual keys were removed without changing the concurrent component,
  and the real i18n checker then passed with digest
  `6aa073ad759b98c7`.
- No UI automated test was added, modified, updated, or run.
- The current Vite build was opened through the real backend at
  `http://127.0.0.1:7878/ui/`, connected to the live Task Board, and the native
  Right Dock Goals tab was opened through its visible controls.
- Six canonical Goals rendered in the requested icon, `#GxV1`, title order.
  Browser diagnostics measured one shared `x` coordinate for every icon,
  revision, and title column; title CSS resolved to `white-space: nowrap` and
  `text-overflow: ellipsis`.
- The toolbar metric starts six pixels from the Goals panel's leading edge and
  no `[data-task-action="cancel"]` exists in the panel.
- Clicking the first real Goal changed its existing `aria-expanded` value from
  `false` to `true`, rendered the canonical objective and acceptance body, and
  clicking again collapsed it.
- Final task-scoped desktop screenshot:
  `packages/overlay/.scratch/goals-workbench-leading-summary-final.png`.
- Delivery commits `52dfcd9420` and `9cc25ef34b` passed the full pre-push
  typecheck, route inventory, documentation, i18n, and secret-scan hook and
  were pushed to `legacy-remote/work-v0.0.24beta-yr-0729`.
- Follow-up static verification passed: `bun run typecheck`,
  `bun run build:vite`, `bun run docs:check`, Prettier, and
  `git diff --check`. No UI automated test was added, modified, updated, or
  run.
- The current Vite source at `http://127.0.0.1:5173/` was connected to the
  real backend on port 7878. The native Right Dock visibly rendered
  Requirements `0/13`, Architecture `7`, and Goals `0/6` at the shared leading
  toolbar edge.
- Follow-up screenshots:
  `packages/overlay/.scratch/task-scope-requirements-leading-summary.png`,
  `packages/overlay/.scratch/task-scope-architecture-leading-summary.png`, and
  `packages/overlay/.scratch/task-scope-goals-leading-summary.png`.
- Follow-up delivery commit `bb143738c3` passed the full pre-push typecheck,
  route inventory, documentation, i18n, and secret-scan hook and was pushed to
  `legacy-remote/work-v0.0.24beta-yr-0729`.
