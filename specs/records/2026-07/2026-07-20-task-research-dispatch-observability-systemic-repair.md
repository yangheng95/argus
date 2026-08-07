# Task Research Dispatch And Observability Systemic Repair

Date: 2026-07-20
Status: Completed
Owner: Codex

## Recall

### User request

The user supplied Task debug evidence for Task
`tsk_f7d5cfd76001h3HHivXszWpp5K` (`Phase 01: 审计基线并对齐设计`) and asked why it
appeared stuck, then explicitly requested a systemic repair.

Read-only runtime reconstruction proved that the Task was not deadlocked. At the
clipboard timestamp (`2026-07-20 03:16:46Z`) the Orchestrator was waiting for the tenth
task-scoped `interface-investigator` session. The first repository investigation took about
15 minutes; ten source-specific frontend-research sessions then ran serially for about 33
minutes. The final GeckoTerminal session completed at `03:20:11Z` and a real
`implementation-engineer` session started at `03:20:36Z`.

### Acceptance criteria

- The General scheduler prompt must distinguish multi-source external fact research from
  single-source interface investigation without a host routing gate or keyword matcher.
- Every projected worker row in the Orchestrator prompt must expose the exact legal
  target-specific `dispatch_agent` fields derived from the adapter schema single source.
- General `interface-investigator` must receive the existing Browser MCP tools required to
  observe a supplied source page; repository/task prose alone must not be presented as
  observed webpage evidence.
- The task board/debug projection must make real research outcomes and live/terminal Agent
  sessions visible even before a Goal or build outcome exists.
- `engine_task.time_updated` remains the Task-row timestamp; runtime activity is derived
  from `agentInvocationDAG` and outcome timestamps rather than continuously rewriting the
  Task row or creating a second lifecycle source.
- Existing strict adapter schemas, execution leases, task/Goal lifecycle, and visible
  message flow remain intact.
- Focused tests must cover schema-derived prompt fields, General Browser MCP projection,
  research outcome projection, and the copied debug blob's live activity section.

### Hard constraints

- No fallback, compatibility alias, route bypass, host preflight gate, workflow engine,
  state machine, mechanical retry, keyword routing, or synthetic progress event.
- Do not loosen task-scoped projected-agent execution leases merely to increase apparent
  parallelism.
- `prompt_profile.active`, `PromptProfileResolver`, typed dispatch adapters, persisted
  artifacts, and `agentInvocationDAG` remain the runtime authorities.
- Preserve concurrent Expert Squad installation-scope work and the untracked `C:/` tree.
- Do not restart, cancel, refresh, or otherwise interfere with the running OpenCorvus Task
  or Overlay.
- Commit subjects use the `dsw-33987` prefix and delivery pushes to `legacy-remote/v0.0.11beta`
  without bypassing hooks.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-07-dispatch-agent-projected-target-schema.md`
- `specs/records/2026-07/2026-07-16-webfetch-inline-attachment-e2e.md`
- `packages/opencorvus/src/agent/dispatch-adapter-contract.ts`
- `packages/opencorvus/src/agent/dispatch-adapter-input.ts`
- `packages/opencorvus/src/engine/projected-agent-execution-lease.ts`
- `packages/opencorvus/src/expert-squad/builtin/general/expert-squad.jsonc`
- `packages/opencorvus/src/expert-squad/builtin/general/agents/orchestrator/system.md`
- `packages/opencorvus/src/expert-squad/builtin/general/agents/interface-investigator/system.md`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/orchestrator/dispatch-agent-tool.ts`
- `packages/opencorvus/src/orchestrator/frontend-research-stage.ts`
- `packages/opencorvus/src/agent/outcomes.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/src/orchestrator/task-event.ts`
- `packages/overlay/src/utils/debug-info.ts`
- Runtime Task status, SQLite Task/session/message/Part/artifact/protocol rows for the
  supplied Task and all descendant sessions.

### Whole-repository search evidence

- `rg -n "frontend_research|deep_research|interface-investigator|research-investigator|dispatch_agent" packages/opencorvus/src packages/opencorvus/test specs`
- `rg -n "default_mcp_tool_refs|default/mcp/browser/tool" packages/opencorvus/src packages/opencorvus/test .opencorvus specs/current/architecture`
- `rg -n "taskAgentOutcomes|collectTaskAgentOutcomes|agentInvocationDAG|Task Debug Info|task.time.updated" packages/opencorvus/src packages/overlay/src packages/opencorvus/test packages/overlay/test`
- `rg -n "listResearchBriefArtifacts|listFrontendResearchBriefArtifacts|kind: \"exploration\"" packages/opencorvus/src`
- `rg -n "buildSystemParts|Active Projected Worker Identities|ResolvedProjectedAgent" packages/opencorvus/src packages/opencorvus/test`

### Independent agent feedback

No sub-agent was used. The user did not request parallel audit agents, and the live runtime,
database, source, architecture records, and existing tests provide direct evidence for the
repair.

## Causal diagnosis

### Observable symptom

The copied Task debug blob showed `active`, no run, no outcomes, no Goals, and a Task-row
updated timestamp equal to creation time. It therefore looked inactive for roughly 45
minutes.

### Direct trigger

The Orchestrator dispatched ten independent source URLs to the same task-scoped dynamic
identity. `ProjectedAgentExecutionLease.conflict()` correctly serializes any same-identity
dispatch when either scope is task-scoped. Raising `max_executor_groups` cannot bypass this
identity/scope conflict.

