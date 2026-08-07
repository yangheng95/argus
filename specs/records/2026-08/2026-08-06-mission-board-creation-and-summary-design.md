# Mission Board Creation and Summary Design

Status: approved for implementation.
Date: 2026-08-06

## Recall

### User request

- Show the current number of running items on the left Task Board navigation row without opening the board.
- Show a hover overview containing the count in every board lane.
- Add a Create Task action to the board detail page.
- Support manual creation and Artificial Intelligence creation.
- A manually created item can be explicitly dispatched later; an Artificial Intelligence-created item immediately enters the conversation send path.
- Preserve the previously accepted Mission-first board identity.

### Acceptance criteria

1. Every displayed count is a Mission count. Child Tasks remain Mission-owned execution detail and are never counted as peer board items.
2. The navigation row trailing badge displays the canonical running-lane Mission count and remains visible while another surface is open.
3. Hovering the navigation row shows all five exclusive lane counts from the same Mission record collection used by the board.
4. The board header exposes one Create Task action using the existing Dialog, Button, TextField, SelectControl, Badge, Icon, and theme-token primitives.
5. Manual mode requires a title, request, Project, and Expert Squad selection. It persists one backlog Mission with a pending user prompt and does not invoke a model.
6. A manual Mission card exposes Dispatch while that pending prompt exists. Dispatch sends exactly that prompt as a visible user message through the existing streaming Mission wake path and opens the Mission conversation.
7. Artificial Intelligence mode requires a request, Project, and Expert Squad selection. It uses the existing Mission wake path immediately and opens the created Mission conversation.
8. Successful create or dispatch refreshes Work Ledger and Mission Board from canonical server facts.
9. Errors remain visible in the creation surface or existing diagnostics; there is no silent fallback or local-only draft.
10. Desktop visual acceptance uses a real running OpenCorvus page and manually reviewed screenshots. No User Interface automation test is added, changed, or run.

### Hard constraints

- Mission is the only top-level board identity. Task remains the sole business execution lifecycle.
- Do not persist a Mission status, board column, workflow step, or dispatch state.
- Do not change the database schema. The pending prompt is current Mission metadata in the existing Session row.
- Do not create hidden, synthetic, model-only, or User-Interface-only messages. Dispatch creates the ordinary visible user message through `SessionWake.wake`.
- Expert Squad selection is the existing immutable Mission-held snapshot, not a new person/assignee model.
- Use one shared Overlay Mission record source for the board and navigation summary.
- Do not add, change, or run User Interface automation tests. Positive route, projection, service, and protocol contracts remain allowed.
- Do not create a worktree. Preserve `.superpowers/` and unrelated changes. Commit subjects begin with `dsw-33987` and push to `legacy-remote`.

### Sources read

- `specs/records/2026-08/2026-08-06-mission-board-design.md`
- `specs/records/2026-08/2026-08-06-mission-board-implementation-plan.md`
- `packages/opencorvus/src/mission/session.ts`
- `packages/opencorvus/src/mission/projection.ts`
- `packages/opencorvus/src/mission/board.ts`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/test/mission/wake-route.test.ts`
- `packages/opencorvus/test/mission/list-route.test.ts`
- `packages/overlay/src/components/MissionBoard.tsx`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ui/Dialog.tsx`
- `packages/overlay/src/services/mission.ts`
- `packages/overlay/src/services/work-ledger.ts`
- `packages/overlay/src/main.tsx`
- User-provided Multica manual-create and Artificial Intelligence-create desktop references.

### Whole-repository search result

- `POST /mission/wake` is the canonical visible-message and streaming execution entrypoint. Omitting `missionID` creates a Mission; supplying it resumes the same Mission.
- `ensureMissionSession` already owns Mission Session creation and immutable Expert Squad snapshots in `metadata.mission.visibleExpertSquadIDs`.
- `MissionRecord.boardLane` already provides one exclusive lane derived from current Mission, Task, interaction, and completion facts.
- `MissionBoard` currently owns a private duplicate Mission list; Work Ledger therefore cannot display the same summary before the board opens.
- Work Ledger already loads every registered Project row and maintains a runtime projection service, but that service currently discards Project rows.
- The existing Kobalte-backed `Dialog` and OpenCorvus form primitives cover the requested modal without a new component library.
- No database migration is required because Session metadata is part of the current schema.

### Independent agent feedback

None requested. No sub-agent was used.

## Data and message model

Manual creation persists this additional Mission metadata fact:

```ts
type MissionPendingPrompt = {
  text: string
}
```

It lives at `session.metadata.mission.pendingPrompt`. Its presence means there is a real operator-authored request waiting to be sent; it is not a lifecycle state. `MissionRecord.pendingPrompt` exposes the validated fact to the Overlay. Because the Mission has no active execution or child Tasks, the existing lane projection places it in backlog without a special rule.

`POST /mission/draft` resolves the requested Expert Squad through the existing launch authority, creates the Mission Session, applies the operator title, and writes the pending prompt. It returns the canonical `MissionRecord`.

`POST /mission/:missionID/dispatch` reads the persisted pending prompt, resolves the Mission model exactly as the wake route does, calls `SessionWake.wake` with `author: "user"`, `agent: "mission"`, and `surface: "panel"`, then removes the consumed prompt from Mission metadata. The result uses the existing `MissionWakeResult` shape. No parallel message path is introduced.

Artificial Intelligence creation continues to call `POST /mission/wake` without a Mission identifier. It never creates a draft record first.

## Overlay ownership

- `services/mission-board.ts` becomes the single shared Mission-list owner. It pages the canonical Mission list once, exposes records/loading/error, and derives the five counts from those records.
- Work Ledger triggers that shared refresh from its existing connection/refresh revision lifecycle. Mission Board renders the same shared records and calls the same reload action for explicit refresh.
- Work Ledger runtime projection retains canonical Project rows and exposes their directories for the creation dialog. No second Project fetch is added.
- The navigation action accepts one trailing slot and one custom tooltip body. The Task Board instance uses them for the running badge and five-lane overview; other navigation rows keep their existing presentation.
- `MissionCreateDialog` owns only temporary form input. Successful actions call main-owned callbacks, which invoke canonical services, refresh shared data, and open Mission conversation when execution starts.

## Interaction details

- The board header button opens manual mode by default.
- Manual and Artificial Intelligence modes are two explicit tabs inside one dialog; switching mode preserves common Project and Expert Squad selections but clears mode-specific submission errors.
- Manual submit keeps the board open and shows the new backlog card.
- Artificial Intelligence submit closes the dialog and opens the Mission conversation after the server accepts the wake.
- A pending-prompt card exposes Dispatch as a secondary card action. Clicking it does not trigger the card's ordinary open action.
- Dispatch resolves the current composer model, consumes the stored prompt on the server, opens the same Mission conversation, and refreshes the shared Mission record source.
- `aria-label`, focus, disabled, loading, and error treatment use existing primitive behavior and localized copy.

## Non-goals

- No direct child-Task creation.
- No person/member assignee model.
- No drag-to-move, editable status, workflow engine, due date, priority, attachment, mobile, or tablet scope.
- No local-storage Mission draft or compatibility route.

