# Scheduled Real-Project End-to-End Repair

## Recall

### User requirement

- “现在的scheduled功能不可用，端到端使用实际项目测试”
- Treat “不可用” as a product-execution failure until evidence proves a narrower
  presentation problem.
- Use the current OpenCorvus repository as the project under test. A temporary
  empty Git fixture is not sufficient acceptance evidence.

### Acceptance criteria

- A Scheduled Automation can be created from the visible Settings → Scheduled
  surface for `/Users/yangheng/Desktop/opencorvus`.
- The automation becomes due by its persisted recurrence and is executed by the
  background scheduler without clicking `Run now` or calling the private
  `runDueNow` test helper.
- The run creates a real persisted Coding Chat for the OpenCorvus project,
  streams a model request, records a successful run, advances `nextRun`, and is
  visible from the same Settings surface after execution.
- The exact created Session opens from run history and shows the model result.
- The test runs with a separately started backend, isolated OpenCorvus data
  directory, and isolated Vite page, so it does not modify the user's live
  database or interfere with the running Overlay.
- A headed Node-driven browser run produces task-scoped screenshots that are
  opened and visually inspected.
- Focused service, route, Overlay, type, API, documentation, and historical-link
  checks pass.

### Hard constraints

- Preserve all unrelated staged, unstaged, and untracked work. Do not stash,
  reset, restore, delete, or broadly stage it.
- Do not stop, restart, refresh, close, or otherwise interact with the user's
  currently running OpenCorvus or Overlay.
- Playwright is started by Node, never Bun.
- Use the real repository directory but an isolated `OPENCORVUS_HOME`; do not
  write test configuration into the repository.
- The local streaming provider is test transport only. It must receive a real
  model request, and must be injected through `OPENCORVUS_CONFIG_CONTENT`.
- Keep `AutomationService` and the existing experimental Automation routes as
  the only persistence and execution owners. Do not add another timer, cron,
  fallback route, compatibility source, gate, or host workflow state.
- Do not use `Run now`, a database edit, or `AutomationService.runDueNow()` as
  proof that scheduled time-based execution works.

### Read records and sources

- `AGENTS.md`
- `specs/records/2026-07/2026-07-27-scheduled-automation-usability-repair.md`
- `specs/records/2026-07/2026-07-28-scheduled-settings-convergence.md`
- `packages/opencorvus/src/project/bootstrap.ts`
- `packages/opencorvus/src/project/instance.ts`
- `packages/opencorvus/src/project/instance-state.ts`
- `packages/opencorvus/src/scheduler/index.ts`
- `packages/opencorvus/src/scheduler/automation-service.ts`
- `packages/opencorvus/src/scheduler/recurrence.ts`
- `packages/opencorvus/src/scheduler/automation.sql.ts`
- `packages/opencorvus/src/server/server.ts`
- `packages/opencorvus/src/server/routes/experimental.ts`
- `packages/overlay/src/services/automations.ts`
- `packages/overlay/src/components/settings/ScheduledAutomationsPanel.tsx`
- `packages/overlay/test/browser/automation-lifecycle-browser.test.ts`

### Repository-wide call-site inventory

| Call site                                                     | Current role                                                       | Disposition                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `InstanceBootstrap` → `AutomationService.init()`              | Initializes one project-scoped scheduled poller                    | Keep; verify the real server request bootstraps it for the actual project.                                       |
| `Scheduler.register()`                                        | Owns interval, runtime re-entry, overlap suppression, and disposal | Keep unless real-project due execution proves a scheduler lifecycle defect.                                      |
| `AutomationService.create/update/list/runNow/listRuns/remove` | Sole public Automation lifecycle owner                             | Keep; exercise create/list/history/delete over real HTTP routes.                                                 |
| `AutomationService.poll/run/claim/execute/executeJobWake`     | Sole due-time execution path                                       | Exercise through elapsed wall-clock time; modify only if the real failure is reproduced here.                    |
| `Recurrence.parse/normalize/nextRun`                          | Sole RFC 5545 recurrence source                                    | Use a seconds-level anchored UTC recurrence in the test; add regression coverage if it cannot advance correctly. |
| `/experimental/automation*` routes                            | Project-scoped HTTP contract                                       | Keep; use the current repository directory on every request.                                                     |
| Overlay `automations.ts`                                      | Project-directory route adapter                                    | Keep; drive it through the visible Settings panel.                                                               |
| `ScheduledAutomationsPanel`                                   | Canonical create/list/history UI                                   | Keep; change only if real browser evidence proves a product defect.                                              |
| Existing `automation-lifecycle-browser.test.ts`               | Temporary-project CRUD and `Run now` acceptance                    | Retain as fast lifecycle coverage; add a separate real-project elapsed-time test so evidence is not conflated.   |

