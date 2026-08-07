# Environment Task Heading Removal

Date: 2026-07-28
Status: In progress
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.
- DOM: Document Object Model, the rendered browser element tree.

## Recall

### User requirement

- Remove the visible `Task` title from Environment Information.
- Promote the items shown below `Task`, beginning with `Goals`, to peer titles.
- Make the `Environment information` title use the same font size as the
  titles below it.
- After promotion, keep title typography and trailing icon size/position
  aligned.

### Acceptance criteria

- The Environment panel contains no visible `Task` classification.
- `Goals`, `Requirements`, and `Architecture` render as peer title rows on the
  same left axis; Workspace and Tools keep the same peer recipe when present.
- `Environment information` and all peer titles resolve to the same 13 pixel
  Environment title size and regular weight.
- The Goals fold glyph and the Requirements/Architecture navigation glyphs use
  the existing shared 16 pixel trailing column, share a vertical centerline,
  and keep their current actions and keyboard semantics.
- Goal rows, summaries, status icons, bounded scrolling, Worktree/Tool/Source
  data, and every existing panel action remain unchanged.
- A Node-launched real Vite page and task-scoped screenshot confirm the final
  desktop geometry.

### Hard constraints

- Reuse the existing HoverCard, Section, Button, Icon, and TaskProgressBar
  primitives; add no renderer, fallback, compatibility branch, gate, or state
  machine.
- Preserve unrelated staged, unstaged, and untracked changes in the shared main
  worktree. Do not reset, restore, stash, or create another worktree.
- Do not restart, refresh, close, or otherwise interfere with the operator's
  running OpenCorvus or Overlay processes.
- Browser verification uses Node, not Bun. Desktop is the only visual target.
- Delivery commits use the `dsw-33987` prefix and push to `myhexin`.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control Skill.
- Supplied screenshot
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-89159a2f-4f2d-4c3d-b4b4-422eb43b7f99.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-28-environment-panel-design-language-convergence.md`.
- `specs/records/2026-07/2026-07-25-environment-information-text-axis-alignment.md`.
- `specs/records/2026-07/2026-07-25-environment-menu-typography-density.md`.
- Current `TaskDirBar.tsx`, `TaskProgressBar.tsx`, `Section.tsx`,
  `conversation.css`, `card.css`, and focused source/browser tests.

### Whole-repository grep evidence

Repository-wide searches covered `project_runtime.category_task`,
`hasTaskInformation`, `project-runtime-category-task`, `TaskProgressBar`,
`project-runtime-tool-goals`, every `project-runtime-category-*` title and
indicator selector, current architecture statements, and focused source/browser
assertions.

| Owner / call point                           | Current evidence                                                                                                                                                                           | Disposition                                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.taskScopeShortcuts`              | Requirements, Architecture, and Goals are derived from the canonical Task board; `runtimeToolShortcuts` already excludes Goals because TaskProgressBar is its sole Environment projection. | Preserve the data flow and the single Goals projection.                                                                         |
| `TaskDirBar.hasTaskInformation` and render   | A boolean alias wraps the one TaskProgressBar in a `Task` Section, creating a title whose only child immediately renders another `Goals` title.                                            | Delete the alias and wrapper; mount TaskProgressBar directly as the Goals peer.                                                 |
| `TaskProgressBar`                            | Owns the Goals title, summary, fold action, Goal rows, locate behavior, and bounded list.                                                                                                  | Preserve behavior; add a stable peer-category class/data hook only.                                                             |
| `conversation.css`                           | Environment title is explicitly 15 pixels while peer titles are 13 pixels; Goals layout rules depend on the deleted Task ancestor and its fold control occupies a different trailing box.  | Use the shared 13 pixel title tier and retarget Goals rules to its own peer-category root with the shared trailing icon column. |
| `project_runtime.category_task` translations | Used only by the deleted Task wrapper.                                                                                                                                                     | Remove the now-unused English and Chinese keys.                                                                                 |
| `task-cwd-row-layout.test.ts`                | Requires the Task wrapper, three Section end indicators, and the alias.                                                                                                                    | Replace those assertions with the direct Goals peer contract and two remaining Section indicators.                              |
| `task-dirbar-keyboard.test.ts`               | Measures and screenshots the live Vite panel but currently expects `Task`, a 15/13 split, and a Task disclosure glyph.                                                                     | Assert the Task title is absent, all titles are 13 pixels, and Goals owns the aligned fold glyph.                               |
| `specs/current/architecture/07-panel.md`     | Describes Task as the owner of Goals and keeps Environment on a distinct 15 pixel tier.                                                                                                    | Replace those superseded presentation facts with the user-authoritative peer-title contract.                                    |

