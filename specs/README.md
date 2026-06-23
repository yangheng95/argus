# Historical specs index

This directory stores implementation notes, product requirements, and investigation records. These files are historical evidence unless a file explicitly says it is the current source of truth.

## Current Sources

| Surface                               | Current source                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Public product docs                   | `packages/web/src/content/docs/**`                                                                                    |
| Architecture map                      | `specs/new-arch/README.md`; historical new-arch notes are indexed in `specs/new-arch/HISTORY.md`                      |
| API reference                         | `packages/web/src/content/docs/{reference/api,zh-cn/reference/api}.mdx`, generated from the OpenAPI generation script |
| Package-local OpenCorvus notes        | `packages/opencorvus/specs/README.md`                                                                                 |
| Retired missing historical references | `specs/retired-reference-ledger.md`                                                                                   |

Do not recreate `docs/product/**`. It was removed on 2026-06-15 because it duplicated the Starlight docs source.

## Root-Level Notes

| File                                                                 | Status                         | Notes                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `coding-agent-tui-independent-plugin-2026-06-06.md`                  | Superseded                     | Superseded by `new-arch/2026-06-10-tui-removal-plan.md`; retained as historical TUI plugin evidence.    |
| `2026-06-10-cancelled-task-message-input.md`                         | Historical implementation note | Cancelled-task composer behavior.                                                                       |
| `2026-06-10-tradingview-world-economy-clone.md`                      | Historical implementation note | TradingView clone task record.                                                                          |
| `bug-hunt-2026-06-17.md`                                             | Current bug-hunt log           | Unattended independent-agent bug hunt findings and verification status.                                 |
| `bug-hunt-repair-plan-2026-06-17.md`                                 | Historical implementation note | Bug hunt repair plan.                                                                                   |
| `cli-entrypoint-lifecycle-2026-06-17.md`                             | Current lifecycle repair note  | CLI and overlay entrypoint lifecycle ownership.                                                         |
| `db-schema-drift-reset-2026-06-03.md`                                | Historical implementation note | Database reset/drift handling.                                                                          |
| `event-log-task-project-directory-2026-06-16.md`                     | Historical implementation note | Event log project-directory correction evidence.                                                        |
| `executor-selector-loading-fix-2026-06-09.md`                        | Historical implementation note | Executor selector loading state.                                                                        |
| `frontend-visual-qa-dedicated-agent-2026-06-08.md`                   | Historical implementation note | Dedicated visual QA agent.                                                                              |
| `goal-batch-wake-natural-message-2026-06-04.md`                      | Historical implementation note | Goal-batch wake copy.                                                                                   |
| `instance-stale-global-worktree-refresh-2026-06-16.md`               | Superseded                     | Symptom repair note superseded by `remove-global-project-sentinel-2026-06-16.md`.                       |
| `mission-panel-parity-2026-05-29.md`                                 | Historical implementation note | Mission panel parity.                                                                                   |
| `mission-project-archive-export-2026-06-18.md`                       | Historical implementation note | Mission archive export.                                                                                 |
| `notification-log-schema-stress-2026-06-17.md`                       | Current benchmark note         | Notification and log schema stress benchmark hardening.                                                 |
| `notification-center-history-contract-2026-06-09.md`                 | Historical implementation note | Notification center history.                                                                            |
| `orchestrator-no-decision-stop-2026-06-18.md`                        | Historical implementation note | Orchestrator no-decision stop root cause.                                                               |
| `operator-wake-open-tool-facts-2026-06-17.md`                        | Current operator-wake note     | Open tool-part facts for real operator wake.                                                            |
| `operator-wake-status-facts-not-scheduler-2026-06-17.md`             | Current operator-wake note     | Status facts must not become scheduling rules.                                                          |
| `overlay-package-size-optimization-2026-06-05.md`                    | Historical implementation note | Overlay package size work.                                                                              |
| `overlay-runtime-notification-message-2026-06-05.md`                 | Historical implementation note | Runtime notification copy.                                                                              |
| `retired-agent-trace-cleanup-2026-06-03.md`                          | Historical implementation note | Retired agent trace cleanup.                                                                            |
| `remove-global-project-sentinel-2026-06-16.md`                       | Historical implementation note | Removal of global project sentinel writes.                                                              |
| `task-execution-terminalization-2026-06-16.md`                       | Superseded                     | Symptom repair note superseded by `remove-global-project-sentinel-2026-06-16.md`.                       |
| `task-global-project-forbidden-2026-06-16.md`                        | Superseded                     | Symptom repair note superseded by `remove-global-project-sentinel-2026-06-16.md`.                       |
| `task-lineage-terminal-notification-2026-06-07.md`                   | Historical implementation note | Terminal lineage notification.                                                                          |
| `task-project-archive-export-2026-06-04.md`                          | Historical implementation note | Task archive export.                                                                                    |
| `task-queue-explicit-wake-no-poll-2026-06-17.md`                     | Current task queue repair note | Explicit A2A queue wake; no background prompt poll or hidden retry loop.                                |
| `task-row-action-rail-visual-alignment-2026-06-05.md`                | Historical implementation note | Task row action rail alignment.                                                                         |
| `tui-home-layout-density-2026-06-06.md`                              | Superseded                     | Superseded by `new-arch/2026-06-10-tui-removal-plan.md`; retained as historical TUI UI evidence.        |
| `tui-tank-battle-usability-case-2026-06-06.md`                       | Superseded                     | Superseded by `new-arch/2026-06-10-tui-removal-plan.md`; retained as historical TUI usability evidence. |
| `amd-replica.txt`, `prd-stock-trading-sim.txt`, `tc_clone_prompt.md` | Prompt/reference artifacts     | Kept as task inputs, not architecture sources.                                                          |

## Maintenance Rules

1. New product documentation belongs in `packages/web/src/content/docs/**`.
2. New architecture decisions belong under `specs/new-arch/**` unless they are package-local implementation notes.
3. If a spec is superseded, add a top-of-file banner in the superseded file and point at the replacement.
4. Missing old external notes should be described as retired external notes, not recreated as empty placeholders.
5. Run `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` after adding, deleting, or moving historical docs.
