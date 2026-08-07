# Mission-first Task Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real Mission-first desktop board whose five lanes are projected from Mission, Task, interaction, and visible completion facts.

**Architecture:** Extend the existing Mission list projection rather than introduce another persistence owner. Record final Mission acceptance as a real `panel.complete_mission` Tool result in Mission Session history, derive one exclusive board lane at read time, and render the result as a first-class Overlay center surface opened from Work Ledger.

**Tech Stack:** Bun, TypeScript, Zod, Hono, SolidJS, Kobalte primitives, existing OpenCorvus Session/Task/Artifact contracts, CSS design tokens.

## Global Constraints

- Mission is the top-level card; Task remains Mission detail and execution queue.
- Do not persist Mission status or board column.
- Do not change the database schema.
- Do not add, change, or run User Interface automation tests.
- Use test-first positive non-User-Interface contracts for projection, Tool, protocol, and route behavior.
- Use only the current worktree and stage exact files.
- Commit subjects begin with `dsw-33987` and push to `legacy-remote`.

---

### Task 1: Visible Mission completion contract

**Files:**
- Modify: `packages/opencorvus/src/panel/capability.ts`
- Modify: `packages/opencorvus/src/tool/panel.ts`
- Modify: `packages/opencorvus/src/prompt/core/mission-core.txt`
- Test: `packages/opencorvus/test/panel/mission-completion.test.ts`

**Interfaces:**
- Consumes: current Mission/session lineage, `TerminalLifecycleReferenceSchema`, `ArtifactReadLocatorSchema`, `completeArtifactReadsBeforePanelAction`.
- Produces: `panel.complete_mission` with strict input and canonical visible JSON output.

- [x] Write a positive contract test that persists a Mission assistant Tool part, current completed child Task occurrence, and complete Artifact read facts, then asserts the action returns the exact canonical completion receipt.
- [x] Run the focused test and confirm it fails because `complete_mission` is not registered.
- [x] Add `complete_mission` to the Mission capability set and implement exact Mission/Task/terminal/evidence validation in `PanelTool`.
- [x] Run the focused Panel contracts and confirm they pass.
- [x] Update Mission core instructions to call the action only after complete evidence reconciliation, then regenerate derived prompt payloads through the repository generator.
- [x] Commit the independently verified Tool contract.

### Task 2: Mission board fact projection and API

**Files:**
- Create: `packages/opencorvus/src/mission/board.ts`
- Modify: `packages/opencorvus/src/mission/projection.ts`
- Modify: `packages/opencorvus/src/server/routes/mission.ts`
- Modify: generated OpenAPI and Software Development Kit outputs owned by repository generators
- Test: `packages/opencorvus/test/mission/board.test.ts`
- Test: `packages/opencorvus/test/mission/list-route.test.ts`

**Interfaces:**
- Consumes: Mission Session messages/parts, child Task lifecycle projection, pending interaction facts, Mission Session interruptibility.
- Produces:

```ts
type MissionBoardLane = "backlog" | "running" | "attention" | "review" | "completed"
type MissionCompletionFact = {
  messageID: string
  toolCallID: string
  toolPartID: string
  summary: string
  timeRecorded: number
}
```

- [x] Write table-driven positive projection tests for all five lanes using literal expected lane values and real persisted facts.
- [x] Run the tests and confirm failure because the board projection does not exist.
- [x] Implement completed Tool-fact parsing, current-scope selection, pending-interaction aggregation, and exclusive lane precedence in `mission/board.ts`.
- [x] Extend `MissionRecord` with `boardLane`, `pendingInteractions`, and optional `completion`; keep binary activity and raw Task lifecycle unchanged.
- [x] Run focused Mission projection and list-route tests.
- [x] Regenerate OpenAPI and Software Development Kit types and run route checking.
- [x] Commit the independently verified projection and Application Programming Interface contract.

### Task 3: First-class Mission Board Overlay surface

**Files:**
- Create: `packages/overlay/src/components/MissionBoard.tsx`
- Create: `packages/overlay/src/styles/surfaces/mission-board.css`
- Modify: `packages/overlay/src/components/App.tsx`
- Modify: `packages/overlay/src/components/WorkLedger.tsx`
- Modify: `packages/overlay/src/services/mission.ts`
- Modify: `packages/overlay/src/main.tsx`
- Modify: Overlay style entrypoint importing surface Cascading Style Sheets
- Modify: every owned Overlay locale bundle with Mission Board labels

**Interfaces:**
- Consumes: `loadMissions`, Mission list generated types, existing Mission open callback, Work Ledger refresh events.
- Produces: `MissionBoard` component and ephemeral `conversation | mission-board` center-surface selection.

- [x] Add the Work Ledger Mission Board navigation action and wire it to main's ephemeral surface signal.
- [x] Implement paged Mission loading, search, project filter, lane grouping, loading/error/empty states, and card opening without cross-lane drag.
- [x] Render Mission title, project, compact identity, update time, child-Task terminal progress, active/queued counts, pending interactions, and Task detail chips.
- [x] Integrate the board into App so opening a Mission returns to the existing conversation and right-side execution surfaces retain their existing identity.
- [x] Add localized labels and use existing primitives and tokens.
- [x] Run Overlay typecheck, localization check, and production build. Do not run its User Interface test command.
- [x] Commit the compiled User Interface surface.

### Task 4: Real-page visual review and correction

**Files:**
- Modify only implementation files proven incorrect by visual review.
- Create evidence under: `specs/artifacts/mission-board-*.png`
- Modify: this implementation plan with final verification facts.

