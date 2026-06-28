# Message Card OrderKey Convergence

Date: 2026-06-27
Status: Implemented and under regression guard

## Acronyms

- UI: User Interface, the visible overlay surface.
- SSE: Server-Sent Events, the live task/session event stream.
- DB: Database, the persisted project state.
- ID: Identifier, a stable row or event identity.

## Problem

The build-agent split-card bug was one symptom of a broader contract drift:
different layers still disagree about whether an event-level `orderKey`
orders a message, a part, a protocol event, a phase card, or a locally
observed timestamp.

This creates double sources:

- backend bridge and overlay tests disagree on `message.part.updated`
  top-level `orderKey`;
- overlay executor `run.*` conversion still synthesizes message events;
- agent rail sometimes targets the tree-writer projection and sometimes
  reconstructs card IDs or compares timestamps;
- hydrate paths can repair missing message and part IDs locally;
- build phase rendering still has special renderer promotion paths.

## Canonical Contract

For `message.part.updated`:

- `payload.orderKey` is the owning message timeline key;
- `payload.part.orderKey` is the part timeline key;
- both keys are derived from persisted backend rows;
- conflicting provided keys fail loudly at the bridge or mirror boundary;
- frontend projection never infers either key.

For rendered card targets:

- tree-writer/cardTreeStore is the only source of rendered card ownership;
- rail and other surfaces query tree-writer projection results;
- no consumer reconstructs card IDs from stage/session/message formulas;
- no consumer decides recency with wall-clock timestamps when `orderKey`
  exists.

For hydrate/live/replay:

- all visible message rows use the same backend message contract;
- missing message ID, part ID, role, channel, or orderKey is a data error;
- overlay must not create `loaded-msg:*`, `loaded-part:*`, or default roles
  to continue rendering.

For legacy executor events:

- overlay must not create synthetic conversation messages from `run.progress`
  or `run.output`;
- if executor output must appear as conversation content, the backend must
  write durable message rows and emit real `message.*` events.

## Issue Inventory

Runtime or structural issues repaired in this goal:

1. `overlay/src/services/events.ts` no longer converts executor
   `run.progress` or `run.output` into synthetic conversation `message.*`
   events.
2. standalone session events now carry UI-facing top-level `orderKey`.
3. `conversation-agents.ts` target replacement uses `orderKey` and tree-writer
   rendered targets.
4. hydrate paths require backend `transcript`/`view.messages[]` metadata and
   no longer repair missing visible message identity locally.
5. build phase display reads the tree-writer/cardTreeStore projection instead
   of triggering renderer-side session history promotion.
6. `message.part.updated` now requires a message-domain top-level order key
   and a distinct part-domain `payload.part.orderKey`.
7. `messageStore.setMessages()` now routes every non-empty write through the
   same visible-message normalizer and sorts by message-domain `orderKey`,
   not local `time.created` / `time.updated`.
8. Hydrate/replay and tree-writer test helpers no longer auto-complete visible
   message, part, view, or protocol event `orderKey` fields; fixtures must
   spell backend-like keys explicitly.
9. Task conversation lifecycle fixtures and `session.error` schema now model
   session-domain lifecycle keys and bridge enrichment metadata as one public
   contract.
10. Interaction-owner projection now fails when a message card has no
    `orderKey` instead of skipping the card and hiding projection drift.
11. Integrity review `review.stream.*` keeps `integrity:session:<sid>` as the
    dedicated card source; later message rows project into that card and do
    not create a sibling message-turn card.
12. Part-first `message.part.updated` projection no longer writes a synthetic
    `MessageInfo` into the authoritative `messages` timeline. It records a
    projection-scoped pending entry so the card and rail target are visible
    before `message.updated`, then replaces that projection with the durable
    backend message row when it arrives.
13. `classifyMessage()` and `effectiveRole()` no longer infer from
    `agent`/`role` or default to `main`/`assistant`; missing backend
    `channel`/`resolvedRole` is a contract error.
