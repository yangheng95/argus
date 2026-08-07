# Chat-to-Mission Inline Conversation Handoff

## Recall

User request, 2026-07-21: when Chat routes a request to Mission, do not make the
user enter a newly opened conversation surface. Switch the existing conversation
window to Mission in place, preserve the experience, and do not break any
existing capability.

Acceptance criteria:

- Chat remains the product-facing source that decides, through the existing
  `panel.wake_mission` tool contract, when durable Mission orchestration is
  required.
- Mission keeps its own backend Session identity, model/config projection,
  control-plane surface, task ownership, cancellation, terminal status, Work
  Ledger row, and caller receipt. The Chat Session must not be mutated into a
  Mission Session.
- A successful Chat-to-Mission wake emits one typed, observable handoff fact
  containing the caller Chat Session, Mission identifier, Mission Session, and
  owning directory.
- When that caller Chat is still the selected conversation, Overlay changes the
  selected source to the Mission in the already-mounted Conversation workbench.
  It must not open a native window, create another frontend conversation
  container, wait for a terminal receipt, infer from titles, or parse prose/tool
  output strings.
- If the user has navigated elsewhere before the handoff arrives, the event does
  not steal focus. The Mission remains reachable from the canonical Work Ledger.
- Source switching retains the current rendered conversation until the Mission
  hydrate response is ready, then replaces it through the existing canonical
  conversation hydrator. No blank intermediate transcript or parallel card
  source is introduced.
- Backend stream tests cover the real `panel.wake_mission` -> Mission wake ->
  handoff event path. Overlay unit/browser tests cover event dispatch, no-focus-
  steal behavior, in-place activation, live Mission rendering, keyboard focus,
  and screenshots.

Hard constraints:

- No fallback, compatibility path, host-side workflow classifier, keyword
  routing, gate, state machine, hidden/synthetic message, second active Mission
  source, or duplicated conversation store.
- `prompt_profile.active`, Mission Session metadata, the existing Session wake
  path, the Work Ledger stream, and the existing Conversation/card-tree
  projection remain their respective single sources.
- Do not remove the terminal Mission receipt written to the caller Chat; it is
  durable completion evidence and remains useful after the live surface switch.
- Do not restart, refresh, or close the user's running OpenCorvus/overlay. Use an
  isolated preview for browser verification. Playwright on Windows runs through
  Node, never Bun.
- The shared worktree contains unrelated changes. Do not reset, restore, or stage
  those changes. No new worktree is authorized.
- All edits receive tests, a second review, a `dsw-33987` commit, and a push to
  the `myhexin` git-cc remote.

Sources read before implementation:

