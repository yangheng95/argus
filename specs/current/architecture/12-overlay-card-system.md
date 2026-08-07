# 12 — Overlay Card System

> Current sources: `packages/overlay/src/store/card-tree.ts`,
> `packages/overlay/src/services/tree-writer.ts`,
> `packages/overlay/src/components/Conversation.tsx`,
> `packages/overlay/src/components/Card.tsx`,
> `packages/overlay/src/components/ChatBubble.tsx`, and
> `packages/overlay/src/components/CardHeader.tsx`,
> `packages/overlay/src/components/SubagentProgressGrid.tsx`, and
> `packages/overlay/src/components/TodoProgress.tsx`.

Overlay cards are plain store-backed projections rendered by shared Solid
components. They are not frontend class instances and do not encode a hidden
execution model.

## Responsibilities

| Owner                           | Responsibility                                                                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `card-tree.ts`                  | `CardNode` shape, exact identity, parent/child edges, top-level order, status, parts, and cached evidence.                                                                                    |
| `tree-writer.ts`                | Single mutation surface for hydration, live messages, lifecycle events, interactions, reviews, and cleanup.                                                                                   |
| `Conversation.tsx`              | Virtualized top-level rendering and exact-card scrolling.                                                                                                                                     |
| `subagent-presentation.ts`      | Project child-session records into one ordered progress-grid item and reject child-owned ordinary rows whose canonical session record is missing.                                             |
| `SubagentProgressGrid.tsx`      | Render Handoff context and canonical conversation-agent activity inside one fixed-thumbnail, natively scrollable viewport above a fixed TODO progress footer.                                 |
| `TodoProgress.tsx`              | Shared Kobalte progress primitive for card, detail, and child-Agent TODO summaries; the compact child-Agent variant exposes its complete current TODO through the shared hover/focus Tooltip. |
| `SubagentConversationPanel.tsx` | Aggregate canonical child sessions under one programmatic `Squad agents` Dock tab, then render the selected session's complete backend transcript.                                            |
| `Card.tsx` / `ChatBubble.tsx`   | Render typed card/message bodies and explicit children.                                                                                                                                       |
| `CardHeader.tsx`                | Structured-card identity, status, timing, usage, and header actions.                                                                                                                          |
| `ConversationTurnControl.tsx`   | Ordinary Conversation turn actions, complete per-model usage, and trailing timestamp disclosure.                                                                                              |
| `conversation-ui.ts`            | Task-scoped card and transcript disclosure presentation that survives reactive tree replacement.                                                                                              |

## Identity And Rendering

Session/message cards derive identity from backend `sessionID`, `messageID`,
exact projected `agentID`, and runtime stage. Review and interaction cards use
their explicit protocol IDs. Array position, labels, base roles, DOM state, and
display text are never identity sources.

Conversation message projections carry two explicit identities. `sessionAgentID`
is the canonical execution-session owner used by the card tree and Agent Rail to
index and merge session records. `agentID` is the truthful participant for one
message and owns that message card. Registered helpers such as `compaction` may
therefore author messages inside a worker-owned session without replacing its
owner; two different `sessionAgentID` values for one session remain an identity
error across hydrate, history and live event paths.

User-owned message cards are settled conversation facts as soon as their real
persisted message is projected. They use `completed` presentation and do not
receive Session execution lifecycle, because `streaming`, `retry`, `idle`, and
terminal facts describe the executable Agent turn rather than the submitted
human input. A direct human reply inside a non-main executable Session remains a
settled user card while the writer projects that Session's real executable
lifecycle separately. Root user-only Sessions do not manufacture an Agent
lifecycle card.

Before the first displayable Agent part exists, an executable Session's real
`streaming` or `retry` lifecycle is projected as one deterministic contentless
running Agent card. The shared Conversation dispatcher presents that exact card
as the unboxed localized thinking row; it is not a synthetic message or a
second UI status. Canonical running status plus the absence of displayable
parts, review content, and child cards remains the pending truth throughout
provider retry; stale attempt error metadata cannot expose an empty ordinary
card while the Session is still running. The label is one fixed text run whose
clipped color gradient moves by `background-position`; no duplicate glyph layer
or transform moves the letter geometry. Reduced-motion presentation remains
static and readable. `ensureMessageTurnProjection()` migrates the same card
into the first real message-turn identity, and the first displayable part
switches the shared renderer to the ordinary Agent card. Contentless `idle`,
completed, or aborted lifecycle cards do not enter top-level order. Persisted
assistant messages whose canonical error discriminator is
`MessageAbortedError` settle to that same completed/aborted projection during
transcript restoration rather than becoming ordinary error cards. A
contentless error with its real reason remains visible through the ordinary
diagnostic card.

The rounded Agent card owns its complete visual boundary. Agent-owner changes
do not paint a second divider on the virtual transcript row, and the unboxed
pending-thinking projection likewise has no inherited top rule. Ordinary Agent
and User turns retain that one rounded boundary, inset, and role-derived
background; the shared transcript canvas is not a reason to cancel the turn's
own boundary properties through a later cascade override.

