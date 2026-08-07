# Environment Bounded Resource Lists

Date: 2026-07-25
Status: Implemented
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser layout and presentation language.
- DOM: Document Object Model, the browser's rendered element tree.
- VCS: Version Control System, the canonical repository status source.

## Recall

### User requirement

The supplied Environment Information screenshot contains 127 Goal rows and lets
the expanded list consume the card. Every repeated item collection in this card
must show at most 10 rows at once; additional items remain available by
scrolling inside that collection.

### Acceptance criteria

- Goals, Worktree, Tools, and Sources use one shared bounded-list layout
  contract.
- A list containing 10 or fewer items renders at its natural height without an
  empty reserved region.
- A list containing more than 10 items retains every DOM item but exposes a
  viewport equal to exactly 10 row heights plus the nine internal gaps.
- Overflow scrolls vertically within that list, never horizontally, and does
  not resize or clip sibling Environment categories.
- Sources no longer truncate to three entries or replace remaining sources
  with a synthetic `View all` row.
- Existing Goal location, Worktree actions, tool navigation, source rendering,
  category disclosure, keyboard focus, and Environment floating-card behavior
  remain unchanged.
- Focused source tests, Overlay typecheck/build, a Node-launched real Vite
  browser fixture with more than 10 Goals, task-scoped screenshot review,
  documentation health, and a second diff review pass.

### Hard constraints

- Keep the canonical arrays and current `For` renderers as the only item data
  sources. Do not paginate, slice, clone, virtualize, add local list state, or
  introduce a second data cache.
- Use one reusable CSS bounded-list class and per-list row metrics. Do not copy
  four unrelated overflow implementations.
- Keep every item keyboard reachable and preserve existing accessible
  primitives.
- This is a desktop-only change. Do not add tablet or mobile scope.
- Do not restart, reload, close, or otherwise interfere with the operator's
  running OpenCorvus/Overlay process. Browser verification uses an isolated
  fixture launched with Node.
- Preserve unrelated working-tree changes and do not create a worktree.
- Commit subjects use `dsw-33987`; delivery goes to `myhexin`.

### Material read before implementation

- `AGENTS.md`.
- Browser control skill.
- Supplied screenshot.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-22-environment-goals-density-and-chat-scrollbar.md`.
- `specs/records/2026-07/2026-07-25-environment-information-text-axis-alignment.md`.
- `specs/records/2026-07/2026-07-25-environment-popover-floating-message-overlay.md`.
- `packages/overlay/src/components/TaskProgressBar.tsx`.
- `packages/overlay/src/components/TaskDirBar.tsx`.
- `packages/overlay/src/styles/surfaces/card.css`.
- `packages/overlay/src/styles/surfaces/conversation.css`.
- `packages/overlay/test/task-progress-collapse.test.ts`.
- `packages/overlay/test/task-cwd-row-layout.test.ts`.
- `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.

### Whole-repository search evidence

Repository-wide searches covered `TaskProgressBar`, `task-progress__pills`,
`project-worktree-list`, `project-runtime-tool-shortcuts`,
`project-runtime-source-list`, `requestSources`, `visibleWorktrees`,
`resourceToolShortcuts`, `max-height`, and `overflow` across Overlay source,
tests, and current architecture.