- `AGENTS.md`
- `specs/records/2026-07/2026-07-08-chat-default-mission-forwarding-receipt.md`
- `specs/records/2026-07/2026-07-14-mission-launch-directory-and-dock-continuity.md`
- `specs/records/2026-07/2026-07-16-chat-mission-surface-attachment-forwarding.md`
- `specs/records/2026-07/2026-07-21-mission-prompt-async-surface-continuity.md`
- `specs/current/architecture/{01-agents,02-data,07-panel,07-panel-reactivity,14-agent-runtime-mode}.md`
- `packages/opencorvus/src/{tool/panel,mission/caller-receipt,mission/session,session/wake,server/routes/work-ledger}.ts`
- `packages/overlay/src/{main,services/sse,services/mission,services/conversation,services/coding-assistant}.ts(x)`
- Related backend and Overlay tests returned by the repository searches below.
- Solid documentation for [`batch`](https://docs.solidjs.com/reference/reactive-utilities/batch)
  and [`startTransition`](https://docs.solidjs.com/reference/reactive-utilities/start-transition).
  The existing hydrator already fetches before committing card-tree changes, so
  the repair should reuse that owner instead of adding a Suspense/resource
  navigation layer. A small synchronous batch may be used only where multiple
  visible signals must commit together.

Whole-repository search evidence:

- `rg -n -i 'mission mode|MissionMode|missionMode|chat mode|ChatMode|chatMode|route.*mission|navigate.*mission|open.*mission|new.*session|createSession|session.*create|conversation|window' packages/overlay packages/opencorvus specs/current specs/records/2026-07`
  found the shared Conversation workbench, Mission Session creation, Work Ledger
  selection, and prior Session/visual continuity records. No native-window
  creation occurs in the Chat-to-Mission tool path.
- `rg -l 'right-sidebar|rightSidebar|RightSidebar' ...` and
  `rg -l 'mission/wake|wakeMission|attachMissionCaller|missionCaller' ...`
  found one right-sidebar Chat identity owner, one `panel.wake_mission`
  implementation, one caller attachment/receipt owner, one Mission Session
  activation function in Overlay, and their tests.
- `rg -n 'wakeMission\(' packages/overlay/src` found only the explicit Multica
  launcher call. Chat forwarding happens inside the backend tool and therefore
  cannot be repaired by changing the `/mission/wake` launcher response.
- `rg -n 'work-ledger.changed|WorkLedgerEvent|setWorkLedgerChangeHandler' ...`
  found one global Server-Sent Events (SSE) schema/route and one Overlay handler.
  The handler currently discards event semantics and increments only a refresh
  token.
- `rg -n 'session.created|mission|workLedger|refreshToken' ...` confirmed that
  generic Mission Session updates are repeated lifecycle facts. They cannot be
  treated as one-shot navigation without a dedicated typed handoff source.
- `rg -n 'mission_session_id|mission_id|caller.*mission|mission.*caller' ...`
  confirmed that terminal receipt metadata is message evidence, not an active
  navigation contract.

Independent agent feedback:

- Not launched. The user did not request multiple agents or parallel audit, and
  the active collaboration policy forbids unsolicited sub-agent spawning. The
  main Codex agent performs the required second source/diff review.

## Diagnosis

The visible symptom is not caused by a native window API. `panel.wake_mission`
intentionally creates a fresh Mission Session because Session kind, Mission
identity, model/config overlay, task provenance, control-plane authorization,
cancellation, terminal status, and receipt ownership all belong to that Session.
Reusing or mutating the caller Chat Session would destroy those contracts.

The direct trigger for the experience break is the event boundary. After the
tool creates and wakes the Mission, the Overlay receives only generic
`work-ledger.changed` notifications. Its sole handler refreshes the Work Ledger.
It receives no one-shot fact that the selected Chat handed off to this Mission,
so the Mission can only appear as another ledger row and later be selected as a
separate conversation.

The deeper cause is that backend execution lineage is durable while frontend
surface continuity was never projected. The terminal receipt closes the eventual
message-flow loop but arrives only when Mission ends; it cannot make the active
Mission stream visible while work is running. Parsing the panel tool output or
Mission title would turn display strings into causality and would replay
navigation on hydration, violating the project's evidence and single-source
rules.

## Call-Site Treatment

| Call site / sibling                  | Current behavior                                                                                                         | Treatment                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `PanelTool` `wake_mission`           | Creates caller-linked Mission and starts `SessionWake`; returns IDs only to the Chat model.                              | After the wake message is durably injected, publish one typed Mission handoff event. Preserve the output and all runtime behavior.         |
| `mission/caller-receipt.ts`          | Owns strict caller metadata and terminal receipt delivery.                                                               | Own the handoff event schema/publisher beside the same caller lineage contract; keep receipt delivery unchanged.                           |
| `WorkLedgerRoutes` SSE               | Projects generic Session/Task/Project changes.                                                                           | Project the handoff event through the same global stream with exact IDs and directory; do not add a second stream.                         |
| `setWorkLedgerChangeHandler`         | Accepts `any`; caller only refreshes the ledger.                                                                         | Give the event a strict Overlay type and deliver the exact payload to the existing consumer.                                               |
| `main.tsx` Work Ledger handler       | Increments `missionSharedRefreshToken`.                                                                                  | Continue refreshing; activate only when the currently selected source is the exact caller Chat. Reuse `openMissionSession`.                |
| `openMissionSession`                 | Clears `cardTreeStore` before directory/conversation hydration, although `hydrateConversation` resets again after fetch. | Remove the premature reset and retain the hydrator as the only card-tree replacement owner, eliminating the blank intermediate transcript. |
| Manual Work Ledger Mission selection | Calls `openMissionSession`.                                                                                              | Preserve behavior; it gains the same stale-content-until-ready continuity.                                                                 |
| Explicit Multica Mission launch      | Calls `/mission/wake`, then `openMissionSession`.                                                                        | Preserve behavior; it does not emit a Chat handoff because it has no caller Chat.                                                          |
| Terminal caller receipt              | Writes one visible assistant message into caller Chat.                                                                   | Preserve unchanged as durable completion evidence.                                                                                         |
| Coding-assistant/Task selection      | Use their existing activation paths.                                                                                     | No semantic change in this task.                                                                                                           |

## Implementation Plan

1. Define and publish the typed one-shot Mission handoff fact only after
   `SessionWake.wake` has persisted the Mission user message.
2. Project that fact through the existing Work Ledger change SSE schema and
   generated OpenAPI/Software Development Kit (SDK) contracts.
3. Type the Overlay stream event and make the existing handler switch only the
   still-selected caller Chat to the Mission through `openMissionSession`.
4. Remove the premature Mission card-tree reset so the mounted Conversation
   surface stays visually stable until canonical hydration commits.
5. Update current panel architecture and add backend route/tool tests, Overlay
   stream/selection tests, and a Node-launched browser interaction test with
   current-goal screenshots.
6. Run focused and documentation checks, typecheck, route/OpenAPI checks, browser
   visual review, diff review, then stage only this task's hunks, commit, and push
   the current main delivery branch to `myhexin`.

## Validation Plan

- Backend: `panel.wake_mission` emits one handoff with exact caller/Mission IDs
  only after a successful wake; failed wake emits none; Work Ledger SSE preserves
  the payload.
- Overlay: ordinary Work Ledger changes only refresh; exact active-caller handoff
  switches in place; a stale/unselected caller does not switch; the Mission
  hydrate/SSE path remains canonical.
- Browser: one mounted Conversation container before and after handoff, no native
  window/open call, stable layout during hydrate, Mission user/agent content,
  Composer focus, manual return through Work Ledger, and light-theme desktop
  screenshots bound to this handoff.
- Required checks include focused Bun tests, package typechecks, API route/OpenAPI
  generation checks, `historical-docs-links`, `document-health`,
  `product-docs-single-source`, formatting, and `git diff --check`.

## Validation Evidence

- The two exact `panel.wake_mission` success/failure tests pass independently;
  the adjacent non-right-sidebar rejection test also passes on its isolated
  rerun after a transient Windows Git supervisor startup failure in the broader
  name-filtered run.
- Work Ledger route tests pass `9 / 9`; Overlay handoff, stream, and static
  ownership tests pass `37 / 37`.
- The Node-launched desktop browser test passes with one mounted
  `#chatSection`, retained Chat content while Mission hydration is blocked,
  exact Mission content after hydration, two stable Work Ledger rows, focused
  composer, zero `window.open` calls, and successful manual return to Chat.
- Goal-scoped screenshots were inspected at
  `.scratch/chat-mission-inline-handoff/transition-retains-chat.png` and
  `.scratch/chat-mission-inline-handoff/mission-active-in-place.png`. The first
  visual run exposed a redundant post-hydration Work Ledger refresh; removing
  that duplicate owner eliminated the visible row flicker, and the fresh
  screenshot shows both rows remaining visible.
- `bun ./script/generate.ts`, `api:routes-check`, `docs:check`, root typecheck,
  and Overlay internationalization checks pass. Generated OpenAPI and the
  JavaScript Software Development Kit include both `mission.handoff` and
  `work-ledger.mission-handoff`.
- Historical links, document health, and product documentation single-source
  checks pass `87 / 87` in an isolated Git index that marks both concurrently
  linked untracked July records as intent-to-add; this proves the documentation
  content and link graph without changing the other work's real index state.
