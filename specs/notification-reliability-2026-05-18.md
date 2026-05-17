# Notification Reliability & Coverage — Single-Source Tiered Design

- Date: 2026-05-18
- Status: DRAFT — pending codex review → consensus → codex implementation
- Owner decisions (locked by user 2026-05-18):
  - Coverage = **full tiered model** (3 tiers, every notify-worthy event classified)
  - Dock = **persistent numeric badge + attention flash**
  - Reliability = **persistence + resume-on-reconnect (snapshot reconciliation)**
  - Architecture = **A: engine classifies tier (single source), overlay delivers**

---

## 0. Problem statement (evidence-backed, rule 1/3)

Notification behavior is accidental, not designed. Three structural defects:

### D1 — No single source mapping event → urgency → channel
OS toasts exist for exactly **4** event types, decided ad-hoc at 2 call sites:

| Entry point | Stream | Events covered | File:line |
|---|---|---|---|
| `notifyTaskLifecycle` | global task-list | `task.completed`, `task.failed`, `task.cancelled` | `packages/overlay/src/services/events.ts:951-953`, `notify.ts:272-285` |
| `notifyInteractionRequested` | per-task | `interaction.requested` | `events.ts:40-47`, `notify.ts:287-293` |

Every other notify-worthy event (`delivery.gate.rejected`, `goal.failed`, `evaluation.completed` rejected, `session.error`, `workspace.failed`, retry-exhausted, stall/watchdog abort) renders only as a card — **no OS signal, no dock signal**. There is no table anywhere mapping the 86 `BusEvent.define` event types (29 files; `engine/model.ts` alone defines 37) to an urgency or a channel. Coverage is whatever the 2 call sites happen to catch.

### D2 — Dock/tray channel is fully orphaned
`setTrayAttention()` (`packages/overlay/src/services/window.ts:14`) → `tray.attention.set` (`tauri-transport.ts:477`) → `overlay_attention_set` (`main.rs:1107`) → `request_user_attention(Informational)` + tray-flash thread. The Rust→TS plumbing is complete and working, but **`setTrayAttention` has zero callers in application code** (grep: only the definition, the transport case, and the Rust command — nothing decides *when* to demand attention). The dock has never reflected engine state. Additionally there is **no persistent numeric badge primitive** — `request_user_attention` is a one-shot flash, not a count.

### D3 — Not reliable
- In-memory only: `notificationStore` / dedupe `lastDispatched` (`notify.ts:51,270`) are lost on overlay restart — pending blocking prompts vanish from the shell.
- Coarse suppression: `shouldSuppressDesktop` skips when `document.hasFocus() && selectedTaskID === taskID` (`notify.ts:229-235`) — a **blocking** question on the currently-selected task while the operator scrolled away or tabbed within the app produces *no* signal at all.
- The global task-list stream carries only `{type, taskID, sequence}` (no payload), forcing the two-path split; list-derived notifications cannot know urgency without a payload.

Note (rule 3 self-correction): `permission.asked` / `question.asked` are **not** silent — `engine/interaction.ts:17,19` subscribes to both and re-emits `Event.InteractionRequested` (`interaction.ts:56,114`). The defect is the *channel/reliability* of that signal, not a missing event.

---

## 1. Design principles honored

- **Rule 8 (no dual source)**: tier is declared exactly once, at the `BusEvent.define` site, and travels *with* the event over SSE. No overlay-side type enumeration. The overlay never re-classifies.
- **Rule 13/15 (no state machine, no synthetic messages)**: the tier table is declarative data, not control flow. No new event channel; we annotate existing events. Badge state is *reconciled from the authoritative board snapshot*, not driven by an accumulator state machine.
- **Rule 5/6 (no over-engineering)**: one descriptor field, one delivery hub, one Rust badge command. No queue service, no per-notification ack protocol — reliability comes from snapshot reconciliation + existing SSE sequence resume.
- **Rule 6.1 (prompt-over-host)**: N/A — this is data-shape + client-delivery, not teaching an LLM a route. Host-side is legitimate (pure data classification + an outward-facing OS action).