| Call point / owner               | Current fact                                                                      | Disposition                                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskProgressBar.tsx`            | Renders every canonical Goal into an unbounded grid.                              | Add the shared bounded-list class; retain all Goals and existing actions.                                                                                            |
| `TaskDirBar.tsx` Worktree        | Renders every visible Worktree into a list with an unrelated fixed 320-pixel cap. | Replace the one-off cap with the shared 10-row contract.                                                                                                             |
| `TaskDirBar.tsx` Tools           | Renders the canonical resource-tool catalog without a list height contract.       | Add the shared bounded-list class.                                                                                                                                   |
| `TaskDirBar.tsx` Sources         | Renders `slice(0, 3)` plus a synthetic `View all` row.                            | Render the complete canonical source array inside the shared bounded list and delete the synthetic row.                                                              |
| `card.css`                       | Owns base Goal grid and exact 26-pixel Goal row plus 2-pixel gap geometry.        | Keep base Goal styling; the Environment surface supplies the bounded-list contract.                                                                                  |
| `conversation.css`               | Owns exact 38/6 Worktree, 32/4 Tool, and 28/2 Source row/gap geometry.            | Define one 10-row scroll rule and feed it each list's existing row/gap metrics.                                                                                      |
| `task-progress-collapse.test.ts` | Guards Goal rendering and layout but has no 10-row overflow contract.             | Require the shared class while preserving complete Goal rendering.                                                                                                   |
| `task-cwd-row-layout.test.ts`    | Guards the list owners but not a common scrolling abstraction.                    | Require all four consumers and reject the retired Worktree-only cap and source slicing.                                                                              |
| `task-dirbar-keyboard.test.ts`   | Uses two Goals, two Worktrees, and four Sources; it cannot prove overflow.        | Supply more than 10 Goals, measure exact visible rows and scrollability, verify all four lists share the computed overflow contract, and capture the rendered state. |

No backend route, API contract, database model, translation key, board identity,
Right Dock catalog, or Environment visibility change is required.

### Independent agent feedback

None. The user did not request sub-agents or parallel audits.

## Root cause

The Environment card has four repeated-item owners with four unrelated
behaviors: Goals are unbounded, Worktrees use an arbitrary pixel cap, Tools are
unbounded, and Sources are destructively sliced to three plus a synthetic row.
The 127-Goal screenshot is therefore one symptom of missing collection-level
layout ownership, not a Goal-only defect.

The root correction keeps each canonical array complete and gives all four
renderers one shared bounded-list surface. The shared rule derives its maximum
block size from the consumer's existing row height and gap, so the visible
window is exactly 10 items without forcing short lists to grow.

## Implementation plan

1. Update current architecture with the shared 10-row collection contract.
2. Add the bounded-list class to Goals, Worktree, Tools, and Sources; remove the
   Worktree-only fixed cap and Source slicing/synthetic row.
3. Define one overflow rule and pass the existing row/gap metrics from each
   list owner.
4. Extend static contracts and the real browser fixture with more than 10 Goals,
   exact geometry/scroll assertions, and a task-scoped screenshot.
5. Run focused tests, Overlay typecheck/build, document health, and the
   Node-launched browser fixture. Inspect the screenshot at original resolution,
   perform a second diff review, commit only task-owned files, and push to
   `myhexin`.

## Status

- [x] Baseline diagnosis, architecture review, and whole-repository call-point search.
- [x] Architecture, implementation, and regressions.
- [x] Vite geometry and screenshot review.
- [x] Validation and second review.
- [x] Commit and push.

## Validation evidence

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/task-cwd-row-layout.test.ts`
  passed 12 tests with 351 assertions.
- `bun run --cwd packages/overlay check:i18n` passed with catalog hash
  `0762a4bc7c9590d2`.
- `bun run --cwd packages/overlay typecheck` passed.
- The Node-launched focused Vite browser scenario
  `chat header environment panel matches the compact Codex information layout`
  passed after building 7,036 modules.
- Browser geometry measured 12 retained Goal rows in a 278-pixel viewport,
  exactly 10 26-pixel rows plus nine 2-pixel gaps. The list scroll height
  exceeded its client height and programmatic scrolling reached the exact
  terminal offset. Worktree, Tools, and Sources retained natural height with
  no overflow while sharing the same computed overflow contract.
- Original-resolution review of
  `.scratch/task-progress-goals-ten-row-scroll.png` confirmed that Goal rows
  1 through 10 fill the visible list region without extending the card.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
  passed 83 tests with 1,398 assertions.