### Deeper causes

1. The Orchestrator initially selected the correct multi-source `research-investigator` but
   mixed in the explore-only `request` field. Later it mixed the deep-research-only
   `target_deliverable` field into three frontend-research calls. The strict schemas rejected
   all four calls, but the dynamic worker inventory prompt listed only adapter IDs, not each
   adapter's exact legal fields.
2. The General scheduler overlay did not clearly state that multi-source current facts belong
   to `research-investigator` while `interface-investigator` is for one supplied page's
   observable interface.
3. General `interface-investigator` promised observed interface evidence but projected no
   Browser MCP or acquisition tool. Its sessions could only read repository material and
   publish limitation-heavy structured briefs.
4. `taskAgentOutcomes` registered only the build provider. Ten persisted
   `frontend_research_brief` artifacts therefore appeared as zero Task Agent Outcomes.
5. The debug blob omitted the board's already-canonical `agentInvocationDAG`, and displayed
   only the Task-row timestamp. The backend board tag and DAG were updating correctly, but
   the copied diagnostic surface hid them.

### Why the previous path did not repair the problem

Strict schema errors were visible, but the next Orchestrator turn repaired only the immediate
call shape and continued with a less suitable worker. Because each frontend-research brief
was a valid terminal artifact, the scheduler had no factual indication of deadlock; it simply
waited through the bounded ten-source sequence. The UI diagnostic surface then omitted the
session/artifact evidence that would have made this behavior obvious.

## Call-site disposition

| Surface                                         | Current callers/consumers                                    | Repair                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `DispatchAdapterContractRegistry.inputSchema()` | unified `dispatch_agent`, stage tools, provider-schema tests | Preserve strict execution schema; add a schema-derived field-name projection for scheduler prompt text.                 |
| `buildSystemParts()` projected worker inventory | Orchestrator model prompt, scheduler capability tests        | Append exact adapter field names per dynamic target; do not duplicate a handwritten field table.                        |
| General scheduler overlay                       | composed only when `general` is active                       | Clarify evidence responsibility and multi-source batching as natural scheduling guidance.                               |
| General `interface-investigator` projection     | `PromptProfileResolver.resolveWorkerCapability()`            | Add the same mature Browser MCP tool refs already used by General `visual-reviewer`; keep explicit manifest authority.  |
| `collectTaskAgentOutcomes()`                    | Task board/status/debug, downstream outcome readers          | Register research brief outcomes alongside build outcomes; preserve provider extension architecture.                    |
| `buildTaskDebugBlob()`                          | double-click Task clipboard action and focused overlay tests | Add DAG counts, live session rows, and a derived activity timestamp while retaining Task-row timestamps and Goal facts. |
| `engine_task.time_updated`                      | pagination, Task record state, board cache tag               | Preserve; do not repurpose as runtime heartbeat.                                                                        |
| `ProjectedAgentExecutionLease.conflict()`       | all projected worker dispatch admission                      | Preserve; routing and capability repair remove waste without weakening concurrency ownership.                           |

## Implementation plan

1. Add `DispatchAdapterContractRegistry.inputFieldNames()` derived from each adapter's strict
   Zod object schema and render those names in every projected worker inventory row.
2. Strengthen the General scheduler and interface-investigator overlays with responsibility,
   batching, and evidence-boundary instructions.
3. Project the existing Browser MCP tool set to General `interface-investigator`.
4. Add a research outcome provider backed by the existing typed
   `listResearchBriefArtifacts()` and `listFrontendResearchBriefArtifacts()` stores.
5. Extend the copied Task debug blob with `task.activity.updated`, DAG status counts, and live
   session details from the board's existing DAG.
6. Add focused tests for every new behavior and update current architecture documentation.
7. Run focused suites, TypeScript checks, document health checks, `git diff --check`, mandatory
   pre-push hooks, and a final diff review.

## Validation plan

- `bun test packages/opencorvus/test/agent/dispatch-adapter-contract.test.ts`
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `bun test packages/opencorvus/test/agent/outcomes.test.ts`
- `bun test packages/overlay/test/task-debug-info.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `git diff --check`

## Implementation result

- The adapter contract registry now exposes schema-derived input field names,
  and the scheduler renders them beside every exact projected target.
- General routing guidance now separates coherent multi-source external facts,
  one-URL interface observation, and repository investigation.
- General `interface-investigator` now receives the same explicit Browser Model
  Context Protocol tool projection used by the package's mature visual review
  lane and must record observation/access boundaries.
- Persisted `research_brief` and `frontend_research_brief` artifacts now appear
  through the existing task outcome provider surface with their real session
  IDs and timestamps.
- The copied Task diagnostic now includes real invocation DAG status counts,
  nonterminal sessions, and an activity timestamp derived from DAG/outcome
  evidence while preserving the Task-row timestamp.

## Validation evidence

- Focused adapter, outcome, General package, scheduler projection, Browser
  capability, and Overlay debug tests: passed (37 selected tests).
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: passed.
- `git diff --check`: passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: passed
  after the shared index exposed all three concurrently authored July records;
  this repair's commit remains restricted to its own record and index entries.
- The mandatory pre-push hook passed repository TypeScript checks, API route
  inventory, generated API documentation, Overlay internationalization, and
  tracked-source secret scanning before delivery to `legacy-remote/v0.0.11beta`.
