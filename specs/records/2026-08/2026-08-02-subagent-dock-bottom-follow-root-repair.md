# Sub-agent Dock Bottom-follow Root Repair

## Recall

| Item                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request          | “子agent展开的右侧dock，消息流不会跟踪底部，反而一直往顶部弹，简直是个灾难”。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Acceptance criteria   | The selected `Squad agents` transcript opens on its newest content and remains bottom-pinned while canonical child-session messages stream or repaint. Deliberate upward wheel, keyboard, touch, or native-scrollbar input releases following so history remains readable; returning to the bottom resumes it. The main Conversation keeps the same shared behavior. Real desktop interaction and screenshots must be manually reviewed; no User Interface (UI) automated test may be added, modified, or run.                                                                                                                                                                                                                                                                                                                                                                                                |
| Hard constraints      | Preserve the canonical exact-session resource, one transcript projection, one scroll element, and the shared follow controller. Do not add polling, a MutationObserver, a second scroll owner, persisted scroll state, timer, gate, fallback, state machine, query override, iframe, or worktree. Use one controller-owned native `ResizeObserver` for real content-box size changes rather than timing guesses. Do not refresh, restart, terminate, or otherwise interfere with the user's running packaged OpenCorvus. Preserve all parallel worktree changes.                                                                                                                                                                                                                                                                                                                                              |
| Previous repair       | `2026-07-30-subagent-scroll-composer-model-and-dock-tab-chooser.md` identified DOM replacement as an unmatched upward `scroll`, but only rebased `expectedTop` when `contentChanged()` reached the controller before the browser's delayed scroll event. Its live streaming acceptance remained explicitly unverified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Sources read          | Root `AGENTS.md`; Browser control skill; persistent Right Dock memory; `specs/current/architecture/07-panel.md`; the 2026-07-25 Sub-agent Dock record; the 2026-07-28 refresh-storm record; the 2026-07-30 incomplete scroll repair; the 2026-08-02 Conversation scroll-owner repair; `SubagentConversationPanel.tsx`; `Conversation.tsx`; `RightDock.tsx`; `subagent-conversation.ts`; `dom-utils.ts`; `inspector.css`; `workspace.css`; and Git history/blame for the scroll controller.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Whole-repository grep | `setupAutoScroll()` has exactly two production callers: the canonical main `Conversation` and `SubagentConversationScroll`. Both supply caller-owned follow signals, while `dom-utils.ts` alone classifies scroll movement and performs bottom pins. `SubagentConversationPanel` alone calls `contentChanged()` for exact-session resource revisions and `scrollToBottom()` for explicit Session changes. `inspector.css` alone owns the child transcript overflow element and disables native anchoring only while `data-follow-lock="true"`. The encountered `dom-utils-autoscroll.test.ts`, `long-transcript-scroll.test.ts`, `subagent-progress-presentation.test.ts`, and `subagent-conversation-tab-typography.test.ts` automate UI presentation or interaction and must be deleted without running. `subagent-conversation-service.test.ts` is a pure route/projection contract and remains untouched. |
| Independent feedback  | The user did not request independent Agents and the active collaboration boundary forbids unsolicited delegation. The primary Agent owns implementation and second review.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Git baseline          | Investigation started from clean `v0.0.28beta` at `d98db6aa056bf9eabdab97db1592d7400b73bd66`, equal to `legacy-remote/v0.0.28beta` after fetch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

### Reopened after packaged-runtime rejection

The user rejected the first delivery with “没有解决问题”. That rejection
invalidates the isolated Chromium/Vite acceptance as proof of the native
Tauri/WebKit outcome.

- The current native process started at `2026-08-02 19:31:06 +08:00` from the
  application bundle built at `19:29:33`. Commit `616805e9b7` is an ancestor of
  current `HEAD`, and its controller repair remains in source. The packaged
  application was not merely stale.
- The native window confirmed that the child conversation is opened by the
  progress-card action into the dedicated `subagent` panel. The generic Dock
  toggle opens the tools panel and is not the reported surface.
- Full-repository grep found a separate vertical scroll writer in
  `SubagentConversationPanel.tsx`: its selected-tab effect reads the entire
  projected `records()` array and calls `Element.scrollIntoView()` on every
  reactive run.
- `conversationAgentRecordsForSource()` returns a newly projected array whose
  records change for live activity, status, target-message, and timestamp
  updates. Therefore the tab effect re-runs for message-stream activity, not
  only for a real Session selection or agent-list change.
- `scrollIntoView()` is not confined to the horizontal agent strip. It may
  scroll every scrollable ancestor on both axes, which lets a live record
  update move the Dock toward its fixed agent selector at the top. This writer
  is independent of—and can counteract—the transcript's bottom-pin controller.

The reopened root repair is to retain selected-agent visibility but make it a
strictly horizontal operation owned by the tab strip. Its reactive dependency
must be the selected Session identity plus the ordered Session-ID set, never
the live record payload. No ancestor vertical scroll API may run on message
updates.

