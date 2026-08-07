# Anonymous Task Project And Followup Convergence

## Recall

- User request: analyze the Northstar task incident systemically and fix it. User correction: anonymous projects should be different anonymous projects per task, not all placed into one temporary directory. Follow-up request: implement the systemic repair for the newly reproduced Northstar failure rather than patching the individual Task record.
- Acceptance criteria: creating a task while the active workspace is an anonymous project must create a fresh anonymous project for that task; explicit named projects still use the active project route; followup suggestion calls must not fail OpenAI Responses requests with `Store must be set to false`; a Goal must not start a second Build attempt while its latest attempt has no terminal result fact; cancelling a live Goal attempt must write an `aborted` result; a caller-owned `current_project` Build commit must be projected as already published in the primary project; a managed-worktree contribution must remain unpublished until `merge_back`; the Orchestrator must be able to reject one exact terminal Goal attempt before retrying; Goal-scoped research artifacts must remain searchable by that Goal.
- Hard constraints: no shared anonymous temporary directory, no fallback/compatibility path that hides project ownership, no process restart, no destructive git reset, tests required.
- Read records: `specs/records/2026-07/2026-07-25-anonymous-project-chats-promotion-and-attachments.md`, `specs/records/2026-07/2026-07-27-anonymous-project-mission-classification-repair.md`, `specs/records/2026-07/2026-07-25-goal-worker-evidence-continuation-repair.md`, current task debug evidence supplied by user.
- Full-repo grep performed before implementation:
  - `ImplicitProject`, `global/projects/anonymous`, `GlobalTaskService`, `createTask`, `/task`, `/global/tasks`.
  - `followup`, `streamText`, `ProviderLLM`, `store`.
  - `beginBuildAttempt`, `goal_attempt_result`, `abortGoalAttemptExecution`, `TerminalGoalRefill`, `published_commit_ref`, `recordBuildHostObservation`, `current_project`, `managed_worktree`, `complete_goal`, `query_failed_goals`.
  - `persistResearchBrief`, `persistFrontendResearchBrief`, `persistTaskResearchPartial`, `deep-research-stage`, `frontend-research-stage`, artifact catalog `goal_ids`.
- Independent agent feedback: the user explicitly requested an Agent review. A read-only independent reviewer inspected the execution/publication, Goal-attempt lifecycle, research lineage, prompt/schema, and regression surfaces without modifying files or delegating further.

## Evidence

- `ImplicitProject.create()` already creates one dated UUID Git project. The defect boundary is caller selection: overlay `createTask()` always posts to `task`, so a currently active anonymous project can receive multiple unrelated tasks.
- `POST /global/tasks` already creates a concrete implicit project and task in one backend transaction through `GlobalTaskService.create()`.
- `/task/:taskID/followup` uses `streamText()` in `packages/opencorvus/src/task-api/index.ts`; incident logs show OpenAI returned `Store must be set to false`.
- `beginBuildAttempt()` previously allowed a new Build attempt to supersede a latest attempt whose result was still `null`. That permits two Build sessions for one Goal before the scheduler has judged the first terminal evidence.
- `abortGoalAttemptExecution()` cancelled the prompt controller but did not persist the `aborted` result fact required before a later retry.
- `Terminal Goal Refill` exposes unresolved terminal Build attempts, but its current publication projection assumes every `contribution_commit_ref` without `published_commit_ref` belongs only to a managed Goal worktree.
- Northstar Goal attempt `493268f3` disproves that assumption. Its Build dispatch explicitly used `use_worktree=false`; the Build committed `dbf8d0800e7f` directly on the primary project's `main`, and that commit remains the primary repository HEAD. `BuildAgent` nevertheless recorded `published_commit_ref=null` because it only uses `mergedHead`, which exists exclusively for managed-worktree `merge_back`.
- The new unresolved-attempt guard then correctly refused a second Build attempt, but the visible Goal lifecycle exposes completion only. There is no exact Orchestrator rejection action that writes a failed `goal_attempt_result`, so a terminal but unacceptable attempt cannot legally transition to retry.
- The rejected redispatch still created a child Build Session and dispatch lineage before `beginBuildAttempt` refused it, leaving a zero-work terminal DAG node.
- Goal-scoped Deep Research and Frontend Research dispatches persist task-level brief artifacts without the dispatch Goal subject. Artifact Catalog filtering by `goal_ids` therefore returns no match and forces unsafe task-wide discovery.
- The first Northstar research brief explicitly lacked desktop screenshots, computed styles, hover states, and scroll-motion evidence. This did not trigger the infrastructure failure, but it proves visual reference evidence must precede design implementation when the Goal contract depends on layout density, typography hierarchy, and interaction semantics.

