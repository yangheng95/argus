# 2026-06-14: Marker-On-Anchor Compaction Boundary

## Trigger

Task `tsk_ec3ebff47001VGYgHftSjXkRgt` stalled in build session
`ses_13a97afd9ffe76mt899sqhhVhR` after completing the accessibility audit.
The session produced a valid structured compaction summary, then repeatedly
triggered predictive compaction without reducing the prompt:

- first repeated trigger: `2026-06-14T09:40:21Z`
- repeated triggers before operator cancel: `6593`
- stable estimate: `totalTokensEst=169255`, `limit=165254`
- stable payload: `messagePayloadChars=509524`, `mediaCount=13`

The completed compaction marker was written onto the dispatch anchor user
message itself. Its `anchor_id` also pointed at that same user message and it
had no `tail_start_id`. `Message.filterCompacted()` and
`latestCompactionPruneRange()` only handled the shape where the compaction
marker appears after the anchor, so the structured handoff existed but old
assistant/tool history stayed visible to the next prompt.

## Cross Review

Three independent read-only reviews agreed on the core defect and constraints:

- `hasCompletedCompactionForSource()` is not the root cause. It should remain a
  duplicate-control idempotency check; deleting it would repeat summaries rather
  than shrink the prompt.
- `marker-on-anchor` is a supported shape produced by long workflow sessions
  with a single dispatch user and many assistant step messages.
- Replay and prune must understand this shape directly. A retry cap or hidden
  gate would only mask the root cause.
- If a valid summary exists and the actual filtered prompt is still over
  budget, the next turn must produce a visible `PromptBudgetOverflowError`
  instead of queueing another same-source compaction.

## Call-Point Audit

Command basis:

`rg -n "filterCompacted|latestCompactionPruneRange|prunableToolParts|completedCompactions|hasCompletedCompactionForSource|SessionCompaction.create|SessionCompaction.process|compaction_request|manual_summarize|CompactionHandoff.isValidSummaryMessage|toModelMessages|predictiveCompactionDecision|PromptBudgetOverflowError" packages/opencorvus/src packages/opencorvus/test specs`

| Surface                                       | Decision                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Message.filterCompacted`                     | Replace the implicit "marker is after anchor" assumption with explicit support for marker-on-anchor. Keep legacy tail-only and separate-marker behavior.                                                                                                                                                                                                                              |
| `Message.toModelMessages`                     | Keep summary rendering through `CompactionHandoff.isValidSummaryMessage`; filtered ordering must make the handoff attach to the intended visible user.                                                                                                                                                                                                                                |
| `SessionCompaction.selectCompactionInput`     | Keep selecting assistant-step history for long single-dispatch build sessions. Do not reintroduce assistant `tail_start_id`.                                                                                                                                                                                                                                                          |
| `SessionCompaction.process`                   | Keep writing the compaction marker on the source user and keep summary `parentID` as that source user. Do not synthesize a continuation user.                                                                                                                                                                                                                                         |
| `SessionCompaction.create`                    | Keep control-record creation unchanged. Runtime validation remains bound to the source user.                                                                                                                                                                                                                                                                                          |
| `completedCompactions`                        | Keep valid structured summary as the only accepted boundary source; marker-on-anchor must still be represented by the existing marker user plus summary parent relation.                                                                                                                                                                                                              |
| `latestCompactionPruneRange`                  | Replace no-tail end selection for marker-on-anchor so the covered range is `anchor + 1` through the summary, not an empty range ending at the marker.                                                                                                                                                                                                                                 |
| `prunableToolParts`                           | Keep as a consumer of `latestCompactionPruneRange`; no separate prune rule.                                                                                                                                                                                                                                                                                                           |
| `SessionCompaction.prune`                     | Keep requiring a valid structured boundary before clearing tool outputs.                                                                                                                                                                                                                                                                                                              |
| `CompactionHandoff.isValidSummaryMessage`     | Keep as the single summary validity predicate. Do not add a parallel boundary predicate.                                                                                                                                                                                                                                                                                              |
| `SessionLoop.hasCompletedCompactionForSource` | Keep as the completed-summary predicate. Pending-control idempotency and already-compacted over-budget visible errors may share this predicate; do not turn it into a retry cap or route gate.                                                                                                                                                                                        |
| Pending `compaction_request` handling         | Keep control consumption flow. Add no retry counter and no new control kind.                                                                                                                                                                                                                                                                                                          |
| Legacy `task?.type === "compaction"` handling | Keep legacy path; marker-on-anchor should not reinterpret old tail-only markers.                                                                                                                                                                                                                                                                                                      |
| `/session/:sessionID/summarize`               | Keep manual summarize semantics: summary mode stops after the maintenance summary.                                                                                                                                                                                                                                                                                                    |
| `MemoryFlush.flush`                           | Keep flushing from structured handoff, not rendered Markdown.                                                                                                                                                                                                                                                                                                                         |
| SDK/OpenAPI `CompactionPart`                  | No schema change.                                                                                                                                                                                                                                                                                                                                                                     |
| Predictive/reactive budget handling           | Add a deterministic "already compacted but still over budget" visible error path based on actual filtered prompt state, not a retry cap. Post-turn overflow must not queue another same-source compaction once the source already has a valid summary; it should fall through to the real prompt diagnostic path rather than constructing an outer error with incomplete budget data. |

## Boundary Model

The single source of truth is still:

- a user message containing a `compaction` part;
- a later assistant message with `summary: true`, `parentID` equal to that user
  message id, and valid `CompactionHandoff` structured data.

For marker-on-anchor:

- the marker user is also the `anchor_id`;
- the dispatch anchor text remains visible;
- the structured summary covers messages after the anchor and before the
  summary;
- without `tail_start_id`, all covered assistant/tool history is removed from
  replay and eligible for prune after the protected tool-output budget;
- with a user `tail_start_id`, replay keeps the anchor, summary, and the real
  user-tail suffix;
- with an invalid or assistant `tail_start_id`, replay rejects the partial tail
  instead of preserving an assistant-only suffix.

## Implementation Plan

1. Add failing tests for marker-on-anchor replay and prune.
2. Update `Message.filterCompacted()` so marker-on-anchor can retroactively
   remove the covered history that was already read in newest-first order.
3. Update `latestCompactionPruneRange()` so marker-on-anchor no-tail produces a
   non-empty covered range ending at the summary assistant.
4. Add a loop-level test or hook coverage for the already-compacted still-over
   case, then implement visible `PromptBudgetOverflowError` before queueing a
   duplicate same-source compaction.
5. Run only targeted session compaction tests first, then broaden if those
   changes touch shared message replay behavior.

## Acceptance

- Marker-on-anchor plus no tail replays as anchor + structured summary + newer
  turns; old assistant/tool history is absent.
- Marker-on-anchor plus user tail preserves that tail and rejects assistant-only
  tails.
- Marker-on-anchor prune can select old covered tool output, while preserving
  post-tail tool output.
- Existing legacy tail-only, separate-marker, manual summarize, and multi-user
  compaction tests remain green.
- A valid same-source summary followed by another over-budget prompt does not
  enqueue endless same-source compaction requests. Predictive/reactive prompt
  diagnostics produce a visible typed budget error; post-turn overflow does not
  create a second same-source compaction control.
