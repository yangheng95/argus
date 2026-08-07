# 2026-07-24 Completed Message Card Auto-Collapse

## Recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | Message cards currently stay expanded forever. After an Agent message finishes, automatically compact it to a card approximately as tall as the supplied reference, showing a summary or the first few lines and avoiding wasteful full-body hydration. Follow-up clarification: only terminal completion may trigger automatic collapse; an Agent that is still executing or is idle between live turns must remain expanded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Acceptance                 | Running Agent messages remain expanded; terminal Agent messages with no operator override default collapsed; user-authored messages remain expanded; collapsed cards expose an accessible one-click disclosure, identity/status/time/actions, and at most three summary lines; the heavy `CardParts`, nested Agent/tool subtree, interactive artifacts, trace, and reply form are not mounted while collapsed; a manual expand/collapse remains authoritative across status changes and task reload persistence.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Hard constraints           | Reuse `conversation-ui.ts` as the only fold-state owner and `defaultExpandedForNode` as the only no-override policy. Prefer persisted `agentSummary.text`, then the existing latest-activity preview; do not call another model, add hidden messages, duplicate message data, introduce a status gate/state machine, or add a second hydration path. Use the shared Button/Icon primitives. Use the repository Node-launched browser path for visual QA. Do not restart, refresh, or kill the user's running OpenCorvus/Overlay process. Preserve unrelated dirty worktree changes.                                                                                                                                                                                                                                                                                                                               |
| Sources read               | `AGENTS.md`; Browser skill; supplied screenshot; `specs/current/architecture/12-overlay-card-system.md`; `specs/records/2026-07/2026-07-08-overlay-finished-message-collapse-scroll-bottom.md`; `specs/records/2026-07/2026-07-08-collapsed-card-dynamic-latest-activity.md`; `specs/records/2026-07/2026-07-22-card-expansion-ownership-repair.md`; `ChatBubble.tsx`; `Card.tsx`; `CardHeader.tsx`; `Conversation.tsx`; `conversation-ui.ts`; `card-tree.ts`; `utils/card-tree.ts`; `chat-bubble.css`; focused source and browser tests.                                                                                                                                                                                                                                                                                                                                                                         |
| Whole-repository grep      | `defaultExpandedForNode` is implemented only in `utils/card-tree.ts` and currently consumed only by `Card.tsx`; `ChatBubble.tsx` is the sole message/Agent bubble renderer and currently has no fold-store calls. `cardExpanded`/`setCardExpanded` are owned by `conversation-ui.ts`; production callers are `Card.tsx`, `GoalGroup.tsx`, `ConversationAgentRail.tsx`, `goal-locate.ts`, plus the new ChatBubble call. `renderAsBubble` routes only `message` and `agent` nodes from `Conversation.tsx`; direct browser-fixture uses are explicit tests. `collapsedActivityPreviewText` and `collectLatestActivityText` are the existing compact-preview pipeline; `agentSummary` is projected by `tree-writer.ts`. Existing regression owners are `card-collapsed-preview.test.ts`, `card-expand-collapse-contract.test.ts`, `chat-bubble.test.ts`, and `browser/chat-bubble-disclosure-button-browser.test.ts`. |
| Independent agent feedback | None requested; no sub-agent was used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Baseline delivery evidence | `git fetch myhexin v0.0.17beta` found the branch two commits ahead. The required pre-change push ran the repository hook but was blocked by nine pre-existing `RunOutput.result` type errors in dirty `packages/opencorvus/src/orchestrator/build-tool.ts`; no task file had been modified at that point.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Diagnosis

The structured `Card` renderer already owns a lightweight collapsed projection,
but top-level `message` and `agent` nodes are routed to `ChatBubble`, which always
mounts its complete body. A later regression test explicitly forbids
`ChatBubble` from reading the canonical fold store, so the older finished-message
default policy cannot affect the real message-card surface. CSS-only clamping
would leave Markdown, artifacts, tool output, nested Agents, and reply controls
mounted and therefore would not solve the resource problem.

The repair is a projection correction, not a new lifecycle mechanism:

1. `defaultExpandedForNode` returns `true` for live Agent messages (`pending`,
   `running`, and `idle`) and user-authored messages, but `false` only for
   terminal non-user message/Agent cards (`completed`, `error`, and `skipped`).
2. `ChatBubble` reads that default through `cardExpanded`. With no stored
   operator choice, the reactive running-to-terminal status transition changes
   the effective value from expanded to collapsed.
3. `setCardExpanded` records a click as the existing task-scoped operator
   override. That explicit boolean remains authoritative across later status
   changes, preserving the 2026-07-22 ownership repair.
4. The collapsed preview prefers the backend-projected terminal Agent summary
   and otherwise reuses the cached latest-activity text. CSS clamps it to three
   lines.
5. The body is behind Solid's conditional mount, so collapsed cards do not
   instantiate the expensive transcript subtree.

## Call-Site Disposition

