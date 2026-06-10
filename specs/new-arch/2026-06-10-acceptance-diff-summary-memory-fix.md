# Acceptance Diff Summary Memory Fix

## Evidence

- The live `opencorvus.exe` serving port 7878 moves between roughly 2 GB and 4 GB working set within one-second samples, while handle and thread counts stay stable. That points to large transient allocations and garbage collection churn, not a simple handle leak.
- The task tree for `tsk_eb0b5db4a001llno0GgFW2n14w` has modest protocol/message volume: hundreds of messages and small `protocol_event` payloads.
- The local database contains one outlier `engine_artifact` row:
  - `id=dlv_eb1035802001AJoUIgqgDEbl4q`
  - `kind=acceptance`, `label=acceptance-goal_run`
  - `length(payload)=92263305`
- That payload stores `result.diffs[]` entries with full `before` and `after` file contents. Reading board, conversation, or acceptance state parses the 92 MB JSON payload into many large JavaScript strings and objects, which explains the fast GB-scale memory oscillation.

## Call-Site Sweep

| Surface | Current behavior | Change |
| --- | --- | --- |
| `engine/persist.ts::writeAcceptanceRow` | Stores `input.acceptance.diffs` in acceptance result, `workspace-diff`, and `changed_file` artifacts. | Store only diff summaries: `file`, optional `status`, `additions`, `deletions`. |
| `engine/persist.ts::finalizeBuildAttempt` | Filters runtime paths but keeps full `before` and `after` strings in per-goal acceptance result. | Filter first, then persist diff summaries only. |
| `engine/engine.sql.ts::AcceptanceResult` | Type allows `before`, `after`, and `diff`. | Type accepts summary fields only. |
| `engine/model.ts::Acceptance` | Reuses snapshot `FileDiff`, which requires full file contents. | Use an acceptance-specific summary schema. |
| `engine/store.ts::viewAcceptance` | Parses acceptance diffs as snapshot full diffs. | Parse summaries so read models match persisted shape. |
| `workbench/board.ts`, `integrity/replay-context.ts`, `orchestrator/tools.ts` | Read file names and stats from `result.diffs`. | Continue reading the same summary fields. |

## Decision

Acceptance artifacts are delivery evidence, not blob storage for file contents. The single persisted source for acceptance file changes is a bounded diff summary. Full content remains recoverable from the referenced workspace and commit, and callers that need file names or stats keep the same `result.diffs[]` location without carrying `before`, `after`, or raw `diff` text.

## Validation

- Add regression coverage to `finalizeBuildAttempt` proving runtime paths are filtered and full file bodies are not persisted.
- Add task-level acceptance coverage proving `persistTaskAcceptance` stores summaries in acceptance, workspace-diff, and changed-file artifacts.
- Run the targeted engine tests and typecheck.
