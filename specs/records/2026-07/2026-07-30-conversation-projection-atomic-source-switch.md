# Conversation projection atomic source switch

Date: 2026-07-30

## Recall

### User request and evidence

- The supplied Chat debug snapshot identifies selected standalone Session
  `ses_04e8d236effefpi44Qq07b1AQc` and reports one top-level Agent card.
- The supplied screenshot shows latched render failures for two unrelated
  child Sessions and one unrelated Orchestrator message:
  `subagent progress card missing activity record` and
  `card-tree: missing rendered card`.
- Repair the real projection inconsistency without refreshing, restarting, or
  mutating the user's active Overlay.

### Acceptance criteria

- A Task, Chat, Mission, archive/delete, empty-workspace, or recovery source
  transition never exposes a frame where conversation-Agent records belong to
  one source while card-tree rows belong to another.
- A complete conversation hydrate publishes Board, Agent, and card-tree
  projection changes as one reactive commit.
- Exact missing-identity errors remain strict; the repair must not hide errors,
  insert placeholder records, or add fallback rendering.
- The existing Virtua row identity, Sub-agent progress grid, exact Right Dock
  transcript, scrolling, animation, and every user-visible feature remain.
- UI acceptance uses an isolated real page and manually inspected screenshot;
  no UI automated test is added, modified, or run.
- Only task-owned files are committed; concurrent Composer work remains
  untouched.

### Hard constraints and sources read

- `AGENTS.md`, `specs/current/architecture/07-panel-reactivity.md`,
  `specs/records/2026-07/2026-07-25-subagent-progress-grid-and-conversation-dock.md`,
  and
  `specs/records/2026-07/2026-07-27-subagent-grid-dynamic-split-reactivity.md`.
- Prior Sub-agent projection guidance: canonical `sessionID` is the stable
  child identity and progress cards plus the Dock derive from the same
  conversation-Agent projection.
- Preserve the shared dirty worktree and do not touch the active server beyond
  read-only inspection.

### Read-only live evidence

- `GET /session/ses_04e8d236effefpi44Qq07b1AQc/conversation` currently returns
  eight transcript messages, all owned by that root Mission Session.
- Its canonical `agentView.sessions` contains only the root Mission Session;
  none of the Session/message identities rendered in the screenshot belongs to
  the selected source.
- Therefore the screenshot is not a backend identity omission. It is a stale
  frontend row from the previous source that rendered during a split store
  transition and then remained latched in `ErrorBoundary`.

### Whole-repository grep and disposition

| Owner / call site | Current behavior | Disposition |
| --- | --- | --- |
| `cancelConversationReplay` | Cancels requests and independently clears the Agent store by default. | Make cancellation lifecycle-only; projection reset belongs to one atomic owner. |
| `resetConversationAgentView` + `resetWriter` | Clear two stores through separate calls. | Introduce one `resetConversationProjection` commit that clears both inside Solid `batch`. |
| Task selection | Clears Agent state before the existing Board/card-tree batch. | Move the unified projection reset into the source-selection batch. |
| Chat selection, delete, archive | Same split clear around `selectedSource`. | Use the same unified reset inside the existing batch. |
| Mission selection/failure | Clears Agent state without synchronously clearing the old tree; failure clears only the tree. | Atomically set source/Board state and reset both projections. |
| Empty workspace | Cancels/reset Agent, then clears the tree separately. | Use the unified projection reset. |
| Selected-task recovery | Cancels replay while retaining the current tree. | Cancellation no longer mutates either projection. |
| Complete hydrate | Resets the tree, then publishes Board, Agent, and tree projections sequentially. | Validate the response first, then publish all projection stores in one batch. |
| Latest-tail hydrate | Publishes Board, Agent, and tree projections sequentially. | Publish the replacement projections in one batch. |
| Full/tail event replay | Commits the prepared transcript and protocol events in two subscriber-visible waves and repeats tree projection work. | Commit the snapshot and event page in one batch and one deferred projection pass. |
| Event handlers | Rebuild timeline, hierarchy, top-level order, card statistics, and visible version repeatedly within one event page. | Defer every derived tree projection to the page boundary and flush each owner at most once. |
| Markdown prewarm | Scans the complete transcript and parses multiple entries before paint; visible rendering scans unbounded input before clipping. | Inspect only the latest 24 messages, prewarm one bounded short source after paint, cancel superseded work, and clip visible input before regex/Markdown parsing. |
| Hydrate failure | Solid `batch` delays notification but does not roll back Map/store writes when a later validator throws. | Prepare and validate messages, parts, order keys, Agent identities, and standalone questions before mutation; an owned Task/Chat failure clears Board and both projections together. |
| Writer reset | Flushes buffered part deltas from the source being destroyed before clearing the tree. | Cancel and discard superseded deltas at the ownership boundary; never execute old-source work during reset. |
| Task Board projection | `setBoardData` notifies the tree projection and full hydrate rebuilds the same Board-derived cards again. | Suppress the intermediate notification only for the hydrate transaction and perform one prepared tree commit. |
| Older/session history | Adds history to the same source without clearing identity owners. | Preserve; it is not a source-replacement boundary. |
| `VirtualizedConversationItem`, `SubagentProgressGrid`, `StoreCardNode` | Strictly expose missing canonical records/cards. | Preserve unchanged; their failures supplied the correct evidence. |

