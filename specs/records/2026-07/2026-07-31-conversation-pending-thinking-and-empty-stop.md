# Conversation Pending Thinking And Empty Stop Repair

Date: 2026-07-31

LLM means Large Language Model. UI means User Interface. SSE means
Server-Sent Events.

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | After a user submits a prompt and the model has not produced visible output yet, show a quiet `正在思考` hint like the supplied Codex reference, with a traveling wave effect. If the user stops during that interval, do not leave an empty `CHAT` card. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-82cdaecc-65ab-4cb6-bb0a-c190e4987ca2.png`, `C:/Users/10132/AppData/Local/Temp/codex-clipboard-75008198-4ca8-45b4-97dc-32b28731ea00.png`, and `C:/Users/10132/AppData/Local/Temp/codex-clipboard-684b391b-ee67-432d-9183-81d8c12b3d2f.png` were inspected. The desired pending surface is an unboxed muted text row below the user card. The current stop defect is a bordered Agent card that contains identity and duration chrome but no body. |
| Acceptance criteria | A real executable Session in `streaming` or `retry` with no displayable Agent output projects one visible unboxed `正在思考` row after the user message. The row uses a directional text wave, the existing shared loop duration, and a static readable reduced-motion form. The first displayable text, Tool, patch, file, artifact, or interaction replaces the pending row with the ordinary shared Agent card. `idle`, completed, and aborted contentless Sessions render no row or empty Agent card. A pre-output error remains visible through the ordinary error card. Waiting and post-stop states are operated on a real current-source page, captured, and personally reviewed. |
| Hard constraints | Keep `tree-writer.ts` as the only card-tree mutation owner and `ConversationCard.tsx` as the shared main/right-Dock dispatcher. Reuse the real Session lifecycle, `messagePartHasDisplayContent`, `agent-running-surface-wave`, and `--ui-duration-loop-tool-wave`. Do not add a second status source, timer, synthetic message, fallback, gate, query override, iframe, new keyframe, UI automated test, fixture, or screenshot baseline. Do not run any UI automated test. Preserve the unrelated benchmark-catalog worktree modification. |
| Sources read | Root `AGENTS.md`; Browser control skill; all three screenshots; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-29-conversation-streaming-text-wave.md`; `2026-07-30-parent-execution-wave-scope.md`; `2026-07-30-user-message-status-settlement.md`; `tree-writer.ts`; `card-tree.ts`; `message-part.ts`; `chat-bubble.ts`; `Conversation.tsx`; `ConversationCard.tsx`; `ChatBubble.tsx`; `CardParts.tsx`; `TextPart.tsx`; `messages.css`; `chat-bubble.css`; `conversation.css`; motion tokens; localization catalogs; and the focused non-UI hydrate contract. |
| Whole-repository grep | `createSessionCardNode()` has four production construction sites: lifecycle, Integrity, ordinary message-turn, and timeline regrouping. `ensureMessageTurnProjection()` has live and hydrate callers and already migrates a deterministic lifecycle card into the first real message card. `materializeTerminalLifecycleCard()` has three lifecycle callers and is the source of the contentless terminal shell. `shouldHideSessionCard()` is consumed only by per-Session visibility synchronization and top-level order rebuilding. `ConversationCard` has two production consumers: main virtualized Conversation and exact-session right Dock. `chat.thinking` has one production protocol-placeholder classifier plus the two locale values. `agent-running-surface-wave` and `--ui-duration-loop-tool-wave` are the existing directional wave and shared duration owners. |
| Existing-test audit | `packages/overlay/test/conversation-view-hydrate.test.ts` is a non-UI card-tree contract suite. Its focused user-settlement case already replays user input, `session.status`, and the first assistant message, so it is the positive lifecycle contract owner for pending-card materialization, message-card migration, and terminal settlement. No UI assertion is added or run. |
| Independent-agent feedback | None. The user did not request sub-agents, so the primary Agent owns implementation and second review. |
| Git baseline | Local `v0.0.26beta` was fast-forwarded from `ca8ebf64fe` to git-cc `myhexin/v0.0.26beta` at `1ffe88b6aa` before this plan. The pre-existing modification to `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md` remains outside this task. |

## Causal Chain