The native `assistant` session kind is a structural direct-reply container, not
an Agent identity. When that structural row has no explicit projected owner,
conversation projection completes it from the unique persisted native-primary
message `agentID`; two different non-helper participants remain an identity
error. Current Chat metadata and worker descriptors remain stronger explicit
owner evidence.

Tool-call render objects may exist inside a parent card body. They enter the
store only when a backend event gives them a durable identity. Components may
read the store and issue commands; they cannot mutate structural ownership.
Visible Agent identity names use uppercase presentation in message and
structured Agent headers without rewriting their canonical identity values.
Tool, plan, TODO, and message-body text retain their authored casing.

Ordinary Conversation turns and structured cards have disjoint control owners.
`ConversationTurnControl` is the only ordinary-turn action surface and renders
as a sibling immediately below the visual `.chat-bubble`, outside that card's
border, background, clipping, and padding. It mounts only for a user-authored
turn with non-empty prose or for a non-active assistant turn with non-empty
answer prose; `pending` and `running` turns and empty success, failure, or
cancellation terminals do not render a rail. It owns the visible copy action,
total usage trigger, direct guidance control, and trailing timestamp. The mounted
rail remains visually hidden and non-interactive at rest, then discloses as one
unit when its owning card shell is hovered or contains keyboard focus. Keeping
the mounted rail in layout prevents card-content movement during disclosure;
focus and expanded controls preserve access after pointer departure.
`CardHeaderChrome` remains the structured-card metadata and header action owner.
Only structured-card headers use `CardOverflowMenu`; ordinary Conversation turns
do not expose a three-dot menu, AgentTrace inspection, disabled Rewind, or hidden
command panel. A steerable completed Agent turn instead exposes the existing
guidance toggle as a direct labelled message icon beside Copy. Activating it
expands the turn and opens the canonical inline operator-guidance form without
duplicating submission ownership. A failed structured card
may add one persistent red alert trigger sourced from its canonical
`errorReason`; it replaces the generic error dot, exposes the complete diagnostic
through the shared viewport-constrained Kobalte Tooltip, and copies that exact
value on double-click. The reason is not repeated in the message body or overflow
menu.
Trace inspection, session model settings, operator guidance, message copy,
cancel, and rewind remain backed by their existing callbacks and state, but
render only as labelled items in the shared Kobalte dropdown. Commands cannot
also appear as sibling header buttons; unavailable commands remain visibly
disabled in the same menu.

`ConversationTurnControl` presents one compact toolbar with two stable groups.
Available direct actions use the same icon-button geometry, while usage and
timestamp facts use one quieter metadata treatment separated from commands by
the toolbar's single divider. The compact month/day/time label is part of every
eligible toolbar and follows that toolbar's hover/focus disclosure; unavailable
commands and absent usage remain omitted without placeholders. The usage trigger
uses a measurement glyph, never an Agent-identity glyph, and opens the exact
per-model facts through the shared Popover. The same toolbar contract applies to
exact sub-agent transcripts; message-local `CardNode.status` does not alter its
disclosure language.

Tool timing is projected once from persisted tool-part `state.time.start/end`
into `CardNode.time/timeCompleted`. `CardHeaderChrome` owns the inline start and
duration projections; both stay absent at rest and appear together on Tool
header hover or keyboard focus. Tool title and detail use the same monospace
font size and line height so the row stays vertically aligned. The canonical
Tool title takes its content width but can shrink; detail consumes only the
remaining width. Both remain single-line and ellipsized so the complete
non-shrinking timing projection owns its trailing space even when the Tool name
is long. No Tool timing surface may create a mount-time timestamp, native timing
tooltip, or a second timer.

Flattened narrative message runs retain their exact boundary timestamp. The
timestamp is an absolute, non-reserving child of its final narrative text part
and appears only on run hover or focus. Later Tool rows cannot relocate or
inherit it, and Tool-only messages render no message timestamp; Tool timing
remains solely in the Tool header.

Card and adjacent execution-run expansion are operator presentation, not message
state. `conversation-ui.ts` is their single reactive owner. Execution runs use
the canonical first visible Tool or Patch part `orderKey`, so later adjacent
streamed parts and same-task tree replacement retain the current disclosure.
The disclosure summary remains one bounded, ellipsized activity row in both
collapsed and expanded presentation. Complete Tool parameters and results are
owned only by the expanded Tool body through its specialized or preformatted
payload renderer; they are not repeated as wrapping summary or Tool-header
text. This keeps long machine payloads inside their scroll owner and prevents
them from painting over adjacent chronological content.
Reasoning remains in persisted/runtime message data but has no message-card
renderer, disclosure, count, or style. A real selected-task change clears
transcript disclosures; no expanded flag is written into message, card-tree, or
backend data.

