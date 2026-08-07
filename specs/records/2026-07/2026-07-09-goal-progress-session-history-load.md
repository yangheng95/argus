# Goal Progress Session History Load Repair

## Recall

- User request: explain why task `tsk_f42ad0c49001kkPDDbQ7tlmWSE` appears to have lost G1-G4 execution details and why clicking the goal pills cannot load them.
- Task context: completed workflow task `Phase 01: Research and System Design`, runtime DB `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`, project directory `C:\Users\chuan\myhexin-local\demos\economy\futures`, server `http://127.0.0.1:7878`.
- Acceptance criteria:
  - Prove whether G1-G4 execution details are persisted or actually lost.
  - Identify the UI/API/code path that makes clicking G1-G4 fail to reveal the details.
  - Repair the root cause without fallback, duplicate rendering state, gate logic, or card-renderer side effects.
  - Add focused tests that cover historical goal-pill click materialization and error surfacing.
  - Verify with targeted tests and review the changed delivery surface after tests pass.
- Hard constraints:
  - Do not restart, refresh, kill, or otherwise disturb the running OpenCorvus/overlay process.
  - Do not use git reset or create a new worktree.
  - Preserve `cardTreeStore` and `tree-writer.ts` as the single rendered card-tree source.
  - Do not make `Card.tsx` hydrate build-session history from render.
- Disk records read before edits:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
  - `specs/records/2026-07/2026-07-08-subagent-terminal-summary-cards.md`
  - `specs/current/architecture/07-panel-reactivity.md`
- Full-repo grep and source recall:
  - `rg -n "goalWorkflows|GoalWorkflow|listTaskInteractions|getTaskTrace|conversation" packages/opencorvus/src packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx"`
  - `rg -n "TaskProgressBar|task-progress|loadConversationSessionHistory|loadConversationHistoryUntilCard|conversation-card-scroll|findGoalCardID" packages/overlay/src packages/overlay/test packages/opencorvus/test -g "*.ts" -g "*.tsx"`
  - `rg -n "function conversationCardContainsMessage|conversationCardContainsMessage|attachConversationAgentViewTargets|renderedCardID|targetMessageID|phaseSessionID" packages/overlay/src/services packages/overlay/src/store packages/overlay/src/utils -g "*.ts" -g "*.tsx"`
- Independent agent feedback: none requested; this is a single-surface overlay history materialization bug with direct DB/API/source evidence.

## Evidence

SQLite read-only inspection of `opencorvus.db` shows the data is still present:

- `engine_goal` has all seven goals for `tsk_f42ad0c49001kkPDDbQ7tlmWSE`.
- `engine_artifact` has seven `acceptance`, seven `build_attempt_outcome`, seven `diff`, and twenty-eight `goal_run_attempt` artifacts for the task.
- G1-G4 `goal_run_attempt` artifacts carry build session IDs:
  - G1: `ses_0bd43d06affePrnlNc2v9loPZC`
  - G2: `ses_0bd40f8a9ffeEvxz7jfRqzsTyd`
  - G3: `ses_0bd3d9fecffezH705PGXN6FYrU`
  - G4: `ses_0bd3da32effe7cq9qzdXYod4bi`
- `message` and `message_part` rows exist for those build sessions:
  - G1: 18 messages / 1278 parts
  - G2: 17 messages / 1088 parts
  - G3: 31 messages / 3410 parts
  - G4: 25 messages / 2375 parts

Read-only HTTP inspection against the running server also proves the rows project through backend APIs:

- `/task/tsk_f42ad0c49001kkPDDbQ7tlmWSE/board?sync=0&directory=...` returns G1-G4 build steps with `payload.buildSessionID`, `startedAt`, `completedAt`, and completed build phases.
- `/task/tsk_f42ad0c49001kkPDDbQ7tlmWSE/transcript?directory=...` returns 266 messages, including all G1-G4 build session message groups.
- `/session/ses_0bd43d06affePrnlNc2v9loPZC/trace?directory=...` returns trace events for G1.

Conclusion: the details are not deleted from DB and are not missing from backend APIs. The failure is an overlay historical-materialization path problem.

## Root Cause

`packages/overlay/src/services/task.ts` intentionally hydrates only the initial tail when selecting a task. The selected long task has much more history than the tail limit, so older G1-G4 build session message parts are not immediately in `cardTreeStore`.

`packages/overlay/src/components/TaskProgressBar.tsx` only calls `findGoalCardID(goalID)` and then `requestConversationCardScroll`. It does not verify whether the goal's build-session target message has been materialized, and it does not use the existing session-scoped history loader.

The left `ConversationAgentRail` already has the correct owner pattern:

- It reads the workflow record target.
- It uses `loadConversationSessionHistory` / `loadConversationHistoryUntilCard` for missing historical content.
- It then expands and scrolls to the card.

`TaskProgressBar` lacks that materialization step, so clicking G1-G4 can scroll to an empty/promoted build step header or no-op if the target has not entered the card tree. The UI looks like execution details were lost even though the persisted data remains intact.

## Repair Plan

- Keep `tree-writer.ts` and `cardTreeStore` as the single rendered card source.
- Add a goal-pill locate path that:
  - derives the goal's build session ID from `boardStore.board.goalWorkflows[].steps[].payload.buildSessionID`;
  - resolves the current `ConversationAgentRecord` for that session when available;
  - calls the existing `loadConversationHistoryUntilCard` with the rendered card ID, target message ID, session ID, and task directory before scrolling;
  - expands the located step card and its parents before scroll, matching the agent rail behavior;
  - surfaces a warning toast and log entry on missing target or load failure instead of silent no-op.
- Do not hydrate history from `Card.tsx`.
- Add tests that assert goal-pill locate uses session-scoped history materialization and no longer silently ignores missing historical content.

## Verification Plan

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/build-phase-promotion.test.ts`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`

## Verification Results

- Passed: `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/conversation-agent-rail.test.ts packages/overlay/test/build-phase-promotion.test.ts`
- Passed: `bun test packages/overlay/test/conversation-hydrate-replay.test.ts`
- Passed after staging this tracked record file: `bun test packages/opencorvus/test/script/document-health.test.ts`
- Passed: `bun run --cwd packages/overlay check:i18n`
- Passed: `bun run --cwd packages/overlay typecheck`
- Passed: `git diff --check`
