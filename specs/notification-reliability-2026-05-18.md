# Notification Reliability & Coverage — Single-Source Tiered Design

- Date: 2026-05-18
- Status: DRAFT v3 — addresses codex iteration 2 (REJECTED, 7 points); pending iteration 3 consensus → codex implementation
- Owner decisions (locked by user 2026-05-18): full tiered model · persistent dock badge + attention flash · persistence/resume via projection · architecture A (engine classifies, overlay delivers)

---

## 0. Problem statement (evidence-backed)

Notification behavior is accidental, not designed. Three structural defects:

### D1 — No single source mapping event → urgency → channel
OS notifications driven by engine events flow through exactly **2** call sites:

| Entry point | Stream | Events | File:line |
|---|---|---|---|
| `notifyInteractionRequested` | per-task | `interaction.requested` | `packages/overlay/src/services/events.ts:40-47` → `notify.ts:287-293` |
| `notifyTaskLifecycle` | task-list | `task.completed`, `task.failed`, `task.cancelled` | `events.ts:945-954` → `notify.ts:272-285` |
| (delivery) | — | both above | `notify.ts:243-265` |

> Scope narrowing (codex #3): this spec replaces **only the engine-event OS-notification path** above. In-app `showNotification`/`notifyWarning`/`notifyError`/`notifyProgress` used for local UX (export/import `TaskList.tsx`, DB reset `main.tsx`, permission settings `notify.ts:166-212`, agent-rail `ConversationAgentRail.tsx`) are **unrelated and preserved untouched**.

Every other engine event (`delivery.gate.rejected`, `goal.failed`, `evaluation.completed` rejected, `session.error`, `workspace.failed`, `worktree.failed`) renders only as a card — no OS/dock signal. No table maps the 86 `BusEvent.define` types (29 files; `engine/model.ts` = 37) to urgency.

### D2 — Dock/tray channel fully orphaned
`setTrayAttention()` (`packages/overlay/src/services/window.ts:14-26`) → `host-transport.ts:129-153` → `tauri-transport.ts:477-478` → Rust `overlay_attention_set` (`packages/overlay/src-tauri/src/main.rs:1106-1124`, registered `:1150-1179`). Chain is complete and working, but **grep finds zero overlay callers** of `setTrayAttention` (codex #4 confirmed). The dock has never reflected engine state. No persistent numeric-badge primitive exists; `request_user_attention(Informational)` is a one-shot flash.

### D3 — Not reliable
- In-memory only (`notificationStore` / `lastDispatched`, `notify.ts:51,270`) — pending prompts vanish on overlay restart.
- Coarse suppression: `shouldSuppressDesktop` skips when `document.hasFocus() && selectedTaskID === taskID` (`notify.ts:229-235`) — a blocking prompt on the selected task while the operator scrolled/tabbed away is fully silent.
- Task-list stream carries only `{type,taskID,sequence}` (`server/routes/orchestrator.ts:300-307`, schema `:280-284`), forcing the two-path split with no urgency signal.
- Replay/hydration spam (codex #13): `replayTaskEventToTree()` (`packages/overlay/src/services/conversation.ts:117-184`) reaches `writeToTree()` → `events.ts:40-47`, so history reload would re-fire notifications.

Note (rule 3): `permission.asked`/`question.asked` are **not** silent — `engine/interaction.ts:17,19` re-emits both as `Event.InteractionRequested` (`interaction.ts:56,114`). The defect is the channel/reliability of that carrier, not a missing event. Raw `permission.asked`/`question.asked` are session-bus internal and never reach the task SSE stream → N/A in the matrix.

---

## 1. Design principles honored

- **Rule 8**: tier declared once at `BusEvent.define`, stamped onto the envelope at one engine seam, consumed by overlay as opaque `event.notify`. Verdict-conditional tiers (e.g. `evaluation.completed`) are resolved **at the engine emit site** (which holds the payload), never re-classified in overlay (codex #9).
- **Rule 13**: no mutable lifecycle store. Badge = one pure projection `computeBadge(snapshots, localAcks)`; SSE only triggers recompute (codex #11).
- **Rule 15**: no new event channel/synthetic message; existing events gain one annotation field.
- **Rule 5/6**: Windows = alert overlay-icon dot (no fabricated numeric icon); no persisted rich interaction details; no overlay failure taxonomy (codex #14).
- **Rule 35**: §3 enumerates every `BusEvent.define`.

---

## 2. Architecture A

### 2.1 Registry change (single source) — exact shape (codex #1)
`packages/opencorvus/src/bus/bus-event.ts` currently stores `{ type, properties }` only (`:9-15`); `payloads()` builds the discriminated union (`:18-39`). Change:

```ts
export type NotifyTier = 1 | 2 | 3
export interface NotifyDescriptor {
  tier: NotifyTier
  badge?: boolean   // contributes to the projected persistent badge count.
                    // ONLY valid for events whose state the global task
                    // summary can project (codex iter2 #4): interaction
                    // pending count, terminal task failure, rejected
                    // evaluation. No other knob — flash is derived, not
                    // declared; clears happen via recompute, not a field.
}
// Generic constraint preserved verbatim from bus-event.ts:9.
export function define<Type extends string, Properties extends ZodType>(
  type: Type, properties: Properties,
  notify?: NotifyDescriptor | ((payload: z.infer<Properties>) => NotifyDescriptor | undefined),
)
```
`notify` may be a **function of the runtime payload** so verdict/terminal-conditional tiers are decided at the engine source (codex iter1 #9/#7). Registry stores it; `payloads()` schema unchanged (notify is envelope metadata). Omitted ⇒ NOOP. The `badgeEffect`/`flash` fields from v2 are **removed** (codex iter2 #6/#4): there is exactly one projection and flash is `badgeCount > 0`.

### 2.2 Stamp seam (Q2 closed — codex #2)
Two seams, one registry source:
- Per-task: `protocolTaskEvent()` in `server/routes/orchestrator.ts:1422-1444` (used by live SSE `:447-464`, replay `:470-474`, conversation pages `:1396-1419`).
- Task-list: serializer `orchestrator.ts:300-307`.

The runtime event envelope exposes its data as **`event.payload`**, not `.properties` (`ProtocolStore.eventView` `protocol/store.ts:91`; `protocolTaskEvent` serializes `payload` at `orchestrator.ts:1435`; the task-list serializer receives the same shape at `:300`) — codex iter2 #3. Both seams call `const notify = resolveNotify(event.type, event.payload ?? {})` from the registry and attach `notify` to the JSON. Update `TaskEvent` model (`engine/model.ts:912-922`) and the `/task/events` schema (`orchestrator.ts:280-284`) to include optional `notify`. The lightweight task-list payload grows by exactly this one field.

### 2.3 Overlay delivery — single hub, live-only (codex #13)
New `routeNotification(event, { live: boolean })` in `notify.ts`. Called **only** from the live SSE dispatch and the task-list live handler — **never** from `replayTaskEventToTree`/hydration. `live` is a property of the call path, not inferred from event content (no heuristics, rule 13). It reads `event.notify` (opaque) and applies:

| `tier` | in-app toast | OS notification | badge |
|---|---|---|---|
| 1 | always | unless `focused && selected && task-detail (not list) visible` | counted **iff** `badge:true` (only summary-projectable events) |
| 2 | always | only if window **unfocused** | counted iff `badge:true` |
| 3 | existing in-app feed only | never | no |

`routeNotification` never mutates badge state directly — it only fires the toast/OS shell. The badge/flash come solely from the §2.4 projection (codex iter2 #4/#6). Toast copy is **generic per tier/event type** via i18n keys (no failure-reason parsing, codex iter1 #7/#14).

### 2.4 Persistent badge — projection, not accumulator (codex #10, #11)
Badge state is a **pure function**, recomputed on every relevant snapshot/SSE change:

```
badgeCount = Σ over tasks (global summary): task.pending_interactions    // awaiting operator
           + |{ task : task.status ∈ terminal-failure } \ acks|          // unread failed task
           + |{ task : task.evaluation == rejected }   \ acks|          // unread rejected eval
flashActive = badgeCount > 0          // derived, NOT a separate signal
```
- **Only summary-projectable facts** (codex iter2 #4). The global task summary carries exactly `task` (status), `run`, `evaluation`, `pending_interactions` (`engine/model.ts:880`). The `badge:true` set in §3 is **exactly** these three projectable facts and nothing else. Selected task's detailed `interactions` (`:848`) are used only to render *which* prompt in the UI, never to alter the count. No persisted interaction details (rule 8 — codex iter1 #10).
- **`acks`**: a persisted set keyed `` `${taskID}:${failedAt}` `` where `failedAt = task.time.completed ?? task.time.updated` (`engine/model.ts:263,295`). Task IDs are reused across retries (codex iter2 #5); a version-keyed ack subtracts **only** when it matches the current failed snapshot, so a new failure after a retry re-appears. `acks` is local UI acknowledgement that only ever *subtracts* from a projection over authoritative data → not a second source.
- One pure function `computeBadge(globalSummary, acks) → {count}`; `flashActive` is `count > 0`. Recomputed on every SSE (re)connect/hydrate and board/summary refresh; pushes `setDockBadge(count)` + `setTrayAttention(count > 0)` (debounced). Restart → reload `acks`, recompute from fresh summary → self-heals; nothing leak/lose-able persisted.
- `interaction.resolved` is **not in the tier table** (codex iter2 #6): it carries no `notify`, fires no toast; the resolved interaction simply drops out of `pending_interactions` at the source and the next recompute reflects it. No overlay special-casing, no `badgeEffect` field.
- Tier-1 events that are **not** `badge:true` (`goal.failed`, `delivery.gate.rejected`, `session.error`) still fire an immediate OS toast (urgent, live), but their *persistent* signal arrives via the resulting terminal `task.failed` which **is** projectable. Flash therefore stays a clean derivative of the projection, never an independent live latch (rule 13).

### 2.5 Rust badge primitive (Q1 resolved — codex #5, #6)
Authoritative Tauri v2 behavior: `setBadgeCount` is **macOS/Linux/iOS only**; **Windows has no numeric taskbar badge** — only `setOverlayIcon` (a small glyph). Rust `WebviewWindow::set_badge_count` takes **`Option<i64>`** (codex iter2 #7), not `u32`. New command `overlay_badge_set(count: i64)` in `main.rs`, registered exactly like `overlay_attention_set` (`:1150-1179`):
- macOS/Linux: `WebviewWindow::set_badge_count(if count > 0 { Some(count) } else { None })`.
- Windows: `set_overlay_icon(if count > 0 { Some(alert_dot_icon) } else { None })` — a dot, **no number** (don't fabricate one — codex iter1 #5/#14).
`overlay_attention_set` retained for tier-1 flash. New TS `setDockBadge(count)` in `window.ts` + `badge.set` kind in `host-transport.ts`/`tauri-transport.ts`, mirroring `tray.attention.set`.
**ACL (codex #6)**: custom Rust commands need **no `core:window:*` capability**; just register `overlay_badge_set` in the `invoke_handler` like `overlay_attention_set`. Do **not** add JS window permissions to `capabilities/default.json`.

---

## 3. Full event matrix (rule 35 — every `BusEvent.define`, codex #12)

Task-scoped events reach the overlay either via `protocolTaskEvent` (`engine/model.ts` lifecycle) **or** via the orchestrator message-bridge `dispatchEphemeral({aggregate:"task"})` (`orchestrator/protocol/message-bridge.ts:294,352,406,459`) — codex iter2 #1. `badge:true` ⇒ contributes to the §2.4 projection; permitted **only** for the three summary-projectable facts (codex iter2 #4).

**A. `engine/model.ts` lifecycle (task-scoped):**

| Event | tier | badge | rationale |
|---|---|---|---|
| `interaction.requested` | 1 | ✓ | agent blocked on operator → projects via `pending_interactions` |
| `task.failed` | 1 | ✓ | terminal task failure → projects via `task.status` |
| `evaluation.completed` | **fn(payload)**: rejected → `{tier:1, badge:true}` · accepted → `{tier:2}` | conditional resolved at engine emit (codex iter1 #9); rejected projects via `task.evaluation` |
| `goal.failed` | 1 | – | urgent live toast; persistent signal arrives via resulting `task.failed` (not summary-projectable) |
| `delivery.gate.rejected` | 1 | – | urgent live toast; ditto |
| `session.error` (bridged, see B) | 1 | – | session crash; urgent live toast; persistent via `task.failed` |
| `task.completed` | 2 | – | success while away; toast/unfocused-OS, no badge (a result, not a pending item) |
| `task.cancelled` | 2 | – | terminal, lower urgency; toast only |
| `delivery.ready` | 2 | – | candidate to review; toast only |
| `integrity.review.completed` | 2 | – | verdict ready; toast only |
| `goal.passed`, `plan.activated`, `workflow.selected` | 2 | – | phase transition |
| `run.created\|updated\|progress\|output`, `goal.progress`, `goal_run.updated`, `task.created\|updated\|message`, `workflow.step.updated`, `goal.workflow.progress`, `delivery.evidence.updated`, `integrity.review.started\|progress\|chunk`, `plan.created` | 3 | – | high-volume progress; in-app feed only |
| `interaction.resolved` | — (not in table) | – | recompute-only; no `notify`, no toast (codex iter2 #6) |
| `task.rewound`, `spec.created\|updated\|approved`, `milestone.activated\|passed\|failed`, `message.injected` | NOOP | – | not user-actionable / router-consumed / superseded by goal-level |

**B. Bridged task-scoped events** (`message-bridge.ts`, codex iter2 #1) — previously mis-listed as N/A:

| Event | tier | badge | rationale |
|---|---|---|---|
| `message.updated\|removed`, `message.part.updated\|delta\|removed` | 3 | – | conversation stream; in-app feed only (`message-bridge.ts:406,459`) |
| `session.status`, `session.idle` | NOOP | – | liveness/phase; surfaced via run/task state, not a toast (`:294,352`) |
| `session.error` | 1 | – | crash → tier-1 toast (also listed in A for tier reference) (`:352`) |

**C. Global / non-task-scoped `BusEvent.define` → cannot flow through `protocolTaskEvent` or `/task/events`; out of architecture-A scope (codex iter2 #2):** `workspace.failed`, `workspace.ready` (`workspace/workspace.ts:14,20`), `worktree.failed`, `worktree.ready` (`worktree/index.ts:54,61`, emitted via `GlobalBus.emit` `:1061`), `server.instance.disposed`, `global.disposed`, `server.connected`, `file.watcher.updated`, `file.edited`, `command.executed`, `installation.updated`, `installation.update-available`, `ide.installed`, `lsp.*`, `tui.*`, `mcp.*`, `project.updated`, `task-queue.completed`, `permission.asked\|replied`, `question.asked\|replied\|rejected`, `memory.task-plan`, `task-report`/`goal-report`. **`workspace.failed`/`worktree.failed` operator impact is not lost** — when they break a task, that task emits a terminal `task.failed` (tier-1, `badge:true`), which is the user-facing carrier. No separate global notification seam is added (rule 5/6 — no scope creep). `permission.asked`/`question.asked` surface solely via re-emitted `interaction.requested` (§0 note).

> Iteration 3 ask: codex confirms (a) the A/B/C partition is exhaustive over all 86 defines, (b) no other `dispatchEphemeral({aggregate:"task"})` family is missed, (c) `badge:true` is restricted to exactly the three projectable facts.

---

## 4. Files touched (rule 35)

**Engine:** `bus/bus-event.ts` (registry shape + `resolveNotify`, generic constraint preserved); task-scoped `BusEvent.define` in `engine/model.ts:1057-1393` per §3-A (add `notify` only to non-NOOP rows); the bridged `session.error` / `message.*` defines per §3-B (session/message define sites — `session/events.ts`, `session/message.ts`; only `session.error` gets `notify`); `server/routes/orchestrator.ts` (`protocolTaskEvent` `:1422-1444` stamp via `event.payload`, task-list serializer `:300-307` stamp, `/task/events` schema `:280-284`); `engine/model.ts:912-922` `TaskEvent` type. **Global/non-task-scoped defines (§3-C incl. `workspace.failed`/`worktree.failed`): untouched** — no `notify`, not in scope.
**Overlay:** `notify.ts` (replace `dispatch`/`notifyTaskLifecycle`/`notifyInteractionRequested` with `routeNotification(event,{live})` toast/OS only + pure `computeBadge(globalSummary, acks)` + version-keyed `acks` persisted via `overlay-settings-storage.ts`); `events.ts` (call `routeNotification` from the live per-task + live task-list paths only; remove the old 2 sites); `conversation.ts` replay/hydration path (`:117-184`) does **not** call `routeNotification` (`{live}` is the call-path, not event-derived); `window.ts` (`setDockBadge`); `host-transport.ts`/`tauri-transport.ts` (`badge.set` kind); `sse.ts` (recompute on hydrate/reconnect `:120`).
**Rust:** `main.rs` (`overlay_badge_set` + register in both invoke lists `:1150-1179`).
**Docs:** `packages/web/.../overlay/overview.mdx` (EN + zh-cn) — `overlay_badge_set`.

---

## 5. Test plan (rule 28/36 — assert removed behavior)

1. Registry: `define` with descriptor / fn-descriptor / omitted ⇒ stored / resolved-by-payload / undefined (NOOP).
2. Stamp: tier-1 event ⇒ `notify` present on **both** `protocolTaskEvent` output and task-list serializer output; NOOP event ⇒ no `notify`; `/task/events` schema validates the new optional field.
3. `evaluation.completed`: rejected payload ⇒ `{tier:1,badge:true}`; accepted ⇒ `{tier:2}` (resolved at engine emit, asserted on stamped envelope, **not** overlay).
4. routeNotification matrix: table-driven tier×focus×selected; negatives (tier-3 never OS; tier-2 no OS when focused; tier-1 focused+selected+detail ⇒ no toast). routeNotification never mutates badge state.
5. Replay guard: `replayTaskEventToTree` on `interaction.requested` ⇒ **no** toast (asserts codex iter1 #13 fixed).
6. Badge projection: pure-function `computeBadge(globalSummary, acks)` over `pending_interactions` + terminal `task.status` + rejected `task.evaluation`; version-keyed ack `${taskID}:${failedAt}` — assert a retry after an acked failure re-counts (codex iter2 #5); reconnect with changed summary self-corrects; restart (reload acks, recompute) ⇒ no leak/loss; `flashActive == count>0`.
7. `interaction.resolved` ⇒ no `notify`, no toast; recompute reflects lowered `pending_interactions`.
8. Rust: `overlay_badge_set(0)` clears; `>0` ⇒ macOS/Linux `set_badge_count(Some(i64))`, Windows `set_overlay_icon` (mock per-platform); `i64` param type.
10. Bridged events: `message.part.delta` ⇒ tier-3 (no toast); `session.error` ⇒ tier-1 toast, no badge (codex iter2 #1).
11. Global events: `workspace.failed`/`worktree.failed` ⇒ no overlay notification path exercised; the consequent `task.failed` carries the badge (codex iter2 #2).
9. Regression: `notify-no-boot-prompt.test.ts`, `events-single-write-to-tree.test.ts` adapted & green (no double-fire, no boot prompt).

---

## 6. Codex review log

### Iteration 1 (2026-05-18): REJECTED — 14 points, all accepted
Mapping: #1→§2.1, #2→§2.2, #3→§0 scope-narrowing, #4→§0/D2 chain, #5→§2.5, #6→§2.5 ACL, #7→§2.3/§3 generic copy, #8→§3, #9→§2.1 payload-fn, #10→§2.4, #11→§2.4, #12→§3, #13→§2.3 live-only, #14→§2.5/§3.

### Iteration 2 (2026-05-18): REJECTED — 7 points, all accepted
1 (missing bridged task-scoped `message.*`/`session.*`) → §3-B added. 2 (`workspace.failed`/`worktree.failed` are global, not task-scoped) → §3-C, removed from matrix; impact via resulting `task.failed`. 3 (`event.payload` not `.properties`; keep generic constraint) → §2.1/§2.2. 4 (badge projection can only cover summary facts) → §2.4 + §3 `badge:true` restricted to `pending_interactions`/terminal `task.status`/rejected `evaluation`; results lose `dock`. 5 (`Set<taskID>` ack too coarse) → §2.4 version-keyed `${taskID}:${failedAt}`. 6 (`interaction.resolved` contradiction) → removed from tier table, `badgeEffect` field deleted. 7 (`set_badge_count` is `Option<i64>`) → §2.5 `i64`. Codex confirmed the live-only replay fix sound.

Open for iteration 3 consensus: §3 closing note (A/B/C partition exhaustive over 86 defines; no other `aggregate:"task"` family missed; `badge:true` ⊆ projectable facts). No silent rewrites — further feedback appended as iteration 3.
