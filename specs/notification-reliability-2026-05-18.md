# Notification Reliability & Coverage — Single-Source Tiered Design

- Date: 2026-05-18
- Status: DRAFT v2 — addresses codex review iteration 1 (REJECTED, 14 points); pending iteration 2 consensus → codex implementation
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
  dock?: boolean                 // contributes to badge projection
  flash?: boolean                // tier-1 attention flash
  badgeEffect?: "add" | "clear"  // default "add"; "clear" = decrements (e.g. interaction.resolved)
}
export function define<Type, Properties>(
  type: Type, properties: Properties,
  notify?: NotifyDescriptor | ((props: z.infer<Properties>) => NotifyDescriptor | undefined),
)
```
`notify` may be a **function of the payload** so verdict/terminal-conditional tiers are decided at the engine source (codex #9, #7). Registry stores it; `payloads()` schema is unchanged (notify is envelope metadata, not payload). Omitted `notify` ⇒ NOOP (opt-in).

### 2.2 Stamp seam (Q2 closed — codex #2)
Two seams, one registry source:
- Per-task: `protocolTaskEvent()` in `server/routes/orchestrator.ts:1422-1444` (used by live SSE `:447-464`, replay `:470-474`, conversation pages `:1396-1419`).
- Task-list: serializer `orchestrator.ts:300-307`.

Both call `const notify = resolveNotify(event.type, event.properties)` from the registry and attach `notify` to the JSON. Update `TaskEvent` model (`engine/model.ts:912-922`) and the `/task/events` schema (`orchestrator.ts:280-284`) to include optional `notify`. The lightweight task-list payload grows by exactly this one field (no other contract change).

### 2.3 Overlay delivery — single hub, live-only (codex #13)
New `routeNotification(event, { live: boolean })` in `notify.ts`. Called **only** from the live SSE dispatch and the task-list live handler — **never** from `replayTaskEventToTree`/hydration. `live` is a property of the call path, not inferred from event content (no heuristics, rule 13). It reads `event.notify` (opaque) and applies:

| `tier` | in-app toast | OS notification | badge / flash |
|---|---|---|---|
| 1 | always | unless `focused && selected && task-detail (not list) visible` | projection counts it; `flash` if descriptor says so |
| 2 | always | only if window **unfocused** | projection counts it if `dock`; never flashes |
| 3 | existing in-app toast only | never | no |

Toast copy is **generic per tier/event type** via i18n keys (no failure-reason parsing, codex #7/#14).

### 2.4 Persistent badge — projection, not accumulator (codex #10, #11)
Badge state is a **pure function**, recomputed on every relevant snapshot/SSE change:

```
badgeCount = Σ over tasks: pendingInteractions(task)   // blocking, awaiting operator
           + |{ tasks in terminal-failure state } \ localAcks|   // unread failures
