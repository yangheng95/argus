# Task Activity and Mission Completion Semantics

## Recall

- User request: modify scheduler and Mission wording so a Task has only two user-facing states, running and not running. A Task is expected to finish its own delivery; only force majeure may prevent completion.
- Acceptance:
  - Task and Mission public status projections, Work Ledger presentation, and visible labels expose only `running` / `inactive` semantics and never classify a Task as successful or failed.
  - Raw `queued`, `active`, `completed`, `failed`, and `cancelled` lifecycle facts remain available only as diagnostic and recovery evidence.
  - The scheduler keeps recoverable findings, interruptions, and tool failures inside the same Task and bound dispatch lineage until the delivery completes.
  - `fail_task` is an exceptional physical stop for evidenced force majeure, not a normal business outcome or an alternative to repair.
  - Mission accepts outcomes from canonical evidence, re-enters an inactive but unaccepted Task when repair remains possible, and reports force-majeure blockers without inventing a failed Task business state.
  - The real Overlay is opened and manually reviewed with current screenshots for both binary labels.
- Hard constraints: preserve every parallel worktree change; do not create a worktree, fallback, compatibility alias, gate, status machine, or second Task-status source; do not restart or mutate the production runtime; do not add, update, or run User Interface (UI) automation tests; retire UI tests discovered in the touched status surface; keep physical lifecycle facts for diagnosis and recovery.
- Sources read:
  - `specs/current/architecture/03-control.md`
  - `specs/current/architecture/07-panel.md`
  - `specs/records/2026-08/2026-08-02-same-task-repair-first-orchestration.md`
  - `specs/records/2026-08/2026-08-02-large-build-observation-and-interrupted-task-recovery.md`
  - `specs/records/2026-08/2026-08-03-work-ledger-task-running-spinner.md`
  - scheduler, Mission, built-in Expert Squad Orchestrator overlays, Task lifecycle tools, status projections, transport protocol, Work Ledger service, Task status header, routes, and their positive non-UI contract tests.
- Whole-repository search evidence:
  - `StatusSnapshotState`, `statusFromTaskLifecycle`, `MissionTaskCounts`, and `MissionStatusSnapshot` own the current `success | failed | running` public status.
  - `MissionTaskProjection`, `MissionTaskStats`, `WorkLedgerExecutionStatus`, `WorkLedgerTaskStats`, and `WorkLedgerTaskRow.executionStatus` duplicate that three-way presentation into Mission and Work Ledger transport.
  - `workLedgerPresentationStatus`, `workLedgerPresentationLabel`, and `TaskStatusHeader` turn raw terminal reasons into visible `Completed`, `Failed`, or `Cancelled` labels.
  - `orchestrator-core.txt`, `mission-core.txt`, the three built-in Orchestrator overlays, and `fail_task` descriptions still describe completion and failure as parallel scheduler outcomes.
  - raw physical lifecycle owners in `engine/task-status.ts`, Engine tables, events, retry/recovery, and terminal persistence are diagnostic infrastructure and must remain unchanged.
  - generated OpenAPI and embedded Expert Squad payloads derive from the owned source files and must be regenerated rather than edited.
- UI automation discovered in the touched status surface: Work Ledger runtime/status/service fixtures and browser fixtures, Mission pagination/action fixtures, and the `TaskStatusHeader` source-string duration test. They will be deleted with any fixture-only dependents and will not be run.
- Independent agent feedback: none requested; no sub-agent was used.

## Root cause

The Host correctly preserves several physical lifecycle endings, but the public status layer promoted those diagnostic endings into three business states. Scheduler and Mission prompts then treated failure as an ordinary alternative to completing the owned delivery. That lets a recoverable finding escape the Task instead of remaining under its one fixed owner.

The repair separates two meanings:

1. **Activity** answers only whether the Task is currently executing: `running` or `inactive`.
2. **Lifecycle diagnostics** preserve how an inactive Task reached its current physical record so recovery, auditing, and force-majeure explanation remain possible.

Acceptance is neither activity nor lifecycle. Mission and the Task Orchestrator judge acceptance from canonical Artifacts, visible worker results, tool evidence, and the completion decision.