1. A user message is correctly settled as a durable completed card.
2. When its executable Session begins streaming before any Agent message or
   displayable part exists, `tree-writer.ts` buffers the lifecycle status and
   intentionally exposes no visible row.
3. If the operator stops in that interval, the terminal lifecycle path calls
   `materializeTerminalLifecycleCard()`. That creates a real Agent card without
   a `messageID` or body.
4. `shouldHideSessionCard()` hides only empty cards that already have a
   `messageID`; the terminal lifecycle card therefore enters top-level order
   and `ConversationCard` truthfully renders the empty `CHAT` shell.
5. A stop also persists the assistant message with the canonical
   `MessageAbortedError` discriminator. Transcript restoration previously
   interpreted that record as an ordinary model error, so a refresh could
   recreate an empty error-framed Agent card even after the live terminal event
   had hidden the lifecycle card.
6. The repair belongs at this lifecycle projection boundary: materialize one
   real running lifecycle card as the pending fact, render its contentless
   running shape as the lightweight hint, migrate it into the first real
   message card, map the persisted abort discriminator back to the same aborted
   terminal fact, and remove contentless non-running lifecycle cards from
   top-level visibility.

## Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `tree-writer.ts::handleSessionStatus()` | Materialize a real lifecycle card for executable `running` projections; apply every lifecycle update through one helper that also resynchronizes visibility. |
| `tree-writer.ts::holdSessionLifecycleForExecutableCard()` | Use the same lifecycle-card path when a submitted user card is currently active; retain buffering only for lifecycle states that have no visible pending/error surface. |
| `tree-writer.ts::handleSessionError()` | Preserve pre-message error materialization and route the result through the same visibility synchronization. |
| `tree-writer.ts::materializeTerminalLifecycleCard()` | Replace the terminal-only name and responsibility with the existing deterministic lifecycle-card constructor used by running and error projections. |
| `tree-writer.ts::ensureMessageTurnProjection()` | Preserve canonical migration from the lifecycle card to the first message-turn card. |
| `tree-writer.ts::applyAssistantMessageSettlement()` | Map the canonical persisted `MessageAbortedError` discriminator to completed/aborted before ordinary error-reason projection, so live stop and transcript restoration have one terminal meaning. |
| `tree-writer.ts::shouldHideSessionCard()` | Make display content, running lifecycle, and visible error the complete visibility contract; hide contentless idle/completed/aborted cards regardless of `messageID`. |
| `utils/chat-bubble.ts` | Add one pure presentation predicate for a contentless running Agent card; reuse `messagePartHasDisplayContent` and reject cards that already own visible children, review, or an error. |
| `ConversationCard.tsx` | Keep the shared dispatcher and render the pending predicate as one localized unboxed text row; all other Agent/message nodes continue through `ChatBubble`. |
| `conversation.css` | Style the pending row and reuse `agent-running-surface-wave` plus the shared loop token for a traveling text highlight; reduced motion remains static. |
| `i18n/{zh-CN,en-US}.json` | Reuse the existing `chat.thinking` key and align its text with the requested label. |
| `conversation-view-hydrate.test.ts` | Extend the existing non-UI positive lifecycle scenario to assert the real running lifecycle card, canonical migration into a displayable Agent turn, and the settled top-level projection after a pre-output abort. |
| UI tests / fixtures | Do not add, modify, delete, or run them. |

## Implementation And Verification Plan

1. Commit and push this plan before implementation.
2. Implement the lifecycle projection, shared pending predicate/renderer,
   localization, and CSS using the existing owners above.
3. Update the current Overlay card architecture with the pending lifecycle and
   empty-terminal visibility contract.
4. Run the focused non-UI projection contract, Overlay typecheck and Vite
   build, historical-document links, relevant document health, and
   `git diff --check`.
5. Start an isolated current-source backend and Overlay, submit a real prompt
   that leaves a measurable pre-output interval, capture and inspect the
   `正在思考` wave, stop before output in a second run, and capture and inspect
   the post-stop conversation. Use Node-backed Browser control only.
6. Re-grep the lifecycle, visibility, renderer, localization, and animation
   owners; review the exact diff; update this record with evidence; commit,
   reconcile with git-cc, and push `v0.0.26beta`.

## Follow-up Recall: User Message Chrome And Color-Only Wave

