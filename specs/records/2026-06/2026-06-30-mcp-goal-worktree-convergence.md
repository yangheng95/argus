# MCP Goal Worktree Convergence

Date: 2026-06-30

MCP means Model Context Protocol. UI means User Interface. DB means Database.
API means Application Programming Interface. SDK means Software Development
Kit. WSL means Windows Subsystem for Linux.

## Recall

- User request: "mcp确实挂了，别犟嘴，修复所有问题" after goal retries kept
  failing and task debug output showed contradictory workspace paths.
- Acceptance criteria:
  - MCP status must not report browser `connected` when the browser MCP client
    is closed or cannot answer the same tool-listing path used by sessions.
  - Build sessions that do not require browser/MCP tools must not be blocked by
    browser MCP startup failure.
  - Retry feedback must clearly identify prior-run terminal errors and must not
    make stale MCP failures look like the current attempt's live failure.
  - Interrupted or blocked goal runs must have durable, diagnosable lifecycle
    evidence instead of leaving active/running contradictions.
  - Task debug output must expose the selected task directory and backend
    canonical project worktree as different facts, or use one canonical fact
    consistently.
- Hard constraints:
  - No fallback or compatibility MCP status path.
  - No UI gate that pretends MCP is healthy.
  - No process restart, kill, refresh, or interference with the user's running
    OpenCorvus or overlay process unless the user explicitly authorizes it.
  - No broad git reset or overwrite of unrelated dirty worktree changes.
  - All code changes require targeted tests.
- Disk records read before implementation:
  - `specs/README.md`
  - `specs/records/2026-06/README.md`
  - `specs/records/2026-06/2026-06-29-browser-mcp-node-package-manifest.md`
  - `specs/records/2026-06/2026-06-29-browser-mcp-web-research-proxy.md`
  - `specs/records/2026-06/2026-06-29-a2a-stale-cancel-terminal-status.md`
  - `specs/records/2026-06/2026-06-29-build-outcome-and-visual-evidence-repair.md`
  - `specs/records/2026-06/2026-06-28-directory-source-convergence-plan.md`
  - `specs/records/2026-06/2026-06-13-task-debug-blob-trim.md`
- Remote evidence:
  - `GET /mcp` for the remote task returned `{"browser":{"status":"connected"}}`.
  - `GET /global/tasks` for the same runtime included build failures with
    `MCP server browser failed to connect: Not connected` and
    `MCP error -32000: Connection closed`.
  - The current bonds task run
    `run_f1492b218001q4CfMtupvyBOlU` is `blocked` with
    `OrchestratorPromptInactiveError` after `600000ms` of no activity.
  - `GET /task/tsk_f1452cf69001pMZgbn83qo66Rg/runs` showed an older run still
    `running` while the latest run was blocked.
  - The task debug blob reported `task.directory: /workspace/markets-bonds1`,
    while the API projected the project worktree as
    `/root/.local/share/opencorvus/markets-bonds1` and build worktrees under
    `/root/.local/share/opencorvus/markets-bonds1/.opencorvus/r/w/**`.
- Whole-repository grep evidence:
  - `MCP.status()` is exposed through `packages/opencorvus/src/server/routes/mcp.ts`
    and implemented in `packages/opencorvus/src/mcp/index.ts`.
  - `listTools` appears in MCP tests and in `MCP.tools()` /
    `MCP.status()` paths inside `packages/opencorvus/src/mcp/index.ts`.
  - `includeMcpTools` already exists on `SessionRuntimeContract`; the session
    loop omits `MCP.tools()` when the runtime contract sets it to `false`.
  - `build_retry_previous_*` artifacts are written in
    `packages/opencorvus/src/engine/persist.ts` and tested in
    `start-new-attempt.test.ts` and orchestrator tool tests.
  - `buildTaskDebugBlob` is the single overlay debug-copy source in
    `packages/overlay/src/utils/debug-info.ts`; its tests are in
    `packages/overlay/test/task-debug-info.test.ts`.
  - Task directory projection still appears in overlay task rows, debug copy,
    task services, backend task status snapshots, and gateway routes.
  - `project.worktree` is the backend project root used by runtime paths,
    task archives, trace/event logs, orchestrator route projection, and gateway
    metadata.
- Independent agent feedback: none. The user asked for direct repair, and the
  remote API plus local source evidence are sufficient to start implementation.

