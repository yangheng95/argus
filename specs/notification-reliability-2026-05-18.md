# Notification Reliability & Coverage — Single-Source Tiered Design

- Date: 2026-05-18
- Status: v6 APPROVED (codex iter5 consensus on the correct tree) — spec + 2 specified publisher emits; implementation in progress
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

### 2.6 Publisher wiring — two notify-worthy events are defined but never emitted (codex iter5)
Two tier-1 events in §3-A have a `BusEvent.define` but **no `EngineProtocol.emit` call site** on this tree, so annotating them would yield a dead notification (rule 1/20 — fix the real gap, don't drop the requirement; these are exactly the operator-facing "待处理问题和错误" the original ask targets). The fix is to **emit them at their real decision points** (codex iter5 option A):
- **`evaluation.completed`** — defined `engine/model.ts:1210`. `updateEvaluationFromDeliveryVerdict` writes evidence at `engine/persist.ts:1304` without emitting. Fix: capture the `persistEvidence(...)` return there and `EngineProtocol.emit(Event.EvaluationCompleted, { taskID, runID, evaluationID: <evidence/projection id>, status, verdict, summary })`.
- **`delivery.gate.rejected`** — defined `engine/model.ts:1352`. Gate failures are only collected/arbitrated in `DeliveryService.verify` (`delivery/service.ts:114`, decision `:295`). Fix: `EngineProtocol.emit(Event.DeliveryGateRejected, { taskID, runID, iteration, violations })` at the final host-gate rejection point (`service.ts:~295`).
Both emit through the task aggregate (same path `protocol.ts:49`), so they reach the §2.2 seams and the single-owner handler. No new event types; the `notify` annotation (§3-A) plus these two emits make the notification live end-to-end.

### 2.3 Overlay delivery — single hub, live-only (codex #13)
New `routeNotification(event)` in `notify.ts`. **Single-owner delivery (codex iter3 #2):** the server broadcasts every task-aggregate event to *both* the per-task SSE stream (`overlay sse.ts:104-137`, server `orchestrator.ts:447-469`) and the global task-list stream (`sse.ts:227-250`, server `:300-309`). Calling `routeNotification` from both would double-fire. Therefore **the live task-list handler is the sole notification owner** — it now carries the stamped `notify` (§2.2), runs globally regardless of selected task, and is the only caller of `routeNotification`. The per-task live SSE path and `replayTaskEventToTree`/hydration only write the tree, never notify. Ownership is structural (one call site), not a runtime `{live}` flag or content heuristic (rule 13). It reads `event.notify` (opaque) and applies:

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
- **`acks`**: a persisted set of **typed, per-fact** version-keyed entries (codex iter3 #3 — the two badge facts have independent identities/clocks):
  - `task-failed:${taskID}:${task.time.completed ?? task.time.updated}` (`engine/model.ts:295-300`)
  - `evaluation-rejected:${evaluation.id}:${evaluation.time.completed ?? evaluation.time.updated}` (`engine/model.ts:467-480`)
  An ack subtracts **only** the fact whose typed key matches the current snapshot. Acking a failed task does not clear a rejected evaluation; a new evaluation, or a retry that produces a fresh failure timestamp, re-appears (IDs/timestamps are reused per retry — codex iter2 #5). `acks` only ever *subtracts* from a projection over authoritative data → not a second source.
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

Task-scoped events reach the overlay through the task aggregate via three distinct mechanisms (codex iter3 #5 precision):
- **Lifecycle** — `engine/model.ts` events through `protocolTaskEvent` (`orchestrator.ts:1422-1444`).
- **Persisted bridged** — `session.status|idle|error` via `ProtocolStore.appendEvent` on the task aggregate (`message-bridge.ts:302-319,360-380`; task-aggregate append at `engine/protocol.ts:49-67`). Being persisted task-aggregate events, these are broadcast to the task-list stream and so are stamped/owned identically to lifecycle.
- **Ephemeral bridged** — `message.*` via `ProtocolStore.dispatchEphemeral({aggregate:"task"})` (`message-bridge.ts:406-413`). All tier-3 (no toast), so their stream routing does not affect notification correctness.

`badge:true` ⇒ contributes to the §2.4 projection; permitted **only** for the three summary-projectable facts (codex iter2 #4).

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
Define sites: `message.*` at `session/message.ts`; `session.error` at `session/events.ts`; `session.status`/`session.idle` at `session/status.ts`. They reach the overlay as **task-aggregate** events because `message-bridge.ts` republishes them onto the task aggregate: persisted `ProtocolStore.appendEvent({aggregate:"task", aggregate_id: taskID})` for session lifecycle/error (`message-bridge.ts:302-306,360-364`) and ephemeral `dispatchEphemeral({aggregate:"task"})` for messages (`:406-408`) — both verified on this tree (commit `6b43131659`).

| Event | tier | badge | rationale |
|---|---|---|---|
| `message.updated\|removed`, `message.part.updated\|delta\|removed` | 3 | – | conversation stream; ephemeral; in-app feed only (`message-bridge.ts:406-408`) |
| `session.status`, `session.idle` | NOOP | – | liveness/phase; persisted, surfaced via run/task state, not a toast (`message-bridge.ts:302-306`) |
| `session.error` | 1 | – | crash → tier-1 toast; persisted task-aggregate event (also in A for tier ref) (`message-bridge.ts:360-364`) |

**C. Global / non-task-scoped — every remaining `BusEvent.define`, exact names regenerated from `rg 'BusEvent.define'` on this tree (codex iter4 #4):** `workspace.failed`, `workspace.ready` (`workspace/workspace.ts`), `worktree.failed`, `worktree.ready` (`worktree/index.ts`, `GlobalBus.emit`), `session.created`, `session.updated`, `session.deleted`, `session.diff` (`session/index.ts`), `session.compacted` (`session/compaction.ts`), `todo.updated` (`session/todo.ts`), `vcs.branch.updated` (`project/vcs.ts`), `task_plan.updated` (`memory/task-plan.ts`), `project.updated` (`project/project.ts`), `task-queue.completed` (`scheduler/task-queue-service.ts` — **does exist on this branch**, contrary to an origin/dev-based review), `goal.report` (`tool/goal-report.ts`), `task.report` (`tool/task-report.ts`), `permission.asked`, `permission.replied` (`permission/next.ts`), `question.asked`, `question.replied`, `question.rejected` (`question/index.ts`), `lsp.client.diagnostics` (`lsp/client.ts`), `lsp.updated` (`lsp/index.ts`), `mcp.tools.changed`, `mcp.prompts.changed`, `mcp.resources.changed`, `mcp.browser.open.failed` (`mcp/index.ts`), `file.edited` (`file/index.ts`), `file.watcher.updated` (`file/watcher.ts`), `ide.installed` (`ide/index.ts`), `installation.updated`, `installation.update-available` (`installation/index.ts`), `command.executed` (`command/index.ts`), `tui.command.execute`, `tui.prompt.append`, `tui.session.select`, `tui.toast.show` (`cli/cmd/tui/event.ts`), `server.instance.disposed` (`bus/index.ts`), `global.disposed` (`server/event.ts`, `server/routes/global.ts`), `server.connected` (`server/event.ts`). **`workspace.failed`/`worktree.failed` operator impact is not lost** — a broken task emits terminal `task.failed` (tier-1, `badge:true`), the user-facing carrier. No separate global seam (rule 5/6). `permission.asked`/`question.asked` surface solely via re-emitted `interaction.requested` (§0). This list ∪ §3-A ∪ §3-B = the complete `BusEvent.define` set on this tree.

> Iteration 4 was run against an **origin/dev**-based worktree (a 2127-commit-older architecture lacking `engine/model.ts`/`orchestrator.ts`/`message-bridge.ts`); its points #1–#3 were wrong-tree artifacts and are disproven here. Point #4 (regenerate §3 from real `rg`) was valid and is now applied on the correct pinned tree. All §3-A/B/C define sites + the task-aggregate seams (`orchestrator.ts:300-309`, `:1422`, `message-bridge.ts:302/360/406`) and `evaluation.id` (`engine/model.ts:468`) re-verified at commit `6b43131659`.

---

## 4. Files touched (rule 35)

**Engine:** `bus/bus-event.ts` (registry shape + `resolveNotify`, generic constraint preserved); task-scoped `BusEvent.define` in `engine/model.ts:1057-1393` per §3-A (add `notify` only to non-NOOP rows); the bridged `session.error` / `message.*` defines per §3-B (session/message define sites — `session/events.ts`, `session/message.ts`; only `session.error` gets `notify`); `server/routes/orchestrator.ts` (`protocolTaskEvent` `:1422-1444` stamp via `event.payload`, task-list serializer `:300-307` stamp, `/task/events` schema `:280-284`); `engine/model.ts:912-922` `TaskEvent` type. **Publisher wiring (§2.6, codex iter5):** `engine/persist.ts:~1304` (emit `Event.EvaluationCompleted` in `updateEvaluationFromDeliveryVerdict`); `delivery/service.ts:~295` (emit `Event.DeliveryGateRejected` at the host-gate rejection point). **Global/non-task-scoped defines (§3-C incl. `workspace.failed`/`worktree.failed`): untouched** — no `notify`, not in scope.
**Overlay:** `notify.ts` (replace `dispatch`/`notifyTaskLifecycle`/`notifyInteractionRequested` with `routeNotification(event)` toast/OS only + pure `computeBadge(globalSummary, acks)` + typed version-keyed `acks` persisted via `overlay-settings-storage.ts`); `events.ts` (call `routeNotification` from **exactly one** site — the live task-list handler `handleTaskListNotification` `:945-954`; **delete** the per-task `interaction.requested` notify branch `:40-47` and the old lifecycle site so the per-task stream only writes the tree — codex iter3 #2); `conversation.ts` replay/hydration (`:117-184`) never calls `routeNotification`; `window.ts` (`setDockBadge`); `host-transport.ts`/`tauri-transport.ts` (`badge.set` kind); `sse.ts` (recompute on hydrate/reconnect `:120`).
**Rust:** `main.rs` (`overlay_badge_set` + register in both invoke lists `:1150-1179`).
**Docs:** `packages/web/.../overlay/overview.mdx` (EN + zh-cn) — `overlay_badge_set`.

---

## 5. Test plan (rule 28/36 — assert removed behavior)

1. Registry: `define` with descriptor / fn-descriptor / omitted ⇒ stored / resolved-by-payload / undefined (NOOP).
2. Stamp: tier-1 event ⇒ `notify` present on **both** `protocolTaskEvent` output and task-list serializer output; NOOP event ⇒ no `notify`; `/task/events` schema validates the new optional field.
3. `evaluation.completed`: rejected payload ⇒ `{tier:1,badge:true}`; accepted ⇒ `{tier:2}` (resolved at engine emit, asserted on stamped envelope, **not** overlay).
3b. **Publisher wiring (§2.6):** a delivery verdict through `updateEvaluationFromDeliveryVerdict` emits exactly one `evaluation.completed` reaching `/task/events`; a host-gate rejection in `DeliveryService.verify` emits exactly one `delivery.gate.rejected` reaching `/task/events` (asserts the previously-dead notifications are now live end-to-end — codex iter5).
4. routeNotification matrix: table-driven tier×focus×selected; negatives (tier-3 never OS; tier-2 no OS when focused; **tier-1 focused+selected+detail ⇒ in-app toast still shown, OS/host notification suppressed** — codex iter3 #4). routeNotification never mutates badge state.
5. **Single-owner (codex iter3 #2):** feed the *same* task-aggregate event into both the per-task live SSE path and the live task-list handler ⇒ assert exactly **one** toast + one OS send (the task-list owner); per-task path produces zero notifications.
6. Replay guard: `replayTaskEventToTree` on `interaction.requested` ⇒ **no** toast (asserts codex iter1 #13 fixed).
7. Badge projection: pure `computeBadge(globalSummary, acks)` over `pending_interactions` + terminal `task.status` + rejected `task.evaluation`; **typed** acks — assert acking a failed task does NOT clear a co-pending rejected evaluation, and a retry with a fresh failure timestamp re-counts (codex iter3 #3 / iter2 #5); reconnect self-corrects; restart (reload acks, recompute) ⇒ no leak/loss; `flashActive == count>0`.
8. `interaction.resolved` ⇒ no `notify`, no toast; recompute reflects lowered `pending_interactions`.
9. Rust: `overlay_badge_set(0)` clears; `>0` ⇒ macOS/Linux `set_badge_count(Some(i64))`, Windows `set_overlay_icon` (mock per-platform); `i64` param type.
10. Bridged events: `message.part.delta` ⇒ tier-3 (no toast); `session.error` ⇒ tier-1 toast, no badge (codex iter2 #1 / iter3 #5).
11. Global events: `workspace.failed`/`worktree.failed` ⇒ no overlay notification path exercised; the consequent `task.failed` carries the badge (codex iter2 #2).
12. Regression: `notify-no-boot-prompt.test.ts`, `events-single-write-to-tree.test.ts` adapted & green (no double-fire, no boot prompt).

---

## 6. Codex review log

### Iteration 1 (2026-05-18): REJECTED — 14 points, all accepted
Mapping: #1→§2.1, #2→§2.2, #3→§0 scope-narrowing, #4→§0/D2 chain, #5→§2.5, #6→§2.5 ACL, #7→§2.3/§3 generic copy, #8→§3, #9→§2.1 payload-fn, #10→§2.4, #11→§2.4, #12→§3, #13→§2.3 live-only, #14→§2.5/§3.

### Iteration 2 (2026-05-18): REJECTED — 7 points, all accepted
1 (missing bridged task-scoped `message.*`/`session.*`) → §3-B added. 2 (`workspace.failed`/`worktree.failed` are global, not task-scoped) → §3-C, removed from matrix; impact via resulting `task.failed`. 3 (`event.payload` not `.properties`; keep generic constraint) → §2.1/§2.2. 4 (badge projection can only cover summary facts) → §2.4 + §3 `badge:true` restricted to `pending_interactions`/terminal `task.status`/rejected `evaluation`; results lose `dock`. 5 (`Set<taskID>` ack too coarse) → §2.4 version-keyed `${taskID}:${failedAt}`. 6 (`interaction.resolved` contradiction) → removed from tier table, `badgeEffect` field deleted. 7 (`set_badge_count` is `Option<i64>`) → §2.5 `i64`. Codex confirmed the live-only replay fix sound.

### Iteration 3 (2026-05-18): REJECTED — 5 points; **architecture explicitly blessed**
Codex: *"evaluation tier via payload function is sound… Dropping interaction.resolved is correct… The pure projection design is sound after the ack-key fix."* All 5 accepted: 1 (§3-C non-exhaustive / misnamed) → §3-C exact names incl. `task_plan.updated`, `session.created|updated|deleted|diff`, `session.compacted`, `todo.updated`, `vcs.branch.updated`. 2 (live double-fire across both streams) → §2.3/§4 single-owner = task-list handler only; per-task notify branch deleted; §5.5 regression. 3 (ack keys incomplete for rejected eval) → §2.4 typed per-fact keys. 4 (test plan contradicts §2.3) → §5.4 "in-app yes, OS no". 5 (bridge prose wrong: session.* persisted not ephemeral) → §3 intro three-mechanism rewrite.

Done in an isolated worktree because the main tree was under concurrent git churn.

### Iteration 4 (2026-05-18): VOID — reviewed the wrong tree
Run against an `origin/dev`-based worktree (2127 commits older; no `engine/model.ts`/`orchestrator.ts`/`message-bridge.ts`). Points #1–#3 were wrong-tree artifacts (disproven on the correct tree). Point #4 (regenerate §3 from real `rg`) valid → applied in v5 on the correct pinned tree (`6b43131659`). Process fix: re-pinned an isolated worktree to the branch tip (`notif-impl`) for the architecture the spec actually targets.

### Iteration 5 (2026-05-18): APPROVED-WITH-REVISIONS — consensus reached
Codex on the correct tree (HEAD `dd0a51c294`): registry/stamp design, single-owner seam, badge projection + ack field names (`engine/store.ts:1373` task time, `:1538` evaluation id/time), §3 A/B/C completeness (86 sites / 85 names), and rule audit 8/13/15/5/6 — **all pass**. Two required revisions, both accepted as **publisher wiring** (not design flaws): `evaluation.completed` and `delivery.gate.rejected` are defined but never `EngineProtocol.emit`-ed → §2.6 adds the two emit sites (`persist.ts:~1304`, `delivery/service.ts:~295`); §4/§5.3b updated. Chose codex option A (wire the emits) over option B (drop) because these are precisely the operator-facing failures the original ask requires (rule 1/20). **Design consensus reached; v6 = approved spec + the two specified emits. Proceeding to implementation (no further review round — codex approved and itself specified these fixes; re-review would be rule 5/6 over-iteration).**