| Surface                                                     | Current role                                                    | Disposition                                                                                                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/utils/card-tree.ts`                   | Single no-override expansion policy and compact-preview helpers | Change terminal non-user message/Agent default to collapsed; preserve pending/running/idle live sessions, user-authored cards, Todo tools, and explicit `node.defaultExpanded` behavior.                    |
| `packages/overlay/src/store/conversation-ui.ts`             | Task-scoped persisted operator fold choice                      | Reuse unchanged.                                                                                                                                                                                            |
| `packages/overlay/src/components/Card.tsx`                  | Structured tool/review/Agent card disclosure consumer           | Reuse unchanged; its existing behavior proves the store contract.                                                                                                                                           |
| `packages/overlay/src/components/ChatBubble.tsx`            | Sole `message`/`agent` bubble renderer                          | Add the canonical fold-store read/write, primitive disclosure header, summary projection, and conditional body mount.                                                                                       |
| `packages/overlay/src/components/Conversation.tsx`          | Sole production router between `ChatBubble` and `Card`          | Preserve unchanged.                                                                                                                                                                                         |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | Explicit locate-and-expand command                              | Preserve; its existing `setCardExpanded(true)` now also expands located ChatBubbles.                                                                                                                        |
| `packages/overlay/src/services/goal-locate.ts`              | Explicit goal locate-and-expand command                         | Preserve unchanged.                                                                                                                                                                                         |
| `packages/overlay/src/components/GoalGroup.tsx`             | Separate goal-group fold consumer                               | Preserve unchanged.                                                                                                                                                                                         |
| `packages/overlay/src/styles/surfaces/chat-bubble.css`      | Message-card material and layout                                | Add compact header/preview/disclosure styles using existing tokens and a three-line clamp.                                                                                                                  |
| Focused unit/browser tests                                  | Encode the currently incorrect always-expanded contract         | Replace that assertion with running/terminal/user defaults, single-store wiring, no collapsed body mount, click/keyboard expansion, resource-heavy subtree absence, and compact-height screenshot evidence. |

## Implementation And Verification Plan

1. Update the default fold-policy tests before implementation so the prior
   always-expanded contract fails for terminal non-user messages.
2. Wire `ChatBubble` to the canonical fold state and render the collapsed
   summary inside a shared Button disclosure.
3. Keep the whole body under one conditional mount and verify collapsed DOM
   absence for message text, Tool output, Artifact, nested children, and reply
   form.
4. Update the existing Node/Playwright message-card browser fixture to start
   terminal and collapsed, capture a goal-scoped compact screenshot, expand by
   clicking visible summary text, verify the full body, collapse again, and
   verify the compact height.
5. Run focused Bun tests, Overlay typecheck/build, the Node browser test,
   relevant document-health tests, and inspect every produced screenshot.
6. Perform a second diff review, record validation here, then create a
   `dsw-33987` scoped commit and retry the git-cc push.

## Validation

### Passing Evidence

- `bun test packages/overlay/test/card-collapsed-preview.test.ts packages/overlay/test/card-expand-collapse-contract.test.ts packages/overlay/test/card-fold-store.test.ts packages/overlay/test/chat-bubble.test.ts packages/overlay/test/chat-bubble-routing.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts packages/overlay/test/use-card-head-actions.test.ts`
  - Original delivery: `72 pass / 0 fail`.
  - Follow-up terminal-state correction: focused `card-collapsed-preview`,
    `card-fold-store`, and `chat-bubble` run passed `39 pass / 0 fail`.
  - Covers pending/running/idle remaining expanded, terminal auto-collapse
    without an override, manual expansion authority, task persistence,
    terminal/user defaults, cached preview selection, and ChatBubble's
    conditional body mount.
- `bun run --cwd packages/overlay typecheck`
  - Pass.
- `bun run --cwd packages/overlay check:i18n`
  - Pass.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts`
  - `1 pass / 0 fail`, using Node and a real non-headless browser.
  - The fixture starts with a terminal Agent card, verifies `aria-expanded` is
    false, measures a 70–190px compact bound, proves that message text, Tool
    cards, interactive Artifacts, the reply form, and recursive copy-text
    collection are absent, then clicks the visible summary and exercises the
    complete existing body, Tool, Artifact, copy, keyboard, dark-theme, and
    reload-persistence paths.
- Follow-up lifecycle browser replay confirmed the real `running → idle →
terminal.completed` transition keeps the body expanded through `idle` and
  collapses it only at terminal completion. The existing long visual fixture
  then reached an unrelated concurrent styling assertion because the dirty
  worktree currently makes the Agent bubble background transparent; no task
  production style was changed, and the fixture file was restored unchanged.
- The browser runner rebuilt the production Vite artifact successfully.
- `bunx prettier --check ... && git diff --check`
  - Pass for every task-owned source, test, and record.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `21 pass / 0 fail`.

### Visual Review

Reviewed after the final browser run:

- `.scratch/overlay-agent-message-collapsed-default.png`
- `.scratch/overlay-conversation-message-collapsed-default.png`
- `.scratch/overlay-codex-message-expanded-default.png`

The one-line terminal summary produces an approximately 90px card with a
visible disclosure chevron, Agent identity, status, timestamp, duration, and
summary. Longer summaries are clamped at three lines. The full conversation
view keeps the compact card aligned to the canonical message width; expanding
restores the complete typography, execution disclosure, and Artifact layout
without a header or border shift.

### Baseline And Residual Dirty-Worktree Evidence

- The mandatory pre-change git-cc push hook was initially blocked by nine
  existing `RunOutput.result` type errors in dirty
  `packages/opencorvus/src/orchestrator/build-tool.ts`. Those owning changes
  converged before final delivery; the final git-cc push passed all package
  typechecks, API route checks, docs checks, Overlay i18n, and secret scan.
- After staging the new record, the combined document-health run passed 81
  assertions and failed only because tracked
  `specs/current/architecture/15-agent-context-packet.md` is deleted by another
  in-progress change, so the audit cannot read it.
- An extra Agent Rail regression test failed because its clean expectation has
  not been updated for the existing `oc-section-heading` class in
  `ConversationAgentRail.tsx`. The task-owned Agent Rail locate/expansion
  production path was not modified.
