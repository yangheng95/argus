# Overlay Stream Jank Benchmark

Date: 2026-06-28
Status: active investigation

## Task

The post-refactor overlay feels noticeably laggy. This pass treats the issue
as a Graphical User Interface performance defect, not as a generic test-green
question.

## Recall

- `2026-05-14-overlay-refresh-single-source-plan.md` requires visible message
  deltas to update through `cardTreeStore` without broad board refresh.
- `2026-05-15-overlay-streaming-text-main-thread-plan.md` requires streaming
  text and reasoning to avoid full markdown parsing on every delta.
- `2026-05-15-overlay-scroll-single-source-plan.md` requires scroll follow to
  be driven by visible data version, not rendered DOM mutation observation.
- `2026-06-19-system-performance-high-confidence-pass.md` requires benchmark
  evidence and no restart of running overlay processes.

## Current Evidence

- `packages/overlay/test/tree-writer-perf.test.ts` passes with large margins;
  the writer itself does not show quadratic delta cost.
- `packages/overlay/test/browser/task-list-perf.test.ts` passes; task and
  mission list rendering is not the first suspected root.
- The uncovered surface is a real browser stream with the right workflow panel
  mounted. Before the fix, `Board.tsx` derived requirements/frontend-research
  streaming messages from `cardTreeStore`, so a running stage rendered the
  same live text in both the conversation and workflow panel.
- `Conversation.tsx` additionally observes the rendered virtual window and
  calls the scroll controller on resize, which is a possible second content
  change source next to `cardTreeStore.visibleVersion`.

## Benchmark Contract

Input:

- A fixture backend serving the real overlay build.
- One selected task with many hydrated requirement-stage messages.
- A running requirements workflow section.
- A sustained `message.part.delta` stream on the selected task.

Measured output:

- Maximum event-loop drift while streaming.
- Browser long-task count and maximum long-task duration.
- Number of mounted conversation cards, proving virtualized DOM size remains
  bounded.
- The streamed text is visible, proving the benchmark did not pass by dropping
  updates.

Timeout policy:

- Page waits use activity-sensitive loops where possible.
- Browser-side remote procedure calls already use inactivity timeouts in
  `packages/overlay/test/launch.ts`.

Acceptance:

- No unexpected browser errors.
- Mounted conversation cards remain bounded.
- Max event-loop drift stays below the benchmark threshold.
- Long tasks stay below the benchmark threshold.
- Streamed text reaches the visible overlay.
- Right workflow running status remains visible, but workflow streamed正文 text
  is not rendered there. The conversation is the single streamed-text surface.

## Constraints

- No fallback, compatibility path, or gate.
- No new git worktree.
- Do not restart or reload any user-running OpenCorvus overlay process.
- Use Node Playwright runner for browser tests on Windows.

## 2026-06-28 Implementation Result

Root cause:

- `message.part.delta` appended text, then rebuilt top-level card order for
  every visible delta. That global sort invalidated conversation and board
  projections even when the delta only changed one leaf part.
- The right workflow panel amplified the cost by deriving full message segment
  arrays in `Board.tsx`, so every streamed token could rescan the reachable
  tree and re-split all requirements messages.

Fix:

- Text deltas now update only the target part and card stats. Top-level order
  is rebuilt only when a previously hidden message card becomes visible.
- `replaceCardTreeOrder()` is idempotent when the computed order is unchanged.
- Workflow panels no longer render streamed正文 text. They keep the running
  status, badge, and structured results; the conversation remains the streamed
  text owner.

Evidence:

- Before fix: `stream-jank drift=206.7ms`.
- After first writer fix: `stream-jank drift=191.9ms`.
- Final benchmark after removing duplicated workflow text rendering:
  `stream-jank drift=41.1ms longTasks=0 maxLongTask=0.0ms mounted=17
  workflowMessages=0 order=122`.
- Visual evidence:
  `.scratch/overlay-stream-jank-after-stream.png` and
  `.scratch/workflow-generating-status-live.png`.
