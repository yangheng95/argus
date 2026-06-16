# Task Global Project Rebind - 2026-06-16

## Problem

Task `tsk_ecefdca56001FewJ8LlB0AozSE` was created while its directory was still
cached as the global pseudo-project (`project_id="global"`, worktree `/`). The
directory later resolved to the real Git project
`15ac4076a1e5bf1ea4eccd7fe36d5d8187fe12ce`, and per-goal worktree creation
succeeded, but the task row and screenshot system artifacts still pointed at
`/attachment/global/...`.

The latest G1 retry failed before implementation:

`AttachmentStore.stageToWorktree: attachment url-www_tradingview_com-1781589242317.png belongs to project global, expected 15ac4076a1e5bf1ea4eccd7fe36d5d8187fe12ce`

## Call-Site Audit

Command:

```powershell
rg -n "createTask|EngineTaskTable|project_id:|projectID: Instance\.project\.id|Project\.fromDirectory|handleTaskMessage|Operator message reopened failed task|reopened failed task|resume|requeue|task.message" packages/opencorvus/src/engine packages/opencorvus/src/task-api packages/opencorvus/src/server/routes packages/opencorvus/src/orchestrator packages/opencorvus/src/tool -g "*.ts" -S
rg -n "AttachmentStore\.write|writeFromPath|writeFromBytes|system_artifacts|attachments:" packages/opencorvus/src/frontend-design packages/opencorvus/src/engine packages/opencorvus/src/task-api packages/opencorvus/src/session packages/opencorvus/src/tool -g "*.ts" -S
```

Relevant findings:

| Area | Evidence | Decision |
| --- | --- | --- |
| Task creation | `task-api/index.ts::createTaskInner` persists `projectID: Instance.project.id`. | Existing `Instance` refresh prevents new stale-global tasks once the directory is a Git repo. |
| Operator message resume | `task-api/index.ts::handleTaskMessage` reads `requireTask(taskID)` before appending follow-up attachments or waking the task. | This is the right repair boundary for old contaminated tasks before another retry. |
| File reference registration | `mergeTaskFileRef` rejects `file.url` project mismatch against `task.project_id`. | Keep this strict; do not bypass it. |
| Build staging | `build/agent.ts` invokes `AttachmentStore.stageToWorktree(Instance.project.id, ...)`. | Keep staging strict; it surfaced the real task/project split. |
| Attachment storage | `AttachmentStore.write/read/nameFromUrl` are the single source for stored bytes and URLs. | Re-materialize old global task refs into the real project through AttachmentStore, then rewrite task refs. |
| Sessions | `session.project_id` is scoped by project and used by session tree queries. | Rebind the task root session tree together with the task row. |

## Fix

Before accepting an operator task message, detect the narrow legacy shape:

- task row has `project_id="global"`;
- the task root session has the same directory as the active `Instance`;
- the active `Instance.project.id` is not `global`;
- the root directory now resolves to a real Git project.

Then perform one data-integrity rebind:

- update `engine_task.project_id` to the active project;
- update every session in the task root tree to the active project;
- copy task `attachments` and `system_artifacts` bytes from `/attachment/global/...`
  into the active project AttachmentStore and rewrite their URLs to
  `/attachment/<active-project>/...`.

This is not a fallback path:

- non-global tasks are untouched;
- active global tasks in non-Git directories remain global;
- attachment project mismatch remains a hard error everywhere else;
- build staging still never guesses alternate projects.

## Acceptance

- A legacy global task rooted in a directory that later becomes a Git project
  is rebound before operator-message retry.
- Rebound task attachments and system artifacts resolve under the real project,
  not `global`.
- The root session tree is rebound with the task row.
- `AttachmentStore.stageToWorktree` continues to reject mismatched project refs.