---

## 2. Architecture A — single source in the engine taxonomy

### 2.1 Extend the event registry (single source)

`packages/opencorvus/src/bus/bus-event.ts` — `define()` gains an optional 3rd arg:

```ts
export type NotifyTier = 1 | 2 | 3            // 1 = blocking/severe, 2 = notable, 3 = progress
export interface NotifyDescriptor {
  tier: NotifyTier
  dock?: boolean                               // contributes to the persistent badge / attention
  kind?: "blocking" | "failure" | "result" | "progress"  // for badge bucket + tone
}
export function define<...>(type, properties, notify?: NotifyDescriptor)
```

The registry stores `notify`. **Default when omitted = no notification (NOOP)** — opt-in, so heartbeats/spec.\*/milestone.\*/message.injected stay silent without enumeration.

### 2.2 Stamp tier onto the event envelope

The engine emit path (`EngineProtocol.emit`, the per-task SSE serializer, **and** the lightweight task-list stream serializer) attaches `notify` from the registry to every emitted event:

```jsonc
{ "type": "interaction.requested", "taskID": "...", "sequence": 42,
  "properties": {...}, "notify": { "tier": 1, "dock": true, "kind": "blocking" } }
```

The task-list stream — today `{type,taskID,sequence}` — additionally carries `notify`, so list-driven notifications no longer need a payload to know urgency (closes the D1 two-path gap without merging streams).

### 2.3 Overlay = single delivery hub

Replace the 2 ad-hoc entry points + `dispatch()` with one router `routeNotification(event)` in `notify.ts`, called once from `routeSSEEvent` (per-task) and once from `handleTaskListNotification` (task-list). It reads `event.notify` and applies the channel matrix:

| Tier | In-app toast | OS notification | Dock badge + flash |
|---|---|---|---|
| **1** blocking/severe | always | unless `focused && selected && task-detail visible` | **yes** — increments badge, flash on |
| **2** notable result | always | only if window **unfocused** | badge **only** (no flash) |
| **3** progress | always (existing toast) | never | no |

Tier-1 suppression is narrowed: OS toast is skipped only when the operator is provably looking at *that* task's detail (focused **and** selected **and** the task pane — not the list — is the active view). The **badge always reflects state regardless of focus**, so nothing is ever fully silent.

### 2.4 Persistent badge — new Rust primitive

Add Tauri command `overlay_badge_set(count: u32)` next to `overlay_attention_set` (`main.rs`). Implementation must use the **Tauri v2 cross-platform badge API** (`WebviewWindow::set_badge_count` / `set_overlay_icon` on Windows taskbar, dock badge on macOS, Unity on Linux). `overlay_attention_set(active)` is retained for the **flash** (tier-1 only). New TS service `setDockBadge(count)` in `window.ts`, routed via a new `host-transport` kind `badge.set`, mirroring `tray.attention.set`. Capability `core:window:allow-set-badge-count` (or the correct Tauri v2 ACL id) added to `tauri.conf.json` / capabilities.

> codex MUST verify the exact Tauri v2 badge API + ACL permission id against `docs.rs/tauri` / `v2.tauri.app` before coding (rule: search authoritative docs before touching unfamiliar SDK; memory `feedback_search_before_fix`). The spec asserts the capability exists; codex confirms the precise symbol/permission.

### 2.5 Reliability via snapshot reconciliation (not accumulation)

`pendingStore` (new, persisted via existing `overlay-settings-storage.ts`):

```ts
{ blocking: Record<taskID, {interactionID, summary, since}>,   // open prompts awaiting answer
  unreadFailures: Record<taskID, {kind, summary, since}> }      // terminal failures not yet viewed
```

