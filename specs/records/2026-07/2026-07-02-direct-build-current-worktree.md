# Direct Build Current Worktree Dispatch

Date: 2026-07-02
Status: Implemented

## Problem

Task-level direct build dispatch for file modification currently reaches
`BuildAgent.run` without `workDir` or `managedWorktree`. `BuildAgent.run`
interprets that shape as build-managed execution and calls `Worktree.create`.
That is correct for goal-scoped pipeline builds, but it is the wrong ownership
boundary for direct `build({ request, directBuildIntent: "modify_files" })`:
the user asked that direct build file modification not create a new worktree.

## Recall

| Item | Details |
| --- | --- |
| User request | Change direct dispatched build file modification so it does not create a new worktree. |
| Acceptance criteria | Task-level direct `build({ request, directBuildIntent: "modify_files" })` passes the current task project directory to `BuildAgent.run` as caller-owned `workDir`; it does not pass `managedWorktree`; `BuildAgent.run` therefore must not call `Worktree.create` for that direct path. Goal-scoped builds keep their existing managed worktree create/reuse contract. Tests must cover the direct dispatch contract and preserve goal worktree behavior. |
| Hard constraints | No fallback or compatibility branch; no host-side gate; no broad git reset; no new git worktree; preserve unrelated dirty workspace changes; inspect landed specs before edits; code changes require tests; do not restart OpenCorvus or overlay processes. |
| Sources read | `specs/README.md`, `specs/records/2026-07/README.md`, `specs/current/architecture/01-agents.md`, `specs/current/architecture/04-extensions.md`, `specs/records/2026-06/2026-06-25-context-recovery-and-worktree-reuse.md`, `specs/records/2026-07/2026-07-01-build-staged-reference-single-source.md`, `packages/opencorvus/src/orchestrator/tools.ts`, `packages/opencorvus/src/build/agent.ts`, `packages/opencorvus/test/orchestrator/tools.test.ts`, `packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`, `packages/opencorvus/test/build-dispatch-fidelity-order.test.ts`. |
| Whole-repository grep | `rg -n 'Worktree\.create\|BuildAgent\.run\|managedWorktree\|directBuildIntent\|modify_files\|kind\s*[:=]\s*"build"\|WorkflowRegistry\.resolve' packages/opencorvus/src packages/opencorvus/test`; `rg -n 'task-level direct build\|directBuildIntent\|build\(\{ request\|Worktree\.create\|managedWorktree\|workDir\|caller-owned' specs/current specs/records/2026-06 specs/records/2026-07 packages/opencorvus/src packages/opencorvus/test -g '*.md' -g '*.ts' -g '*.txt'`; focused reads around `orchestrator/tools.ts` lines 12700-13420 and `build/agent.ts` lines 469-675 / 953-1006. |
| Independent agent feedback | Not obtained. The available multi-agent tool metadata explicitly forbids spawning sub-agents unless the user asks for sub-agents, delegation, or parallel agent work. |

## Causal Chain

1. The orchestrator `build` tool resolves `attachedGoalID`.
2. When there is no `attachedGoalID`, the branch is task-level direct build and sets `target = { kind: "request", text: requestText }`.
3. The same call later invokes `BuildAgent.run({ ..., managedWorktree })`.
4. In the task-level branch `managedWorktree` remains `undefined`, and no `workDir` is supplied.
5. `BuildAgent.run` computes `ownsWorktree = !input.workDir`; with no `workDir`, it calls `Worktree.create({ name: "build-...", taskID, sessionID, reuseIfValid: true })`.
6. That makes a direct file-modification build behave like an isolated managed build, despite the desired caller-owned current-directory semantics.

## Repair Contract

1. In the orchestrator build tool, derive a `directBuildWorkDir` only for
   task-level direct builds from `taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })`.
2. Pass `workDir: directBuildWorkDir` to `BuildAgent.run` for the task-level
   direct branch.
3. Keep `managedWorktree` creation and retry reuse only under the goal-scoped
   branch.
4. Do not change `BuildAgent.run` fallback behavior for other callers in this
   repair. Its existing "no `workDir` means create a managed build worktree"
   remains the default primitive for callers that explicitly use that shape.
5. Update current architecture docs so direct task-level build and goal-scoped
   managed worktree behavior are not described as one undifferentiated path.

## Test Plan

- Extend the existing task-level direct build orchestrator test to assert:
  - `input.workDir` equals the active project directory;
  - `input.managedWorktree` is `undefined`;
  - `onSessionCreated` receives the same directory as the build session workdir.
- Preserve the existing goal-scoped tests that expect `input.managedWorktree`
  to be populated.
- Run focused orchestrator/build tests plus docs link health after updating this record.

## Implemented Fix

1. `packages/opencorvus/src/orchestrator/tools.ts`
   - Added `directBuildWorkDir` for the task-level direct branch only.
   - `directBuildWorkDir` is derived from `taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })`.
   - `BuildAgent.run(...)` now receives `workDir: directBuildWorkDir` for task-level direct builds.
   - Goal-scoped builds still create or reuse `managedWorktree`; no goal branch worktree create/reuse path was replaced.
2. `packages/opencorvus/test/orchestrator/tools.test.ts`
   - The direct Visual QA rework test now asserts `workDir === tmp.path` and `managedWorktree === undefined`.
   - The build mock's `onSessionCreated` helper now mirrors real `BuildAgent.run(workDir)` by reporting the caller-owned `workDir`.
3. `specs/current/architecture/01-agents.md` and `specs/current/architecture/04-extensions.md`
   - Current architecture now distinguishes goal-scoped managed worktrees from task-level direct caller-owned `workDir`.

## Verification

Commands run:

```powershell
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "workflow task-level direct build receives active requirements and Visual QA feedback"
bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "workflow task-level"
bun test packages/opencorvus/test/build-dispatch-fidelity-order.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
bun run --cwd packages/opencorvus typecheck
```

Results:

- Direct task-level build test: pass; it now proves `directBuildIntent="modify_files"` dispatch uses caller-owned current project `workDir` and no `managedWorktree`.
- Workflow task-level build group: 3 pass.
- Goal worktree static dispatch order test: pass.
- Historical docs links: 19 pass.
- Document health: 46 pass.
- Product docs single source: 4 pass.
- `packages/opencorvus` typecheck: pass.
