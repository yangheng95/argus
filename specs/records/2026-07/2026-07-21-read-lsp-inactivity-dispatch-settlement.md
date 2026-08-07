# Read, LSP Provisioning, And Dispatch Inactivity Settlement

Date: 2026-07-21
Status: Proposed; implementation not started
Owner: Codex

## Recall

### User request

The user supplied Task debug evidence for Task
`tsk_f8344de6f001aoVQvAK2tiimoi` ("帮我阅读研究mirror prism该如何才能合理导入到opencorvus"),
asked why it was stuck, then asked for the concrete repair plan.

The requested outcome is a systemic repair. The implementation must not merely increase the
600,000 ms inactivity threshold, retry the Task mechanically, hide the active row, or recover
the stranded report by patching this one database record.

### Acceptance criteria

1. The `read` tool is a pure bounded file-read operation. Reading `.sh`, `.py`, `.ts`, or any
   other supported source file must not install, start, initialize, or await a language server.
2. Explicit LSP (Language Server Protocol) consumers use one shared provisioning path. A silent
   or failed package installation terminates through the existing activity-aware process runner,
   checks the exit code and expected entry point, captures stderr, and leaves no process tree.
3. Orchestrator inactivity cancellation settles the exact current Orchestrator execution scope:
   descendant prompts, owned `dispatch_agent` executions, owned tool parts, and ownership terminal
   evidence finish before the Orchestrator runtime contract and project Instance lease are released.
4. The external-abort and inactivity paths reuse the same awaited settlement primitive. There is
   no fire-and-forget descendant cancellation path and no second ownership terminal writer.
5. Projected worker execution owns a project lifetime that does not become invalid merely because
   the synchronous parent Orchestrator turn starts closing. A worker that reaches a real terminal
   boundary can persist its terminal session/evidence without inheriting a closing lease.
6. The production-shaped regression reproduces the copied incident: a Task-scoped projected
   source investigator reads a shell file while LSP provisioning is unavailable. The read returns,
   the worker result reaches the parent `dispatch_agent` result, the Orchestrator makes a visible
   lifecycle decision, and the invocation DAG contains no false nonterminal session.
7. If scoped settlement genuinely fails, preserve the live records and expose exact
   cancellation-incomplete evidence. Do not claim Task completion, delete the Task, synthesize an
   Agent outcome, or silently rewrite ownership.

### Hard constraints

- No timeout increase as the repair, retry loop, fallback language server, compatibility path,
  host routing gate, keyword classifier, hidden wake, synthetic message, or second Task lifecycle
  source.
- Preserve `prompt_profile.active`, `PromptProfileResolver`, the strict dynamic `dispatch_agent`
  projection, canonical `orchestrator_tool_ownership`, and strict conflicting terminal replay.
- Reuse the current typed cancellation and ownership writers described by
  `2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`; do not fork another
  cancellation protocol.
- Do not automatically fail the Task merely because infrastructure or one worker failed. The
  Orchestrator remains the Task lifecycle decision-maker.
- Do not restart, stop, refresh, or otherwise interfere with the user's running OpenCorvus or
  Overlay during implementation or verification.
- Every behavior change requires focused regression coverage plus a production-shaped observable
  session/tool/ownership test.

### Runtime evidence read

- SQLite database `/Users/yangheng/.local/share/opencorvus/opencorvus.db`.
- Server log `/Users/yangheng/.local/share/opencorvus/log/2026-07-21T053942-6760-1.log`.
- Exact Task, session, message, Part, protocol-event, decision-log, and `engine_artifact` rows for
  `tsk_f8344de6f001aoVQvAK2tiimoi`.
