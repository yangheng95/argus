# Overlay Message Execution Chronology

## Recall

### User requirements

- Fix the Overlay message card shown in the supplied screenshot: after Activity/tool calls are visible, a later refreshed Mission narrative must not jump above earlier reasoning and tool calls.
- Explain and repair the root ordering contract rather than hiding Activity, collapsing it again, or special-casing refreshed messages.

### Acceptance criteria

- A Mission card containing earlier reasoning/tools and a later narrative renders the Activity block before the later `MISSION <time>` boundary and narrative.
- Hydration and live `message.*` projection produce the same visible order.
- Message and part ordering use backend `orderKey` as the single source; persisted reads do not depend on part ID order and live insertion does not depend on event arrival order.
- Consecutive execution parts remain summarized and expandable, but only as an in-place contiguous execution run; narrative and boundary parts are never hoisted across that run.
- The 2026-07-14 work-only-turn contract remains intact: pure reasoning/tool messages do not create empty boundaries, while later real narrative still creates one boundary.
- Focused unit tests, Overlay typecheck/build, a real Node-driven Playwright fixture, screenshot inspection, document health, and final diff review pass.

### Hard constraints

- No fallback, compatibility path, timestamp heuristic, arrival-order branch, synthetic message, hidden stream, gate, or second card tree.
- `tree-writer.ts` remains the single projection writer and `CardParts.tsx` remains the single part renderer.
- Preserve the existing dirty worktree and staged index; no reset, stash, broad restore, new worktree, or unrelated cleanup.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay processes.
- Playwright runs through Node against an isolated fixture.
- The benchmark has no process-start wall-clock deadline. Focused commands remain observable through emitted build/test activity; a true inactivity timeout, if needed for a spawned long-running process, resets whenever output or artifact activity occurs.

