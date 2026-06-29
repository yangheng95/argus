# Runtime Isolation Second Repair

Date: 2026-06-20

## Codex Review Feedback

The initial draft treated `queue=false` direct start and `startQueuedTaskNow`
parallel activation as isolation defects. The goal was then clarified to
support same-project multi-task parallel work. Serializing every same-cwd task
would be a gate and would not fix the runtime-interference root cause.

Queue admission changes are therefore rejected in this repair. The backend
must preserve explicit parallel starts and fix shared/ambient runtime reads and
project-scoped lookup leaks instead.

## Problem

Multiple task-runtime paths still allow same-directory tasks to affect each
other:

- Project-scoped run and goal-run HTTP routes resolve rows by global IDs before
  proving the backing task belongs to the active project.
- Session trace reads validate neither the owning task nor the task primary
  runtime before reading the trace index.
- Goal-path build prompt composition gives managed-worktree executors relative
  frontend-design runtime paths. Those paths resolve inside the goal worktree
  instead of the task primary project runtime, so sibling same-project builds
  can miss or misread frontend-design evidence.
- Overlay service calls for browser preview, queue start-now, and trace panels
  still depend on the globally configured API directory even when the row/panel
  already has a task directory. Their cache/request key includes task/session
  identity but not the project directory, so stale selected-project state can
  mis-route requests or reuse trace data across runtime roots.
- `/task/:taskID/events` opens a task-scoped SSE stream before proving the task
  belongs to the request project. A stale overlay selection can therefore keep
  listening to another project's task message changes under the wrong project
  directory.
- Browser-preview capture has two job-directory allocation sites:
  `verification-core.ts` allocates an old `taskAbsolute(..., "browser-preview",
captureID)` directory and passes it to the capture job, while
  `evidence-runner.ts` allocates a separate `browserPreviewJobRoot(...)`
  directory and uses that one. The unused old directory is a latent double
  source for task runtime evidence.
- Frontend-design and research task artifacts still have call sites that pass
  `Instance.directory` into runtime helpers even when `taskID` is available:
  frontend-design trace/report/materialized manifests, skeleton package
  defaults, visual-region binding packages, research PRD evidence, and
  research bundles can split a single task's artifacts between the primary
  project runtime and a managed-worktree runtime.
- Overlay still has project-scoped services that accept only IDs and depend on
  the global directory injection path: mission/task status, executor config,
  session config, task operator model context, conversation history/tail,
  selected-source SSE, coding-assistant row actions, and the legacy memory
  service. Row actions already have a stable directory on the row; the service
  contract must carry it explicitly.
- Some tests still validate the old contracts rather than the runtime
  isolation contract: task trace tests call `AgentTrace.readSessionEvents`
  without `taskID`, runtime-isolation route tests lack owning-project positive
  assertions, and browser-preview route tests only cover the target GET route
  for cross-project rejection.

These are not UI-only issues. They are data-contract leaks in the backend
admission and lookup paths.

## Recall

- The pre-June task session runtime isolation record: task runtime files are scoped
  by task/session IDs under the project runtime root.
- `2026-06-15-opencorvus-short-runtime-layout.md`: current runtime layout is
  `.opencorvus/r/t/<task-key>/...`; legacy paths must not become read
  fallbacks.
- `task-global-project-forbidden-2026-06-16.md`: task workflow state must be
  bound to a concrete project, never global.
- `event-log-task-project-directory-2026-06-16.md`: project directory must be a
  request-scoped selector, not an ambient default.
- `task-queue-explicit-wake-no-poll-2026-06-17.md`: terminal task wakes are
  explicit operator actions and must enter the task loop via the task queue
  path.

## Call-Point Audit

Commands run before writing this plan:

- `rg -n "persistQueuedTask" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "advanceQueue\\(" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "claimQueuedTaskForCwd|startQueuedTaskInCwd|dispatchTaskLoop" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "requireRun|findAcceptanceByRun|findGoalRun|findArtifacts|findEvaluations|abortRun" packages/opencorvus/src/task-api/index.ts packages/opencorvus/src/engine/store.ts packages/opencorvus/src/server/routes -S`
- `rg -n "readSessionEvents\\(" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "queue=false|pipeline\\.direct|startQueuedTaskNow" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "renderFrontendDesignHandoffReference|buildUserPrompt|renderBuildPromptOverlays|frontendDesignPaths|sourcePackageAbsolute|webCloneRuntimeRef" packages/opencorvus/src packages/opencorvus/test specs`
- `rg -n "loadTaskBrowserPreview|captureTaskBrowserPreview|selectTaskBrowserPreview|sendTaskBrowserPreview|fetchSessionTrace|fetchTaskTrace|invalidateTraceCache|startQueuedTaskNow\\(" packages/overlay/src packages/overlay/test -S`
- `rg -n "/task/:taskID/events|task\\.events|ProtocolStore\\.subscribeEvents|listTaskEventsAfter" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "runBrowserPreviewEvidenceJob\\(" packages/opencorvus/src packages/opencorvus/test -S`
- `rg -n "taskAbsolute\\([^\\n]*browser-preview|browserPreviewJobRoot" packages/opencorvus/src/browser-preview packages/opencorvus/test/browser-preview -S`
- Faraday read-only subagent audit on backend runtime derivation:
  frontend-design agent/tool/orchestrator/research call sites still using
  `Instance.directory` for task runtime artifacts.