- **Source of truth = the board snapshot.** On every SSE (re)connect / hydrate, `reconcilePending()` rebuilds both maps from `boardStore` (open interactions = unresolved `interaction.requested` without matching `interaction.resolved`; unread failures = tasks in failed/rejected terminal state not since viewed). This makes restart, disconnect, and missed events self-heal — the badge can neither leak nor permanently lose an item.
- Live events mutate `pendingStore` for instant feedback; reconciliation corrects drift.
- `badgeCount = |blocking| + |unreadFailures|`. `flashActive = |blocking| > 0`. Both pushed to Rust whenever `pendingStore` changes (debounced).
- Decrement: `interaction.resolved` clears `blocking[taskID]`; selecting/opening a failed task clears `unreadFailures[taskID]`; tray-click (`main.rs` already shows window) clears flash, and on focus we re-`reconcile` (does not auto-zero the badge — only viewing the specific task clears its entry).

---

## 3. Tier assignment table (the single-source content)

Applied at each `BusEvent.define` site. Exhaustive over user-relevant events found in the inventory; anything not listed = no `notify` arg = NOOP.

| Event type | Tier | dock | kind | Rationale |
|---|---|---|---|---|
| `interaction.requested` | 1 | ✓ | blocking | agent blocked on operator answer (perm/question) |
| `task.failed` | 1 | ✓ | failure | terminal task failure |
| `delivery.gate.rejected` | 1 | ✓ | failure | delivery blocked, needs operator |
| `goal.failed` | 1 | ✓ | failure | terminal goal failure |
| `evaluation.completed` (verdict=rejected) | 1 | ✓ | failure | rejection — conditional on payload verdict |
| `session.error` | 1 | ✓ | failure | agent/session crash |
| `workspace.failed` | 1 | ✓ | failure | worktree/env hard-block |
| run terminal failure / retry-exhausted / stall-abort | 1 | ✓ | failure | giving-up signal (see §3.1) |
| `task.completed` | 2 | ✓ | result | success, operator may be away |
| `task.cancelled` | 2 | ✓ | result | terminal, lower urgency |
| `delivery.ready` | 2 | ✓ | result | candidate ready to review |
| `integrity.review.completed` | 2 | ✓ | result | verdict ready |
| `interaction.resolved` | 2 | ✓ | result | clears a blocking badge entry |
| `plan.activated`, `workflow.selected` | 2 | – | result | phase transition (badge-less, in-app + unfocused-OS) |
| `evaluation.completed` (verdict=accepted) | 2 | – | result | conditional sibling of the tier-1 case |
| `run.progress`, `run.output`, `message.*`, `goal.progress`, `goal_run.updated`, `task.updated`, `workflow.step.updated`, `integrity.review.progress\|chunk\|started`, `plan.created`, `run.created`, `task.created`, `task.message`, `delivery.evidence.updated` | 3 | – | progress | high-volume; in-app only |
| heartbeats, `*.connected`, `config.changed`, `spec.*`, `milestone.*`, `message.injected`, `agent.updated`, `task.replay_expired` | — | – | — | NOOP (no `notify` arg) |

### 3.1 Verdict/terminal-conditional events (rule 35 follow-up codex must close)
`evaluation.completed` and run-failure are **payload-conditional**: tier depends on `verdict` / terminal `status`. The descriptor supports a static tier; the conditional split is resolved in `routeNotification` by reading `properties.verdict` / `properties.status`. codex must enumerate, during implementation, the exact emit sites in `engine/model.ts` / `engine/state.ts` / `engine/goal-status.ts` and confirm which terminal `run.updated`/`task.failed` payload field marks "retry exhausted" vs "stall abort" vs ordinary failure (so the toast body is accurate, not just "failed").

---

## 4. Files touched (rule 35 enumeration)

**Engine (single source):**
- `packages/opencorvus/src/bus/bus-event.ts` — add `NotifyDescriptor`, 3rd `define` arg, registry storage, `notificationFor(type)` accessor.
- `~30` `BusEvent.define` call sites across 29 files (esp. `engine/model.ts`) — add the `notify` arg per §3 table. Each touched site listed in the implementation plan with "tier N / NOOP".
- Per-task SSE serializer + global task-list stream serializer (locate exact emit/serialize path; `server/event.ts`, `server/routes/global.ts`, `engine/model.ts` emit) — stamp `notify` into the envelope for **both** streams.