### Independent-agent feedback

- No independent Agent was requested, so none is used. The main agent owns the
  source review, real browser evidence, and final diff review.

## Investigation evidence

- The existing headed lifecycle test passes, but it creates a temporary empty
  Git repository and proves execution only with `Run now`.
- Therefore its PASS does not establish that the background scheduler can wake
  an Automation for a real registered project after wall-clock time elapses.
- The first real-project run proved that `AutomationService` found the due row,
  created the canonical right-sidebar Coding Chat, injected the wake message,
  advanced `nextRun`, and persisted a succeeded history row.
- That run also exposed a test-only constraint: the real project's projected
  Tool schemas exceed the old fixture model's 32k context declaration. Raising
  the local fixture model's declared context made the real streamed request
  complete; no production context limit was changed.
- The product defect was visible-state staleness. While Settings remained open,
  the Scheduled panel never reloaded after its persisted `nextRun`; the
  successful run and new Session were invisible until Settings was closed and
  reopened. This made a working backend schedule appear unavailable.

## Implementation plan

1. Add a Node/Playwright test that uses the current repository as the selected
   project, an isolated backend database, inline local-provider configuration,
   and a future UTC recurrence a few seconds ahead.
2. Create the Automation from Settings, wait for the persisted `nextRun`, and
   observe successful history without any manual run trigger.
3. If the run fails, trace backend log, persisted Automation/run/Session facts,
   scheduler runtime re-entry, and provider requests; repair the single root
   cause and add focused regression tests.
4. Open the exact run Session, assert visible model output, delete the
   Automation, capture screenshots, and inspect them at original resolution.
5. Run focused unit, route, source-contract, type, API, docs, and historical
   document checks; review the final diff.
6. Update both spec indexes, stage only task-owned paths, commit with the
   `dsw-33987` prefix, and push the current delivery branch to `legacy-remote`.

## Implemented repair

- The Scheduled panel now derives its next refresh from the earliest active
  Automation's server-owned `nextRun`.
- The refresh is a one-shot UI observation timer, not another scheduler. At the
  due instant plus a short delivery grace it reloads the canonical Automation
  list and selected run history. If the service has not advanced the due row
  yet, it retries observation without creating, claiming, or executing work.
- Background refresh preserves the current Settings surface and selection
  without showing a loading replacement or requiring a page reopen.
- The existing lifecycle browser test now uses the real OpenCorvus repository,
  isolated backend data, inline provider configuration, and a future UTC
  recurrence. It explicitly forbids `Run now` for the scheduled execution,
  waits for wall-clock delivery, requires the page to update while remaining
  open, opens the exact generated Session, and verifies the visible model
  result.

## Verification

- `bun test packages/overlay/test/scheduled-automations.test.ts`: 8 pass / 0 fail.
- `bun run --cwd packages/overlay typecheck`: pass.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/automation-lifecycle-browser.test.ts`:
  strict E2E PASS against `/Users/yangheng/Desktop/opencorvus`; two real local
  streaming-provider requests; the scheduled standalone run occurred at or
  after its persisted `nextRun` and advanced to the following day.
- Original-resolution screenshots were opened and inspected under
  `specs/artifacts/2026-07-28-scheduled-real-project-e2e/`. They prove the Dock
  entry, canonical Settings destination, real-project owner, advanced schedule,
  in-place succeeded history, exact Session result, and heartbeat ownership.