| Item | Evidence and requirement |
| --- | --- |
| User request | While the left Work Ledger row is still spinning, the user-message card already presents `已完成`. The pending wave also appears to move the letters instead of moving only a color ripple. Correct both behaviors. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-dc4cbfb8-4c1c-4e7d-8a22-602c35ea088a.png` was inspected at original resolution. The standalone Chat row truthfully shows an active Session spinner; the user card simultaneously exposes a green completed status dot and its `已完成` tooltip; the pending text is visible below. |
| Acceptance criteria | A user-owned message card remains a durable settled message internally but exposes no Agent/session execution status dot or duration. The Work Ledger spinner and pending row remain the visible owners of the active Session fact. The pending label's glyph geometry stays fixed while only its clipped text color gradient travels horizontally; reduced motion stays static and readable. |
| Hard constraints | Preserve `tree-writer.ts` as the only card-tree mutation owner and keep the existing settled user-message projection. Do not copy Session lifecycle onto a user card, add a second status source, timer, synthetic message, fallback, gate, query override, iframe, UI automated test, fixture, or screenshot baseline. Do not run UI automated tests. Preserve the unrelated benchmark-catalog worktree modification. |
| Sources read | The supplied screenshot; Browser control skill; this record; `2026-07-30-user-message-status-settlement.md`; `2026-07-29-conversation-streaming-text-wave.md`; `2026-07-30-parent-execution-wave-scope.md`; `specs/current/architecture/12-overlay-card-system.md`; `WorkLedger.tsx`; `services/work-ledger.ts`; `tree-writer.ts`; `ConversationCard.tsx`; `ChatBubble.tsx`; `CardHeaderChrome.tsx`; `chat-bubble.ts`; `chat-bubble.css`; `conversation.css`; `messages.css`; and motion tokens. |
| Whole-repository grep | `WorkLedgerRowView.sessionLoading()` is the sole standalone Chat/Mission spinner owner and consumes the real ledger `active` status. `initialSessionCardStatus()` is the sole user-message settlement owner and is intentionally retained. `ChatBubbleIdentity()` is the sole shared bubble identity renderer and the only place that unconditionally adds both `StatusIndicator` and `CardDurationChip`; its nested callers are Agent-only. `.conversation-thinking__text::after` is the only pending-label wave consumer and currently translates a duplicate glyph layer. `agent-running-surface-wave` is also consumed by compact Agent surface motion and therefore cannot become the text-color animation owner. |
| Existing-test audit | The requested product changes are purely visible presentation. Under the UI automated-test prohibition, no UI test is added, modified, updated, deleted, or run. Typecheck, production build, localization validation, document health, exact owner grep, computed-style inspection, real interaction, screenshots, and personal visual review remain the verification surfaces. |
| Independent-agent feedback | None. The user did not request sub-agents, so the primary Agent owns implementation and second review. |
| Git baseline | `v0.0.26beta` and `myhexin/v0.0.26beta` both point to `d05d4f48f1` after fetch. The pre-existing modification to `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md` remains outside this task. |

### Follow-up Causal Chain

1. The left spinner truthfully represents the standalone Chat Session's
   `active` lifecycle.
2. The user card's `completed` value truthfully represents that the submitted
   message is already durable, but `ChatBubbleIdentity()` renders the same
   execution-oriented status dot and duration chrome for both user messages
   and Agent turns.
3. Exposing that persistence fact as `已完成` beside the user identity makes it
   look like the still-active conversation has completed. Rebinding the user
   card to Session lifecycle would recreate the earlier dual-ownership defect.
4. The correct boundary is presentation: keep the durable message settled,
   remove execution chrome from user-owned bubbles, and leave Session activity
   to the Work Ledger and Agent pending/response surfaces.
5. The pending wave duplicates the label in `::after`, clips a highlight into
   that duplicate, and translates the duplicate glyph layer. Even with the
   base label underneath, moving glyph edges remain perceptible.
6. A color-only wave must paint one fixed text run with a wide background
   gradient and animate only `background-position`; it needs its own text-color
   keyframe because the existing transform keyframe remains the correct owner
   for compact Agent surface waves.

### Follow-up Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `tree-writer.ts::initialSessionCardStatus()` | Preserve settled `completed` ownership for user messages; do not copy Session lifecycle into the user card. |
| `WorkLedger.tsx::sessionLoading()` and `services/work-ledger.ts` | Preserve the real active standalone Chat spinner and ledger lifecycle projection. |
| `ChatBubble.tsx::ChatBubbleIdentity()` | Render execution status and duration only for non-user identities. Nested compact calls remain Agent-only and unchanged. |
| `ConversationCard.tsx` | Remove the duplicate wave-text data payload; the visible localized label is the single text run. |
| `conversation.css` | Replace the translated duplicate-glyph pseudo-element with a fixed text-clipped gradient and one background-position keyframe. Retain the shared duration token, parent running selector, and reduced-motion readability. |
| `agent-running-surface-wave` and compact Agent surfaces | Preserve their transform-based surface motion; do not overload that keyframe with text-color semantics. |
| UI tests / fixtures | Do not add, modify, update, delete, or run them. |

### Follow-up Implementation And Verification Plan

1. Commit and push this follow-up Recall before product edits.
2. Implement the user-only chrome boundary and fixed-glyph color gradient in
   their existing shared owners.
3. Update the current Overlay card architecture with the user-message chrome
   and pending text-motion contracts.
4. Run Overlay typecheck, localization validation, production build, required
   document-health checks, exact owner grep, and `git diff --check`; do not run
   UI automated tests.
5. Start an isolated current-source backend and Overlay, submit a real prompt,
   capture at least two pending-wave frames, inspect element geometry and
   computed animation properties, and personally review that the user card has
   no execution status/duration while the active Work Ledger spinner remains.
6. Perform a second diff/owner/screenshot review, update this record with
   evidence, commit only task-owned paths, reconcile with git-cc, and push
   `v0.0.26beta`.

## User Correction: Preserve Completed, Repair Retry Thinking

The user explicitly confirmed that the completed presentation on the submitted
user card is correct. This correction supersedes only the earlier follow-up
acceptance criterion and call-site decision that proposed hiding status and
duration from user-owned bubbles. `ChatBubbleIdentity()` and the durable
completed user-message projection must remain unchanged.

The remaining requested outcomes are:

1. The pending label keeps fixed glyph geometry while only its clipped color
   gradient travels horizontally.
2. A still-running executable Session that has produced no displayable output
   continues to render the localized pending label during provider retry
   instead of exposing an empty `CHAT` card.

The second supplied screenshot was correlated with the real Session
`ses_048a2c089ffe94lU41YUR3cHmW` and
`2026-07-31T084913-35044-1.log`. At `08:51:30.986`, exactly two minutes and one
second after prompt start, the streaming provider returned HTTP 429 and entered
credential cooldown/retry. This is the screenshot boundary: the executable
Session was still active, no displayable Agent output existed, but the shared
conversation surface showed the ordinary empty card. The canonical renderer
contract is therefore: a running Agent card without displayable content renders
the pending row throughout streaming and retry; terminal error cards and cards
with real output continue through ordinary `ChatBubble`.

### Corrected Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `ChatBubble.tsx::ChatBubbleIdentity()` | Preserve the existing completed status and duration presentation for user cards. |
| `utils/chat-bubble.ts::renderAsPendingAgent()` | Treat canonical running status plus absence of displayable content as the pending truth; retry metadata must not turn that card into an empty ordinary bubble. |
| `ConversationCard.tsx` | Keep one visible localized text run and remove the duplicate wave-text payload. |
| `conversation.css` | Animate only a text-clipped gradient's `background-position`; retain fixed glyph geometry, the shared loop-duration token, and a static reduced-motion form. |
| Existing UI test encountered in the touched architecture surface | Delete the obsolete UI automation and its test-only fixture without running it, as required by the repository UI-test prohibition; remove obsolete verification references from current architecture. |

## Progress

- [x] Evidence, architecture, lifecycle projection, render chain, animation owners, localization, tests, and remote baseline inspected.
- [x] Whole-repository call-site search completed and plan recorded.
- [x] Plan committed as `eed8aace96` and pushed to `myhexin/v0.0.26beta`.
- [x] Lifecycle, persisted-abort, shared renderer, localization, and motion implementation completed.
- [x] Focused non-UI projection contract, Overlay typecheck, Vite build, localization check, targeted document health, and diff whitespace verification completed.
- [x] Real waiting, immediate post-stop, and post-reload visual acceptance completed.
- [x] Second review, final commit, remote reconciliation, and git-cc push completed.

## Verification Evidence

- `bun test packages/overlay/test/conversation-view-hydrate.test.ts`: 7
  positive card-tree contracts passed, covering running lifecycle
  materialization, first-message migration, live abort settlement, and
  persisted `MessageAbortedError` settlement.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed. Existing third-party
  module-directive and large-chunk warnings remained warnings.
- `bun run --cwd packages/overlay check:i18n`: passed.
- Targeted current-architecture and monthly-record document-health checks
  passed.
- The full historical-document link suite retained one unrelated failure:
  its canonical benchmark-catalog contract still expects legacy `E01`–`E10`
  and `N01`–`N10` identifiers, while the user's pre-existing uncommitted
  catalog edit publishes a different case-ID scheme. This task neither changes
  that catalog nor rewrites its unrelated contract test.
- The isolated current build ran at `http://127.0.0.1:7882/ui/` with the real
  configured `hexin/gpt-5.6-terra` streaming model. The pending row rendered
  `正在思考` with no border or background; its computed pseudo-element animation
  was `agent-running-surface-wave`, `6.8s`, infinite.