**Interfaces:**
- Consumes: real local OpenCorvus backend and real Vite Overlay.
- Produces: manually inspected desktop screenshots bound to Mission Board.

- [x] Start the backend with an isolated fresh database and serve the compiled Overlay through the real OpenCorvus server, using the Node-owned Playwright sidecar for one-off navigation and screenshots.
- [x] Open the real board, interact with Mission cards, and capture desktop screenshots without retaining any repeatable assertion script or baseline.
- [x] Personally inspect hierarchy, clipping, horizontal density, light/dark tokens, empty lanes, real pending-interaction facts, and card-to-conversation navigation.
- [x] Correct every observed visual or interaction defect and capture a fresh screenshot.
- [x] Run final non-User-Interface contracts, both package typechecks, Overlay build, localization check, Application Programming Interface route check, documentation checks, historical link checks, and repository status review.
- [x] Commit and push the final verified implementation to `legacy-remote` (`c1b0538bd1`).

### Task 5: Conversation-owned Environment Information lifecycle

**Files:**
- Modify: `packages/overlay/src/components/App.tsx`
- Modify: this approved design and implementation record

**Interfaces:**
- Consumes: the existing `primarySurface()` projection and `ProjectRuntimeStatusPanel.anchorVisible` lifecycle.
- Produces: one conversation-owned visibility condition for the Environment Information launcher and its portal-mounted card.

- [x] Trace the visible card from Mission Board navigation through `primaryWorkspaceSurface`, the hidden conversation container, and `HoverCard.Portal`.
- [x] Confirm the root cause: the card is mounted outside the hidden conversation subtree, while `anchorVisible` only checks the conversation home state.
- [x] Bind `anchorVisible` to both the conversation surface and the existing non-home condition.
- [x] Run Overlay typecheck, localization check, and production build without running User Interface automation tests.
- [x] Start the real page, open a concrete Project conversation, open Environment Information, navigate to Mission Board, and manually verify from a fresh screenshot that the card is gone.
- [x] Open a Mission card and verify the conversation-owned launcher is available again.
- [x] Complete a second diff/status review, commit, and push the exact repair to `legacy-remote` (`6f22ffb9ee`).

## Final verification record

- Real runtime: `http://127.0.0.1:9999/ui/`, backed by an isolated current-DDL database under `.mirror/mission-board-visual-runtime`. The user's existing database was left unchanged after it correctly failed closed with `SCHEMA_RESET_REQUIRED` semantics.
- Visual facts: opening the board 2.5 seconds after page load exposes all five lanes and real Mission cards; the final dark-theme screenshot is `specs/artifacts/mission-board-desktop.png`. Clicking its first Mission card returns to the existing Mission conversation, recorded in `specs/artifacts/mission-board-card-open.png`.
- Correction: the first real-page pass proved that a late initial Task restoration could overwrite a newer board selection. `openMissionBoard` now owns a new workspace-selection epoch, while the initial restored Task callback only projects the Task conversation kind and no longer rewrites the selected top-level surface.
- Browser evidence: `Backlog`, `Running`, `Attention`, `Review`, and `Completed` were all visible; five Mission cards rendered; the board DOM was `display:flex`; Mission-card navigation restored the conversation surface; zero console or page errors were observed.
- User Interface automation policy: no User Interface test was added, modified, or run. The one-off Playwright navigation script was removed after screenshots were captured.
- Production build: `node --max-old-space-size=8192 node_modules/vite/bin/vite.js build --config vite.config.ts` completed with 7,075 modules transformed. The package-default 2 GiB build had previously exhausted memory, so the verified command used the repository's established 8 GiB Node ceiling.
- Focused non-User-Interface contracts pass when run in their owned isolation: Mission board 3/3, Mission list route 5/5, Mission completion 2/2, and Work Ledger routes 10/10. Combining all four files in one Bun process exposes an existing process-global subscription isolation defect; the two affected files each pass alone and product behavior was not changed to hide that harness coupling.
- Root `bun run typecheck` passes all eight participating package checks; Overlay localization passes with panel revision `1ea977e04e406727`.
- Environment Information lifecycle: the real page shows the open card in `specs/artifacts/mission-board-environment-before.png`; after selecting Task Board, `panelVisibleOnBoard=false` and `triggerVisibleOnBoard=false` in the one-off browser session, matching `specs/artifacts/mission-board-environment-hidden.png`; reopening the Mission conversation returns `triggerVisibleAfterReturn=true`.
- Repair build: Overlay production compilation completed with 7,075 modules using `NODE_OPTIONS=--max-old-space-size=6144` and `GOMAXPROCS=1`; the single-core esbuild setting avoided the Windows commit-memory failure seen during the first unconstrained run.
- Repair documentation checks: historical links pass 2/2; document health passes 60/60 with 1,134 expectations when run with its owned 15-second timeout. No User Interface automation test was added, modified, or run.

## Plan self-review

- Spec coverage: each accepted identity, lane, completion evidence, navigation, visual, and verification requirement maps to one task above.
- Placeholder scan: no deferred implementation step or unspecified owner remains.
- Type consistency: `MissionBoardLane` and `MissionCompletionFact` are defined once in backend Mission board projection, emitted by `MissionRecord`, and consumed through generated Software Development Kit types in Overlay.
- Scope: one product slice spans a necessary completion fact, its read-time projection, and one User Interface surface; splitting these into independently released products would leave the completed lane semantically false.
