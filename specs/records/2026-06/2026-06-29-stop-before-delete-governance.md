# Stop Before Delete Governance

## Recall

- User request: "禁止在停止前删除mission，coding-assistant chat和task".
- Acceptance:
  - `AGENTS.md` records an explicit hard rule that Mission records, Coding Assistant chat sessions, and task records must not be deleted before explicit stop/abort/cancel completion.
  - The rule distinguishes stop from delete: stop completion must be proven by the existing backend settlement evidence before delete/archive/cleanup can run.
  - The new record lives under `specs/records/2026-06/` and the June index links to it.
- Hard constraints:
  - No fallback, compatibility path, or UI masking.
  - No process restart, overlay refresh, database reset, or task/Mission/Coding Assistant deletion during this documentation update.
  - Do not use git reset or create a new worktree.
  - Preserve the existing dirty worktree and stage only this task's changes if committing is possible.
- Sources read:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/records/2026-06/README.md`
  - `specs/current/architecture/03-control.md`
  - `specs/current/architecture/16-unified-teardown.md`
  - `specs/records/2026-06/2026-06-19-task-mission-agent-cancellation-scope.md`
  - `specs/records/2026-06/2026-06-22-delete-active-task-record-context.md`
  - `specs/records/2026-06/2026-06-23-task-stop-agent-settle-validation.md`
  - `specs/records/2026-06/2026-06-23-delete-running-task-settle-root-repair.md`
  - `specs/records/2026-06/2026-06-26-coding-assistant-stop-prompt-state-lifetime.md`
  - `specs/records/2026-06/2026-06-27-stale-session-status-task-delete-root-repair.md`
  - `specs/records/2026-06/2026-06-28-delete-running-task-no-premature-queue-terminalization.md`
  - `specs/records/2026-06/2026-06-29-orchestrator-goal-complete-delete-tools.md`
- Whole-repository search evidence:
  - `rg -n "deleteMission|delete mission|mission delete|delete_task|deleteTask\\(|DELETE /task|delete coding|coding-assistant|coding assistant|abortMission|abort.*mission|stop.*mission|cancelTask\\(|cancel_task|delete_goal|deleteGoal|deleteSession\\(" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs AGENTS.md -S`
  - `rg -n "abortMission|deleteMission|deleteCodingAssistantSession|abortCodingAssistantSession|deleteSession\\(|abort.*coding|cancelTask\\(|deleteTask\\(|DELETE /task|/coding/session|/mission/.*/delete|/mission/.*/abort" packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test -S`
  - `rg -n "stop.*delete|delete.*stop|停止.*删除|删除.*停止|abort.*delete|delete.*abort|stop.*task|task.*stop" AGENTS.md specs/records/2026-06 specs/current/architecture -S`
  - Results show existing stop and delete surfaces are separate for task, Mission, and Coding Assistant sessions; historical records already require stop success to wait for real settlement and delete paths to avoid physical deletion while owned work is still live. No existing AGENTS rule stated this cross-surface ordering constraint.
- Independent agent feedback:
  - Not collected because the active tool policy permits spawning sub-agents only when the user explicitly asks for sub-agents/delegation/parallel agent work. This task is a governance-rule update; local source reading and whole-repository grep are the evidence source.

## Plan

1. Add a new `AGENTS.md` rule under OpenCorvus / overlay runtime boundaries: stopping must complete before deleting Mission records, Coding Assistant chat sessions, or task records.
2. Clarify that delete/archive/cleanup are separate explicit operations and stop failure must preserve records and surface the failure.
3. Add this record to `specs/records/2026-06/README.md`.
4. Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`.

## Validation

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Manual diff review confirming the change is documentation-only and does not delete or mutate runtime records.

## Validation Result

- First run entered the real checker but failed because `packages/opencorvus/test/script/historical-docs-links.test.ts` scanned its own synthetic invalid-path fixtures as repository links.
- Fixed the checker boundary by excluding the guard file itself from repository historical-reference scanning; the synthetic paths remain covered by their direct assertions.
- Re-ran `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 19 pass, 0 fail.