## Root Cause Chain

The observed failure is not one bug. It is a convergence failure across MCP
health, tool exposure, retry context, and path projection.

1. MCP status can remain `connected` based on client creation state even when
   the same MCP client has closed or cannot answer `listTools`. The build
   session then sees the real failure during provider-tool preparation.
2. Build sessions have a runtime contract flag that can suppress MCP tools, but
   failed remote evidence shows some pure implementation retries still received
   browser MCP startup as a hard dependency. That makes an unrelated browser
   sidecar failure block file-authoring goals.
3. Retry feedback stores prior terminal errors under `build_retry_previous_*`.
   Without explicit prior-run wording, an old browser MCP terminal error reads
   like the current attempt's live terminal failure.
4. The task debug copy exposes `task.directory` only. In mirrored Linux
   runtimes this can be the user-facing selected directory (`/workspace/...`),
   while the backend project worktree and managed goal worktrees live under the
   runtime data root. The output therefore hides two different path categories
   behind one label.
5. Blocked and running run rows can coexist in the task API projection. That is
   valid historical data only if the projection clearly separates current run
   state from stale prior run state; otherwise it looks like the same goal is
   both dead and active.

## Repair Plan

1. Make MCP status derive from the same usable client/tool-listing path used by
   sessions. A closed or failed browser MCP client must be marked failed with a
   current error message instead of `connected`.
2. Audit build-agent runtime contract creation and ensure MCP tools are included
   only when the build contract needs them. Pure file-authoring contracts must
   keep `includeMcpTools: false`.
3. Rewrite retry feedback text to include prior goal-run/attempt identity and
   terminal timing so stale terminal errors cannot be mistaken for current
   failures.
4. Add backend debug projection for canonical project worktree and overlay
   debug-copy labels for selected task directory versus project worktree.
5. Tighten task run projection/tests so current blocked run and stale older run
   state are clearly diagnosable.

## Required Verification

- Targeted MCP status and startup tests.
- Targeted session/runtime-contract tests for MCP tool inclusion.
- Targeted retry feedback tests.
- Targeted task debug blob tests.
- Typecheck for changed packages.
- Remote read-only API check after code verification, without restarting or
  killing the user's running OpenCorvus/overlay process.

## Implementation

- `MCP.status()` now validates every already-connected configured client by
  calling `listTools` with the same timeout path used by session tool loading.
  If that call fails, the client and transport are closed, the cached client is
  removed, and status becomes `failed` with the current error.
- BuildAgent in-process sessions now set `includeMcpTools` to `true` only when
  the caller explicitly requests it. Ordinary build/file-authoring sessions use
  the BuildAgent runtime tools and registry tools without depending on browser
  MCP availability.
- Retry feedback now says
  `Previous goal_run <id> terminal error (status=<status>): ...` instead of
  `Terminal error: ...`.
- If a `build_retry_previous_<goal_run>` entry already exists with older text,
  the engine appends a new entry with the same key and a superseding reason.
  The build prompt reads only the latest retry entry for each key.
- `TaskBoard` now includes the backend canonical `project.worktree`, and the
  overlay task debug blob prints both `task.directory` and `project.worktree`.

## Verification

- `bun test ./packages/opencorvus/test/mcp/prompt-resource-fail-fast.isolated.ts`
- `bun test packages/opencorvus/test/mcp/status-lazy-start.test.ts`
- `bun test packages/opencorvus/test/mcp/startup-failure.test.ts`
- `bun test packages/opencorvus/test/engine/start-new-attempt.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal build retry reuses the prior build session by default"`
- `bun test packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`
- `bun test packages/opencorvus/test/workbench/board.test.ts --test-name-pattern "compileBoard does not retain a mutable process board between hydrations"`
- `bun test packages/overlay/test/task-debug-info.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `git diff --check`

Remote read-only check after implementation still showed the old running
process state:

- `/mcp` returned browser `connected`.
- `/task/tsk_f1452cf69001pMZgbn83qo66Rg/runs` returned latest run
  `run_f1492b218001q4CfMtupvyBOlU` as `blocked` with
  `OrchestratorPromptInactiveError`, while older
  `run_f145acf7200168zRv4wbFo5ay5` still projected as `running`.

No OpenCorvus or overlay process was restarted or killed during this repair.
