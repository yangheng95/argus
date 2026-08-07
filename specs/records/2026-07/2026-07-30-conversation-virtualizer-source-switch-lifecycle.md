# Conversation Virtualizer Source-Switch Lifecycle Repair

Date: 2026-07-30

## Recall

### User request and visible evidence

- After the recent conversation-projection refactor, selecting another
  Work Ledger conversation appears to leave the message panel unchanged.
- Clicking New Chat can leave the previous conversation cards visible while
  simultaneously mounting the empty-home Composer and suggestion grid.
- The supplied macOS screenshot shows the old `Phase 01` conversation header
  and terminal cards above the `What should we build?` home composition.

### Acceptance criteria

- Selecting conversation A and then conversation B replaces the rendered
  message rows with B's canonical projection.
- Selecting New Chat removes every previous virtualized message row before the
  empty-home composition is displayed.
- Task, Mission, Chat, Work, tail replacement, and empty-workspace projection
  replacements share one render-generation owner.
- Existing Virtua scrolling, pinned history anchors, Sub-agent progress grids,
  strict missing-card diagnostics, Composer draft behavior, and lazy New Chat
  persistence remain unchanged.
- Real packaged-page interaction and manually inspected desktop screenshots
  cover conversation-to-conversation and conversation-to-New Chat transitions.
  No User Interface (UI) automated test is added, modified, or run.

### Hard constraints

- Preserve every unrelated staged, unstaged, and deleted shared-worktree path.
- Do not restart, refresh, close, or otherwise mutate the user's running native
  OpenCorvus window or its managed sidecar.
- Do not add a duplicate transcript store, fallback renderer, timer, route
  gate, or imperative Document Object Model (DOM) cleanup.
- Keep Virtua as the mature virtual-list implementation; align its component
  lifetime with the existing canonical card-tree replacement generation.
- New commits use the `dsw-33987` prefix and push to `myhexin`.

### Sources read