## Causal chain

1. Source selection calls `cancelConversationReplay()`.
2. Cancellation clears `conversationAgentStore` immediately while the previous
   `cardTreeStore` and Virtua rows remain mounted.
3. A reused Sub-agent grid row resolves its old canonical `sessionID` against
   the now-empty/new Agent projection and throws.
4. Hydration similarly resets and rebuilds Board, Agent, and card stores across
   separate reactive commits, allowing a card row to resolve between owners.
5. The local `ErrorBoundary` correctly records that inconsistent frame, but its
   fallback stays mounted after the later valid hydrate.

## Implementation

1. Separate request cancellation from render projection ownership.
2. Add one atomic conversation projection reset shared by every source
   transition.
3. Batch complete hydrate and latest-tail replacement across Board,
   conversation-Agent, and card-tree owners.
4. Parse and validate the complete transport projection outside the reactive
   commit, discard superseded buffered deltas at reset, and atomically clear
   owned failure paths.
5. Eliminate the duplicate Task Board-derived tree rebuild while keeping the
   same single projection owner.
6. Defer transcript, event, Board, hierarchy, top-level order, card-stat, and
   visible-version projection work to one page boundary.
7. Restrict speculative Markdown work to the newest 24 messages and sources of
   at most 4,000 characters, schedule one item after paint, and retain the
   complete on-demand renderer for every message. Apply the existing 120,000
   character display boundary before data-image regex and Markdown parsing.
8. Validate the response Board kind/ID against the requested source, require
   every Agent parent chain to terminate at that root, and reject a root record
   that itself carries a parent.
9. Keep strict missing-record/card errors and the canonical virtualizer
   projection unchanged.
10. Verify typecheck/build, then use an isolated real Overlay to switch between
   sources and manually inspect the resulting screenshot.

## Independent audit feedback

- Frontend, backend, and system reviewers independently agreed that the
  supplied stale IDs are absent from the canonical backend payload and that
  the original defect is a frontend cross-source split commit.
- Their first review found three remaining ownership gaps: empty-workspace
  source clearing, Chat/Task hydrate failure rollback, and data validation
  still occurring after mutation inside a non-transactional Solid batch.
- The system review also found duplicate Board-derived projection work and
  old-source buffered deltas executing during reset.
- The implementation was revised before acceptance: every named source/failure
  boundary now resets Board, Agent, and tree ownership together; hydrate uses
  pure prepare/validation before commit; reset discards superseded deltas; and
  Task hydrate performs one Board-derived rebuild.
- Later independent review caught and prevented a `finally` return from
  swallowing replay exceptions. The final deferral only clears flags on
  failure, preserves the original error, and lets the outer owner reset the
  projection at depth zero.
- The final three-agent review reports no P0 or P1 projection/performance
  defects. Event-page projection includes timeline, hierarchy, Board,
  top-level order, card statistics, and visible version; each converges once
  at the page boundary.

## Verification

- Canonical read-only server evidence for Session
  `ses_04e8d236effefpi44Qq07b1AQc` contains only that root identity; the stale
  screenshot IDs are absent from its Board, transcript, and Agent view.
- `bun run typecheck`: all eight repository typecheck tasks passed.
- `bun run --cwd packages/overlay build:vite`: production Overlay build
  passed. Existing Radix `use client` and large-chunk notices remain warnings,
  not build failures.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  and the product-document single-source checks passed.
- The final real Vite page used the live server read-only and exercised
  New Chat → Mission → Task. The stable Task state contained two real
  Sub-agent progress regions and Agent activity, with zero `Card render
  failed`, `missing activity record`, or `missing rendered card` text.
- Screenshot:
  `.scratch/conversation-projection-final-performance-task.jpg`. Manual review
  confirmed the real Task card, scrollbar, composer, and single platform
  titlebar render normally.
- No UI automated test was added, modified, or run. The owned Vite and isolated
  validation service were stopped; the user's server on port 7878 was not
  restarted, refreshed, or terminated.