- Maxwell read-only subagent audit on overlay project-scoped calls:
  mission/config/executor/conversation/SSE/coding-assistant/memory services
  still have ID-only contracts that rely on global directory injection.
- Poincare read-only subagent audit on stale test contracts:
  trace tests still use the old optional task-less read signature, some route
  isolation tests lack owning-project positives, and browser-preview route
  tests need broader cross-project negatives.

## Decisions

1. Preserve explicit parallel task starts.
   `queue=false` continues to start immediately and does not enter the wait
   queue. `startQueuedTaskNow` continues to be an operator override. Runtime
   isolation must come from task/session-scoped runtime paths, not from
   serializing all work.

2. Scope run and goal-run service reads through their owning task.
   `getRun`, `getAcceptance`, `getGoalRunAcceptance`, `listArtifacts`,
   `listEvaluations`, and `abortRun` must resolve the row and then call the
   existing current-project task assertion before returning or mutating data.

3. Read session trace through the owning task primary runtime.
   `/session/:sessionID/trace` must require the session to belong to a task in
   the current project, then read the trace index from that task's primary
   project runtime. Standalone sessions do not have task trace files because
   trace append requires `taskID`; returning an empty task trace for them would
   hide a broken route contract.

4. Update prompt text so it does not present queueing as a runtime-isolation
   solution.
   The prompt may describe immediate start versus queued wait, but must not
   claim queueing solves runtime interference.

5. Compose goal-path build prompts with the task primary project runtime.
   The goal build session runs in a managed worktree, while frontend-design
   evidence is stored under the task primary project runtime. The orchestrator
   build tool must resolve the task's primary project root, render the
   frontend-design handoff in absolute mode, and pass the same `projectDir`
   into build prompt overlays. Relative paths remain valid only for request-path
   consumers whose file tools resolve against the primary project directory.

6. Make overlay task-runtime requests directory-explicit.
   Browser preview services, trace fetch/invalidation, and queue start-now
   must receive the task row's directory from their caller and encode it in
   the API query. Their client-side cache/scope keys must include directory.
   Global API directory injection remains only a transport helper for callers
   that truly operate on the active project; it is not the source of truth for
   task-row actions.

7. Validate task SSE ownership before streaming.
   `/task/:taskID/events` must call the same task primary-project assertion
   before subscribing to protocol replay/live streams. Rejecting before
   `streamSSE` avoids a long-lived wrong-project connection and keeps the
   route behavior consistent with the project-scoped trace/run routes.

8. Make browser-preview capture job directories single-source.
   `runBrowserPreviewVerification` owns the capture job ID and
   `browserPreviewJobRoot(...)` directory. The real runner and test harness
   must use the provided `jobID` and `outDir`; they must not independently
   allocate another job directory or keep the old
   `taskAbsolute(..., "browser-preview")` path.

9. Make frontend-design and research artifacts task-primary-root based.
   Any helper or orchestrator call that has a `taskID` and reads/writes
   `frontend_design`, visual binding, PRD evidence, or research bundle runtime
   files must derive `projectDir` from `taskPrimaryProjectRoot(taskID, {
activeProjectID: Instance.project.id })`. Current cwd/worktree remains
   relevant for source-code editing, not for task runtime artifact storage.

10. Make overlay project-scoped row actions directory-explicit.
    ID-only service contracts for project-scoped routes must be replaced with
    contracts that carry the owning row directory. Calls from active-project
    settings can pass the active directory, but row/session/task actions must
    pass the frozen row directory and include it in cache keys where data is
    cached.

11. Update stale tests so they validate the actual isolation contract.
    Tests that seed a task and inspect trace data must pass the task ID into
    `AgentTrace.readSessionEvents`. Route isolation tests must include both the
    owning-project positive and wrong-project negative path so a broken fixture
    cannot pass by returning 404 everywhere.

## Tests

- Queue-time dead-owner regression:
  - Startup dead-owner inspection remains read-only.
  - `advanceQueue(cwd)` may perform explicit queue-time terminalization for
    dead-owner active tasks in that cwd, then claim queued work.
  - Live-owner active tasks are not terminalized.