14. `step-start` / `step-finish` remain valid backend message parts but are
    control-only, not card-body content. Tree-writer validates their persisted
    part identity/orderKey and then keeps them out of projected card `parts`;
    empty `text` / `reasoning` parts still project because later deltas can
    make them visible. The control-only part classification lives in
    `packages/overlay/src/utils/message-part.ts` and is shared by tree-writer,
    render helpers, agent rail live display checks, and workflow panel message
    ordering; no caller may keep a local `step-start` / `step-finish` display
    list.
15. Hydrate applies the same projection entry contract as live/replay:
    persisted control parts are validated for identity and orderKey, then
    skipped before any `cardTreeStore` write. There is no "write first, clean
    during regroup" window.
16. `boundary` is not a backend message body part. It is the renderer's
    synthetic per-message separator for phase-absorbed cards, and its type
    checks also live in `packages/overlay/src/utils/message-part.ts` via
    `isBoundaryMessagePart()` so separator handling does not duplicate the
    string literal across production code.
17. Conversation agent rail targets are derived from the current
    tree-writer projection, not from cached `renderedCardID` /
    `targetMessageID` fields. Existing record targets may become stale after
    adjacent segment regroup, `message.removed`, hydrate reset, rewind prune,
    or session switch. Incoming targets must still be proven by tree-writer,
    but a stale existing target must not block replacement by a current
    projection.
18. A `message.updated` row without rendered body content is not a rendered
    rail target. It may update the session ledger through `session.status`,
    but rail location fields are attached only once the message has a
    currently rendered target, normally after a display part arrives.
19. Conversation projection reset is a lifecycle boundary. Once hydrate enters
    the `resetWriter()` commit phase, derived rail target fields are cleared
    before the replacement view is projected; mission session switch/close
    resets the rail view together with the card tree.
20. SSE dispatch diagnostics are bounded structured records. They include
    event/message/session identifiers and a bounded sample, not the full event
    payload. Overlay log-upload failure diagnostics stay local and never
    recurse into the same `/log` upload queue.
21. Backend `conversationMessageHasDisplay()` and overlay
    `messagePartHasDisplayContent()` agree that control parts and empty
    reasoning shells such as `[]` are non-display content.

Adversarial review resolution:

1. Browser visual QA now covers a rail record targeting an absorbed build
   message; the screenshot shows both build messages inside one rendered card.
2. `Card.tsx` no longer renders arbitrary inline `children` as a second card
   body source; parts are the render contract.
3. Historical specs that mentioned session-wide message cards or top-level
   part-domain event keys now point back to this contract as superseding
   truth.
4. Remaining `orderKey || ...` occurrences in the audited test helpers are
   board/task/workflow fixture stamping, not visible message, part, view, or
   protocol event ordering. They are outside this message-card convergence
   contract and must not be used as precedent for message timeline input.
5. A final adversarial review flagged part-first projection as a hidden
   message-row double source. The repaired shape keeps part-first visibility
   and adjacent build aggregation, but the overlay timeline's authoritative
   rows still come only from `message.updated` / hydrate visible messages.
6. The remaining grep hits for `loaded-msg`, `loaded-part`, and `run.*`
   message synthesis are negative test names or this contract text. Benchmark
   and diagnostic helpers now expose missing metadata explicitly instead of
   using role/agent fallback expressions.

## Work Partition

- Worker A owns the executor `run.*` path and related overlay tests.
- Worker B owns standalone session event envelope order keys.
- Worker C owns conversation rail target and order replacement logic.
- Worker D owns hydrate fallback removal and build phase renderer convergence.
- The main agent owns this contract file, final integration, global test runs,
  browser visual verification, and post-fix adversarial review.

Workers must not edit outside their assigned domains unless they first prove
the extra file is a direct dependency of their issue.

## Acceptance

- Live and hydrated adjacent same-session messages merge only when adjacent in
  message order.
- Interleaved sessions or roles remain separate in chronological order.
- `message.part.updated` top-level and part keys have distinct domains.
- No overlay runtime path synthesizes conversation messages from executor
  `run.*` events.