**Overlay delivery:**
- `packages/overlay/src/services/notify.ts` — replace `notifyTaskLifecycle`/`notifyInteractionRequested`/`dispatch` with `routeNotification(event)`; new `pendingStore` + `reconcilePending()`; narrowed tier-1 suppression.
- `packages/overlay/src/services/events.ts` — call `routeNotification` from `routeSSEEvent` (per-task) and `handleTaskListNotification` (task-list); delete the 2 old call sites; delete the `interaction.created` typo comment path.
- `packages/overlay/src/services/window.ts` — add `setDockBadge(count)`; keep `setTrayAttention` (now actually called by the badge effect for flash).
- `packages/overlay/src/services/host-transport.ts` + `tauri-transport.ts` — add `badge.set` kind + `overlay_badge_set` invoke.
- `packages/overlay/src/services/sse.ts` — call `reconcilePending()` on hydrate/reconnect.
- Persist `pendingStore` via `overlay-settings-storage.ts`.

**Rust:**
- `packages/overlay/src-tauri/src/main.rs` — `overlay_badge_set` command + register in `invoke_handler` (both lists, lines ~1162/1179).
- `tauri.conf.json` / generated capabilities — add badge ACL permission.

**Docs:**
- `packages/web/.../overlay/overview.mdx` (EN + zh-cn) — document `overlay_badge_set`.

---

## 5. Test plan (rule 28/36 — assert removed behavior too)

1. **bus-event**: `define` with/without `notify`; `notificationFor` returns descriptor or undefined; default = NOOP.
2. **Envelope stamping**: emitting a tier-1 event yields `notify` on *both* per-task and task-list serialized payloads; a NOOP event has no `notify`.
3. **routeNotification matrix**: table-driven over tier×focus×selected → asserts (in-app?, OS?, badge delta, flash?). Includes the *negative*: tier-3 never OS/dock; tier-2 no OS when focused.
4. **Suppression narrowing**: tier-1 with `focused && selected && detail-visible` ⇒ no OS toast **but badge still incremented** (asserts the old "fully silent" behavior is gone).
5. **Reconciliation/reliability**: seed `pendingStore`, simulate reconnect with a board snapshot that resolved one interaction + added one failure ⇒ badge self-corrects; restart (reload persisted store then reconcile) ⇒ no leak, no loss.
6. **Verdict-conditional**: `evaluation.completed` rejected ⇒ tier-1+dock; accepted ⇒ tier-2 no dock.
7. **Rust**: `overlay_badge_set(0)` clears; `>0` sets; flash decoupled from badge (tier-2 badge without flash).
8. **Regression**: existing `notify-no-boot-prompt.test.ts` / `events-single-write-to-tree.test.ts` still green (no double-fire, no boot permission prompt) — adapt to the new single entry point.

---

## 6. Open questions for codex (resolve to consensus before implementation)

- Q1: Exact Tauri v2 badge symbol + ACL id (cross-platform `set_badge_count` vs Windows `set_overlay_icon`); confirm Windows shows a usable count vs only a dot — if Windows can only show a dot, spec degrades Windows badge to "dot when |blocking|+|unreadFailures|>0" while macOS/Linux show the count. codex verifies against authoritative docs and amends §2.4.
- Q2: Precise engine serialization seam where `notify` must be stamped for the **task-list** stream (must not regress the lightweight payload size contract beyond the one added field).
- Q3: Payload fields distinguishing retry-exhausted / stall-abort / plain failure for accurate tier-1 bodies (§3.1).
- Q4: Whether `interaction.resolved` should also fire a tier-2 OS toast when unfocused, or only silently decrement (proposed: silently decrement; toast only on the *request*, not the resolve, to avoid pairs).

codex feedback gets appended here as a "## Codex review — <date>" section with revisions inline-marked (rule 35 final clause); no silent rewrites.