- Route regression:
  - `/run/:runID`, `/run/:runID/acceptance`,
    `/run/:runID/artifacts`, `/run/:runID/evaluations`, and
    `/goal-run/:goalRunID/acceptance` reject IDs from another project
    directory.
  - `/session/:sessionID/trace` rejects a session whose owning task belongs to
    another project directory.
  - `/task/:taskID/events` rejects a task ID owned by another project directory
    before opening the SSE stream.
- Trace regression:
  - session trace reads use the task primary project runtime when the active
    request directory is different.
- Build prompt regression:
  - Goal-path build prompts include absolute frontend-design public report and
    source manifest paths from the task primary project runtime.
  - The webpage clone source-baseline overlay resolves `web-clone-source/...`
    and `frontend-design-skeleton/...` under that same absolute runtime root.
  - Existing request-path prompts keep relative task-runtime paths for
    in-process consumers.
- Overlay request regression:
  - Browser preview target/evidence/capture/live service calls preserve the
    explicit task directory in the transport query.
  - Browser preview component passes `props.directory()` into every service
    call and includes it in live/evidence scope keys.
  - Trace fetch and invalidation cache keys include directory and the transport
    query uses the panel's explicit directory.
  - Task row start-now sends the row directory instead of the globally selected
    settings directory.
- Browser-preview capture regression:
  - Verification capture jobs persist manifests and screenshot paths under
    `ProjectRuntimePaths.browserPreviewJobRoot(projectRoot, taskID, jobID)`.
  - The runner uses the job ID supplied by verification core; it does not
    allocate a second job ID.
- Frontend-design/research regression:
  - Running frontend-design persistence or visual binding from a managed
    worktree writes and reads task runtime artifacts under the task primary
    project runtime.
  - Research PRD evidence and research bundles use the task primary project
    runtime when a task ID is available.
- Overlay directory regression:
  - Mission/task status, session config, task operator model context, executor
    list/model updates, conversation history/tail, SSE, and coding-assistant
    row actions include the explicit owning directory in transport requests.
  - The legacy memory service is either deleted after confirmed dead-code
    review, or converted to an explicit-directory contract with tests.
- Test-contract regression:
  - Task trace tests call `AgentTrace.readSessionEvents(sessionID, taskID)`
    when validating task-primary runtime reads.
  - Runtime-isolation route tests prove the owning project can read its own
    run/goal-run rows before asserting another project gets 404.
  - Browser-preview route tests cover cross-project rejection for evidence,
    capture, target selection, and capture mutation routes, not just target
    discovery.

## Implementation Notes

- Browser-preview route tests now cover cross-project rejection for evidence
  JSON reads, capture PNG reads, target selection, and capture mutation.
- Overlay mission status and task status service calls now require
  `{ id, directory }` inputs and include `directory` in the request query.
- Overlay session config, task operator model context, Hexin budget, executor
  list, and executor model writes now require explicit project directories.
  `setExecutorModel` logs and rethrows transport failures instead of silently
  swallowing them.
- Conversation hydration registers a selected source directory, and history
  paging, session-history reads, live tail merge, selected-task SSE, SSE
  reconnect, and selected-task recovery all use that same directory. Missing
  directory is a hard error, not a fallback to the globally selected project.
- Coding-assistant session create, select, rename, abort, and delete calls now
  carry the row/current directory explicitly. Create reuses the returned row
  directory for the immediate selection hydrate/SSE.
- MemoryPanel already sent explicit request directories; its explicit
  `props.directory` branch no longer mutates global API directory context.
- Dewey overlay follow-up audit found more ambient-directory leaks:
  `loadBoard()` board refresh/retry paths, TracePanel session directories,
  permission/question interaction replies, and the legacy `services/memory.ts`
  API wrappers. These must be fixed before completion; tests must use a wrong
  global configured directory and assert the owning row/session/task directory
  is used.
- Bacon backend follow-up audit found more task-runtime leaks:
  terminal decision-log finalization, integrity feedback markdown, stale
  browser-preview test fixtures/persist validation, and missing owning-project
  positives in runtime route tests. These must be fixed before completion.
- Codex second review found one remaining frontend-design runtime writer in
  `orchestrator/tools.ts`: live webpage evidence preparation still passed
  `Instance.project.worktree` to `ensureLiveWebpageEvidence`. The call must use
  `taskPrimaryProjectRoot(taskID, { activeProjectID: Instance.project.id })`
  for `projectDir`, while keeping `Instance.directory` only as the visible
  worktree mirror source.
- Codex second review also removed the optional no-task form of
  `primaryWebpageEvidenceArtifacts` / `primaryWebpageSourcePackageArtifacts`.
  Production callers already had task IDs; test fixtures now pass task IDs too,
  so these helpers no longer expose the old `webpage-evidence` /
  `web-clone-source` roots.
