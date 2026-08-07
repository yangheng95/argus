# Overlay Web Benchmark Retirement and Direct Prism Run

## Recall

### User requirements

- Do not use the Overlay benchmark wrapper to test Prism.
- Delete `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts`.
- Publish the TradingView Spaces delivery request directly into the real OpenCorvus database.
- Inspect the database directly and repair every infrastructure or Expert Squad defect exposed by the real run.
- If the database is damaged, preserve evidence, clean it, and run again with a new Mission rather than reusing polluted lineage.

### Acceptance

- No executable or documented entry point references `overlay-web-benchmark.ts`.
- Tests that existed only to pin that deleted script are removed; shared benchmark and Overlay contracts remain tested by their canonical owners.
- The canonical database passes `PRAGMA quick_check`, the live backend holds its database, write-ahead-log (WAL), and shared-memory (SHM) files, and `/global/health` reports healthy.
- A new Mission is created through `POST /mission/wake`, persists in the canonical SQLite database, and creates real Task, Goal, message, tool, interaction, and permission evidence.
- The Mission uses the fresh-11 repository only. Older fresh directories and entity lineages remain evidence and are not reused.

### Hard constraints

- Preserve unrelated dirty-worktree changes. The pre-deletion dirty versions of the script and its two dirty tests are retained under `.scratch/removed-overlay-web-benchmark-20260725-2200/`.
- Do not stop the independent process currently listening on port 7878.
- Do not add a fallback, gate, compatibility path, synthetic completion, or restart loop.
- Use the real Mission, Task, Session, Goal, message, interaction, and permission tables as the diagnostic source.

### Read material