Goal facts belong to `TaskBoard.goals[].activity`, `reviewAssociations`, and
`acceptance`. Conversation Sessions
remain Task-level physical execution facts and the card system does not
manufacture Goal-owned containers or an execution hierarchy from board data.
When a visible message explicitly cites a Delivery Slice revision as an
evidence subject, the compact badge is metadata only; it never assigns Session,
workflow, worktree, or lifecycle ownership to that Slice.

Child-agent cards may be present in the bounded live/task transcript, but they
are not the progress-card data source. The conversation-agent projection owns
one stable `subagent-session:<sessionID>` record containing identity, lifecycle,
input preview, and at most twenty-four compact facts projected from real
persisted or live Text, Tool, Patch, File, and error parts. Consecutive child
sessions share a grid row without losing their individual session identities.
The Task hydrate reserves a bounded root/Orchestrator message lane in addition
to the bounded task-tree tail, so child chatter cannot evict the main
conversation. `CardNode.parentSessionID` lets presentation reject a child-owned
ordinary row when its canonical session record is absent instead of briefly
showing scattered messages. Selecting a progress card loads the complete
transcript from the existing task/session conversation route and renders it
with the shared card-part components in the Right Dock. The bounded activity
facts are not messages and do not form a second transcript store.

Canonical child status and canonical parent execution status jointly own motion.
The selected Task or standalone conversation projects its raw lifecycle once on
the common application panel. Only parent `active` plus child `running` lets
nested Tool name/detail text use its traveling mask or lets the compact progress
card use its directional, paint-only surface wave. Failed, cancelled, completed,
queued, idle, missing, and cross-selected parents keep every nested Tool and
Agent wave static even when the last observed child record remains `running`;
the persisted child fact is not rewritten. Main and exact-session conversation
cards remain static, compact Agent Tool rows remain static, reduced-motion
rendering remains static, and no wave changes card geometry. The Tool text and
compact Agent surface consumers share one `6.8s` cycle: the existing 65%
travel phase and 35% quiet phase give both wave types the same doubled motion
duration and doubled interval without a second timing source. Exact-session
selection is authored only by explicit compact-card, Tab, or overflow-menu
actions and explicit task/session reset; reactive record availability never
substitutes the first record for the selected Session.

Main and exact-session transcripts share `--chat-canvas` as their reading
surface. Ordinary Agent conversation cards use a restrained static directional
gradient of canonical stage color over the neutral `--surface` material
through the single `--conversation-card-background` owner. This reuses the
compact Agent card's complete resting background recipe—its five-percent stage
wash and base surface—without its running-wave pseudo-element. Canonical stage
color remains stronger in avatars, status, Agent rail, compact progress cards,
and other structured identity elements. Expanded nested Tool surfaces continue
to derive their restrained material from the inherited conversation-card
background.

The same child-session record also carries the current TODO snapshot. The
backend `TodoStore` is the persistent authority: task and standalone
conversation hydration batch-load its rows for the already projected
`sessionID` values, while the live `todo.updated` event replaces only the
matching record's snapshot. `TodoSnapshotTable` persists one monotonic revision
per session independently of its item rows, so an empty list can authoritatively
replace stale live state after a reconnect. The same revision travels in the
live event and hydrate projection. `todo.updated` remains a tree-writer no-op because
TODO progress is session metadata, not a conversation card or message. Hydrate
payloads without the optional TODO projection represent an empty list so older
or currently running servers do not make the whole conversation unreadable;
malformed explicit TODO data remains a contract error. Canonical status and
priority enums are enforced by the backend schema and the Overlay projection.

The child-Agent card keeps activity as its only scrolling region. Its
progress-only footer exists only for a non-empty canonical TODO snapshot, does
not shrink or scroll, and derives counts, current work, cancellation, and
terminal unresolved work from the shared `utils/todos.ts` summary. A record
with no TODO list renders no footer or synthetic `0/0` track. Terminal status
never forces incomplete TODOs to appear complete.

The complete card surface is the pointer action for opening its exact session.
A visually hidden real Button primitive provides the same action to keyboard
and assistive-technology users. The Button and Kobalte progress root are
siblings, so the progressbar remains independently exposed in the browser
accessibility tree. The card renders no visible duplicate conversation action
or chevron.

## Constraints

- No unknown-card fallback renderer.
- No component-local placement or sorting policy. Activity disclosure groups
  adjacent execution parts without changing their canonical relative order.
- No second `CardNode` truth source.
- No identity derived from `base_role`, channel, author, or label.
- No package-defined card family, scheduler progress tree, or hidden message.
- No local TODO cache, tool-text parsing, polling, or visible card for
  `todo.updated`.
- No ordinary Conversation command surface outside
  `ConversationTurnControl`; no card mounts both control owners.

## Verification

- `bun test packages/overlay/test/card-tree-visible-version.test.ts`
- `bun test packages/overlay/test/card-tree-reachability.test.ts`
- `bun test packages/overlay/test/tree-writer-hierarchy.test.ts`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts`
- `bun test packages/overlay/test/conversation-agent-rail-records.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