### Reopened for selected-Agent identity drift

The user then reported that an already-open child conversation is frequently
replaced by another Agent's conversation. Full write-site enumeration found
only four selection writers: explicit progress-card opening, explicit inner
tab/menu selection, task/source reset, and the Kobalte Tabs `onChange` bridge.
No service or stream handler intentionally chooses a newer/running Agent.

The unintended writer is the controlled Tabs collection lifecycle:

1. The Agent selector renders `<For each={records()}>`, but `records()` is the
   live projection containing activity, status, target-message, and timestamp
   data in addition to stable Session identity.
2. When a projected record object is replaced, Solid may dispose and recreate
   its Kobalte Trigger even though its `sessionID` is unchanged.
3. During collection re-registration, Kobalte 0.13.11 observes that the
   controlled selected key is temporarily absent. Because Tabs disallows an
   empty selection, its Root chooses `collection.getFirstKey()` and emits
   `onChange` for that fallback.
4. The bridge currently passes that library callback directly to
   `setSelectedSubagentSessionID`, turning the transient collection fallback
   into a real global selection change.

The root repair is stable keyed ownership: both selector surfaces iterate the
ordered primitive `sessionID` list, while a per-ID memo reads the current live
record for label, avatar, and status. Live payload updates must never unmount a
Trigger. Only a real Session-ID insertion/removal or explicit operator action
may change the collection or selected identity.

## Causal chain

1. A selected child transcript is initially pinned to its real bottom.
2. A canonical resource revision replaces or resizes descendant message DOM.
3. WebKit may clamp or re-anchor `scrollTop` and dispatch the resulting upward
   `scroll` before Solid's `contentChanged()` effect reaches the controller.
4. `setupAutoScroll()` currently treats every unmatched upward movement as
   operator intent. It therefore calls `onUserScrollUp()` even though no wheel,
   key, touch, or scrollbar gesture occurred.
5. Follow tracking becomes false before the already-scheduled correction frame.
   Later transcript revisions preserve the false history position and make the
   viewport appear to jump progressively toward the top.
6. The July 30 rebase only repairs the opposite ordering—content notification
   before scroll dispatch—so the race remains.
7. Real-page verification after the initial input-ownership repair exposed a
   second missing fact: the exact running child transcript reported
   `followLock=true`, `clientHeight=600`, `scrollHeight=1595`, and
   `scrollTop=179`, leaving an `816px` bottom distance. Its direct
   `.chat-bubble-row` content box was already `1636px` high. Markdown, code
   highlighting, disclosure, and other descendant layout can therefore grow
   after the controller's fixed two correction frames without producing
   another data revision.

The root repair combines input and size ownership, not another timing
correction: `setupAutoScroll()` must release bottom-follow only when an actual
upward operator gesture owns the scroll, and its one native `ResizeObserver`
must route real direct-content box changes through the same bounded bottom pin.
Layout-driven scroll events remain eligible for correction regardless of
whether they happen before or after a data notification.

## Production call-site disposition

| Owner / consumer                                                | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/utils/dom-utils.ts`                       | Keep one shared controller. Record upward wheel/keyboard/touch intent and active pointer-owned native scrolling locally; consume that ownership in `onScroll()`. An unmatched layout scroll must never disable follow. Observe current direct content boxes with one native `ResizeObserver`, rebinding only when the caller already reports replacement, and route size changes through the same bounded animation-frame bottom correction. |
| `packages/overlay/src/components/SubagentConversationPanel.tsx` | Preserve selected Session identity, canonical resource revision, local follow signal, `contentChanged()`, and Session-change bottom reset. No second listener or scroll model.                                                                                                                                                                                                                                                               |
| `packages/overlay/src/components/Conversation.tsx`              | Preserve its one `#chatScroll` caller, history loading, keyboard scrolling, bottom control, and content notifications. It receives the corrected shared input classification.                                                                                                                                                                                                                                                                |
| `packages/overlay/src/services/subagent-conversation.ts`        | Preserve exact task-child and standalone routes, delta merge, and continuous card projection. Message data is not the defect.                                                                                                                                                                                                                                                                                                                |
| `packages/overlay/src/styles/surfaces/inspector.css`            | Preserve the one bounded `.subagent-conversation-panel__scroll` and follow-lock anchoring rule.                                                                                                                                                                                                                                                                                                                                              |
| Encountered UI tests                                            | Delete the four directly encountered UI automation files without running them. Do not add replacement UI tests.                                                                                                                                                                                                                                                                                                                              |
| Architecture and indexes                                        | Record that follow release requires operator-owned upward input and update both August and root indexes.                                                                                                                                                                                                                                                                                                                                     |

## Implementation and verification plan

1. Commit and push this Recall and indexed plan to `legacy-remote/v0.0.28beta`.
2. Repair upward-input and direct-content-size ownership inside the single
   shared auto-scroll controller and delete the encountered obsolete UI
   automation tests.