- Visual evidence:
  `.scratch/conversation-pending-thinking-20260731/evidence/final-pending-thinking-wave.png`,
  `.scratch/conversation-pending-thinking-20260731/evidence/final-stopped-no-empty-card.png`,
  and
  `.scratch/conversation-pending-thinking-20260731/evidence/final-stopped-after-reload-no-empty-card.png`.
  The first image shows the unboxed pending row. The latter two show exactly the
  two submitted user cards after stop, both immediately and after a full page
  reload, with no thinking row or empty `CHAT` card.
- The isolated Browser tab and backend were closed after acceptance. The
  unrelated worktree modification in
  `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md`
  was not modified by this task.

## Corrected Follow-up Verification Evidence

- The user correction was committed as `b230672bef` and pushed to
  `myhexin/v0.0.26beta` before product edits. The completed user-card status
  remained unchanged.
- `renderAsPendingAgent()` now follows the canonical running status when the
  Agent has no displayable output. A retry-era `errorReason` cannot divert a
  still-running card into the ordinary empty bubble; terminal error cards
  remain ordinary because their canonical status is `error`.
- The pending label is one text node. Its letter geometry has no transform or
  duplicated pseudo-element; the shared `6.8s` duration drives only
  `background-position` on a text-clipped color gradient. Reduced-motion
  presentation retains the static muted text color.
