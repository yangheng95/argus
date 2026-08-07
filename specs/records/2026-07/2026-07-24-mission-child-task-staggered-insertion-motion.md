# Mission Child Task Staggered Insertion Motion

## Recall

| Field | Content |
| --- | --- |
| User request | Mission 下方的子任务默认收起；保留 hover 自动展开，但把当前抽屉动效改为从右侧一条一条插入，并控制动画时间，保证丝滑流畅。 |
| Acceptance criteria | Child tasks remain collapsed at rest; pointer hover and keyboard focus still reveal them; child rows enter from the right in their canonical list order with a bounded stagger; leaving the Mission reverses cleanly; reduced-motion users receive an immediate reveal; a real rendered Overlay screenshot and motion geometry evidence pass. |
| Hard constraints | Keep `WorkLedger` as the single renderer and the backend-projected Mission task array as the only order source; do not add hover state, timers, a second expansion model, or a hand-written drawer controller; reuse the shared motion tokens; preserve unrelated dirty worktree changes; do not restart or refresh a running OpenCorvus or Overlay process. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-08-mission-task-chat-toolbar-consolidation-impact.md`; `specs/records/2026-07/2026-07-17-work-ledger-hover-pin-row-parity.md`; `packages/overlay/src/components/WorkLedger.tsx`; `packages/overlay/src/styles/surfaces/work-ledger.css`; `packages/overlay/src/styles/tokens/design-language.css`; the focused source and browser tests listed below. |
| Whole-repository search | `rg -l "work-row-child-drawer\|work-row-child-list\|data-has-child-tasks" packages specs`; `rg -n "work-row-child-drawer\|work-row-child-list\|data-has-child-tasks\|child.*drawer\|hover.*child" packages/overlay/src packages/overlay/test`; `rg -n "WorkLedger\|work-ledger\|work-row\|mission-child\|mission-task" packages/overlay/src packages/overlay/test`; `rg -n "ui-duration\|timing" packages/overlay/src/styles/tokens packages/overlay/src/styles`; `rg -n "work-ledger\|child-task\|Mission" packages/overlay/test/browser --glob "*.test.ts"`. The search found one component owner, one stylesheet owner, three focused source-contract test files, and the production-shaped `project-ledger-group-browser.test.ts` fixture that already renders Mission-owned child tasks. |
| Independent agent feedback | Not launched because the active multi-agent policy forbids sub-agent delegation unless the user explicitly requests it. The primary agent performs both implementation and second visual review. |
| Worktree and remote note | The worktree was already dirty in unrelated Overlay and spec files. `git fetch legacy-remote` showed the current work branch is published, while `legacy-remote/v0.0.17beta` has newer commits whose changed files overlap those unrelated local edits. This task must not stash, overwrite, or merge those edits implicitly. |

## Evidence and Call Sites

| Surface | Current responsibility | Decision |
| --- | --- | --- |
| `WorkLedger.tsx` Mission child `<For>` | Renders the canonical `WorkLedgerMissionRow.tasks` sequence. | Retain the sequence and expose only the render index as a CSS custom property for presentation staggering. |
| `WorkLedgerTaskChildRow` | Owns each child task `<li>` and delegates the canonical shared row renderer. | Add the presentation index input; do not add interaction state or timers. |
| `work-ledger.css` `.work-row-child-drawer` | Collapses and expands the entire child list as a vertical drawer. | Replace the moving drawer presentation with clipped visibility and animate each child row from the right. |
| `work-ledger.css` motion tokens | Defines `fast`, `base`, `slow`, and standard easing centrally. | Compose row duration and stagger from these tokens; keep motion literals out of the surface. |
| `mission-launcher-component.test.ts` | Guards hover/focus-only child expansion. | Update it to require indexed child rendering and stagger selectors. |
| `work-ledger-consolidation.test.ts` | Guards the unified Mission/Task hierarchy and current drawer contract. | Replace drawer-motion assertions with right-insertion and reduced-motion assertions. |
| `task-row-right-alignment.test.ts` | Slices the shared action rail before the child list. | Preserve unchanged; the markup boundary remains stable. |
| `project-ledger-group-browser.test.ts` | Renders the real Overlay shell with Work Ledger fixtures and screenshots. | Extend the Mission fixture to three children and capture rest, intermediate stagger, and settled hover evidence. |

## Implementation

1. Pass the Solid `<For>` index to `WorkLedgerTaskChildRow` and expose it through one custom property on the child `<li>`.
2. Keep the drawer responsible only for collapsed layout and clipping. Its height reveal uses the shared slow token without the old whole-block fade or vertical translation.
3. Give every child row an initial right translation and zero opacity. Hover/focus reveals rows with a delay derived from their canonical index, producing a short ordered cascade while the overall motion stays bounded.
4. On pointer exit, use the same row properties with no stagger delay so the list retracts as one responsive unit instead of replaying the cascade backward.
5. Under `prefers-reduced-motion: reduce`, remove transitions and transforms while retaining the same visibility and focus semantics.
6. Update focused source tests, run the real Node-based browser test, inspect the goal-region screenshots, then perform a second source/diff review.

## Verification

- `bun test packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/task-row-right-alignment.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- Real screenshot review of the Mission row at rest, during ordered insertion, and after settlement.

## Verification Results

- The focused Mission/Work Ledger source contracts passed: 46 tests, 0 failures. A later combined rerun including the motion-coverage suite passed 51 tests and reported one unrelated concurrent violation in `conversation.css` (`160ms` literal in another task's agent-rail tooltip animation); the Mission child animation itself uses only shared duration tokens.
- Overlay TypeScript typecheck passed.
- The production Overlay browser fixture rendered three canonical Mission children and proved:
  - collapsed visibility is hidden with an exact `0px` drawer height;
  - render indices are `0`, `1`, and `2`;
  - computed entry delays are `0ms`, `40ms`, and `80ms`;
  - the frozen 70ms frame has strictly descending opacity from child 1 to child 3;
  - the settled frame has three fully opaque rows at zero inline translation;
  - pointer exit returns every row to zero opacity with no reverse stagger.
- The goal-region screenshots were reviewed directly:
  - `.scratch/work-ledger-mission-children-collapsed.png`
  - `.scratch/work-ledger-mission-children-inserting.png`
  - `.scratch/work-ledger-mission-children-inserted.png`
- The large existing `project-ledger-group-browser.test.ts` continued beyond all new motion assertions and screenshots, then timed out in later Work Ledger tooltip/row checks while concurrent uncommitted work was changing the same component, stylesheet, browser test, and presentation semantics. The task-owned animation evidence itself is green; this record does not relabel the downstream concurrent failure as a motion failure.
- Historical document links passed: 21 tests, 0 failures. The combined document-health rerun reported concurrent failures in the separately edited `07-panel.md` contract and other untracked July records; this new record is indexed and becomes tracked with the task commit.
- Browser skill inspection found no open local application tab to claim, so validation did not reload or interfere with any running OpenCorvus/Overlay process.
