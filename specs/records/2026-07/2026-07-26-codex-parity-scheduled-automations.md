# Codex-parity Scheduled Automations

## Recall

| Item                          | Evidence and constraint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request                  | “我想加一个定时器功能，对标codex的版本，请你先调查它怎么实现的”，随后明确要求“开一个新worktree做”。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Delivery surface              | Implement a desktop Scheduled Automations experience in the isolated worktree `/Users/yangheng/Desktop/opencorvus-automation-scheduled-tasks` on branch `codex/automation-scheduled-tasks`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Acceptance                    | A user can create, inspect, update, pause, resume, run now, and delete recurring automations; inspect factual run history; choose a standalone run or a same-conversation heartbeat; the Agent-facing `schedule` Tool uses the same service; internal one-shot `wait` wakes keep using that service; the Overlay is verified through a real Vite page and a visually inspected screenshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Hard constraints              | Preserve every parallel edit in the original worktree; no compatibility/fallback parser, second timer source, workflow gate, synthetic hidden message, or restart/refresh/termination of the running OpenCorvus/Overlay. Use a mature RFC 5545 recurrence library. Browser automation runs through Node-backed tooling. Every production change receives regression coverage. Commit subjects start with `dsw-33987`; push the delivery branch to `legacy-remote` through normal hooks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Codex evidence read           | Current Codex desktop bundle `26.721.41059`, CLI `0.146.0-alpha.3.1`, and official [Scheduled Automations documentation](https://learn.chatgpt.com/docs/automations). Codex persists automation definitions separately from runtime scheduling fields, supports RFC 5545 RRULE, `cron` standalone runs and `heartbeat` same-thread runs, Active/Paused lifecycle, run-now/delete/update, and per-run status/inbox history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Existing records read         | `specs/current/architecture/03-control.md`, `07-panel.md`, `13-agent-communication-matrix.md`, `99-principles.md`; `2026-06-04-overlay-tool-agent-timer-single-source.md`, `2026-06-05-terminal-task-wake-p0.md`, and `2026-06-12-wake-causality-agent-retry-mission-scheduler.md`. These require visible natural messages, durable wakes, one scheduling source, and no host-authored scheduler decision state machine.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Full-repository grep          | Searched `CronService`, `CronJobTable`, `ScheduleTool`, `WaitTool`, `/experimental/schedule`, `cron_expression`, `run_at`, `heartbeat`, `automation`, and `scheduled` across `packages/opencorvus/src`, `packages/opencorvus/test`, `packages/overlay/src`, generated SDK/OpenAPI, and `specs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Independent agent feedback    | After the user explicitly required an independent gate, `/root/automation_gate` returned `BLOCKED`. Its required repairs are: anchored `DTSTART` plus `TZID`/DST recurrence stability; heartbeat busy-session delay; run-now without cadence drift; leased-delete atomicity; stale-running reconciliation; heartbeat-to-standalone Session clearing; public/internal delay isolation; preserved Panel surface on delayed wake; execution location, model, and reasoning controls; full test/OpenAPI/SDK/docs/UI/Vite screenshot evidence. Final delivery requires a second review from the same independent gate.                                                                                                                                                                                                                                                                                                                                         |
| Real Vite integration finding | Opening the global Scheduled launcher without an active Task initially failed because the project-scoped Automation API had no directory owner. The repair makes project identity explicit in every Automation service call and adds a project selector populated from the canonical `global/projects/discover` response. The isolated real backend then loaded seeded records and accepted a create, pause, and resume through the rendered UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Final gate corrections        | Independent review blocked manual heartbeat execution while busy, leased update races, active-lease restart reconciliation, run/cadence crash splits, historical owner poisoning, heartbeat/worktree ambiguity, ambient project synthesis, invalid surface fallback, and missing HTTP 409 contracts. The implementation now binds every `automation_run` to its lease `owner`; atomically finalizes the exact run plus cadence/failure in one database transaction; rechecks expired ownership under the reconciliation write lock; closes an old orphan without mutating a newer owner; returns typed conflicts for busy/manual and leased mutations; rejects standalone Session binding; normalizes heartbeat to its exact Session directory and local mode in backend, Tool create/update schemas, and UI; selects only canonical discovered projects; strictly parses persisted Panel surfaces; and publishes 409 for leased update, run, and delete. |
| Remote convergence finding    | Before delivery, `legacy-remote/v0.0.18beta` advanced by seven commits. Its cron-era early Task activity repair claimed a pending wait before dispatch so a rejected or concurrent dispatch could not lose or duplicate the durable wake. The cron files remain deleted; the same single-owner contract was ported into `AutomationService.triggerTaskWaitFromActivity`, with rejected-dispatch retry and concurrent-owner regressions, before merging the updated base. The same upstream range retired the VS Code transport marker still used by SDK generation, so the build now terminates route-policy extraction at the surviving canonical Host native-command marker, with a contract regression.                                                                                                                                                                                                                                                      |
| Final verification            | Independent gate reproduced 41/41 Automation/Tool/API/Overlay tests, both package typechecks, API route/docs checks, and 72 DB/SDK/docs boundary tests. After remote convergence, the expanded Automation/wait/Tool/API/Overlay/SDK/docs matrix passed 215/215; both package typechecks, Overlay i18n and production Vite build, SDK generation, `api:routes-check`, and `docs:check` also passed. The sole earlier matrix failure was an unrelated baseline assertion: `task-api/index.ts` already imported `@/project/bootstrap` in the original base. The final isolated Vite pass selected the canonical project, created `Final Vite acceptance`, paused and resumed it through the real backend, and visually confirmed that heartbeat fixes Workspace to disabled `Current checkout`; final list and heartbeat-form screenshots are stored under `specs/artifacts/`.                                                                               |

## Root-cause finding

OpenCorvus already has a durable lease-based time executor, but the product model
ends at an experimental cron record. The missing feature is not a browser timer:

1. `cron.ts` hand-parses five-field cron and short intervals.
2. `cron_job` mixes user recurrence, internal delayed waits, execution lease, and
   last failure without a public automation lifecycle or run ledger.
3. The route and Agent Tool expose create/list/cancel only.
4. The Overlay has no API wrapper, navigation entry, editor, or history.

Adding another UI timer would create a second source and lose execution when the
window closes. The root repair is to replace the public cron model with one
durable Automation service while preserving internal durable wait semantics as a
typed automation kind.

## Single-source design

### Persistence

- `automation` is the sole time-scheduled definition and execution-lease table.
- `automation_run` records its exact execution owner, factual started/completed
  timestamps, outcome, resulting Session identity, and error.
- User automations store a normalized RFC 5545 recurrence rule with an explicit
  `DTSTART` anchor and either `TZID` or UTC `Z`; the recurrence remains stable
  across process restarts and daylight-saving transitions.
- Internal waits store an explicit due timestamp and `delay` kind; they do not
  serialize a fake cron expression.
- `status` is `active` or `paused`. A completed internal delay is deleted after
  its successful wake; it does not remain as a disabled user automation.

### Execution kinds

| Kind         | Meaning                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `standalone` | Each recurrence creates a new standalone Session and appends the prompt as a visible user message.                                              |
| `heartbeat`  | The recurrence appends the prompt to the exact originating Session as a visible user message. Creation fails when no exact Session is supplied. |
| `delay`      | Internal one-shot `wait` wake for a Task or Session. It is not shown in the Scheduled UI or public automation list.                             |

The executor retains the existing lease, renewal, bounded concurrency, and retry
behavior. Recurrence calculation moves to the mature `rrule` package. All public
mutations go through the same service: create, update, pause/resume, run now, and
delete.

A heartbeat whose exact Session is streaming or retrying is delayed by one
scheduler interval instead of injecting a concurrent prompt. Run-now preserves
the recurrence-owned `next_run`; a manual heartbeat run returns a typed conflict
while the exact Session is busy. Standalone runs may execute in the primary
project or an Automation-owned reusable worktree and may carry an explicit model
and reasoning variant. Heartbeat runs are fixed to local mode because they
inherit the exact Session directory.

Updates and deletes use the execution lease as an atomic mutation boundary. A
definition update that races with a run is rejected instead of letting the old
execution overwrite a newer cadence. Run terminal facts and recurrence/failure
fields commit in one transaction for the exact run owner. Restart reconciliation
preserves a running record while its matching owner lease is valid, rechecks an
expired lease under the transaction's write lock, and applies bounded retry
backoff only for that matching owner. A historical orphan run is closed without
mutating the current owner's cadence or failure fields.

### API and Tool

The experimental cron endpoints are replaced by:

- `GET /experimental/automation`
- `POST /experimental/automation`
- `PATCH /experimental/automation/:id`
- `POST /experimental/automation/:id/run`
- `DELETE /experimental/automation/:id`
- `GET /experimental/automation/:id/run`

The `schedule` Tool keeps its stable Tool identity but replaces cron/interval
parameters with RFC 5545 recurrence plus `standalone`/`heartbeat`, and exposes the
same lifecycle actions. Event-schedule actions remain on `EventService`, because
event matching is not a second time scheduler.

### Overlay

The left Dock context bar receives one Scheduled launcher using the canonical
Button/Icon primitives. It opens a full-screen Scheduled Automations surface
using the canonical Dialog, TextField, SelectControl, Switch, Badge, and Button
primitives:

- explicit project selection from the canonical registered-project discovery
  response, with that directory passed on every scoped Automation request;
- bounded automation list with status and next-run summary;
- selected automation details and run history;
- create/edit form with common recurrence presets and an advanced RRULE field;
- pause/resume, run-now, and armed delete actions;
- loading, empty, success, and error feedback from the canonical server response.

The target is desktop only. No tablet/mobile breakpoints or mobile navigation are
added.

## Exhaustive call-site disposition

| Call site                                                                                  | Disposition                                                                                                                                           |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduler/cron.ts`                                                                        | Delete the custom parser; recurrence calculation moves to `rrule`.                                                                                    |
| `scheduler/cron.sql.ts`                                                                    | Replace with `automation.sql.ts` exporting `AutomationTable` and `AutomationRunTable`.                                                                |
| `scheduler/cron-service.ts`                                                                | Replace with `automation-service.ts`, retaining one lease executor and typed wait entry points.                                                       |
| `project/bootstrap.ts`                                                                     | Initialize `AutomationService` instead of `CronService`.                                                                                              |
| `storage/schema.ts`                                                                        | Export the two Automation tables; remove `CronJobTable`.                                                                                              |
| `tool/schedule.ts`                                                                         | Route time actions to AutomationService and RRULE; retain event actions on EventService.                                                              |
| `tool/wait.ts`                                                                             | Use typed delayed Automation entry points; update visible result vocabulary from cron job to scheduled wake.                                          |
| `scheduler/task-wake-composition.ts`                                                       | Use AutomationService for pending Task waits.                                                                                                         |
| `engine/describe.ts`                                                                       | Project typed delay facts from AutomationTable instead of CronJobTable.                                                                               |
| `orchestrator/tools.ts`                                                                    | Aggregate Automation tables in task diagnostics; remove cron schema import.                                                                           |
| `server/routes/experimental.ts`                                                            | Replace schedule routes/schemas with automation CRUD, run-now, and run-history routes.                                                                |
| `test/scheduler/cron*.test.ts`                                                             | Replace parser/service coverage with RRULE validation, lifecycle, execution kind, run history, lease, retry, and wait coverage.                       |
| `test/tool/schedule.test.ts`                                                               | Replace cron contracts with Automation actions and required message author fixtures.                                                                  |
| `test/server/experimental-schedule-*.test.ts`                                              | Replace with Automation route and OpenAPI contracts.                                                                                                  |
| `test/engine/describe.test.ts`, orchestrator wait tests, DB boundary test, schema snapshot | Update the sole table/service name and preserve wait evidence assertions.                                                                             |
| `packages/sdk/openapi.json`, generated SDK, public API docs                                | Regenerate from the runtime route source; do not hand-maintain a second contract.                                                                     |
| `packages/overlay/src/services`                                                            | Add a typed Automation wrapper over `apiJson`; require an explicit project directory on every request; no ambient-directory fallback or direct fetch. |
| `packages/overlay/src/components/App.tsx`                                                  | Add the Scheduled launcher and host.                                                                                                                  |
| Overlay i18n and HTML/CSS                                                                  | Add localized strings and one Scheduled surface stylesheet linked by the canonical HTML entry.                                                        |
| Overlay tests                                                                              | Cover launcher/host wiring, API paths, primitive use, recurrence builder, lifecycle actions, and surface constraints.                                 |

## Verification

1. Focused Automation service, Tool, route, wake, engine, DB-boundary, and schema
   tests. Recurrence tests also execute subprocesses under UTC,
   America/Los_Angeles, and Asia/Singapore host time zones so both absolute UTC
   and floating TZID semantics remain stable.
2. Overlay unit/contract tests plus typecheck and production Vite build.
3. OpenAPI/SDK generation, route check, document-health and historical-doc-links
   tests.
4. Launch an isolated Vite server and an isolated OpenCorvus backend from the new
   worktree, open the Scheduled surface in the in-app browser, select the owning
   project, and exercise real create, pause, and resume API paths. Capture and
   personally inspect the desktop list/detail, create-form, and heartbeat local
   execution constraint screenshots, then iterate until the density and
   interaction hierarchy are correct.
5. Re-run focused tests after visual changes, inspect the complete diff, commit
   with `dsw-33987`, and push the branch to `legacy-remote` through normal hooks.

## Left Dock usability addendum

### Recall

- User request: move Automation into the actual left Dock and require an
  independent Agent to perform end-to-end acceptance that explicitly covers
  usability and ease of use.
- Acceptance: one labeled Automation row in `aside#sidebar #workLedgerPanel`
  before Projects; no duplicate context-bar launcher; mouse and keyboard open;
  a visible Close action, Escape support, and focus return; one-step access to
  the list and no more than two activations to create; actionable loading,
  empty, no-project, and error states; common daily, weekdays, and weekly
  schedules edit without exposing RRULE; heartbeat shows and validates its
  exact project and Session target; real create, pause, reload, resume, edit,
  run-now, delete, persistence, and restart evidence; 1440x900 screenshots for
  Dock, list/detail, default create, and heartbeat; no page, console, or failed
  network errors.
- Hard constraints: the Dock row and Dialog remain the single UI source;
  canonical Button, Icon, Dialog, SelectControl, and TextField primitives are
  retained; the desktop-only boundary remains; no state machine, fallback,
  hidden message, temporary iframe, local signal, query override, or mock may
  be represented as end-to-end evidence; all browser automation runs through
  Node and an isolated real Vite/backend pair; the user's running OpenCorvus
  process is not restarted or modified.
- Read before implementation: this plan, `App.tsx`, `WorkLedger.tsx`,
  `ScheduledAutomationsHost.tsx`, `Dialog.tsx`, `automation-recurrence.ts`,
  Automation i18n, the Dock/navigation and Automation styles, and the existing
  Overlay Automation and left-Dock tests.
- Exhaustive repository search: `scheduled-automations-toggle` exists only in
  `App.tsx` and its Automation contract test; the real static Dock rows live
  only in `WorkLedger.tsx`; `oc:open-scheduled-automations` is emitted by the
  launcher and consumed only by `ScheduledAutomationsHost`; recurrence
  construction and summary live only in `automation-recurrence.ts`; active
  Session and task-root Session identities come from `store/board.ts`, while
  their canonical owning project directory is projected by
  `services/project-directory.ts`; all Automation API calls require the
  explicit selected project directory.
- Independent Agent feedback: initial status is BLOCKED. The Agent identified
  the misplaced icon-only entry, duplicate-entry risk, absent visible
  Close/Back control and focus-return evidence, forced custom RRULE on edit,
  invisible heartbeat target identity, weak error/no-project recovery, and
  source/mock-only tests. Its final gate is G0-G15 and requires fresh real
  browser and persistence evidence before it may report PASS.

### Left Dock call-site disposition

| Call site                                 | Disposition                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/App.tsx`                      | Delete the context-bar Automation icon; retain search and mailbox actions.                                                                                                                      |
| `components/WorkLedger.tsx`               | Add the sole full-width labeled Automation row after New Mission and before shortcuts/Projects.                                                                                                 |
| `components/ScheduledAutomationsHost.tsx` | Add visible close/focus return, project recovery, common recurrence restoration, and exact heartbeat target presentation/validation.                                                            |
| `services/automation-recurrence.ts`       | Add the inverse projection for supported presets; unknown valid recurrence remains the explicit Advanced RRULE choice.                                                                          |
| `i18n/en-US.json`, `i18n/zh-CN.json`      | Add user-language close/retry/target and project-mismatch explanations only where existing common strings are insufficient.                                                                     |
| `styles/surfaces/automations.css`         | Style target/recovery details with existing surface tokens; do not introduce another navigation style.                                                                                          |
| Overlay unit/contract/browser tests       | Assert unique Dock ownership, ordering, keyboard geometry, preset round-trip, recovery controls, and heartbeat identity; real browser evidence remains separate from fixture/contract coverage. |

### Final verification required

The independent Agent must rerun G0-G15 against the final exact commit after the
main Agent completes real Node/Vite/backend interaction and visually inspects
fresh 1440x900 screenshots. Any failed item remains an explicit blocker; it may
not be reclassified as an accepted variance.

### Main Agent verification evidence

- The real Vite page at `http://127.0.0.1:5173` used the real isolated backend
  at `http://127.0.0.1:7878` and a dedicated portable data root. The Automation
  Dock row measured 244x36 pixels; the 280-pixel sidebar and page had no
  horizontal overflow. The launcher is the only visible Automation entry.
- The rendered lifecycle completed create, pause, page reload with Paused
  preserved, resume, edit from the restored Every day form to Weekdays, Run now,
  backend restart with definition and run history preserved, armed two-click
  delete, and page reload with the record absent.
- The first Run now intentionally covered the real missing-default-model error:
  the surface kept the selected definition visible and presented an inline
  Retry action. After the same definition received explicit
  `openai/gpt-5`, a real Run now completed successfully with visible Session
  `ses_f9d41661a0017PHUYnHSuA9FzR`; history retained both the factual earlier
  failed attempt and the succeeded attempt.
- A project-discovery timeout in a second concurrent tab presented Retry and
  disabled creation. Closing the competing tab and activating Retry recovered
  the canonical project and empty list. The final fresh page reported no
  browser console errors.
- The canonical Dialog's visible Close action returned focus to
  `data-ui="work-ledger-automations"`. The Dock row is a native Button with a
  localized accessible name, standard focus-visible treatment, and the same
  navigation hierarchy and geometry as its neighboring rows.
- Fresh 1440x900 screenshots were visually inspected and contain no clipping,
  overlap, or horizontal scrolling:
  `specs/artifacts/2026-07-26-scheduled-automation-left-dock.png`,
  `specs/artifacts/2026-07-26-scheduled-automation-default-create.png`,
  `specs/artifacts/2026-07-26-scheduled-automation-list-detail.png`, and
  `specs/artifacts/2026-07-26-scheduled-automation-heartbeat-target.png`.
- Same-Session heartbeat was exercised through the rendered UI against the
  selected project Chat `ses_062a7457effeMYUsNfqJfBYohx`. The edit form
  exposed that exact Session and
  `/Users/yangheng/Desktop/opencorvus-automation-scheduled-tasks` as the target,
  fixed Workspace to Current checkout, and enabled Save only with the matching
  project. Run now succeeded with the same Session in visible run history.
  Durable evidence showed Session count 2→2, `engine_task` count 0→0, and the
  exact Session message count 0→1 with
  `wake_reason.source="scheduler.automation"`; no replacement Session or
  Mission/Task record was created.
- Dedicated-worktree standalone execution was also triggered through the
  rendered UI. Run history succeeded with a new Session
  `ses_f9d5daf20001e4BPXxwhEt55J3`; Session count changed 2→3. Its persisted
  directory is the distinct managed worktree
  `/Users/yangheng/Desktop/opencorvus/.opencorvus/.r/w/automation-atm-f9d5da4c4001uyav0gxvbb8iyz`.
  Both `GET /project/current/worktrees` and `git worktree list --porcelain`
  reported the directory as a managed worktree on branch
  `opencorvus/automation-atm-f9d5da4c4001uyav0gxvbb8iyz`, rather than the
  current checkout.
- The same-Session target, same-Session succeeded history, and dedicated
  worktree succeeded history were visually inspected at 1440x900:
  `specs/artifacts/2026-07-26-scheduled-automation-heartbeat-target.png`,
  `specs/artifacts/2026-07-26-scheduled-automation-heartbeat-run.png`, and
  `specs/artifacts/2026-07-26-scheduled-automation-worktree-run.png`.
- The independent G0-G15 rerun released G11 and G12 but correctly kept G14
  blocked: both long list titles forced the full Active Badge past the
  299-pixel item boundary (measured Badge right edges 340.78 and 306.66), and
  the first screenshot visibly clipped the Badge to “A”. The root repair gives
  the title flex item `min-width: 0` plus a shrinkable width and keeps the Badge
  non-shrinking. A Node-driven 1440x900 browser regression now requires the
  complete Badge to remain inside the list item while the long title ellipsizes.
  The real Vite page remeasured both Badge right edges at 286 within the
  299-pixel items, retained the full “Active” label, and the three affected
  screenshots above were regenerated and visually reinspected.
- Final independent Left Dock verdict: G0-G15 all PASS. The same read-only Agent
  independently remeasured both rows at 1440x900 (`itemRight=299`,
  `badgeRight=286`, full `Active`, Badge client/scroll width 46, title
  client width 209 with scroll widths 264 and 230), confirmed title ellipsis,
  zero page/list horizontal overflow, no screenshot clipping or overlap, and no
  browser console warnings/errors. G11 and G12 remained backed by the exact
  Session, database, API, and Git worktree evidence above.
- Focused Automation/Dock contracts pass 25/25; Overlay TypeScript and i18n
  checks, production Vite build, the Node-driven left-Dock browser geometry
  test, and historical document link/structure checks pass.