- `bun run --cwd packages/overlay typecheck`, Overlay localization validation,
  `bun run --cwd packages/overlay build:vite`, and `git diff --check` passed.
  Vite retained its existing third-party module-directive and large-chunk
  warnings.
- The document-health suite passed all 62 contracts after the concurrent
  environment-popover record was committed. The historical-link suite passed
  its index contract and retained the unrelated benchmark-catalog case-ID
  failure caused by the user's pre-existing catalog edit.
- The current source build ran at `http://127.0.0.1:7882/ui/` against the real
  `hexin/gpt-5.5` streaming provider. A real prompt submitted at `17:25:26`
  still had canonical Session status `streaming` at `17:30:03`; throughout
  that more-than-four-minute no-output interval, both the main conversation
  and active Work Ledger row remained visible and the conversation continued
  to show `正在思考` instead of an empty `CHAT` card.
- Two wave frames and the long-wait surface were personally inspected:
  `.scratch/retry-thinking-20260731/thinking-color-wave-frame-a.png`,
  `.scratch/retry-thinking-20260731/thinking-color-wave-frame-b.png`, and
  `.scratch/retry-thinking-20260731/thinking-after-four-minutes.png`. The label
  occupies the same position in both wave frames while its color highlight
  progresses. The long-wait image verifies that the hint remains after the
  original two-minute failure boundary. The validation prompt was stopped
  afterward and left no empty Agent shell.
- While updating the current Overlay architecture, the existing
  `card-todo-summary-progressbar-browser.test.ts` UI automation was encountered.
  It and its test-only fixture were deleted without being run, and three
  obsolete UI-test commands were removed from the architecture verification
  list, as required by the repository UI-test prohibition.