No backend route, API schema, database model, board projection, Right Dock
identity, Goal state, or VCS behavior changes.

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration
boundary forbids unrequested Subagents.

## Root cause

The visible `Task` row is not a data owner. It is a presentation-only Section
wrapped around `TaskProgressBar`, which immediately creates its own `Goals`
header. That redundant nesting produces the extra title and makes Goals inherit
geometry through a parent selector. Separately, an older Environment-specific
typography contract intentionally kept the panel title at 15 pixels while peer
titles were reduced to 13 pixels. The current user request explicitly replaces
both presentation decisions.

The root correction is therefore structural and local: remove the redundant
Task Section, let the existing Goals component own the peer title directly, and
give the panel header and every peer title one shared typography/trailing-glyph
recipe. No task data or interaction needs a second implementation.

## Implementation plan

1. Remove the Task-only boolean alias, Section wrapper, and unused translation
   key while preserving the single TaskProgressBar mount and all board-derived
   shortcuts.
2. Give TaskProgressBar a stable Goals peer-category root and retarget the
   Environment CSS so its header, summary, fold glyph, body, and list retain
   their current behavior without the Task ancestor.
3. Set the Environment panel title to the shared 13 pixel title tier and align
   the Goals fold glyph with the existing 16 pixel navigation/disclosure
   column.
4. Update current architecture and focused source/browser regressions for the
   new title list, equal typography, missing Task row, and icon center/right
   geometry.
5. Run focused Bun tests, Overlay typecheck/i18n/build, documentation health,
   and the Node browser fixture; inspect the original-resolution task-scoped
   screenshot and correct any remaining visual mismatch.
6. Perform a second diff/test/screenshot review, commit only task-owned changes,
   fetch/reconcile the shared delivery branch, and push to `myhexin`.

## Status

- [x] Baseline screenshot diagnosis, material read, and whole-repository search.
- [x] Architecture, component, CSS, translation, and regression changes.
- [x] Focused tests, real browser geometry, and screenshot review.
- [x] Second review, task-owned commits, and git-cc push.

## Verification evidence

- `bun test packages/overlay/test/task-progress-collapse.test.ts
  packages/overlay/test/task-cwd-row-layout.test.ts`: 13 passed, zero failed,
  including the missing Task wrapper, direct Goals peer, shared title tier,
  22-pixel trailing control box, and 16-pixel glyph contract.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun run --cwd packages/overlay build:vite`: passed.
- Prettier check over every task-owned source, test, architecture, record, and
  index file: passed.
- The Node-launched real Vite scenario reached and passed the target
  Environment menu assertions: Task is absent; Environment Information, Goals,
  Requirements, Architecture, Workspace, and Tools all measure 13 pixels;
  their left text axes match; the Goals title row measures 32 pixels; and the
  Environment/Goals trailing control and 16-pixel glyph axes match.
- Original-resolution review of
  `.scratch/environment-environment-disclosure-hover.png` and
  `.scratch/task-dirbar-environment-compact-menu.png` confirms the requested
  title hierarchy and alignment. The enclosing broad browser scenario later
  reports a separate narrow-workbench content-clearance assertion from the
  concurrent
  `2026-07-28-environment-content-clearance-scrollbar-anchor.md` work; it occurs
  after the task-owned menu assertions and screenshots and does not alter this
  delivery surface.
