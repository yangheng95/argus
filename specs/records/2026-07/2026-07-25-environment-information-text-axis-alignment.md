# Environment Information Text Axis Alignment

## Recall

### User requirement

Analyze and repair the visible layout/alignment problem in the supplied
Environment Information screenshot. After clarification, change only the
significant alignment defect and do not redesign typography, density,
hierarchy, interaction, or responsive behavior.

The user's follow-up correction is authoritative: card-level primary headings
belong on the card's left title axis. They must not be moved onto the indented
icon-content text axis.

### Acceptance criteria

- Environment, Task, Requirements, Architecture, Workspace, Tools, and Sources
  headings share the card's left title axis.
- Icon-led Local/VCS, Goals, Goal ID, Worktree, and Tool labels retain their
  existing indented content axis.
- Flexible primary-title text is explicitly left-aligned rather than inheriting
  a centered button text alignment.
- Existing icons remain in their leading column; trailing summaries and
  disclosure controls keep their current behavior.
- The existing Node-launched Vite browser fixture measures the shared text axis
  within one CSS pixel and produces a task-scoped screenshot for visual review.

### Hard constraints

- Change only the existing Environment Information CSS owner and focused
  geometry regression; do not change component structure or behavior.
- Preserve all unrelated dirty work and do not restart or refresh a running
  OpenCorvus/overlay process.
- Browser verification uses Node, not Bun. No mobile or tablet scope.
- Commit subjects use `dsw-33987`; delivery goes to `legacy-remote`.

### Disk sources read

- `AGENTS.md`
- supplied screenshot
- `specs/records/2026-07/2026-07-22-environment-goals-density-and-chat-scrollbar.md`
- `specs/records/2026-07/2026-07-23-overlay-goal-status-settings-macos-keyboard-repair.md`
- `packages/overlay/src/components/TaskDirBar.tsx`
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/styles/surfaces/conversation.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/test/task-cwd-row-layout.test.ts`
- `packages/overlay/test/task-progress-collapse.test.ts`
- `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`

### Whole-repository grep evidence

- `TaskDirBar.tsx` is the only Environment Information render owner and mounts
  `TaskProgressBar` exactly once.
- `TaskProgressBar.tsx` owns the Goals heading and Goal rows; it already aligns
  their icon/ID/title columns and needs no structural change.
- `conversation.css` owns two intentional axes: a left card-title axis and a
  32-pixel indented icon-content text axis.
- `task-dirbar-keyboard.test.ts` currently conflates those intentional axes in
  `globalTextAxes`; its geometry contract must distinguish primary headings
  from icon-led content.
- `task-cwd-row-layout.test.ts` must keep the zero-offset primary-heading
  contract and add an explicit left-text-alignment assertion.
- `popup-contrast-matrix.test.ts` uses these class names only for color contrast;
  it does not own layout geometry.

### Independent agent feedback

None. The user did not request sub-agents or parallel audits.

## Root cause

The panel intentionally has two hierarchy levels. Card-level headings start at
the card's left content edge, while rows with a leading icon place their labels
on the indented 32-pixel content axis. The first implementation incorrectly
treated the browser test's `globalTextAxes` list as the desired design and moved
primary headings into the child-content column.

The Environment title has a second, independent visual problem: its span grows
to consume the disclosure row, and without an explicit text alignment it can
inherit centered button text. The root correction keeps primary heading boxes
on the left axis and explicitly left-aligns title text.

## Call-point disposition

| Owner / consumer | Disposition |
| --- | --- |
| `TaskDirBar.tsx` | Preserve DOM, semantics, summaries, and controls. |
| `TaskProgressBar.tsx` / `card.css` | Preserve existing Goal grid. |
| `conversation.css` | Keep primary headings at zero inset; explicitly left-align primary-title text. |
| `task-cwd-row-layout.test.ts` | Preserve zero-offset assertions and cover explicit left alignment. |
| `task-dirbar-keyboard.test.ts` | Separate primary-heading and icon-content geometry assertions. |

## Implementation plan

1. Keep the four primary-heading CSS owners on the left title axis and add
   explicit left text alignment.
2. Update the focused source and browser contracts to preserve the two intended
   hierarchy axes.
3. Run focused source tests and the Node-launched Vite browser case, inspect the
   resulting Environment screenshot, and correct only remaining axis drift.
4. Run Overlay typecheck/build, document health, diff review, then commit only
   task-owned files and push the current branch to `legacy-remote`.

## Status

- [x] Baseline diagnosis and full call-point search complete.
- [x] CSS and focused regression complete.
- [x] Vite geometry and screenshot review complete.
- [x] Corrected validation, second review, commit, and push complete.

## Validation evidence

- `bun test packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/task-progress-collapse.test.ts`
  passed all 11 focused tests after the correction.
- The corrected Node browser fixture measured all primary headings at 779
  pixels with computed `text-align: left`, while icon-led content remained on
  the intentional 811-812 pixel child axis. It continued past those assertions
  and later failed the unrelated stale 14-pixel Worktree action-icon expectation
  against the current shared 16-pixel icon contract.
- Visual inspection of `.scratch/task-dirbar-runtime-status-task-entry-open.png`
  confirms Environment, Task, Requirements, Architecture, Workspace, and Tools
  share the left title axis while Local/VCS, Goals, Worktree, and Tool rows retain
  their child indentation.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay build:vite` passed after transforming 4,955
  modules.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  passed all 21 documentation-health checks.