- Parent Orchestrator session `ses_07cbab9f5ffe5aQCmh3OQxQ0nd` and worker session
  `ses_07cba3bcfffdPbq3hjSteWsmr0`.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/records/2026-07/2026-07-20-task-research-dispatch-observability-systemic-repair.md`
- `specs/records/2026-07/2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`
- `packages/opencorvus/src/tool/read.ts`
- `packages/opencorvus/src/lsp/index.ts`
- `packages/opencorvus/src/lsp/server.ts`
- `packages/opencorvus/src/util/process.ts`
- `packages/opencorvus/src/shell/inactivity-process.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/engine/cancellation-scope.ts`
- `packages/opencorvus/src/engine/task-agent-lifecycle.ts`
- `packages/opencorvus/src/engine/writer.ts`
- `packages/opencorvus/src/engine/agent-coordination.ts`
- `packages/opencorvus/src/engine/tool-ownership-completion-runtime.ts`
- `packages/opencorvus/src/project/instance.ts`
- `packages/opencorvus/src/project/independent-project-owner.ts`
- `packages/opencorvus/src/session/status-publication.ts`
- Existing focused LSP, read-tool, Orchestrator abort-funnel, ownership, cancellation, queue, and
  Instance-cache tests.

### Whole-repository grep evidence

- `rg -n "LSP\\.touchFile|touchFile\\(|BashLS|bash-language-server|OPENCORVUS_DISABLE_LSP_DOWNLOAD|Process\\.spawn\\(\\[BunProc\\.which\\(\\), \\\"install\\\"" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "runOrchestratorPromptWithInactivity|task_queue_run_timeout_ms|OrchestratorPromptInactiveError|SessionPrompt\\.cancel|requestTaskAgentLifecycleCancellation|cancelSessionPrompt" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "createDispatchAgentTool|completeInvocation|completeDispatch|openOwnership|attachSession|closing instance cache lease|finishOrchestratorRun|blockActiveRunForTask" packages/opencorvus/src packages/opencorvus/test`
- `rg -n "abortLiveOrchestratorToolOwnership|requestSessionPromptSubtreeCancellation|assertSessionPromptSubtreeFinished|completeDispatchOwnershipLifecycle" packages/opencorvus/src packages/opencorvus/test`

The search found five production `LSP.touchFile` callers, eight duplicated Bun language-server
package-install sites, one Orchestrator prompt-inactivity owner, and one canonical
`dispatch_agent` construction/ownership boundary. The call-site dispositions below cover every
production owner; remaining matches are tests, schemas, documentation, or consumers.

### Independent Agent feedback

No sub-agent was used. The user did not request parallel or independent Agents. The runtime
database, server log, current architecture records, source, and focused tests provide direct
evidence for this plan.

## Causal reconstruction

### Observable symptom

The Task debug blob showed `status=active`, two idle nonterminal sessions, no Run, no Goals, and no
Task Agent Outcome. The Task therefore appeared to be running indefinitely.

### Direct trigger

At `06:04:15Z`, the worker issued a `read` for
`/Users/yangheng/Documents/output/mirror-prism-pipeline/scripts/kanban.sh`. The tool Part did not
complete until `06:42:31Z`.

`ReadTool` had already assembled the file output but then synchronously awaited
`LSP.touchFile(filepath, false)`. Bash LSP discovery found no installed `bash-language-server`, so
`BashLS.spawn()` synchronously launched `bun install bash-language-server`. That install has no
activity timeout, does not inspect its exit code, discards its piped output, and does not verify
the expected JavaScript entry point after exit. The LSP process finally reached initialization at
`06:41:46Z` and then failed its 45-second initialize deadline at `06:42:31Z`.

### Cancellation and stranded-result chain

1. No session or stream activity was recorded after `06:04:15Z`.
2. At `06:14:17Z`, `runOrchestratorPromptWithInactivity()` crossed its 600,000 ms no-activity
   deadline and cancelled only the parent Orchestrator prompt directly.
3. The parent `dispatch_agent` tool Part became `AbortError: external abort signal fired`, and the
   Task received an `OrchestratorPromptInactiveError` artifact/error.
4. The worker prompt was not settled and continued until it produced a complete 9,663-output-token
   report at `07:03:36Z`.
5. Its parent Orchestrator runtime/Instance lease was already closing. The ownership terminal row
   therefore recorded `failed` with `Cannot provide project identity through a closing instance
   cache lease` instead of returning a successful tool result to the parent turn.
6. Orchestrator error handling deliberately records `task.error` without making a Task lifecycle
   decision. With no surviving parent turn and no valid worker result, the Task remained `active`.

The child report exists in the worker session, but its existence is not proof of successful
dispatch completion and must not be converted into a synthetic Task outcome.

### Deeper design causes

1. **Read/LSP responsibility violation.** A read-only evidence tool owns an optional development
   service side effect and blocks on provisioning it. The comment says the call only “warms” LSP,
   proving it is not part of the read result contract.
2. **Duplicated unbounded provisioning.** Eight built-in servers independently run `bun install`
   with slightly different stdio settings. None uses the mature activity-aware process runner or
   validates the installed artifact.
3. **Two cancellation shapes.** External Orchestrator abort starts a fire-and-forget descendant
   walk, while inactivity directly calls parent-only `SessionPrompt.cancel`. Neither gives the
   inner `finally` one awaited, ownership-complete settlement receipt before runtime teardown.
4. **Borrowed project lifetime.** Current-project projected worker execution runs inside the
   parent tool's inherited Instance lease. A background terminal path can therefore outlive the
   lease it needs for status/ownership publication.
5. **Correct but incomplete Task error policy.** The Task remains active because only an
   Orchestrator may decide Task lifecycle. The repair must restore a live Orchestrator/tool-result
   path, not add host-side auto-failure.

## Rejected repairs

- Increase `task_queue_run_timeout_ms` above 38 minutes.
- Disable every LSP download globally or preinstall only `bash-language-server` in packaging.
- Fire-and-forget `LSP.touchFile` from `read`; that retains hidden network/process side effects.
- Treat a running tool Part as perpetual heartbeat activity; that makes a genuinely hung process
  immortal.
- Mark the copied Task completed because the child emitted final text.
- Add a timer that automatically retries/reopens every stream-error Task.
- Swallow the closing-lease error, forge a completed ownership, or read the child transcript as a
  fallback `dispatch_agent` result.

## Single repair design

### A. Make `read` pure

- Delete `await LSP.touchFile(filepath, false)` from `ReadTool.execute`.
- Preserve file resolution, byte/line bounds, instruction loading, `FileTime.read`, title,
  truncation metadata, and output exactly as today.
- Keep LSP ownership only on explicit mutation/diagnostic surfaces:
  `write.ts`, `edit.ts`, `apply_patch.ts`, and `tool/lsp.ts`.
- Add a regression that installs a deliberately non-starting custom LSP for `.sh`, invokes
  `ReadTool`, and proves the read returns without spawning or awaiting that server.

This is a direct responsibility correction, not a fallback. A file read never required language
diagnostics to be correct.

### B. Converge language-server provisioning

- Add one internal provisioning helper under `src/lsp/` and replace all eight duplicated Bun
  install blocks in `lsp/server.ts`.
- The helper receives the package name and exact expected entry point, calls `Process.run()` with
  `inactivityTimeoutMs`, captures stdout/stderr, requires exit code zero, and then requires the
  expected entry point to exist.
- Add `assistant.activity.lsp_provision_idle_ms` to the existing assistant activity configuration
  and `EngineConfig` default/merge surface. Do not add a server-specific timeout table.
- On timeout, spawn failure, non-zero exit, or missing entry point, terminate the owned process
  tree and throw one typed provisioning error containing package, command, exit/failure kind, and
  bounded stderr. `LSP.getClients()` keeps its existing single broken-server record and reports the
  exact error; it does not start a second implementation.
- Preserve `OPENCORVUS_DISABLE_LSP_DOWNLOAD` as the explicit configuration that declines built-in
  provisioning. It is not consulted by `read` after section A.
- Add process-fixture tests for continuing-output success, silent inactivity termination,
  non-zero exit, and exit-zero/missing-entry-point failure. Assert one process tree and no residue.

### C. Give Orchestrator abort one awaited execution-scope settlement

- Extract one `settleOrchestratorExecutionScope` helper used by both the `ctrl.signal` listener and
  `runOrchestratorPromptWithInactivity`.
- Identify ownership by durable facts: current Task plus
  `ownership.payload.orchestrator_session_id === currentOrchestratorSessionID`. Do not infer it from
  session title, agent label, or tool name text.
- For every exact live owner, call the existing `abortLiveOrchestratorToolOwnership`. That primitive
  requests descendant prompt cancellation, awaits physical settlement, closes owned tool Parts,
  and invokes the canonical strict ownership terminal writer.
- Cancel and await any remaining descendant/Orchestrator prompts through
  `requestSessionPromptSubtreeCancellation` plus `assertSessionPromptSubtreeFinished`.
- Track the returned settlement promise. The Orchestrator inner `finally` must await it before
  `clearSessionRuntimeContract`, MCP resource disposal, listener removal, or project-lease release.
- Remove the current async-void descendant loop and the inactivity path's direct parent-only
  `SessionPrompt.cancel`.
- If settlement fails, persist the exact cancellation-incomplete failure and preserve live durable
  facts. Do not write a conflicting ownership terminal or claim a successful abort.

This extends the existing P0 typed-cancellation authority; it does not invent a second protocol.

### D. Own projected-worker project lifetime explicitly

- Run current-project projected adapter execution through the existing
  `runWithIndependentProjectIdentity` boundary, keyed by the Task root directory, just as
  worktree execution already owns an explicit directory boundary.
- Keep the synchronous `dispatch_agent` return contract: the Orchestrator still awaits the worker
  and receives its real result. The independent lease changes resource lifetime, not scheduling or
  message visibility.
- Ensure worker terminal status/evidence publication and ownership completion never inherit the
  parent request's closing lease. Reuse `publishSessionStatus` and the independent project-owner
  primitive; do not add a detached background queue or session shadow state.
- On parent cancellation, section C remains authoritative and awaits this independently owned
  worker. Independence is a safety boundary, not permission for orphan execution.
- Add a barrier test that closes the parent Instance lease while the worker reaches terminal.
  Assert the worker publishes one real terminal/idle fact as appropriate, ownership settles once,
  and no `closing instance cache lease` error is stored.

### E. Preserve natural Task lifecycle and visible failure evidence

- Keep `orchestrator-stream-error`, `task.error`, session events, tool result, and ownership rows as
  the evidence sources.
- Do not map inactivity directly to Task `failed`. After sections A–D, ordinary provisioning
  failures return through the worker/tool result while the Orchestrator is still alive, allowing it
  to decide repair, redispatch, ask, or `manage_task action=fail_task` visibly.
- A true Orchestrator-wide inactivity abort may leave the Task active with an explicit error until
  an operator/recovery wake; it must have zero live ownership and zero false nonterminal prompt
  sessions after successful settlement. The Overlay/debug surface already projects Task error,
  invocation DAG, and outcomes and does not need a second status.

## Call-site disposition

| Production surface | Current callers/consumers | Disposition |
| --- | --- | --- |
| `tool/read.ts::ReadTool.execute` | all repository/source investigation Agents | Remove LSP touch; preserve bounded file-read and FileTime evidence. |
| `LSP.touchFile` | write, edit, apply-patch, explicit LSP, current read | Remove read caller; preserve four explicit mutation/diagnostic callers. |
| `lsp/server.ts` built-in Bun installs | Vue, Pyright, Svelte, Astro, YAML, PHP Intelephense, Bash, Dockerfile | Replace every duplicate block with one validated activity-aware provisioner. |
| `Process.run` | shared command execution | Reuse its process ownership, output collection, inactivity reset, exit validation, and teardown. |
| `runOrchestratorPromptWithInactivity` | one `Orchestrator.processTask` prompt boundary | Invoke and await scoped settlement; retain descendant activity signature. |
| Orchestrator `abortPrompt` listener | external interrupt/server shutdown/current-task restart | Replace async-void walk with the same tracked settlement promise. |
| `abortLiveOrchestratorToolOwnership` | Task cancellation and explicit sub-Agent cancellation | Reuse as the sole dispatch ownership cancellation authority. |
| cancellation-scope subtree primitives | Task/project/session/worker cancellation callers | Reuse request plus awaited finish; do not add a sibling cancellation API. |
| `createDispatchAgentTool` current-project `run()` | every projected dynamic worker | Execute under an independent project identity while retaining synchronous return and exact lease/ownership. |
| `completeDispatchOwnershipLifecycle` | ordinary dispatch completion and cancellation authority | Preserve strict transaction/replay semantics; run terminal notification from a valid independent project owner where needed. |
| Orchestrator catch/task error write | stream/inactivity/hard prompt errors | Preserve evidence-only behavior; no host Task auto-failure. |

## Implementation order

1. Add the pure-read regression, remove the read/LSP coupling, and prove the copied `.sh` read no
   longer starts Bash LSP.
2. Add the shared LSP provisioner/configuration and migrate all eight install sites atomically.
3. Add an Orchestrator execution-scope settlement primitive and migrate external abort plus
   inactivity to it in the same change.
4. Give current-project projected worker execution an independent project lifetime and add the
   closing-parent barrier regression.
5. Add the production-shaped incident regression and verify real protocol/session/ownership
   projections.
6. Perform a second diff review against this Recall and the active P0 cancellation record before
   claiming implementation completion.

## Verification matrix

### Read and LSP

1. Read `.sh` with Bash LSP absent: bounded read succeeds; zero install, LSP spawn, or initialize.
2. Read a file covered by a slow custom LSP: read latency is independent of that server.
3. Explicit LSP/write/edit/apply-patch touch with an installed server still starts one client and
   returns diagnostics through the existing contract.
4. Provisioner continuing-output fixture survives beyond one wall-clock interval because activity
   resets the timer.
5. Silent fixture is killed after `lsp_provision_idle_ms`; stdout/stderr and failure kind are
   visible, and the process tree exits.
6. Non-zero install and missing expected entry point fail explicitly and mark one broken server.

### Orchestrator and ownership settlement

1. Descendant activity continues to refresh the parent inactivity deadline.
2. A silent descendant crosses the deadline: child prompt, owned tool Part, ownership, and parent
   prompt each settle once before runtime-contract clear.
3. External abort and inactivity produce the same settlement ordering and durable facts.
4. Typed cancellation does not first write `failed` and later `cancelled`; strict replay remains.
5. Settlement failure preserves live truth and produces cancellation-incomplete evidence.
6. Parent Instance closure cannot break worker status/evidence or ownership terminal publication.

### Production-shaped incident

1. Resolve the real General `source-investigator` projection through `PromptProfileResolver`.
2. Dispatch it Task-scoped through the real `dispatch_agent` ownership path.
3. Make it read a shell fixture while built-in Bash LSP is unavailable.
4. Assert the read returns without provisioning, the child result reaches the parent tool Part,
   ownership is terminal exactly once, and the parent Orchestrator can make a visible lifecycle
   decision.
5. Assert the Task debug projection contains no live/idle-falsely-nonterminal descendant, no
   `closing instance cache lease` error, and a real Task Agent Outcome only when its registered
   provider contract actually produced one.

## Required verification commands

- `bun test packages/opencorvus/test/tool/read.test.ts`
- `bun test packages/opencorvus/test/lsp/client.test.ts`
- Focused new LSP provisioner process-fixture tests.
- `bun test packages/opencorvus/test/orchestrator/session-abort-funnel.test.ts`
- `bun test packages/opencorvus/test/orchestrator/dispatch-agent-tool.test.ts`
- `bun test packages/opencorvus/test/task-api/cancel-task-live-ownership.test.ts`
- Focused new independent-worker-lease and production-shaped incident tests.
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`
- Mandatory pre-push hooks without `--no-verify`.

## Completion boundary

The repair is not complete when `read` alone is fast or when isolated cancellation mocks pass.
Completion requires the real projected-worker chain to return through `dispatch_agent`, exact
ownership/session terminal evidence, no inherited closing-lease failure, and a visible
Orchestrator Task decision. If the production-shaped chain or any required settlement fact remains
unverified, delivery must be marked unaccepted under rule 28b.
