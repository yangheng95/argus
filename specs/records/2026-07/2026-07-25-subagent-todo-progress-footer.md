# Sub-agent TODO progress footer

## Recall

### User request

- Add an attractive progress display to every child-Agent progress card.
- Listen to the exact child Agent's TODO updates.
- Keep the display fixed at the bottom of that child-Agent card.
- Think through the architecture before implementation, then finish the change and ask an independent Agent to review it.
- Follow-up: remove the visible full-conversation action. The complete card is
  the pointer target and opens the exact child conversation directly.
- Follow-up: a record without TODOs renders no footer at all. The progress
  surface must follow the Overlay's quiet card hierarchy instead of reading as
  an appended toolbar.

### Acceptance criteria

- TODO progress is owned by the exact child `sessionID`; same-name Agents cannot share progress.
- The same canonical TODO snapshot survives task conversation hydrate and updates from the live `todo.updated` event.
- Activity remains independently scrollable while the progress footer stays at the card bottom.
- A child with no TODO list renders neither invented progress nor an empty
  footer/action row.
- The whole card opens the exact child conversation on pointer activation; a
  real, visually hidden Button primitive provides the same action to keyboard
  and assistive-technology users without nesting the progressbar inside a
  button role.
- The footer is progress-only: current work is the primary label, the count is
  a compact stage-tinted badge, and the track uses the same restrained inset
  hierarchy as the rest of the card.
- Terminal Agents keep truthful unresolved TODO counts rather than being forced to 100 percent.
- The compact summary and existing TODO renderers share one normalization and summary implementation.
- Focused tests, real Vite rendering, Node-launched Playwright screenshots, and an independent read-only Agent review pass.

### Hard constraints

- Preserve every unrelated change in the shared dirty worktree.
- No polling, local-storage cache, synthetic message, tool-output text scraping, or duplicate TODO store.
- Do not turn `todo.updated` into a visible conversation card.
- Use the existing conversation-agent projection and the installed Kobalte Progress primitive.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus or Overlay process. Browser acceptance uses an isolated Vite process.
- Stage only task-owned paths; commit subjects begin with `dsw-33987`; push only to `myhexin`.

### Records read

- `AGENTS.md`
- `packages/opencorvus/test/AGENTS.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-25-subagent-progress-grid-and-conversation-dock.md`
- `specs/records/2026-07/2026-07-25-subagent-progress-refresh-projection-repair.md`
- Prior rollout note for the canonical `sessionID`-owned sub-agent grid and Node plus Vite `networkidle0` acceptance.

### Repository search

A repository-wide `rg` over `conversationAgent`, `TaskConversationSessionView`,
`TaskConversationHydration`, `todo.updated`, `TodoStore`, `CardTodoSummary`,
`TodoListPart`, and `subagent-progress-card` returned 336 matching lines. The
relevant ownership decisions are:

| Call site / contract                                                                         | Decision                                                                                                                                            |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/todo.ts`, `session/todo-store.ts`, `session/session.sql.ts`                         | Keep as the persistent TODO authority; add one batch read for task-owned session IDs.                                                               |
| `tool/todo.ts`, `/session/:sessionID/todo`                                                   | Keep their existing read/write behavior; they remain producers/consumers of `TodoStore`.                                                            |
| `engine/model.ts` task conversation schemas                                                  | Extend the session view with its canonical TODO list.                                                                                               |
| `conversation/view.ts`                                                                       | Project the batch TODO snapshot into the exact session view.                                                                                        |
| `server/routes/orchestrator.ts` task conversation hydrate                                    | Batch-load TODOs beside activity and pass both projections into the view.                                                                           |
| `overlay/store/conversation-agents.ts`                                                       | Hydrate and live-merge TODOs into the existing `AgentActivityRecord`; do not add a second store.                                                    |
| `overlay/services/event-policy.ts`, `tree-writer.ts`                                         | Keep `todo.updated` a tree-writer no-op so it never becomes a scattered message card.                                                               |
| `utils/todos.ts`, `CardTodoSummary.tsx`, `TodoListPart.tsx`                                  | Centralize normalization and summary; replace the hand-written progressbar with one Kobalte-based primitive.                                        |
| `SubagentProgressGrid.tsx`, `conversation.css`                                               | Render a progress-only non-scrolling footer when TODOs exist; make the card the pointer action and retain an independent keyboard Button primitive. |
| conversation hydrate, activity-record, TODO accessibility, event-coverage, and browser tests | Extend rather than create a parallel fixture family.                                                                                                |

The follow-up repository-wide search additionally covered
`subagent-progress-card__open-hint`, `subagent.progress.view_conversation`,
`subagent.progress.open`, every `SubagentProgressCard`/`TodoProgress` call site,
keyboard activation patterns, and browser assertions. The visible
conversation hint has one renderer, two locale entries, and three browser
assertions. They are replaced together; the shared `subagent.progress.open`
accessible label remains because the Dock agent tabs also use it.

### Independent Agent feedback

The first read-only review found two blocking defects and two secondary
contract defects:

- an empty TODO list deleted every row and therefore lost the persisted
  revision needed to replace stale live state after reconnect;
- the previous card-progress browser test still hand-built the removed CSS
  structure instead of rendering the real component;
- explicit unknown TODO status and priority values were normalized instead of
  rejected; and
- the progressbar was nested under the whole-card `button` role and could be
  flattened from the browser accessibility tree.

The implementation now persists an empty-list revision, uses that same revision
in live events, validates canonical TODO values, renders a separate real open
button beside the progressbar, and exercises both progress variants through
Node-launched Vite plus Playwright ARIA snapshots. The final read-only re-review
closed all four findings, found no new blocker, and accepted the result. It
noted one intentional non-blocking interaction change: the explicit footer
button replaces whole-card activation, reducing the pointer target while
preserving tested click and keyboard access with correct semantics.

The user's follow-up rejected that smaller visible action and supersedes the
interaction note above. The second independent read-only review found no
blocking or secondary defect in the replacement: the card pointer action and
exact `sessionID` share one callback; the visually hidden Button and Kobalte
Progress remain siblings; no-TODO records render no footer; and the inspected
screenshots retain a quiet inset hierarchy without layout collapse or activity
scroll compression.

### Follow-up regression recall

After the TODO footer delivery, the user reported that the current task could
load no visible messages. The real task hydrate still returned 92 messages and
16 exact child-session projections, and every current task/standalone session
TODO payload was structurally valid. An isolated Node-launched Chromium run
against the live `/ui/` route reproduced the empty canvas: the complete
sub-agent grid existed in the DOM, but `virtua@0.42.3` left the single
dynamically hydrated virtual row at `visibility: hidden` with the initial
320-pixel estimate. Its `ResizeObserver` measured the row at more than 1,000
pixels, yet the old release did not reveal or resize it.

The repository-wide follow-up search covered all `virtua/solid`,
`Virtualizer`, `VList`, `WindowVirtualizer`, custom virtual window/item
components, conversation virtual-row tests, and the catalog pin. The
dependency is shared by the conversation, file explorer, changes, screenshot
browser, and log viewer; there is one catalog version source in the root
`package.json`. Upstream `virtua` release 0.43.0 began removing the
measurement-time `visibility: hidden` optimization, but live-task checks
against 0.43.6, 0.44.3, and 0.45.3 still left this asynchronously hydrated
oversized row hidden. Release 0.46.1 fixed initial-render repaint in the
redesigned measurement path, and 0.46.6 removed unnecessary item-level
visibility styling, but live checks proved that upgrading only through 0.46.7
did not resolve this hydration shape. The final repair upgrades the existing
mature virtualization tool to current stable 0.49.3 and migrates every
repository call site from the removed item-count `overscan` property to the
pixel-based `bufferSize` property.

The version upgrade alone was insufficient. The projection also treated every
child-owned message without a subagent progress record as a fatal integrity
error. That incorrectly included nested orchestrator messages and transient
hydrate ordering, so a valid message could reject the entire conversation.
The canonical rule is now narrower: only sessions with an exact subagent
activity record are replaced by progress cards; unmatched or orchestrator
message cards remain ordinary conversation cards. The virtualizer mounts only
after this projected order is non-empty, so a single asynchronously hydrated
grid is measured and revealed as its initial dataset. Exact target location
uses the virtualizer to mount the row and native DOM alignment for the nested
progress card.

Missing TODO snapshots remain canonical empty arrays. Their footer omits the
progress indicator and still exposes the full-conversation action; missing
TODOs never reject a session or the whole conversation. No local reveal
timeout, CSS visibility override, fallback renderer, or second virtualization
path was added.

## Root cause

`TodoStore` persists the current list and publishes `todo.updated`, but task
conversation hydrate currently batch-loads only bounded activity parts.
Overlay deliberately treats `todo.updated` as a tree-writer no-op and has no
conversation-agent TODO projection. A footer fed by tool parts or component
local state would therefore diverge across live updates, truncation, and page
refresh.

The first review exposed a second persistence defect: deleting all TODO rows
also deleted the only update time. A missed clear event followed by hydrate
therefore compared canonical empty revision `0` with stale non-empty live
revision `N` and kept the stale list indefinitely.

## Design

### One data path

1. `TodoStore` remains the sole persisted authority. `TodoSnapshotTable`
   records one monotonic revision per session even when its current list is
   empty.
2. Task conversation hydrate batch-loads current TODO rows for the already
   authorized task session list.
3. `TaskConversationSessionView.todos` carries that list through the existing
   task conversation contract.
4. `AgentActivityRecord.todos` owns the Overlay projection.
5. Live `todo.updated` events carry the persisted revision and update only the
   exact record identified by `sessionID`.
6. The progress footer derives its summary directly from that record.

The event remains a tree-writer no-op: TODO progress is session metadata, not
a conversation message. TODO status and priority are canonical enums; explicit
unknown values are contract errors rather than normalization candidates.

### Shared progress primitive

- Move TODO status normalization and counts into `utils/todos.ts`.
- Introduce one reusable Kobalte Progress-based compact summary component.
- Reuse it from `CardTodoSummary` and the sub-agent footer.
- `completed` is displayed as completed work; `cancelled` remains distinct.
  The resolved fraction may include both terminal states, while the accessible
  value text names both rather than calling cancellations completed.
- If the Agent terminates with pending work, keep the true ratio and label the
  unresolved count.

### Card layout

The card remains a column. Header and input are fixed, activity is the only
scrolling flex child, and the footer is a non-shrinking progress-only bottom
region. The complete card is the pointer target; a visually hidden Button
primitive remains a sibling of the progressbar for keyboard and assistive
technology activation.

```text
┌ Agent identity                              status ┐
│ optional input                                      │
│ independently scrolling activity                   │
├─────────────────────────────────────────────────────┤
│ current TODO                                  3 / 7 │
│ ━━━━━━━━━━━━━━━━━━━───────────────────────────────   │
└─────────────────────────────────────────────────────┘
```

No TODO list means no footer, empty track, action copy, or indeterminate
animation. The card itself remains the navigation affordance.

## Verification

- Server contract tests: exact task session ownership, empty list, multiple
  sessions, and refresh hydrate.
- Overlay store tests: hydrate, live update, same-name session isolation, and
  clearing a list.
- Component tests: one shared summary algorithm, cancellation semantics,
  terminal unresolved text, Kobalte accessibility, and no-TODO omission.
- Existing task conversation, event coverage, document-health, and architecture
  guard suites.
- Isolated Vite page plus Node-launched Playwright screenshots for running,
  completed, unresolved-terminal, and no-TODO cards; inspect geometry and
  bottom anchoring at desktop width.
- Independent Agent reads the final diff and evidence without modifying files.

### Primary results

- `packages/opencorvus/test/server/session-conversation-routes.test.ts`: 15
  passed, including standalone child-session TODO hydrate.
- Focused task hydrate contract: 1 passed. The full task-route file currently
  has seven unrelated `ProviderModelNotFoundError` failures in existing
  A2A/cancellation fixtures; the TODO hydrate case passes independently.
- Overlay conversation-agent, event routing, TODO accessibility, and collapsed
  summary suites: 101 passed.
- Overlay and OpenCorvus TypeScript checks passed.
- Two Node-launched Playwright tests against isolated Vite passed, including
  the real shared card-progress component and browser ARIA snapshots. Inspected
  `.scratch/subagent-progress-dock.png` and
  `.scratch/subagent-progress-truncated-refresh.png`: TODO footers remain
  bottom-aligned, the live 3/4 update survives a truncated refresh, and the
  no-TODO card keeps only the conversation affordance.
- Historical-link and document-health suites passed after the new record was
  added to the task index: 83 tests and 1,398 assertions.
- Independent read-only re-review passed after all initial findings were fixed.

### Follow-up card-surface results

- Overlay i18n check and TypeScript check passed.
- Focused TODO accessibility and conversation-agent projection suites passed:
  48 tests, 0 failures.
- The Node-launched sub-agent Dock browser test passed against the real shared
  component. It covers whole-card pointer activation, a no-TODO card opening
  its exact session, keyboard Enter activation through the hidden Button,
  independent progressbar ARIA, live TODO updates, refresh, and complete Dock
  routing.
- The full production-build Agent Rail browser test passed. Its no-TODO
  screenshot contains neither footer nor duplicate action copy.
- Original-size inspection of `.scratch/subagent-progress-truncated-refresh.png`
  confirms the current TODO label, stage-tinted count badge, and six-pixel
  track form one bottom inset region; the no-TODO card remains visually empty
  at the bottom.
- Historical-link and document-health suites passed: 83 tests and 1,398
  assertions. The real worktree initially exposed one unrelated parallel
  record that was present but untracked; verification used a temporary Git
  index containing that exact file and did not modify the shared index.
- The second independent read-only review reported no findings.