3. Update the normative panel contract. Run formatting, Overlay TypeScript,
   production build, internationalization, focused pure service contracts, and
   documentation health; do not run UI tests.
4. Launch an isolated real Overlay page connected to the existing read-only
   data source, open the real selected child transcript, observe successive
   canonical updates, exercise deliberate upward input and bottom resumption,
   and inspect task-scoped screenshots. Do not disturb the packaged process.
5. Review the entire task-owned diff and repeat the real-page check before an
   exact-path implementation commit and normal-hook push.

## Status

- [x] Recall, causal chain, full production call-site inventory, and constraints recorded.
- [x] Plan commit `11603ff839` and legacy remote push completed.
- [x] Shared controller root repair and obsolete UI-test deletion completed.
- [x] Non-UI checks and documentation health completed.
- [x] Real-page interaction, screenshots, and manual visual review completed.
- [x] Primary-Agent second review completed.
- [x] Final implementation commit `616805e9b7` and legacy remote push completed.
- [x] User rejected the packaged result; prior completion status was reopened.
- [x] Native bundle/process provenance and dedicated child-conversation entry
      path confirmed.
- [x] Remove the record-stream-driven ancestor vertical scroll writer.
- [x] Build a fresh isolated native bundle and launch its real WebKit surface.
- [x] Keep Agent Trigger component identity stable across live record updates.
- [x] TypeScript, production Vite build, internationalization, and the focused
      exact-session service contract passed after the identity repair.
- [ ] Replace and restart the official packaged application, then verify the
      selected live child transcript remains selected and bottom-pinned across
      canonical record updates.
- [ ] Complete second review, commit, and legacy remote push for the reopened repair.

## Real-page verification evidence

| Surface                       | Result                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-repair reproduction       | The isolated production Overlay connected to the existing read-only port `7878` and opened the real active `base-researcher` child Session. The Dock had `followLock=true`, but `clientHeight=600`, `scrollHeight=1595`, and `scrollTop=179`: it was `816px` above the real bottom despite follow mode remaining armed.                                                                         |
| Direct content owner          | The selected transcript scroll element had one direct `.chat-bubble-row` child whose rendered box was `1636px` high. This proved descendant layout growth, not route data or a second overflow element, owned the missing extent notification.                                                                                                                                                  |
| Initial and switched Sessions | After the observer repair, the real `orchestrator` Session measured `scrollHeight=1850`, `scrollTop=1250`, bottom distance `0`; the completed `base-researcher` Session measured `scrollHeight=5773`, `scrollTop=5173`, bottom distance `0`. Both retained `followLock=true`.                                                                                                                   |
| Live growth                   | The running `base-planner` Session grew from `scrollHeight=915 / scrollTop=315` to `1197 / 597` across a canonical update. Both observations had exact bottom distance `0` and `followLock=true`.                                                                                                                                                                                               |
| Manual history reading        | A real upward wheel moved the running Planner `360px` away from the bottom and immediately set `followLock=false`; the history position remained stable while paused. Scrolling back to the exact bottom re-armed `followLock=true` after the native scroll event.                                                                                                                              |
| Visual review                 | `.scratch/2026-08-02-subagent-dock-follow-bottom.png` shows the running Planner's newest `app/api/routes/ingest.py` activity at the bottom of the real Dock with the native scrollbar at its lower boundary. `.scratch/2026-08-02-subagent-dock-follow-paused.png` shows the same Dock deliberately parked `360px` into history with no jump, duplicate titlebar, overlay, or second scrollbar. |
| Non-UI verification           | Overlay TypeScript, production Vite build (`7061` modules), and internationalization passed. The pure exact-session route/projection suite passed `6/6`; historical-document links plus document health passed `62/62`. `git diff --check` passed. No UI automation test was run.                                                                                                               |
| Runtime isolation             | Only an isolated Vite page was opened. The packaged OpenCorvus and its managed sidecar were not refreshed, restarted, stopped, or mutated. The temporary Vite server and in-app Browser tab were closed after acceptance.                                                                                                                                                                       |

### Reopened native verification evidence

| Surface | Result |
| --- | --- |
| Isolated native build | A separately signed `ai.opencorvus.overlay.scrollqa` Tauri application built successfully from the repaired source and launched with the native WebKit surface. It used its own managed scope and sidecar on port `7879`; the official application remained on port `7878`. |
| Isolation boundary | The alternate runtime correctly refused to open the real task directory because its `.authority.json` belongs to the official database authority. This prevents a second instance from impersonating live task ownership. No fixture, query override, copied database, or synthetic message stream was introduced. |
| Remaining acceptance | The actual live child transcript can only be verified after the official application bundle is replaced and its current process restarted. That action remains pending explicit operator authorization. |

The repository-wide document-health run reached `61/62`; its single failure
was a concurrent untracked August record already linked by the concurrently
modified monthly index. That record and index are outside this repair and were
left untouched. The focused historical-links checks, source checks, and build
for this repair passed.