flashActive = (Σ pendingInteractions) > 0
```
- **Authoritative sources only**: unselected tasks → `pending_interactions` *count* from the global task summary (`engine/model.ts:880-887`); selected task → detailed `interactions` from its board (`:848`). No persisted interaction details (would be a 2nd source — codex #10).
- **`localAcks`**: a persisted set of `taskID`s the operator has viewed/dismissed. This is legitimate **local UI acknowledgement state**, not a mirror of engine truth — it only ever *subtracts* from a projection over authoritative data, so it cannot drift into a second source.
- On every SSE (re)connect/hydrate and on board/summary refresh: recompute and push `setDockBadge(count)` + `setTrayAttention(flashActive)` (debounced). Restart → reload `localAcks`, recompute from fresh snapshot → self-heals; nothing persisted that could leak/lose.
- `interaction.resolved` carries `badgeEffect:"clear"` from the registry; it triggers a recompute (the resolved interaction drops out of `pending_interactions` at the source). No overlay special-casing.

### 2.5 Rust badge primitive (Q1 resolved — codex #5, #6)
Authoritative Tauri v2 behavior: `setBadgeCount` is **macOS/Linux/iOS only**; **Windows has no numeric taskbar badge** — only `setOverlayIcon` (a small glyph). New command `overlay_badge_set(count: u32)` in `main.rs`, registered exactly like `overlay_attention_set` (`:1150-1179`):
- macOS/Linux: `WebviewWindow::set_badge_count(if count>0 {Some(count)} else {None})`.
- Windows: `set_overlay_icon(if count>0 {Some(alert_dot_icon)} else {None})` — a dot, **no number** (don't fabricate one — codex #5/#14).
`overlay_attention_set` retained for tier-1 flash. New TS `setDockBadge(count)` in `window.ts` + `badge.set` kind in `host-transport.ts`/`tauri-transport.ts`, mirroring `tray.attention.set`.
**ACL (codex #6)**: custom Rust commands need **no `core:window:*` capability**; just register `overlay_badge_set` in the `invoke_handler` like `overlay_attention_set`. Do **not** add JS window permissions to `capabilities/default.json`.

---

## 3. Full event matrix (rule 35 — every `BusEvent.define`, codex #12)

Only task-scoped events reach the overlay notification path (via `protocolTaskEvent`/task-list). All such events from `engine/model.ts`:

| Event | tier | dock | flash | badgeEffect | rationale |
|---|---|---|---|---|---|
| `interaction.requested` | 1 | ✓ | ✓ | add | agent blocked on operator |
| `task.failed` | 1 | ✓ | ✓ | add | terminal failure |
| `goal.failed` | 1 | ✓ | ✓ | add | terminal goal failure |
| `delivery.gate.rejected` | 1 | ✓ | ✓ | add | delivery blocked |
| `evaluation.completed` | **fn(props)**: rejected→1 dock+flash add · accepted→2 no-dock | | | | conditional resolved at engine emit (codex #9) |
| `workspace.failed` | 1 | ✓ | ✓ | add | env hard-block |
| `worktree.failed` | 1 | ✓ | ✓ | add | worktree hard-block |
| `session.error` | 1 | ✓ | ✓ | add | session/agent crash |
| `task.completed` | 2 | ✓ | – | add | success while away |
| `task.cancelled` | 2 | ✓ | – | add | terminal, lower urgency |
| `delivery.ready` | 2 | ✓ | – | add | candidate to review |
| `integrity.review.completed` | 2 | ✓ | – | add | verdict ready |
| `interaction.resolved` | 2 | ✓ | – | **clear** | clears a blocking entry; no toast |
| `goal.passed` | 2 | – | – | – | milestone success, no badge |
| `plan.activated`, `workflow.selected` | 2 | – | – | – | phase transition |
| `run.created`, `run.updated`, `run.progress`, `run.output`, `goal.progress`, `goal_run.updated`, `task.created`, `task.updated`, `task.message`, `workflow.step.updated`, `goal.workflow.progress`, `delivery.evidence.updated`, `integrity.review.started\|progress\|chunk`, `plan.created` | 3 | – | – | – | high-volume progress; in-app only |
| `task.rewound`, `spec.created\|updated\|approved`, `milestone.activated\|passed\|failed`, `message.injected` | NOOP | – | – | – | not user-actionable / router-consumed / superseded by goal-level |

**Non-task-scoped `BusEvent.define` (never reach overlay notification path → N/A, not a rule-35 omission):** `server.instance.disposed`, `global.disposed`, `server.connected`, `file.watcher.updated`, `file.edited`, `command.executed`, `worktree.ready`, `workspace.ready`, `installation.updated`, `installation.update-available`, `ide.installed`, `lsp.updated`, `lsp.*`, `tui.prompt.append`, `tui.command.execute`, `tui.*`, `mcp.*` (4), `project.updated`, `task-queue.completed`, `permission.asked`, `permission.replied`, `question.asked`, `question.replied`, `question.rejected`, `session.*` (compaction/status/message/index — internal bus), `memory.task-plan`, `task-report`/`goal-report` tool events. These are infra/CLI/session-internal; `permission.asked`/`question.asked` surface to the operator solely via the re-emitted `interaction.requested` (see §0 note).

> Codex must, in iteration 2, confirm this task-scoped vs non-task-scoped partition (which `BusEvent.define` actually pass through `protocolTaskEvent`/the task-list aggregate). Any task-scoped event missing from the table above = rule-35 failure to fix before consensus.

---

## 4. Files touched (rule 35)

**Engine:** `bus/bus-event.ts` (registry shape, `resolveNotify`); the 37 task-scoped `BusEvent.define` in `engine/model.ts:1057-1393` (add `notify` arg per §3); `server/routes/orchestrator.ts` (`protocolTaskEvent` `:1422-1444` stamp, task-list serializer `:300-307` stamp, `/task/events` schema `:280-284`); `engine/model.ts:912-922` `TaskEvent` type. Non-task-scoped defines: **untouched** (no `notify` arg).
**Overlay:** `notify.ts` (replace `dispatch`/`notifyTaskLifecycle`/`notifyInteractionRequested` with `routeNotification(event,{live})` + `computeBadge` projection + `localAcks` persisted via `overlay-settings-storage.ts`); `events.ts` (call `routeNotification` from live per-task + live task-list paths only; remove old 2 sites); `conversation.ts` replay path explicitly passes nothing to routeNotification; `window.ts` (`setDockBadge`); `host-transport.ts`/`tauri-transport.ts` (`badge.set`); `sse.ts` (recompute on hydrate/reconnect).
**Rust:** `main.rs` (`overlay_badge_set` + register in both invoke lists `:1150-1179`).
**Docs:** `packages/web/.../overlay/overview.mdx` (EN + zh-cn) — `overlay_badge_set`.

---

## 5. Test plan (rule 28/36 — assert removed behavior)

1. Registry: `define` with descriptor / fn-descriptor / omitted ⇒ stored / resolved-by-payload / undefined (NOOP).
2. Stamp: tier-1 event ⇒ `notify` present on **both** `protocolTaskEvent` output and task-list serializer output; NOOP event ⇒ no `notify`; `/task/events` schema validates the new optional field.
3. `evaluation.completed`: rejected payload ⇒ tier-1 dock+flash; accepted ⇒ tier-2 no-dock (resolved at engine, asserted on stamped envelope, **not** overlay).
4. routeNotification matrix: table-driven tier×focus×selected; negatives (tier-3 never OS/dock; tier-2 no OS when focused; tier-1 focused+selected+detail ⇒ no toast **but badge still counts** — asserts old fully-silent bug gone).
5. Replay guard: `replayTaskEventToTree` on `interaction.requested` ⇒ **no** notification/badge change (asserts codex #13 fixed).
6. Badge projection: pure-function test over (global summaries with `pending_interactions`, selected board interactions, localAcks) ⇒ expected count/flash; reconnect with changed snapshot ⇒ self-corrects; restart (reload acks, recompute) ⇒ no leak/loss.
7. `interaction.resolved` ⇒ recompute drops it, **no toast** fired.
8. Rust: `overlay_badge_set(0)` clears; `>0` ⇒ macOS/Linux count, Windows overlay-icon set (mock per-platform); flash decoupled from badge.
9. Regression: `notify-no-boot-prompt.test.ts`, `events-single-write-to-tree.test.ts` adapted & green (no double-fire, no boot prompt).

---

## 6. Codex review — iteration 1 (2026-05-18): REJECTED

All 14 points accepted; revisions applied above. Mapping: #1→§2.1, #2→§2.2, #3→§0 scope-narrowing, #4→§0/D2 cited chain, #5→§2.5, #6→§2.5 ACL, #7→§2.3/§3 generic copy, #8→§3 `interaction.resolved` clear+no-toast, #9→§2.1 payload-fn at engine, #10→§2.4 projection from authoritative + localAcks, #11→§2.4 single pure projection, #12→§3 full matrix + N/A partition, #13→§2.3 live-only path flag, #14→§2.5 Windows dot / no rich persistence / no overlay taxonomy.

Open for iteration 2 consensus: confirm the task-scoped vs non-task-scoped `BusEvent.define` partition (§3 closing note). No silent rewrites — further codex feedback appended as iteration 2 with inline marks.
