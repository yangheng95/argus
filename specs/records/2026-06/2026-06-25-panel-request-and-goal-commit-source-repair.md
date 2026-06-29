# Panel Request and Goal Commit Source Repair

Date: 2026-06-25

## Incident

Task `tsk_efc330510001Ow79mN0qrMPBzZ` exposed two concrete algorithm issues:

1. A `panel.create_task` request can be overwritten by ambient
   `ctx.extra.originalText` before `EngineService.createTask()` persists it.
   That violates the task-request single-source rule from
   `2026-06-15-mission-create-task-request-fidelity.md`.
2. Goal debug/board showed G1 `commitRef=a393474` while
   `changedFileDiffs/diffStats` described the contribution commit `f6eef2c`.
   The acceptance row mixed a merge/published commit ref with
   contribution-scoped diffs.

## Call-Point Inventory

Searches run before code changes:

- `rg -n "originalText|params.request|create_task" packages/opencorvus/src/tool packages/opencorvus/src/control packages/opencorvus/test/panel`
- `rg -n "commit_ref|publishedCommitRef|worktreeHead|collectGoalContributionDiffs|finalizeBuildAttempt|changedFileDiffs|diffStats" packages/opencorvus/src packages/opencorvus/test`

Relevant call points:

| Area                   | File                                                                                     | Finding                                                                                                                | Repair                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Panel task creation    | `packages/opencorvus/src/tool/panel.ts`                                                  | `baseRequest = originalText                                                                                            |                                                                                                                               | params.request`makes`ctx.extra.originalText` a second task-request source. | Use only `params.request`; text attachments append after it. |
| Control prompt         | `packages/opencorvus/src/control/message.ts`                                             | The control agent receives the original text in visible prompt parts.                                                  | No host overwrite. If request quality is weak, fix the control/intent prompt, not `panel.ts`.                                 |
| Task API               | `packages/opencorvus/src/task-api/index.ts`                                              | Persists input request faithfully.                                                                                     | No change.                                                                                                                    |
| Contribution diff      | `packages/opencorvus/src/build/agent.ts`                                                 | `collectGoalContributionDiffs()` unwraps merge commits and computes contribution-scoped diffs.                         | Keep as source for per-goal file changes.                                                                                     |
| Published commit fact  | `packages/opencorvus/src/build/agent.ts`                                                 | Managed worktree `result.commit_ref` is rewritten to merged primary HEAD; `publishedCommitRef` also carries that fact. | Treat published ref as publish fact, not per-goal diff commit.                                                                |
| Goal finalization      | `packages/opencorvus/src/orchestrator/tools.ts`                                          | Passes `result.commit_ref` to `finalizeBuildAttempt()` together with contribution diffs.                               | Pass the contribution commit (`HEAD^1` for merge commits, `HEAD` otherwise) to acceptance; keep published ref in tool result. |
| Board/debug projection | `packages/opencorvus/src/workbench/board.ts`, `packages/overlay/src/utils/debug-info.ts` | Reads acceptance `commit_ref` and diffs as one group.                                                                  | No projection change needed once acceptance writes a same-source commit.                                                      |

## Required Semantics

1. `params.request` is the only request source for `panel.create_task`.
2. `ctx.extra.originalText` may remain visible to the control agent, but it must
   not override `params.request` in the panel tool.
3. Goal acceptance `commit_ref`, `changed_files`, `diffs`, and `stats` must
   describe the same contribution range.
4. Published merge HEAD remains visible as `published_commit_ref` in the build
   tool result, not as the per-goal acceptance `commit_ref`.

## Verification

- Add panel test proving ambient `originalText` cannot override
  `params.request`.
- Add goal finalization/projection test proving contribution commit and
  contribution diffs are stored together.
- Run targeted tests and package typecheck.
