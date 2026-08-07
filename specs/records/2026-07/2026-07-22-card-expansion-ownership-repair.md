# 2026-07-22 Card Expansion Ownership Repair

## Recall

User request:

- Already-expanded cards and tool calls must never collapse automatically.

Acceptance criteria:

- A manual expansion remains expanded when a card changes from `running` to
  `completed`, `error`, `idle`, or another runtime status.
- Tool cards obey the same rule even though their no-override default is
  collapsed.
- Explicit user collapse remains stable as the symmetric operator choice.
- Task switches and reload persistence retain the same single fold-state
  source.
- Targeted tests, typecheck, build, a real browser interaction, and a reviewed
  screenshot prove the behavior.

Hard constraints:

- Remove the status-stamped stale-override model instead of adding a second
  state source, compatibility branch, fallback, or transition gate.
- Preserve unrelated dirty worktree changes and do not use `git reset`.
- Do not restart, refresh, close, or otherwise disturb the user's running
  OpenCorvus / overlay process; browser validation must use an isolated test
  instance.
- Use the repository's Node-driven Playwright sidecar for browser validation.

Sources read before implementation:

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-overlay-finished-message-collapse-scroll-bottom.md`
- `packages/overlay/src/store/conversation-ui.ts`
- `packages/overlay/src/components/Card.tsx`
- `packages/overlay/src/components/GoalGroup.tsx`
- `packages/overlay/src/components/ConversationAgentRail.tsx`
- `packages/overlay/src/services/goal-locate.ts`
- `packages/overlay/src/utils/card-tree.ts`
- `packages/overlay/test/card-fold-store.test.ts`
- `packages/overlay/test/card-expand-collapse-contract.test.ts`
- `packages/overlay/test/card-collapsed-preview.test.ts`

Whole-repository search evidence:

- `rg -n "cardExpanded\\(|toggleCard\\(|setCardExpanded\\(" packages/overlay/src packages/overlay/test --glob '*.{ts,tsx}'`
- `rg -n "statusAtSet|expandedCards" packages/overlay specs --glob '*.{ts,tsx,md}'`
- `rg -n "defaultExpandedForNode" packages/overlay/src packages/overlay/test --glob '*.{ts,tsx}'`

Call-site disposition:

| Surface                                 | Current role                                            | Repair                                                              |
| --------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| `conversation-ui.ts`                    | Status-stamped fold override owner and task persistence | Replace entries with direct booleans and remove status from the API |
| `Card.tsx`                              | Reads/writes card and tool expansion                    | Keep the stored operator value independent of node status           |
| `GoalGroup.tsx`                         | Reads/writes goal-group expansion                       | Use the same status-independent store contract                      |
| `ConversationAgentRail.tsx`             | Explicitly expands located card and parents             | Write `true` without runtime status                                 |
| `goal-locate.ts`                        | Explicitly expands located goal card and parents        | Write `true` without runtime status                                 |
| `coding-assistant-service.test.ts`      | Seeds fold state for task-clear tests                   | Update to the direct boolean API                                    |
| `card-fold-store.test.ts`               | Encodes stale-override behavior                         | Replace with status-transition persistence coverage                 |
| `card-expand-collapse-contract.test.ts` | Guards component/store wiring                           | Assert status-free read and write calls                             |

Independent-agent feedback:

- None requested; this task uses no delegated agent.

Diagnosis:

- `conversation-ui.ts` stores `{ value, statusAtSet }` and accepts the entry
  only while the live card status equals `statusAtSet`.
- A tool expanded while running therefore loses its explicit `true` when its
  status changes. `defaultExpandedForNode` then returns the tool default
  `false`, producing the reported automatic collapse.
- The stored user choice can later reactivate if status returns to the old
  value, proving runtime status is incorrectly treated as ownership of UI
  presentation state.

Implementation plan:

1. Make `expandedCards` a task-scoped `Record<string, boolean>` and persist that
   canonical shape.
2. Remove status parameters and stale-override comments from the store and all
   call sites.
3. Replace regression tests with explicit running-to-terminal persistence for
   both expansion and collapse, plus persistence/task-isolation coverage.
4. Add an isolated Node browser test that expands a running tool, streams a
   completed status, verifies it remains expanded, and captures the final UI.
5. Run targeted tests, overlay typecheck/build, documentation health checks,
   inspect the screenshot, then commit and push to `legacy-remote`.

## Validation

- `bun test packages/overlay/test/card-fold-store.test.ts packages/overlay/test/card-expand-collapse-contract.test.ts packages/overlay/test/card-collapsed-preview.test.ts packages/overlay/test/coding-assistant-service.test.ts`
  - Passed: 52 tests, 0 failures.
- `bun run --cwd packages/overlay typecheck`
  - Passed.
- `bun run --cwd packages/overlay build:vite`
  - Passed; Vite reported only the existing large-chunk advisory.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts`
  - Passed: 1 test, 0 failures, using Node with a headed isolated browser.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - Passed: 21 tests, 0 failures.

Visual evidence reviewed:

- `.scratch/tool-status-transition-remains-expanded.png`
  - The `bash` tool card remains visibly expanded after its rendered status is
    `completed`; the command and terminal output `1 pass, 0 fail` remain visible.