## Call-site disposition

| Surface | Current behavior | Disposition |
| --- | --- | --- |
| `status/task-status-snapshot.ts` | Normalizes lifecycle to `success`, `failed`, or `running` | Replace with binary `TaskActivityState`; keep `lifecycleStatus`; give Task/Mission activity progress only `running` and `inactive`; keep Delivery Slice evidence progress separate. |
| `mission/projection.ts` | Exposes raw `status`, three-way `executionStatus`, and six lifecycle counts | Expose binary `activityStatus`, explicit diagnostic `lifecycleStatus`, and `{ total, running, inactive }` counts. |
| `transport-protocol/src/index.ts` | Carries three-way execution status and six-way Mission counts | Rename to binary activity status and counts; retain raw Task lifecycle field. |
| `work-ledger/projection.ts` | Copies three-way execution status | Project the one binary activity owner into each Task row. |
| `overlay/services/work-ledger.ts` | Converts failed/completed/cancelled into visible business labels | Present only `active` / `inactive`; Mission is active when its Session or a child Task is active; labels are `Running` / `Not running`. |
| `TaskStatusHeader.tsx` | Uses terminal label classes to choose elapsed-time behavior | Use raw diagnostic timestamps for duration while the visible status remains binary. |
| Task/Mission status routes | Document three normalized states | Document binary activity and diagnostic raw lifecycle explicitly. |
| scheduler core and package overlays | Permit ordinary final completion/failure decisions | Require same-Task completion; describe failure only as an evidenced force-majeure physical stop. |
| Mission core and General Mission Skill | Reconcile terminal success/failure and count status as acceptance | Reconcile inactive Tasks against evidence; re-enter recoverable work; mark Mission blocked only for evidenced force majeure. |
| `fail_task` tool descriptions | Describe failure as a phase-closure result | Restrict to force majeure outside Task authority and require exact evidence. |
| Engine lifecycle, events, retry, terminal persistence | Preserve physical endings | Keep unchanged as the diagnostic and recovery source. |
| generated contracts and embedded payload | Mirror owned schemas/prompts | Regenerate with repository generators. |

## Implementation

1. Replace the public three-state Task/Mission status schemas with one binary activity schema and separate Task/Mission activity progress from Delivery Slice evidence progress.
2. Propagate the renamed binary fields through Mission records, Work Ledger transport, backend projection, Overlay presentation, route descriptions, and localization.
3. Rewrite scheduler, Mission, General Mission Skill, and built-in package wording around a same-Task completion invariant and a narrow, evidenced force-majeure stop.
4. Regenerate embedded Expert Squad payload and OpenAPI/software development kit artifacts from their source owners.
5. Update positive non-UI schema, route, prompt, and transport contracts. Delete discovered UI automation instead of updating or running it.
6. Run targeted non-UI contracts, typechecks, generators, document health, and a second source review.
7. Start the real Vite Overlay against an isolated backend, inspect running and inactive Task/Mission presentation, capture screenshots, and review them manually.

## Verification

- `bun run typecheck` in `packages/opencorvus`: passed.
- `bun run typecheck` in `packages/overlay`: passed.
- Targeted transport, Task/Mission status, Mission route, Mission prompt, and Orchestrator prompt contracts: 66 passed, 0 failed.
- `historical-docs-links` and `product-docs-single-source`: passed. `document-health` passed 64 of 65 checks; its tracked-record check also sees the pre-existing untracked parallel record `2026-08-02-live-event-control-plane-resource-convergence.md`, so that one check remains blocked until its owner commits the linked record.
- Real Vite Overlay at `http://localhost:5173/` connected to a local server on port 17878. Manual Document Object Model (DOM) inspection and screenshots confirmed an inactive Mission renders `Not running`, while a running Mission renders `Running` and the existing spinner; completed, failed, and cancelled lifecycle lamps are absent.
- Runtime caveat: although the local server used an isolated `--project-dir`, the current configuration still opened the canonical global database and resumed Task `tsk_fc35bb78b001yROT1q9clonUgk`. The server was stopped immediately after visual review; shutdown persisted the normal process-recovery wake. No attempt was made to rewrite or erase that live evidence.
