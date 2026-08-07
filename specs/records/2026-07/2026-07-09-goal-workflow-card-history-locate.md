# Goal Workflow Card History Locate Repair

## Recall

- User request: `goal卡片执行完毕后点击无法拉出数据库中的完整执行过程记录`.
- Interpreted delivery surface: the right-side `GoalWorkflowGroup` goal card header currently only expands/collapses the summary card, while the existing task progress pill has the build-session history materialization path. Completed goal-card clicks must be able to load the persisted build-session conversation from the database-backed session transcript API and locate it in the conversation timeline.
- Acceptance criteria:
  - Completed or failed goal card clicks use the existing persisted conversation/session APIs to materialize the goal build-session transcript before locating the conversation card.
  - The conversation timeline and `cardTreeStore` / `tree-writer.ts` remain the only rendered execution-detail source; the goal summary card must not duplicate executor transcript rendering.
  - Task progress pills and right-side goal cards share one locate/materialization owner instead of parallel code paths.
  - Missing build-session owners, missing task directory, history-load failure, or missing DOM targets surface a warning and log details instead of silently doing nothing.
  - Add focused tests for shared goal-locate ownership and right-side goal card click wiring.
  - Verify targeted overlay tests and docs health after edits, then review the changed surface.
- Hard constraints:
  - Do not restart, refresh, kill, or otherwise disturb the running OpenCorvus / overlay process.
  - Do not use `git reset` or create a new worktree.
  - Do not hydrate build-session history from `Card.tsx`.
  - Do not add a second card tree, duplicated executor pane, gate rule, or compatibility path.
  - Preserve existing unrelated dirty composer changes.
- Disk records read before edits:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/current/architecture/07-panel.md`
  - `specs/current/architecture/07-panel-reactivity.md`
  - `specs/current/architecture/12-overlay-card-system.md`
  - `specs/records/2026-07/README.md`
  - `specs/records/2026-07/2026-07-09-goal-progress-session-history-load.md`
- Whole-repository grep and source recall:
  - `rg -n "goal card|Goal card|goal.*card|goalWorkflows|GoalDialog|goalDialog|workflow.*panel|transcript|control/timeline|task/.*/transcript|history|完整执行|执行过程" specs/current specs/records/2026-07 packages/overlay/src packages/opencorvus/src packages/sdk/js/src packages/overlay/test packages/opencorvus/test -g "*.md" -g "*.ts" -g "*.tsx"`
  - `rg --files packages/overlay/src packages/opencorvus/src packages/overlay/test packages/opencorvus/test specs/current specs/records/2026-07 | rg "(goal|Goal|workflow|Workflow|transcript|timeline|Timeline|board|Board|dialog|Dialog|history|History)"`
  - `rg -n "TaskProgressBar|goal-progress|findGoalCardID|loadConversationSessionHistory|loadConversationHistoryUntilCard|requestConversationCardScroll|goal pill|goal-pill|goalID" packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`
  - `rg -n "conversation/session|TaskConversationSession|session transcript|conversation history|projectConversationView|conversationHistory" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
  - `rg -n "goal card|goal.*card|gwg-header|GoalWorkflowGroup|task-progress-pill|完整执行|执行过程|session history|Goal Progress Session" specs/records/2026-07 specs/current packages/overlay/test packages/opencorvus/test -g "*.md" -g "*.ts" -g "*.tsx"`
- Relevant source evidence:
  - `packages/overlay/src/components/TaskProgressBar.tsx` already performs goal locate by deriving `buildSessionID`, loading `loadConversationSessionHistory` / `loadConversationHistoryUntilCard`, expanding parents, and scrolling.
  - `packages/overlay/src/components/GoalWorkflowGroup.tsx` currently wires `data-ui="gwg-header"` to `onClick={toggleExpanded}` only.
  - `packages/opencorvus/src/server/routes/orchestrator.ts` exposes `/task/:taskID/conversation/session/:sessionID` and reads `loadTaskSessionTranscript(taskID, sessionID, { scope: "task" })`, so the backend has a session-scoped transcript source for the full build-session process.
  - `packages/opencorvus/test/server/task-conversation-routes.test.ts` already asserts that session transcript reads do not load sibling task transcript.
- Independent agent feedback: none requested; this is a single UI-entry unification over an existing backend/session-history contract.

## Root Cause

The previous repair connected the floating `TaskProgressBar` goal pills to the persisted build-session history path. The right-side `GoalWorkflowGroup` goal card was left as a pure summary-card expander, so clicking a completed goal card does not call the session-history loader at all. This creates two different interaction truths for the same goal identity: progress pills can materialize historical execution, but goal cards only toggle local summary state.

## Repair Plan

1. Extract the goal locate/materialization behavior from `TaskProgressBar.tsx` into a shared overlay service.
2. Make `TaskProgressBar` call the shared service and keep only pill loading UI state locally.
3. Wire `GoalWorkflowGroup` header clicks through the shared service after preserving the existing expand/collapse behavior.
4. Keep execution details in the conversation timeline by scrolling/highlighting the materialized card; do not render transcript content in the goal card body.
5. Add source-contract tests that guard the shared owner and the `GoalWorkflowGroup` click wiring.

## Verification Plan

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/goal-workflow-group-worktree.test.ts packages/overlay/test/card-expand-collapse-contract.test.ts`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

## Verification Results

- Passed: `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/goal-workflow-group-worktree.test.ts packages/overlay/test/card-expand-collapse-contract.test.ts packages/overlay/test/overlay-unhandled-rejection-owners.test.ts`
- Passed: `bun test packages/overlay/test/conversation-hydrate-replay.test.ts`
- Passed: `bun test packages/overlay/test/build-phase-promotion.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- Passed: `bun run --cwd packages/overlay typecheck`
- Passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/goal-workflow-css-residue-browser.test.ts`; this browser run opens the real goals panel, captures `.scratch/goal-workflow-header-button-primitive.png`, and asserts that clicking a `passed` goal header requests `/task/:taskID/conversation/session/:sessionID`.
- Visual review completed for `.scratch/goal-workflow-header-button-primitive.png`: the right-side goals panel renders through GWG selectors, the toolbar goals activity is active, goal header text remains readable, and the completed goal card is visible without transcript duplication.
