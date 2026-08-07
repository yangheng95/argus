# Mission-first Task Board Design

Status: approved product direction; implementation source of truth.
Date: 2026-08-06

## Recall

### User request

- Research how the Multica task-board model can be transplanted into OpenCorvus.
- Produce and visually review a Multica-inspired dark desktop board.
- Explain how board flow maps onto the current Mission, Task, Session, interaction, and acceptance architecture.
- Recheck whether the board card identity should be Mission or Task.
- Execute the accepted recommendation: the primary board is Mission-first; Task remains the Mission-owned execution detail and global execution queue.

### Accepted visual and product decisions

- The approved prototype uses a full-width desktop board with five lanes: backlog, running, attention, review, and completed.
- One top-level card is one Mission. Cards summarize project, child-Task progress, active execution, pending interactions, and acceptance.
- Child Tasks never become peer cards beside Missions. They remain expandable Mission details and the existing execution-control surface.
- Cross-lane drag is not a status mutation. Board placement follows facts; actions such as wake, reply, resume, accept, cancel, and archive change real facts and the board reprojects.

### Acceptance criteria

1. The board lists only active, non-archived Mission records as top-level cards.
2. Every Mission appears in exactly one read-time lane derived from canonical facts. No `mission_status`, `board_column`, workflow step, retry counter, or compatibility field is persisted.
3. A pending Task interaction places the Mission in attention ahead of concurrent work because it represents the operator's next required action.
4. A Mission Session that is executing, or any queued/active child Task, places the Mission in running.
5. A Mission with terminal child Tasks and no active work, pending interaction, cancellation-authority blocker, or current completion decision is ready for Mission evidence review.
6. Completed requires one current, visible, persisted Mission completion Tool result. Child Task terminality, Session inactivity, final prose, and archive state never imply acceptance.
7. A later Mission wake invalidates the prior completion projection without deleting its historical Tool call; the Mission must produce a newer completion decision after reconciling the expanded scope.
8. The completion action validates the exact current Mission child-Task set, exact completed terminal lifecycle references, and Artifact locators completely read by Mission in the same Turn.
9. Existing Task public activity remains `running | inactive`; raw `queued | active | completed | failed | cancelled` stays diagnostic and recovery evidence.
10. The real Overlay must be started, opened, interacted with, screenshotted, and manually reviewed at desktop size. No User Interface automation test may be added, changed, or run.
11. Environment Information belongs only to the concrete Project conversation surface. Opening Mission Board must close its portal-mounted card and hide its launcher; opening a Mission or Task conversation restores the existing conversation-owned launcher.

### Hard constraints

- Preserve Mission as final-outcome owner, Task as the sole business execution-lifecycle owner, and Goal as a versioned Delivery Slice with no lifecycle.
- Preserve the current database schema. Mission completion is a real visible `panel.complete_mission` Tool call/result in Mission Session history, not a new table or mutable Session status field.
- Preserve ordinary terminal Task conversation and the explicit evidence-bound same-Task `resume_task` path.
- No fallback, dual source, hidden/synthetic message, Host workflow gate, state machine, keyword verdict parser, or cross-column status write.
- Do not create a worktree. Preserve unrelated changes. Use exact-file staging and `dsw-33987` commit subjects.
- User Interface acceptance is manual real-page evidence only. Non-User-Interface projection, protocol, route, and Tool contracts use positive tests written before implementation.

### Sources read

- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/03-control.md`
- `specs/records/2026-08/2026-08-03-task-activity-and-mission-completion-semantics.md`
- `specs/records/2026-08/2026-08-05-mission-acceptance-evidence-and-source-task-resume-design.md`
- `packages/opencorvus/src/mission/projection.ts`
- `packages/opencorvus/src/status/task-status-snapshot.ts`
- `packages/opencorvus/src/work-ledger/projection.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/agent/artifact-read-facts.ts`
- `packages/opencorvus/src/engine/terminal-lifecycle-reference.ts`
- `packages/transport-protocol/src/index.ts`
- `packages/overlay/src/components/App.tsx`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/services/mission.ts`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/styles/surfaces/work-ledger.css`

### Whole-repository search result

- `MissionRecord` currently projects a Mission Session, child Tasks, binary Task activity counts, and whether the Mission Session is interruptible.
- `WorkLedgerMissionRow` already adds pending interactions and nests Task rows beneath Mission; active Work Ledger does not expose Task as a peer top-level row.
- Task lifecycle is derived from `time_started`, `time_completed`, `error`, and cancellation metadata; there is no persisted Task status cache.
- Mission status currently collapses only to `running | inactive`. No current typed Mission completion or acceptance owner exists.
- Mission already has exact same-lineage Artifact catalog/read and evidence-bound same-Task resume capabilities.
- Completed Tool parts and ordinary Mission messages are persisted in the canonical Session message/part tables and remain visible in the conversation.
- The Overlay currently has one conversation-centered primary surface; Mission Board must be a first-class center surface opened from Work Ledger navigation and must return to the existing Mission conversation when a card is opened.
- No `.openai/hosting.json` exists, so the Sites skill is not applicable.

### Independent agent feedback

None requested. No sub-agent was used.

## Product identity

The sidebar label may remain the localized equivalent of “Tasks,” but the primary page title is “Mission Board” so users do not confuse outcome cards with engine Tasks. A separate “Task Queue” remains an operational projection; it is not a second task board and does not share the Mission lanes.

## Canonical Mission completion fact

`panel.complete_mission` is available only to the real Mission actor on the panel surface. Its input is:

```ts
type CompleteMissionInput = {
  action: "complete_mission"
  summary: string
  task_acceptances: Array<{
    task_id: string
    terminal_lifecycle_reference: TerminalLifecycleReference
    evidence_locators: ArtifactReadLocator[]
  }>
}
```

The Host validates that the listed Task identities equal the Mission's complete current child-Task set, every Task belongs to the exact Mission/session lineage, every terminal reference is current and completed, and every supplied locator was completely read for that Task earlier in the same Mission Turn. A Mission that legitimately completes bounded coordination without a child Task supplies an empty list.

The completed Tool output is canonical JSON containing the Mission identity, Mission Session identity, summary, exact accepted Task occurrences and evidence locators, assistant message identity, Tool call identity, Tool part identity, and record time. It is a visible natural tool result stored with the Mission conversation. Projection accepts only matching completed `panel.complete_mission` input/output facts.

A completion fact is current when no newer user-role Mission message exists after its assistant message. A later operator or child-result wake therefore reopens presentation by fact order while preserving the earlier decision as immutable history.

## Lane projection

Lane selection is exclusive display precedence, not a lifecycle transition table:

1. `completed`: one current valid Mission completion fact exists.
2. `attention`: one or more pending child-Task interactions or a current cancelled child Task requires operator authority.
3. `running`: the Mission Session is interruptible or any child Task is queued/active.
4. `review`: the Mission has at least one child Task and every child Task is terminal, with no stronger fact above.
5. `backlog`: every other active Mission, including a newly created Mission before its first Task.

Failed Task terminality does not automatically mean operator attention. Mission reads evidence and either resumes the same Task, records an external-authority interaction, or continues its own reconciliation. Cancelled Task terminality is different because Mission may not override explicit operator cancellation.

## Overlay structure

- Work Ledger gains one first-class “Mission Board” navigation action.
- App owns one ephemeral center-surface selection: `conversation | mission-board`. This is window presentation only, not Mission state.
- The same center-surface selection is the single ownership source for conversation-only portal surfaces. Environment Information is visible only while the active surface is `conversation`; Mission Board does not manually clear or duplicate its internal open state.
- Mission Board loads the existing global Mission list contract, provides search and project filters, and groups each Mission by its projected lane.
- A card shows title, compact Mission ID, project directory label, updated time, Task terminal progress, active/queued count, pending interaction count, and child-Task titles/status facets.
- Opening a card calls the existing Mission conversation path and switches the center surface back to conversation.
- Work Ledger events increment a board refresh revision; the board refetches the canonical Mission list. No new event family is introduced.
- Cards are keyboard-accessible buttons. Cross-lane drag is absent. Horizontal scrolling is allowed at desktop widths where all five fixed-density lanes cannot fit.

## Visual direction

- Reuse the approved Multica-inspired density and information hierarchy without copying its brand tokens.
- Use existing OpenCorvus dark/light tokens, `Button`, `Badge`, `Icon`, surface header, focus, and scrollbar primitives.
- Lane accents are restrained semantic tints: neutral backlog, blue running, amber attention, violet review, and green completed.
- The board occupies the center workspace; Work Ledger remains the left navigation source of truth.

## Non-goals

- No mobile or tablet design.
- No Task cards at the same hierarchy as Mission cards.
- No drag-to-change-status behavior.
- No new workflow engine, database lifecycle field, Mission retry policy, or automatic keyword classification.
- No replacement of the existing Task Board, Goal panel, Mission conversation, Work Ledger, archive, or execution controls.