### Sources read

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-06/2026-06-05-mission-card-explore-agent.md`
- `specs/records/2026-07/2026-07-02-task-message-immediate-stream.md`
- `specs/records/2026-07/2026-07-11-multi-agent-message-panel-redesign.md`
- `specs/records/2026-07/2026-07-14-mission-work-only-turn-boundary-projection.md`
- Current `CardParts.tsx`, `message-part.ts`, `tree-writer.ts`, `message-store.ts`, timeline-order utilities, and focused Overlay tests.

### Whole-repository search evidence

- `CardParts` has four `collapseWorkDetails` render call-site families: normal agent/message, child agent/message, and structured `Card` bodies. All flow through one `PartCollection` implementation.
- `PartCollection` currently filters the entire input into `bodyParts` and `workParts`, then renders all body parts before all work parts. This is the direct cause of the screenshot.
- `regroupTimelineSegments()` already sorts messages by message `orderKey` and rebuilds a card's source parts in message order. It anchors an adjacent segment card to the first message and inserts a boundary before a later message only when that message has narrative content.
- `upsertPart()` appends new live parts, while `MessageStore.stream`, `latestAcrossSessions`, and `parts` query persisted parts by `PartTable.id`. These are parallel arrival/ID ordering rules beneath the declared part `orderKey` authority.
- Current browser coverage proves work-only Mission messages create no empty boundary, but it contains no later narrative after those tools and therefore cannot detect body/work hoisting.
- Existing message-store coverage proves message ordering by `orderKey`; there is no equivalent persisted/live part-order convergence regression.

### Independent agent feedback

- None. The user did not request delegation, and current collaboration policy forbids spawning an unrequested sub-agent.

## Causal chain

1. Backend messages carry canonical `orderKey` values.
2. `tree-writer.ts` sorts those messages and absorbs adjacent messages with the same exact session, dynamic agent, stage, goal, and parent ownership into one card.
3. The card retains the first message's header time and contains later message boundaries and parts in chronological source order.
4. `CardParts.tsx` then creates a second component-local ordering policy: every non-execution part is rendered first and every reasoning/tool/patch part is rendered afterward.
5. A late Mission narrative therefore crosses all earlier execution parts and appears at the top of the card even though its own boundary time is later.

The root issue is not the message comparator. The chronological contract stops at the card boundary and is replaced by type buckets inside the renderer, contrary to the current no-component-local-sorting architecture.

## Benchmark

### Task definition

Repair the shared Overlay part projection so execution disclosure preserves the canonical relative position of every narrative, boundary, reasoning, tool, and patch part across hydration and live updates.

### Input and output

| Input                                                                                           | Required output                                                                       |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| One Mission session with work-only assistant turns followed by a later narrative assistant turn | One Mission card whose visible DOM order is Activity, later boundary, later narrative |
| The same logical parts delivered in reverse live-event arrival order                            | The same canonical part order as hydration                                            |
| Pure work-only Mission turns                                                                    | One Activity disclosure and no empty `MISSION <time>` boundary                        |

### Environment

- Repository dependencies and browser runtime are loaded from the current Windows host workspace.
- No `.env` secret is required.
- Browser acceptance uses `node packages/overlay/test/browser-runner.mjs ...` and an isolated HTTP fixture; it does not attach to the running Overlay.

### Executable checks

1. Focused pure ordering and writer tests reject the current global type-bucket behavior.
2. Message-store tests prove persisted part rows are returned in part `orderKey` order.
3. Node/Playwright asserts relative DOM geometry and writes a task-scoped screenshot.
4. Overlay typecheck, production build, i18n/document health, and `git diff --check` pass.
5. Final manual review inspects the screenshot at original resolution and re-reads the scoped diff.

## Repair plan

1. Replace `bodyParts/workParts` with a stable scan that emits ordered render runs. Only adjacent execution-detail parts share an Activity disclosure; every non-execution part stays at its source position and terminates the current execution run.
2. Keep delegated-context partitioning outside that scan so its exact message ownership and collapse behavior remain unchanged.
3. Order persisted part reads by `time_created, id`, which is the physical source used to construct part `orderKey`.
4. Canonicalize collected message parts by `part.orderKey` at the shared segment-regroup convergence point, so hydrated payload order and live arrival order cannot survive into the rebuilt card.
5. Add hydrate/live and browser regressions before considering the repair complete.

## Verification results and second review

- PASS: `bun test packages/overlay/test/tree-writer-part-orderkey.test.ts packages/overlay/test/message-part-render-order.test.ts packages/opencorvus/test/session/part-orderkey-projection.test.ts` — 7 tests prove stable in-place render runs, persisted read order, and hydrated/live writer convergence.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts` through the required Node runner. The fixture asserts `Activity.top < boundary.top < narrative.top` and remains interactive after the taller Mission row caused virtual scrolling.
- PASS: production Vite build executed by the browser fixture before the visual run.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts` renders the real shared `CardParts` component in an isolated Vite surface, asserts Activity/boundary/narrative geometry, and records `.scratch/message-part-chronology-component.png`.
- Visual review PASS: `.scratch/overlay-message-execution-before-later-narrative.png` shows one expanded Mission Activity run, then the later `MISSION` boundary, then `Mission research is complete after the recorded tool activity.` No content overlap or clipped chronology evidence remains.
- PASS: Overlay and OpenCorvus `bun run typecheck`; scoped Prettier check and `git diff --check`.
- PASS: `historical-docs-links.test.ts` (11 tests). The broader `document-health.test.ts` has three concurrent-worktree failures outside this repair: the in-progress model-catalog schema move, an existing developer-path fixture, and other untracked July records already linked from the shared monthly README. This chronology record becomes tracked in this delivery; none of those three failures is caused by the chronology implementation.
- The existing browser fixture contained a stale hover contract and reused a screen coordinate after focus-driven virtual scrolling. The landed 2026-07-14 hover design requires a non-transparent flat hover surface, so the assertion now matches that record. Subsequent hover steps target the actual message element instead of extending the timeout or reusing stale coordinates.

### Second review

- Re-read the writer convergence point and confirmed the sort is applied once per message before card rebuilding; no React/Solid component owns a competing comparator.
- Re-read the renderer and confirmed only adjacent execution parts share a disclosure. Every body or boundary run terminates it and preserves source position.
- Re-ran both browser fixtures after formatting. The full Overlay screenshot uses the real conversation canvas (not a transparent element capture), and the focused component screenshot independently shows the same order.
- No running OpenCorvus or Overlay process was restarted, refreshed, or closed.
