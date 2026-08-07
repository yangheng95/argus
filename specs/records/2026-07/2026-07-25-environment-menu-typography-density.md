# Environment Menu Typography Density

Date: 2026-07-25
Status: Implemented
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and presentation language.
- DOM: Document Object Model, the browser's rendered element tree.

## Recall

### User requirement

The supplied Environment Information screenshot shows the menu content below
the card title competing too strongly with the title. Reduce that content's
font size and make the menu slightly more compact.

### Acceptance criteria

- Keep `Environment information` at the canonical title tier.
- Move all content below that title—environment facts, classification labels
  and counts, Goal heading/summary/items, Worktree rows, Tool rows, Sources,
  and operation feedback—to one smaller menu-content tier.
- Reduce classification and repeated-item row rhythm proportionately without
  changing the established text axes, item ordering, disclosure behavior,
  keyboard focus, 10-row scroll limit, or floating-card ownership.
- Preserve legible icons and trailing controls rather than shrinking the
  interaction targets to match the text.
- Verify computed font and row geometry in the real Node-launched Vite fixture,
  inspect a task-scoped screenshot at original resolution, and rerun focused
  source, typecheck, documentation, formatting, and push-hook checks.

### Hard constraints

- Use one Environment-scoped content typography variable. Do not add per-row
  font-size fixes or change the application-wide type scale.
- Keep the title/content hierarchy explicit; the Environment title remains a
  title while every item below it is menu content.
- Keep the complete-data, 10-row collection scrolling contract.
- Do not change components, data sources, application routes, accessibility
  primitives, responsive scope, or the running OpenCorvus/Overlay process.
- Preserve unrelated working-tree changes and do not create a worktree.
- Commit subjects use `dsw-33987`; delivery goes to `myhexin`.

### Material read before implementation

- `AGENTS.md`.
- Browser control skill.
- Supplied screenshot.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-23-overlay-section-heading-typography-standard.md`.
- `specs/records/2026-07/2026-07-22-environment-goals-density-and-chat-scrollbar.md`.
- `specs/records/2026-07/2026-07-25-environment-bounded-resource-lists.md`.
- `packages/overlay/src/styles/tokens/design-language.css`.
- `packages/overlay/src/styles/surfaces/card.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/test/task-cwd-row-layout.test.ts`.
- `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.

### Whole-repository search evidence

Repository-wide searches covered `project-runtime-panel-shell`,
`project-runtime-type-size`, `project-runtime-category-row-height`,
`project-runtime-info-row`, `task-progress__heading`,
`task-progress__pills`, all Worktree/Tool/Source row metrics, their exact-value
tests, and current/historical Environment typography and density records.

| Call point / owner                       | Current fact                                                                                                      | Disposition                                                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `design-language.css`                    | Canonical title is 15 pixels, body/control 14 pixels, and small/meta 12 pixels.                                   | Keep the global scale unchanged; derive the local 13-pixel menu tier from the canonical control tier.                         |
| `conversation.css` Environment variables | One `--project-runtime-type-size` assigns the 15-pixel title tier to the card title and nearly every descendant.  | Split title and content ownership; retain 15 pixels only on the card title and assign one 13-pixel content variable below it. |
| `conversation.css` classifications       | Collapsible classifications use 42-pixel rows and direct launchers inherit the same oversized title presentation. | Use a 36-pixel classification rhythm while preserving the shared Section primitive and text axis.                             |
| `conversation.css` environment facts     | Information rows use 32-pixel height with an independent 14-pixel literal.                                        | Consume the content typography variable and use a 28-pixel row.                                                               |
| `conversation.css` Goal projection       | The Goal heading is reset to title size and Goal rows use 26-pixel height plus 2-pixel gap.                       | Remove the title-tier exception and use 24-pixel rows plus 1-pixel gaps in this Environment projection only.                  |
| `conversation.css` Worktrees             | Repeated rows use 38-pixel height and 6-pixel gaps.                                                               | Use 34-pixel rows and 4-pixel gaps without changing actions.                                                                  |
| `conversation.css` Tools                 | Repeated rows use 32-pixel height and 4-pixel gaps.                                                               | Use 28-pixel rows and 2-pixel gaps.                                                                                           |
| `conversation.css` Sources               | Repeated rows use 28-pixel height and 2-pixel gaps.                                                               | Use 24-pixel rows and 1-pixel gaps.                                                                                           |
| `task-cwd-row-layout.test.ts`            | Pins the single title-sized type variable and general geometry ownership.                                         | Require distinct title/content variables and the compact metrics; reject the retired single-size contract.                    |
| `task-dirbar-keyboard.test.ts`           | Measures equal typography across the title and classifications plus the prior 10-row heights.                     | Assert the 15/13 hierarchy, compact row geometry, retained axes, scrolling, keyboard focus, and screenshot.                   |

No component, translation, backend, database, Right Dock, or item-visibility
change is required.

### Independent agent feedback

None. The user did not request sub-agents or parallel audits.

## Root cause

The Environment surface erased its intended type hierarchy by assigning
`--ui-font-title` to one broad selector containing the panel title,
classification titles, summaries, Goal rows, Worktrees, Tools, and Sources.
Several descendants then repeated title/control overrides, so spacing remained
large even where content happened to resolve one pixel smaller.

The root correction makes the title/content distinction explicit at the
Environment surface boundary and lets the same content tier drive the
proportional row metrics. This removes the visual competition without altering
global tokens or adding feature-by-feature font fixes.

## Implementation plan

1. Update current panel architecture with the explicit 15-pixel title and
   13-pixel menu-content hierarchy plus compact classification rhythm.
2. Split the Environment title/content CSS ownership and proportionally reduce
   classification, information, Goal, Worktree, Tool, and Source row metrics.
3. Update focused source contracts and the real Vite fixture with computed
   typography, exact geometry, 10-row scrolling, and screenshot assertions.
4. Run focused tests, typecheck, i18n, documentation health, formatting, and
   the Node-launched Vite browser scenario; inspect the screenshot, conduct a
   second diff review, commit only task-owned files, and push to `myhexin`.

## Status

- [x] Baseline diagnosis, architecture review, and whole-repository search.
- [x] Architecture, implementation, and regressions.
- [x] Vite geometry and screenshot review.
- [x] Validation and second review.
- [x] Commit and push.

## Validation evidence

- `bun test packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/task-progress-collapse.test.ts`
  passed 12 tests with 363 assertions.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed with catalog hash
  `0762a4bc7c9590d2`.
- The Node-launched focused Vite browser scenario
  `chat header environment panel matches the compact Codex information layout`
  passed. Computed styles proved the title remained 15 pixels while Local,
  classification labels, counts, Goal content, Worktree names, Tool labels,
  and Source names all resolved to 13 pixels.
- Browser geometry measured the unchanged 42-pixel title row over 36-pixel
  classification rows, 28-pixel fact and Tool rows, 24-pixel Goal and Source
  rows, and 34-pixel Worktree rows. The 12 retained Goals still use a
  collection-local 249-pixel viewport equal to exactly ten 24-pixel rows plus
  nine 1-pixel gaps and remain keyboard reachable.
- Original-resolution review of
  `.scratch/task-dirbar-environment-compact-menu.png` confirmed that the menu
  content is visually subordinate to the Environment title without weakening
  icons, counts, or disclosure controls.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
  passed 83 tests with 1,398 assertions.