- `AGENTS.md`.
- `specs/current/architecture/07-panel-reactivity.md`.
- `specs/records/2026-07/2026-07-15-empty-home-layout-state-ownership.md`.
- `specs/records/2026-07/2026-07-29-global-new-chat-lazy-project-persistence.md`.
- `specs/records/2026-07/2026-07-30-conversation-projection-atomic-source-switch.md`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/components/{App,Conversation}.tsx`.
- `packages/overlay/src/services/{conversation,conversation-session,task,workspace}.ts`.
- `packages/overlay/src/store/{board,card-tree,conversation-agents}.ts`.
- `packages/overlay/src/services/tree-writer.ts`.
- The running sidecar's read-only request log and packaged `/ui/` assets.

### Whole-repository search evidence

| Owner / call site | Evidence | Decision |
| --- | --- | --- |
| `main.selectConversationWithUILifecycle` | Chat and Work rows select through `selectConversationSession`. | Preserve; it uses the canonical selection service. |
| `main.openMissionSession` | Mission selection atomically resets Board, Agent, and card-tree projection. | Preserve the store transaction; bind its render lifetime to the same tree replacement. |
| `task.selectTask` | Task selection calls the shared projection reset inside its selection batch. | Preserve. |
| `conversation-session.selectConversationSession` | The requested Session is selected, its 200 response is hydrated, and failure clears the owned projection. | Preserve; live requests prove this backend path succeeds. |
| `workspace.clearConversationRuntime` | New Chat and empty-workspace entry cancel replay and reset the shared projection. | Preserve lazy persistence and directory-free behavior. |
| `conversation.resetConversationProjection` | Atomically resets Agent and card-tree stores. | Keep as the state owner. |
| `tree-writer.resetWriter` / `cardTreeStore.treeEpoch` | Every complete tree replacement clears writer/card state and increments one monotonic generation. | Use this existing generation as the virtual-list render owner. |
| `VirtualizedConversationCards` | The component remains mounted across sources; only its inner Virtua data changes, with no replacement-generation identity. | Recreate the Virtua subtree for each non-empty `treeEpoch`, and unmount it when the canonical order is empty. |
| `launcherHomeActive` / `App[data-empty-chat-home]` | Home activates only when there is no selected Task/Session and the card order is empty. | Preserve; the screenshot proves the old DOM can outlive this canonical empty state. |
| `selectedConversationHasVisibleItems` | Derives visibility from card order and selected-source Sub-agent records. | Preserve; do not add a second Home or transcript signal. |
| `mergeLatestConversationTail` | A complete tail replacement is another same-source tree replacement. | The same `treeEpoch` render owner must cover it; no source-ID-only special case. |

### Independent agent feedback

- None. The user did not request sub-agents.
- A concurrent shared-worktree task independently introduced a
  `treeEpoch`-keyed Virtua lifetime plus a complete tail-replacement
  transaction while this investigation was in progress. Those edits are
  treated as parallel work and will not be overwritten or staged by this
  task until their ownership is settled.

## Causal chain

Observable stale message panel and mixed New Chat composition →
the server successfully completes the newly selected
`/session/:sessionID/conversation` request →
the atomic store refactor clears/replaces the canonical card tree and advances
`treeEpoch` →
`launcherHomeActive` immediately observes the empty canonical order →
the long-lived Virtua component has no source or replacement-generation
identity and can retain its previous rendered rows in the native WebKit
rendering schedule →
old message DOM and the new Home composition become visible together.

The defect is therefore not missing Session data and not the lazy New Chat
database boundary. Store ownership was made atomic, but the external
virtualizer's render lifetime was not included in that ownership boundary.

## Implementation plan

1. Reuse `cardTreeStore.treeEpoch` as the only complete projection-replacement
   generation and mount exactly one Virtua subtree for its current non-empty
   value.
2. Remove the Virtua subtree when the canonical projected order is empty, so
   New Chat cannot retain previous rows.
3. Keep tail replacement a complete writer transaction so same-source
   overlapping tail hydration also advances the render generation.
4. Run focused non-UI projection tests and Overlay typecheck/build without
   running UI tests.
5. Reload only the isolated Vite/packaged browser pages, exercise real
   conversation A → B → New Chat transitions, inspect screenshots and console
   output, then perform a second diff review before the final commit and push.

## Result

- `VirtualizedConversationCards` now binds the Virtua subtree to the canonical
  `cardTreeStore.treeEpoch`. Every complete projection replacement receives a
  new component instance; an empty canonical order mounts no virtual window.
- `mergeLatestConversationTail` now performs same-source tail replacement as
  one full writer, Agent projection, Board, and history transaction, so it
  advances the same render generation instead of retaining an older tree.
- The focused positive contract test proves that overlapping tail replacement
  publishes one complete canonical card containing both returned messages.
- New Chat remains a write-free draft boundary. No Project, Session, or Chat
  persistence was added to click-time navigation.

## Verification

- Running-sidecar requests were inspected read-only. The selected Session
  conversation endpoints returned HTTP 200, excluding transport or database
  load failure as the cause of the stale panel.
- Focused non-UI contract:
  `bun test --config /tmp/opencorvus-empty-bunfig.toml
  /Users/yangheng/Desktop/opencorvus/packages/overlay/test/conversation-tail-replacement.test.ts`
  — 1 pass.
- Overlay typecheck: `bun run --cwd packages/overlay typecheck` — passed.
- Overlay production build: `bun run --cwd packages/overlay build:vite` —
  passed.
- Historical document links:
  `bun test --config /tmp/opencorvus-empty-bunfig.toml
  /Users/yangheng/Desktop/opencorvus/packages/opencorvus/test/script/historical-docs-links.test.ts`
  — 2 pass.
- Real isolated Vite page, Session A → Session B:
  the header and sole virtual row changed to Session B, with no render-error
  boundary. Manually inspected screenshot:
  `.scratch/conversation-virtualizer-session-b-fixed.png`.
- The same real page, Session B → New Chat:
  `data-empty-chat-home` became true, virtual row count and virtual-window
  count both became zero, and only the `What should we build?` Home surface
  remained. Manually inspected screenshot:
  `.scratch/conversation-virtualizer-new-chat-fixed.png`.
- No UI automated test was added, modified, or run. The user's native
  OpenCorvus process and sidecar were not restarted, refreshed, or stopped.

## Native WebKit publication follow-up Recall

### Current user request and acceptance

- The user reports that switching conversations still leaves the message panel
  completely empty and asks for the root repair.
- A successful repair must make an already populated Task become visibly
  populated after selection, keep New Chat free of stale message rows, and
  preserve streaming scroll position instead of remounting Virtua on every
  delta.
- The running native OpenCorvus process and managed sidecar remain read-only
  until the user explicitly authorizes a restart.

### Current evidence

- The running selected Task conversation endpoint returned HTTP 200 with 36
  messages and two sessions.
- The current production projection functions produced two top-level cards
  from that same response for both the initial and narrow tail limits.
- The same backend, Task, and current Overlay source rendered the complete
  conversation in isolated Chrome/Vite, while the packaged native WebKit
  window remained on the empty conversation state.
- `deferConversationTreeProjection` publishes `visibleVersion` only after the
  deferred hierarchy, top-level order, statistics, and visible projection are
  complete.
- `selectedConversationHasVisibleItems`, the virtual-list `items` memo, and
  the Agent boundary memo currently read nested `order/cards` directly without
  observing that publication completion signal.

### Whole-repository follow-up search

| Owner / call site | Evidence | Decision |
| --- | --- | --- |
| `cardTreeStore.visibleVersion` | One monotonic visible-publication signal; writers advance it after complete projection work. | Preserve as the single publication token and expose a semantic read accessor. |
| `Conversation` scroll effect | The only current production consumer of `visibleVersion`. | Route through the same semantic accessor. |
| `selectedConversationHasVisibleItems` | Reads `order.length` and selected-source Agent records only. | Observe publication before reading the final projection. |
| `VirtualizedConversationCards.items` | Reads nested `order/cards/records`; it has no complete-publication dependency. | Drive the memo from publication plus Agent records, then read the final card tree untracked. |
| `agentBoundaryCardIDs` | Derives boundaries directly from nested `order/cards`. | Drive it from the same publication token. |
| `visibleTreeGeneration` | Uses non-empty projected order to expose `treeEpoch`. | Preserve: `treeEpoch` remains the complete-tree identity, not the content publication token. |
| `hydrateConversation` / tail merge / event replay | Validate and atomically commit the canonical Board, card tree, Agent view, and events. | Preserve; live and isolated projection evidence excludes loading failure. |
| `conversation-empty-state-source.test.ts` | Reads TSX/CSS/locale source strings to assert User Interface behavior. | Delete without running under the UI automation prohibition. |
| `card-tree-visible-version.test.ts` UI source assertion | Reads `Conversation.tsx` strings to assert scroll presentation. | Delete only that UI assertion; retain its non-UI visible-version contracts. |

### Independent Agent feedback

- The Solid reactivity audit confirmed that `visibleVersion` is already the
  complete projection publication signal and recommended explicit consumers
  rather than a second state source.
- The selection/data-flow audit found no independent loading, identity,
  abort/epoch, tail replacement, or New Chat clearing root cause.
- The WebKit/Virtua audit confirmed that `treeEpoch` and `visibleVersion`
  cannot be interchanged: the former owns full-tree replacement identity,
  while the latter refreshes data without destroying the virtualizer.

### Follow-up implementation plan

1. Add one semantic accessor for the existing card-tree publication version.
2. Make empty-state, items, Agent-boundary, and scroll consumers observe that
   accessor; keep `treeEpoch` as the only Virtua remount identity.
3. Add a positive, non-UI production-shaped contract showing that a published
   conversation exposes its complete order and visible state.
4. Delete the touched legacy UI source-string tests without running them.
5. Run focused non-UI contracts, typecheck, build, document health, and a real
   isolated page interaction with manually inspected screenshots.

### Follow-up result

- `publishedCardTreeVersion()` is now the semantic read boundary for the
  existing `visibleVersion`; no second signal or transcript store was added.
- Empty-state visibility, virtual conversation items, Agent boundaries, and
  scroll-content notification all observe that same publication.
- Items remain driven by publication plus canonical Agent records. Nested card
  paths are read only after the publication dependency fires.
- `treeEpoch` remains the only Virtua replacement identity, so streaming
  visible-version increments refresh data without destroying measurement or
  scroll state.
- The touched UI source-string test file and the UI assertion embedded in the
  card-tree state contract were deleted without being run.

### Follow-up verification

- Focused non-UI contracts:
  `conversation-tail-replacement.test.ts` plus
  `card-tree-visible-version.test.ts` — 3 passed, 0 failed.
- Overlay typecheck — passed.
- Overlay Vite production build — passed.
- Historical documentation health — 2 passed, 0 failed.
- Real isolated Overlay page against the running sidecar:
  - selecting `Phase 01: 客服中心排班约束求解` rendered nine conversation
    articles, one virtual window, and no empty message;
  - switching to `Phase 02: 独立事实核查：养老数字化采购研究报告` rendered
    three conversation articles and no empty message;
  - selecting New Chat left zero conversation articles and zero virtual
    windows, with only the `What should we build?` Home composition.
- The three states were manually inspected in live screenshots. No stale
  transcript, mixed Home/message composition, or console error was visible.
- The user's running native OpenCorvus process and managed sidecar were not
  restarted, refreshed, or stopped.

## Lifecycle lineage monotonic-completion follow-up

### Recall

#### Current user request and acceptance

- The user reports that conversation switching still fails after the atomic
  projection, virtualizer-lifetime, and publication repairs.
- Switching to a populated Chat, Mission, or Task must publish its complete
  canonical message tree instead of rolling the projection back to empty.
- New Chat must continue to open as a write-free draft.
- The repair must not remount Virtua on stream deltas, add another transcript
  source, insert a retry timer, or increase the per-event projection
  complexity.
- After the root fix, rebuild both deliverables, launch the packaged desktop
  application, exercise real conversation switches, and manually inspect
  screenshots. Do not add, modify, or run User Interface automated tests.

#### Sources and live evidence read

- `AGENTS.md`.
- The atomic source-switch and virtualizer lifecycle records in this file and
  `2026-07-30-conversation-projection-atomic-source-switch.md`.
- `packages/overlay/src/services/{conversation,conversation-session,tree-writer}.ts`.
- `packages/overlay/src/components/Conversation.tsx`.
- `packages/opencorvus/src/engine/model.ts` and the Integrity review stream
  emitters.
- The running packaged sidecar log, the Vite console, and the canonical
  `/session/:sessionID/conversation` response.
- The selected customer-service Session returned HTTP 200 in 11 ms with the
  correct Board title and 17 transcript messages, while the center panel
  retained the previous conversation.
- Both Vite/Chromium and packaged Tauri/WebKit then logged the same projection
  failure: an Integrity lifecycle Session changed from an unknown
  `parentSessionID` to its canonical parent. `hydrateConversation` correctly
  rolled back the failed projection, producing the visible empty/stale panel.

#### Whole-repository grep and disposition

| Owner / call site | Current behavior | Disposition |
| --- | --- | --- |
| `handleReviewStreamStarted` → `ensureIntegritySession` | Registers the physical Integrity Session before its parent/Goal lineage is available. | Preserve; review-start events are valid and can precede canonical Session lifecycle metadata. |
| `handleSessionStatus` / `handleSessionError` → `ensureLifecycleSessionProjection` | Requires exact stage and Agent identity, but also rejects unknown → known parent/Goal lineage as drift. | Keep stage/Agent strict; reject parent/Goal only when both existing and incoming values are known and conflict. |
| `ensureSessionProjection` | Already treats parent and Goal lineage as monotonically enriched identity: known incoming values fill empty stored fields, while empty incoming values do not erase known fields. | Reuse as the single mutation owner after lifecycle validation. |
| Integrity progress/chunk reconstruction | Can also materialize an Integrity Session before a later lifecycle event supplies lineage. | Covered by the same lifecycle repair; do not add event-type special cases. |
| `ReviewStreamStarted` schema/emitter | Does not currently carry parent/Goal lineage even when some callers know it. | Do not widen the event in this repair; producer enrichment alone would not repair retained historical events or reconstruction paths. |
| Conversation hydrate rollback | Clears an owned projection after any tree-writer contract failure. | Preserve; rollback exposed the invalid lifecycle contract instead of hiding it. |
| `Conversation` publication and Virtua lifetime | Publication observes `visibleVersion`; full replacement identity observes `treeEpoch`. | Preserve unchanged; neither caused the confirmed exception. |
| Session conversation route/database | Returns the selected canonical payload successfully and quickly. | Preserve; no loading fallback or cache bypass. |

#### Independent Agent feedback

- Data-flow audit confirmed route, project identity, persisted messages, and
  hydrate ownership are healthy; its earlier publication-token hypothesis is
  already implemented and does not explain the current exception.
- Solid reactivity audit found the current publication and `treeEpoch`
  division correct and found no second blocking component-cache defect.
- WebKit/virtualizer audit reproduced the exact lifecycle exception in both
  browser engines and identified the contradictory contracts between
  `ensureLifecycleSessionProjection` and `ensureSessionProjection`.
- The three audits agree that the render hot path must remain unchanged.

### Causal chain

Selected Session request succeeds with the correct transcript →
`review.stream.started` materializes a real Integrity Session whose parent and
Goal are not present in that event →
the following canonical `session.status` supplies the parent →
the lifecycle wrapper treats unknown → known lineage as immutable-identity
drift even though the shared Session registry defines it as valid monotonic
completion →
event replay throws →
the owned hydrate transaction rolls the new Board/card projection back →
the selected row changes but the message panel stays stale or empty.

### Implementation plan

1. Keep lifecycle stage and exact Agent identity immutable.
2. Validate parent and Goal lineage only when both values are non-empty; two
   distinct known values remain a typed projection error.
3. Delegate the accepted update to the existing
   `ensureSessionProjection` owner so unknown → known fills once and an empty
   later event cannot erase canonical lineage.
4. Add a focused positive non-UI contract using the production event order:
   `review.stream.started` without lineage followed by `session.status` with
   canonical parent/Goal, then assert the Integrity card remains published and
   receives terminal lifecycle state.
5. Run the focused contract, Overlay typecheck/build, document health, and
   second diff review.
6. Exercise real Vite switching, then rebuild GUI before CLI, replace the
   packaged runtime, switch multiple real conversations and New Chat, and
   manually inspect screenshots.

### Performance boundary

- The change adds no signals, observers, timers, renderer keys, route calls,
  tree walks, or transcript copies.
- It performs only constant-time string comparisons in the existing lifecycle
  event path and retains the existing `Map`-based Session registry.
- Virtua remains mounted across streaming publication; only complete
  `treeEpoch` replacement can recreate it.

### Result

- `ensureLifecycleSessionProjection` now keeps stage and exact Agent identity
  strict while accepting parent/Goal lineage only as monotonic completion.
  Distinct non-empty identities still fail with the existing drift error.
- The existing `ensureSessionProjection` remains the single mutation owner:
  canonical non-empty lineage fills an empty field once, and a later event
  that omits lineage cannot erase it.
- No renderer, virtualizer, scroll, route, persistence, retry, or event-schema
  path changed.

### Verification

- Focused positive non-UI contract:
  `tree-writer-lifecycle-lineage-completion.test.ts` — 1 passed, 0 failed.
- Overlay typecheck — passed.
- Overlay production Vite build — passed.
- Historical documentation health — 2 passed, 0 failed.
- Normal git-cc pre-push hooks passed repository typecheck, route inventory,
  API documentation, Overlay i18n, and secret scanning.
- Real Vite page against the canonical running service:
  - E08 rendered its own complete Mission conversation;
  - switching to the customer-service scheduling Mission immediately rendered
    its scheduling tables and constraint audit;
  - New Chat left only the empty Home composition.
- Native packaging ran in the required order:
  `package:gui-installer-matrix` followed by `package:binary-matrix`.
  macOS ARM64 GUI and CLI rows were packaged; non-native rows were explicitly
  skipped.
- The GUI executable and CLI are ARM64 Mach-O files; both signatures verify.
  The DMG checksum is valid, both archives contain their expected runtime
  roots, the CLI reports `0.0.26-beta`, and the application bundle reports
  `0.0.26-beta`.
- The prior packaged GUI and managed sidecar exited before the new bundle
  launched. The replacement processes are the packaged GUI and its new
  content-addressed sidecar, listening online on port 7878.
- Real packaged Tauri/WebKit interaction reproduced the Vite sequence:
  E08 → customer-service scheduling Mission → New Chat. The selected title,
  complete conversation body, Composer, and empty Home all converged
  correctly. Both native screenshots were manually inspected.
- The new sidecar log shows the formerly failing Session conversation request
  completing with HTTP 200 in 10 ms and contains no lifecycle parent/Goal
  drift or conversation-hydrate rollback.
- No User Interface automated test was added, modified, or run.