- Standalone session `session.status` and question events have backend-derived
  top-level `orderKey`.
- Rail targets actual rendered cards for absorbed messages and phase sessions.
- Hydrate fails on missing visible message contract fields.
- Build phase display reads from tree-writer/cardTreeStore projection only.
- All old tests and specs that encode part top-level key equals part key are
  deleted or rewritten.
- Browser screenshots show chronological card order, adjacent aggregation, and
  no split build-agent cards.

## Verification Plan

Targeted checks run:

```bash
bun test packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/message-store.test.ts
bun test packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts
bun test packages/overlay/test/message-store.test.ts packages/overlay/test/messages-bucket-clear.test.ts packages/overlay/test/message-load-fail-loud.test.ts packages/overlay/test/message-load-section-phase-single-source.test.ts packages/overlay/test/delta-doubling.test.ts
bun test packages/overlay/test/task-selection-dead-task.test.ts
bun test packages/overlay/test/agent-role-routing.test.ts packages/overlay/test/tree-writer-projection-primitives.test.ts packages/overlay/test/tree-writer-integrity-review.test.ts packages/overlay/test/events-refresh.test.ts packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/message-store.test.ts packages/overlay/test/tree-writer-message-tokens.test.ts packages/overlay/test/tree-writer-perf.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts
bun test --timeout 120000 packages/opencorvus/test/protocol/message-bridge.test.ts packages/opencorvus/test/protocol/session-mirror.test.ts packages/opencorvus/test/engine/protocol.test.ts
bun test --timeout 120000 packages/opencorvus/test/session/status-idempotency.test.ts packages/opencorvus/test/session/status-cross-instance.test.ts packages/opencorvus/test/session/prompt-state-terminal.test.ts packages/opencorvus/test/server/session-conversation-routes.test.ts
bun test --timeout 120000 packages/opencorvus/test/server/task-conversation-routes.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/sdk/js build
bun run api:routes-check
bun run docs:check
bun run --cwd packages/overlay build
node test/browser-runner.mjs test/browser/message-card-chronological-turns-browser.test.ts
rg -n "complete.*ForTest|loaded-msg|loaded-part|run\\.progress.*message|run\\.output.*message|fallbackCardID|messageOrderTime|finiteMessageTime|UNTIMED_MESSAGE_ORDER|requireTimelineOrderKey\\(raw\\?\\.orderKey|resolvedRole \\|\\||info\\.agent \\|\\||orderKey: .*\\|\\| test(Message|Part|Session)OrderKey|message\\.orderKey \\|\\||part\\.orderKey \\|\\||session\\.orderKey \\|\\||event\\.orderKey \\|\\|" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test specs/new-arch/2026-06-27-message-card-orderkey-convergence.md
```

The final residual scan only reports this contract text and negative test
names proving retired synthesized IDs / `run.*` message synthesis stay absent.

Visual verification:

```bash
node test/browser-runner.mjs test/browser/message-card-chronological-turns-browser.test.ts
node test/browser-runner.mjs test/browser/conversation-agent-rail-scroll-browser.test.ts
```

Visual artifacts reviewed:

- `packages/overlay/.scratch/message-card-chronological-turns-browser/timeline-top.png`
- `packages/overlay/.scratch/message-card-chronological-turns-browser/timeline-bottom.png`
- `packages/overlay/.scratch/conversation-agent-rail-scroll-browser/absorbed-card-after-locate.png`
- `packages/overlay/.scratch/conversation-agent-rail-scroll-browser/chat-pane-after-locate.png`
- `packages/overlay/.scratch/conversation-agent-rail-scroll-browser/rail-after-drag.png`

The screenshots show chronological user/assistant turns, adjacent same-agent
absorption only, no cross-user aggregation, and rail location targeting the
actual absorbed build card.

Runtime restart verification:

- `bun run --cwd packages/overlay build` completed successfully on Windows.
- The prior `opencorvus-overlay.exe` process was stopped after explicit user
  authorization.
- The rebuilt release binary was started from
  `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe`
  and confirmed running as PID `37484`.