- `AGENTS.md`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/script/benchmark/overlay-web-benchmark.ts` before retirement
- `packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts`
- `packages/opencorvus/test/benchmark/store-bridge-benchmark.test.ts`
- `packages/opencorvus/test/benchmark/environment.test.ts`
- `packages/opencorvus/test/script/document-health.test.ts`
- English and Chinese benchmark operation documents

### Whole-repository search

`rg -n --hidden --glob '!node_modules' --glob '!.git' 'overlay-web-benchmark|overlay benchmark'`
found the executable, script-owned tests, documentation, comments, ignore patterns, and historical records. Historical records remain immutable evidence. Current executable/documentation/test references are retired or rewritten.

| Call point | Disposition |
| --- | --- |
| `script/benchmark/overlay-web-benchmark.ts` | Delete. |
| `test/benchmark/bench-script-cleanup.test.ts` | Delete script-specific assertions; retain the generic retired-entrypoint assertions in a focused test. |
| `test/benchmark/store-bridge-benchmark.test.ts` | Remove deleted-script assertions; retain the Overlay test-hook contract under the Overlay test owner. |
| `test/benchmark/environment.test.ts` | Keep the Mission benchmark environment contract and remove the deleted script from its file list. |
| `test/script/document-health.test.ts` | Remove deleted-script assertions and keep canonical Mission/visual-diff documentation assertions. |
| English and Chinese benchmark docs | Make `mission-benchmark.ts` the documented end-to-end entry point. |
| `.gitignore` entries and current source comments | Remove or rewrite stale Overlay-benchmark-specific references. |
| `specs/records/**` historical mentions | Preserve as dated evidence; do not rewrite history. |

No independent agent was launched: the user requested direct execution, and the current collaboration policy forbids delegation unless explicitly requested.

## Failure evidence and causal chain

- The fresh-10 backend was PID `14493`, rooted at `/Users/yangheng/Documents/OpenCorvus-Demos/prism`, and held the canonical database.
- At `2026-07-25T13:45:48.786Z`, scheduler polling failed with `DatabaseUnavailableError`, SQLite code `SQLITE_IOERR_VNODE`, errno `6922`, at `/Users/yangheng/.local/share/opencorvus/opencorvus.db`.
- The same error escaped through the Mission session loop at `2026-07-25T13:45:48.929Z` as both an unhandled rejection and uncaught exception, terminating the backend.
- The deleted script contained a hard-coded removal of
  `/Users/yangheng/.local/share/opencorvus/opencorvus.db-wal` and
  `/Users/yangheng/.local/share/opencorvus/opencorvus.db-shm`, even though the benchmark itself used an isolated `OPENCORVUS_HOME`.
- Observable symptom: Prism execution stopped.
- Direct trigger: the live database lost its WAL/SHM sidecars.
- Deep cause: the Overlay benchmark mixed an isolated benchmark database with a hard-coded production database cleanup path.
- Why earlier health checks were insufficient: process liveness and HTTP success did not prove that the next SQLite operation could still access the live vnode.

The user rejected retaining or repairing this wrapper. Retirement removes the destructive caller instead of preserving another execution path.

## Direct run evidence

- Failed fresh-10 database image:
  `/Users/yangheng/.local/share/opencorvus/opencorvus.failed-prism-lineage-2026-07-25T13-45-48.db`
  with SHA-256 `3c414dd63eaa78ff60f3b755bef23b9d20a890289ef640c115e3c33e8cdd1067`.
- Canonical database reset completed from the Prism project directory.
- Direct backend: PID `19120`, port `7879`, working directory
  `/Users/yangheng/Documents/OpenCorvus-Demos/prism`.
- Fresh repository:
  `/Users/yangheng/Documents/OpenCorvus-Demos/prism/runs/tradingview-spaces-20260725-fresh-11`,
  branch `mirror-prism-tradingview-spaces-20260725-fresh-11`,
  baseline `d1982dc60d3da2a22e659c49eb88e41e350679a0`.
- Direct Mission:
  `b1d22efcf28096dd`, root Session `ses_0666f53d8ffe7hNeZRV7rwtXKB`.

## Task execution-directory lineage failure

### Recall

- The user requires the Mission-owned delivery Task and every projected
  Agent/Expert Squad tool to execute in the one fresh product repository, while
  retaining the parent Prism project as the durable storage namespace.
- A path written only into free-form Task metadata is not execution authority.
  The Task root Session directory, queue cwd, Instance projection, shell/file
  tools, artifacts, and git ownership must all derive from one explicit
  task-creation directory.
- The fix must be shared by every Task and Agent/Squad family. It must not be a
  Prism-specific prompt, path-prefix instruction, fallback, gate, retry, or
  automatic restart.

### Exact evidence

- Mission `b1d22efcf28096dd`, Mission Session
  `ses_0666f53d8ffe7hNeZRV7rwtXKB`, and Task
  `tsk_f999309c0001bPt5R8OvuTHiuX` were settled as cancelled after the
  contamination was proved.
- Panel tool part `prt_f9992f3a9001WYHGICJmr2ge7I` supplied the intended
  repository only as
  `metadata.workdir=/Users/yangheng/Documents/OpenCorvus-Demos/prism/runs/tradingview-spaces-20260725-fresh-11`.
  `panel.create_task` had no execution-directory field, and
  `CreateTaskInput` therefore created the root Session under the caller's
  parent Prism Instance.
- The Task root and all descendant Sessions persisted
  `directory=/Users/yangheng/Documents/OpenCorvus-Demos/prism`.
- Session `ses_066418192ffeXnIBZqt6Gdc9UQ`, tool part
  `prt_f99c5c6b5001bL2H8JDcs5cI9g`, executed from the parent directory and
  removed `.mirror/prd/assets/A001.ico` there after the same worker had created
  it. This is direct product-write contamination, not a naming inference.
- The parent Task bootstrap also scanned and checkpointed the parent repository,
  including prior run repositories, proving that git ownership was projected
  from the wrong cwd before any worker-specific prompt could correct it.

### Causal chain

Observable product writes and git scans escaped fresh-11 because the intended
repository was untyped metadata. The direct trigger was
`EngineService.createTaskInner()` calling `Session.create()` inside the Mission
caller's Instance. The deeper design defect was that Task creation had no
canonical execution-directory input and therefore could not bind the existing
queue/session/tool context machinery to a child repository while preserving the
Mission's storage project identity.

### Whole-repository call-point audit

| Call point | Disposition |
| --- | --- |
| `engine/model.ts::CreateTaskInput` | Add the canonical optional Task execution directory. |
| `panel/capability.ts::create_task` | Expose the exact directory field to every authorized Task creator. |
| `tool/panel.ts::create_task` | Forward the explicit field; do not infer it from metadata or request prose. |
| `task-api/index.ts::EngineService.createTask/createSchedulerChildTask/createTaskInner` | Enter the exact registered execution directory before project preparation, snapshots, root Session creation, git checks, and queue dispatch. |
| `project/project.ts::fromDirectory` | Resolve an explicitly registered project sandbox before independent git identity discovery so an execution repository retains its durable parent project identity. |
| `project/project.ts::addSandbox` and registered-directory lookup | Add a strict execution-directory registration owner that rejects cross-project duplicate ownership. |
| `engine/queue.ts::taskCwd/launchTaskLoop` | Keep root `session.directory` as the single cwd source; the registered projection makes its independent lease resolve the same storage project. |
| `project/task-runtime-root.ts` and TaskArtifact callers | Replace storage-project `worktree` lookup with the same validated root Session directory so artifacts, screenshots, tool-output recovery, and Task git evidence stay in the execution repository. |
| `orchestrator/agent.ts::orchestratorSessionForTask` | No special case: it inherits `Instance.directory`, now the canonical Task execution directory. |
| `agent/runner.ts::Session.createNext` | No special case: every projected worker inherits the same Task Instance directory unless an explicit existing-session directory is being verified. |
| `session/prompt/run.ts` and bash/apply-patch Tool.Context | No special case: prompt re-entry by persisted Session directory resolves the registered Task execution projection. |
| Prism Mission handoff package | Replace the metadata-only workdir convention with the canonical `panel.create_task.directory` field; metadata may describe a run but cannot own cwd. |

### Acceptance

- A Mission-created Task can retain its Mission/storage `project_id` while its
  root Session, Orchestrator, projected workers, shell/file tools, artifacts,
  and git operations use the explicit execution repository.
- A directory already owned by another registered project is rejected instead
  of silently changing ownership.
- Task creation without an explicit directory remains bound to the current
  Instance directory.
- Tests cover project projection, Task root lineage, panel forwarding, and
  representative shared descendants/tool cwd; a fresh real Mission validates
  the full Agent/Squad fan-out after backend reload.

## Shared dispatch contract defect

The real fresh-11 Orchestrator produced two invalid `dispatch_agent` calls before
starting the source researcher:

1. tool part `prt_f9994602e001hz3yeowuPpEzkd` sent `instruction`,
   `artifact_ids`, `goal_ids`, `attachment_refs`, and `evidence_refs` to
   `mirror-prd-general-researcher`; strict validation rejected every key.
2. tool part `prt_f9994d463001G89ScWWOvPaOCI` replaced `instruction` with
   `request`; strict validation rejected `request`.
3. tool part `prt_f99951001001n1F1dZROS6bQTN` used only the rendered
   frontend-research fields and started successfully.

This is recoverable in the current Task, but it repeated across fresh-10 and
fresh-11 and affects every projected Agent family. Whole-repository search
found the shared contract owners in
`agent/dispatch-adapter-input.ts`,
`agent/dispatch-adapter-contract.ts`,
`orchestrator/dispatch-agent-tool.ts`,
`orchestrator/agent.ts`, and
`prompt/core/orchestrator-core.txt`. The strict schemas are correct. The shared
prompt used the phrase “delegated instruction” without explicitly stating
that no universal `instruction` or `request` payload field exists. The repair
keeps strict validation and projects one explicit cross-Squad rule beside the
exact per-target field list: use only the selected target fields and put the
complete instruction in `reason` when that field is rendered.

## Architect concern incorrectly triggered structural reentry

The first Architect session `ses_066555b49ffdQWBWSPNrBWXBTs` completed and
atomically persisted exactly 11 Goals for two independently implementable
delivery surfaces plus three shared-system outcomes. Its ContractGraph artifact
`art_f99b8ba18001uK5KW0lC7bN8st` contained six
`contract_without_audit_coverage` findings. These findings were typed
`concern`, not `blocker`, but their repair-oriented text instructed the caller
to add essential `contract_audit` scorers.

At tool part `prt_f99b8f9cc0013SCuujQO2S9hSI`, the Orchestrator treated those
concerns as a structural defect and dispatched a second Architect session
`ses_06646eb6bffef0OXqgWp31xK7k` in `structural_reentry` mode solely to fill
the audit references. No delivery surface, ownership boundary, dependency, or
requirement had changed.

The direct trigger was the repair-oriented optional-coverage finding. The
deeper cause was an invalid semantic assumption: registering a graph contract
does not imply that an essential acceptance scorer must statically audit that
contract. `contract_audit` is one optional scorer for cases where literal
contract materialization is itself acceptance-critical. Missing coverage is
therefore not a graph defect. The shared validator no longer emits this
finding, while references to unknown contract IDs remain blockers. The active
Prism package already requires exactly one initial Architect pass and forbids a
later phase Architect; removing the false finding lets that package contract
remain the sole workflow authority without adding Prism policy to the global
core prompt.

## Prompt ownership audit

The user required a whole-repository audit for further Expert Squad policy
leaking into global core prompts. The audit enumerated every file under
`packages/opencorvus/src/prompt/core/` and searched prompt renderers under
`agent`, `architect`, `build`, `intent`, `mission`, `orchestrator`, and
`research` for frontend-replica names, source-row vocabulary, concrete browser
comparison tools, route-instance planning, device-specific scope, and named
benchmark products.

| Finding | Classification | Disposition |
| --- | --- | --- |
| `intent-analysis-core.txt` used “pixel-copy Product A while strictly using Design System B” as its generic conflict example. | Confirmed domain-policy leakage. | Remove the frontend example. Keep only the generic rule to derive mutually exclusive choices from the user's actual request. |
| `build-core.txt` requires real rendering and screenshot inspection for visual work. | Platform-wide observable verification contract, not an Expert Squad workflow. | Retain. |
| `build/prompt-context.ts` renders reference-fidelity guidance only from an explicitly supplied FrontendDesign artifact. | Task fact projection at the typed adapter boundary. | Retain; it is not unconditional core policy. |
| `orchestrator-core.txt` describes the generic Visual QA capability and visible evidence handoff. | Platform scheduler protocol shared by all projected visual reviewers. | Retain; no package-specific tool, artifact, route, or product policy is embedded. |
| `research/prompt-section.ts` and `frontend-design/output-tools.ts` name their own typed frontend artifacts. | Adapter-owned schema/rendering contract. | Retain outside global core. |
| Prism, frontend-replica, MirrorTest, and Mission Skill domain rules. | Package-owned policy. | Keep in their Expert Squad or explicit skill package; do not duplicate into core. |

The hygiene regression now scans Intent Analysis alongside the other generic
runtime templates and rejects the removed frontend conflict vocabulary. The
audit found no current global-core occurrences of `frontend-replica`,
`web-clone-source`, `SourceDomPage`, concrete browser comparison tools,
desktop/tablet/mobile replica policy, Mirror Prism, AInvest, TradingView, or
route-instance Goal policy.

## Evidence-strict, omission-tolerant package semantics

The user clarified that partial population is an intentional design property:
an optional field or non-material detail may be absent without failing the
Task. Failure and repair are reserved for false, contradictory, missing, or
unresolvable required evidence; invalid/escaping required paths; failed
persistence or tools; and execution that cannot continue.

Whole-package search found three over-strict prompt families inside
`expert-squads/mirror/prism`: source mapping demanded apparent schema
completeness, Page Designer refused a packet for a broad mixture of required
and optional context, and Architect/Orchestrator did not state that unsupported
optional details are not structural defects. The package README, scheduler,
coordination Skill, source researcher contract, Architect overlay, and Page
Designer overlay now share one evidence-based boundary. They preserve strict
identity, artifact-reference, route-membership, owned-path, persistence, and
executable-acceptance requirements while allowing non-material omissions to be
recorded as limitations. No global core prompt is changed.

## Fresh-12 capability-owner directory regression

The first real Mission after the execution-directory repair exposed a second
shared context projection defect before any Task was created:

- Mission `e28ea9f879766de1`, root Session
  `ses_06609cc41ffe2STBKgySbzhGhi`.
- Mission tool part `prt_f99f6e452001u2V3NLnsbeeZBd` called
  `panel.create_task` with the correct explicit execution directory
  `/Users/yangheng/Documents/OpenCorvus-Demos/prism/runs/tradingview-spaces-20260725-fresh-12`
  and `promptProfile="prism"`.
- The exact terminal tool result was `Unknown prompt profile "prism"`.
- Direct SQLite inspection showed no fresh-12 Task row and
  `PRAGMA quick_check=ok`; backend PID `95204` held the canonical
  DB/WAL/SHM files and `/global/health` returned `healthy=true`.

The direct trigger is `createTaskInner` resolving the project-scoped expert
squad after entering the execution-repository `Instance`. The deeper cause is
that `EffectiveConfig.directory` and the resolver callers use one
`projectDirectory` value for two distinct authorities:

1. the durable owning project's config and installed expert-squad packages;
2. the Task execution repository used by Sessions, tools, MCP processes,
   artifacts, and Git.

The directory-lineage repair correctly changed the second value to fresh-12,
but the same value incorrectly moved package discovery away from the parent
Prism project where `prism` is installed. The repair adds one explicit
capability-project directory projection from the Session's durable
`project_id`, while retaining the root Session directory as the
execution/tool directory. The call-point audit covers Task creation,
Orchestrator capability/skills/tools/prompt composition, worker
capability/skills/tools/prompt composition, session profile changes, and
session skill-mount/catalog routes. Changing only `panel.create_task` would
leave the next Orchestrator wake broken.

## Shared capability preflight lock contention

Fresh-13 remained clean and produced no Task when Mission
`22973eb6ebccf678` invoked tool part
`prt_f9a0cf19d001jXv29htZftI8nU` with the correct directory and
`promptProfile="prism"`. The exact result was
`withKeyedLock timeout: key="skill-catalog" waited 30000ms`.

This followed a shared-backend restart while multiple independent projects
were reopening. `prepareCapabilityPreflight` treated project config and
installed-Skill validation as a global catalog mutation, so every project
preflight held the same exclusive lock across config loading and validation.
Read-only project startups therefore serialized behind unrelated projects and
could make a valid Task create fail after 30 seconds.

The shared reference contracts now use the repository's reader/writer lock:
concurrent capability-reference validations acquire read ownership, while
Skill installation/update/removal and committed Chat capability-reference
changes retain exclusive write ownership. Read-to-write upgrade is rejected
explicitly rather than deadlocking. A cross-project regression holds two
preflights open simultaneously and proves both enter before either releases;
the existing lock-order, inherited-preflight, disposal, and mutation tests
continue to cover lifecycle safety.

## Fresh-13 process-recovery dispatch duplication

Direct SQLite evidence from Task `tsk_f9a3c0c100012R4c9aNoEcXXHS` proves a
shared prompt-lifecycle defect rather than an Expert Squad planning error:

- queued wake `art_f9a3c0ddf002oVHjWNQE0y0ijO` remained `pending`;
- Orchestrator Session `ses_065c3ecd7ffezqW3xG99O86RY7` started
  `dispatch_agent` part `prt_f9a3cd423001Roxv0UKs6kDfMP`, which created source
  researcher Session `ses_065c308f3ffdTdnXO9oALermH8`;
- that backend process ended while the synchronous child tool was still
  running, leaving both the assistant message and tool part incomplete;
- replacement backend PID `49968` started at `2026-07-26T01:06:18+08:00`,
  recovered the same durable wake, and started second `dispatch_agent` part
  `prt_f9a3e263d001A2iAtAEGPjCJbA` with child Session
  `ses_065c1b01fffdhBC6NVx2rRTyKi`;
- there is no `agent_coordination_request`, interaction, or permission record
  authorizing a second source-research wave.

The observable duplicate worker is therefore downstream of an unclosed
physical execution. The durable wake is correctly retained for recovery, but
the new process currently starts a new model turn while the preceding
assistant/tool records still claim live execution. Process-local prompt and
tool ownership cannot survive a process exit, so a fresh owner must first
terminalize the exact incomplete assistant message and every open tool part
with a visible process-interruption error. It must not invent a worker result,
mark the Task complete, suppress recovery, or change Expert Squad policy.

Whole-repository call-point search covers `SessionLoop.loop`,
`SessionPromptState`, `SessionProcessor`, direct agent entrypoints,
Orchestrator recovery, queued Task execution, session wake, and shell resume.
The repair belongs in the shared Session loop boundary so every Agent and
Expert Squad family receives the same persisted lifecycle semantics. Task
cancellation invokes the same convergence only after all physical prompt and
queue owners settle, so a terminal cancelled Task cannot retain historical
`pending`/`running` tool cards from processes that no longer exist.

## Verification

- Run focused retirement, Mission benchmark environment, document-health, and historical-link tests.
- Run repository typecheck for affected packages.
- Query SQLite after every material Mission transition for the exact entity IDs, terminal state, recent tool results, pending interactions, and permission documents.
- A short absence of messages is not failure; an invalid tool contract, terminal Task failure, lost live owner, database error, or impossible dependency transition is.