## Plan

1. Route anonymous-directory task creation through `global/tasks` so every anonymous task receives a fresh `ImplicitProject`.
2. Preserve explicit project task creation and the existing WorktreeNotGitError init flow only for explicit directories.
3. Set no-store semantics on the followup helper LLM call through the existing provider call options.
4. Add focused tests for anonymous task routing and followup no-store behavior.
5. Refuse to open a new Build attempt over an unresolved latest Goal attempt.
6. Persist `aborted` goal_attempt_result when cancellation reaches the exact live prompt controller.
7. Derive Build publication from the canonical execution location: for caller-owned `current_project`, compare the baseline and terminal Git HEAD and project a changed terminal HEAD as both contribution and published; for a managed worktree, keep contribution and merge publication distinct.
8. Make Terminal Goal Refill render execution location plus exact commit facts. It must not infer that a contribution exists only in a Goal worktree when the attempt has no managed workspace binding.
9. Add an exact `reject_goal_attempt` Orchestrator decision. It must bind the current unresolved attempt ID, require persisted terminal Host evidence, write one failed `goal_attempt_result`, and make the existing retry path legal without weakening the duplicate-attempt invariant.
10. Bind `complete_goal` to the exact current attempt when it completes an unresolved Build attempt so a stale refill cannot complete a newer attempt.
11. Persist the dispatch Goal subject on complete and partial Deep Research / Frontend Research artifacts, validate same-Task ownership, and preserve that exact subject in Artifact Catalog filtering when no Build attempt exists.
12. Move unresolved-attempt rejection ahead of durable child Session creation where the current dispatch architecture permits; otherwise prove the rejected preparation has a visible terminal failure and cannot masquerade as executed work.
13. Add regressions for direct-primary commit publication, managed-worktree non-publication/publication, no-op and uncommitted current-project outcomes, exact rejection followed by retry, stale completion rejection, Goal-filtered research discovery, and the full terminal-refill decision chain.
14. Run targeted engine/orchestrator/research/catalog tests, package typecheck, document-health suites, and a second source/diff review before committing only repair-owned files and pushing through normal hooks to `myhexin`.

## Independent review feedback

- The first review found that Terminal Goal Refill read execution location from a summary that did not project the exact attempt workspace. Fixed by projecting `workspace_dir` from the immutable attempt read model, deriving execution mode from that canonical binding, and rejecting conflicting Host payload claims.
- The first review found that exact `completeGoal` could create a new manual completion when the unresolved attempt had no Build Host observation. Fixed by refusing that transition and proving the original attempt remains unresolved.
- The first review found that same-Task rejection evidence did not necessarily identify the rejected attempt. Fixed by requiring the exact immutable Build Host observation locator for that attempt.
- The second review found that duplicate Build rejection still occurred after worktree/Session side effects. Fixed by rejecting the unresolved latest attempt before workspace or child-Session preparation while retaining `beginBuildAttempt` as the atomic race guard.
- The second review found a prompt/schema mismatch: `goalAttemptID` is required and nullable, but the prompt said to omit it. Fixed by requiring `goalAttemptID=null` only for evidence-backed completion when no Build attempt exists.
- The final review found that current-project direct publication lacked BuildAgent-level three-state coverage. Fixed by extracting the HEAD-derived publication function, using it in BuildAgent persistence, and testing direct commit, unchanged/no-op, missing baseline, and a real uncommitted working-tree change.
- The final review found a concurrent preparation window and two strictness gaps. Fixed by serializing only the pre-attempt preparation interval per Task/Goal, retaining the database-backed `beginBuildAttempt` race guard, testing concurrent dispatch creates one worktree and one Session, validating exact Host evidence before idempotent rejection, testing simultaneous rejections write one result/Decision Log, and rejecting current-project publication without the same contribution ref.

## Verification

- `bun run typecheck` in `packages/opencorvus`: passed.
- 105 focused engine, research, Artifact Catalog, scheduler projection, and tool-description tests: passed.
- Real scheduler duplicate-dispatch regression: passed; no worktree, BuildAgent call, or child Session was created.
- Concurrent scheduler preparation regression: passed; two simultaneous dispatches produced one worktree, one BuildAgent call, one child Session, and one immutable attempt.
- Targeted Orchestrator prompt regression: passed.
- Historical docs link and spec-tree health suite: 22 passed.
