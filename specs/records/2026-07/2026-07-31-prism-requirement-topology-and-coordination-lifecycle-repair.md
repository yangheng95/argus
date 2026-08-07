# Prism Requirement topology and coordination lifecycle repair

## Recall

- User request: continue past the surfaced `mirror-prism-generic` failure, challenge the diagnosis for adjacent hidden defects, repair the complete root cause, and run end-to-end acceptance.
- Acceptance:
  - both `mirror-prism-generic` and `mirror-prism-ainvest` expose one real Task-scoped Requirements producer between material discovery/authority mapping and the sole Task-scoped Architect;
  - the Requirements adapter completes normally, persists one immutable `requirement_set`, and Architect consumes that same-Task fact before registering Goals;
  - a worker Session replaced by an accepted `redispatch_worker` action or closed by `fail_task` reaches durable terminal lifecycle evidence instead of remaining idle after its Task is terminal;
  - source package, generated payload, built-in Mission Skill, current architecture, package/SDK tests, and a fresh installed package agree on one 17/19-node graph;
  - focused non-UI contracts, typecheck, generated-artifact checks, documentation health, and a fresh real Task prove the repaired path.
- Hard constraints:
  - preserve all unrelated dirty-worktree changes; do not stash, reset, restore, clean, broadly format, or create a worktree;
  - do not restart, stop, refresh, or otherwise mutate the currently running OpenCorvus/Overlay process;
  - do not add a generic SDK workflow-policy gate, fallback acceptance-source type, synthesized RequirementSet, compatibility alias, retry loop, or second workflow-state source;
  - do not create, modify, or run UI automation tests;
  - tests assert current positive lifecycle, topology, Artifact, Goal, and Session facts.
- Read records and architecture:
  - `specs/records/2026-07/2026-07-26-prism-requirement-set-handoff-lifecycle.md`;
  - `specs/records/2026-07/2026-07-29-mirror-prism-agent-flow-trim.md`;
  - `specs/current/architecture/04-extensions.md`;
  - `specs/current/architecture/13-agent-communication-matrix.md`;
  - `specs/current/architecture/15-agent-facts-and-turns.md`;
  - `specs/current/architecture/99-principles.md`.
- Runtime evidence:
  - Task `tsk_fb3deccf2001cylH8ORWysW6bS` completed source discovery with `R1/R2/R2B/R3`, `S1/S2/S3`, one `prism/source-system-contract`, and one `FrontendResearchBrief`;
  - it had zero RequirementSet artifacts and zero Goals;
  - Architect Sessions `ses_04c15a47affeGdyYjygM80gWoq` and `ses_04c139269ffeaWls0TMC5r6YpZ` both requested an Orchestrator decision because `manage_goal` requires a known persisted `REQ-N`;
  - the first request was answered with an unchanged redispatch, the second with `fail_task`, and both source Sessions remained idle after Task failure.
- Full-repository search:
  - all repository `expert-squad.jsonc` workflows were parsed and their `base_role`, `dispatch_scope`, and `depends_on` edges enumerated; Prism alone has Goal-scoped delivery downstream of an Architect with no Requirements ancestor;
  - `mirror-prd-stage-requirements-analyst`, `RequirementSet`, `Requirements -> Architect`, `validateExpertSquadManifestDispatchTopology`, `completeAgentCoordinationAction`, `failTaskLifecycle`, and `publishSettledSessionTerminalStatus` were searched across source packages, generated payloads, Mission Skills, SDK, Registry, Resolver, Orchestrator, Engine, tests, and specs;
  - commit `9df7de117a` deleted the Prism Requirements identity/resources and rewired both workflows directly to Architect while retaining Requirements-dependent scheduler and Architect contracts.
- Independent review:
  - Claude Code 2.1.220 was invoked read-only with `Read,Grep,Glob`, no delegation/worktree/write tools, and bounded budget. It inspected the package and Requirements adapter. Its streamed final event was not recoverable from the local CLI output capture despite `claude doctor` reporting a healthy install, so no unobserved Claude claim is used as evidence.
  - Codex review rejects a generic SDK topology gate: `validateExpertSquadManifestDispatchTopology()` intentionally validates manifest shape/references/acyclicity while package semantics remain owned by the active package. The repair belongs to Prism plus resolved package contracts.

## Causal chain

1. The lean-flow commit removed the only `base_role: requirements` producer and its resources.
2. The same commit rewired generic Architect to `mirror-prd-general-researcher` and AInvest Architect to `mirror-prd-ainvest-feature-mapper`.
3. Prism scheduler text and Stage Architect still require a terminal RequirementSet.
4. Core Architect output validation correctly requires every acceptance spec to cite a known persisted `REQ-N`.
5. Source evidence therefore completes, but Goal registration cannot start without fabricating a RequirementSet.
6. An unchanged redispatch cannot add the missing producer and leaves the replaced source Session idle.
7. `fail_task` terminalizes the Task and action but does not close the settled requesting Session, leaving a second idle child.

## Call-site disposition

| Surface                                                              | Current evidence                                                                                                    | Disposition                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expert-squads/mirror/prism/expert-squad.jsonc`                      | Requirements identity/node deleted; Architect directly follows researcher/mapper                                    | Restore the package-owned Requirements identity and make it the exact Architect dependency in both workflows.                                     |
| Prism Requirements prompt and Skill                                  | Deleted by lean trim; prior bytes already describe the desired single Task-wide contract                            | Restore as current package resources and keep the post-Turn persistence boundary.                                                                 |
| Prism Orchestrator prompt/Skill                                      | Already requires Requirements but one planning sentence dispatches Architect directly after discovery/mapper        | Make the visible order source/mapper -> Requirements -> Architect explicit.                                                                       |
| isolated real generic Task                                          | First dispatch selected Goal-scoped `mirror-prd-ui-researcher` before any Goal existed                               | State the exact sole-ready initial node for each workflow and distinguish initial general discovery from later surface observation.                |
| isolated Architect handoff                                          | Architect selected RequirementSet and FrontendResearchBrief but blocked on an absent Turn-local `.mirror` file; scheduler repeated the completed source node | Make the immutable terminal research Artifact the sole downstream system-contract source and forbid redispatch to recover a working file. |
| Prism README and Mission virtual-workflow reference                  | Claims 16/18 nodes and direct discovery/mapper -> Architect                                                         | Converge on the actual 17/19-node graph and Requirements handoff.                                                                                 |
| Generated expert-squad and Mission Skill payloads                    | Embed the broken source graph/reference                                                                             | Regenerate through repository generators; do not hand edit.                                                                                       |
| `validateExpertSquadManifestDispatchTopology()` and Registry callers | Validate generic v1 data shape, references, order, and cycles; deliberately do not prescribe package planning roles | Preserve unchanged. A generic Requirements gate would violate package ownership.                                                                  |
| `mirror-prism-package.test.ts`                                       | Positively locks the broken direct Architect dependencies while separately checking Requirements prose              | Replace with one exact resolved package closure and Requirements -> Architect assertions for both workflows.                                      |
| `mirror-prism-source-capability.test.ts` and SDK Prism tests         | Count Architect but do not assert its Requirements ancestor; Mission reference expects 16/18                        | Assert the complete current package-owned topology and 17/19 Mission contract.                                                                    |
| cross-family Goal-mode handoff test                                 | Frontend Innovate says `post-Turn identity` while the shared contract names an Artifact identity                    | Converge its prompt/version on the same explicit post-Turn Artifact identity contract exposed by Prism and other Goal-mode families.               |
| `respond_agent_coordination` fail path                               | Fails Task while the settled requesting worker remains idle                                                         | Close the exact requesting Session with durable terminal-error evidence before terminal Task write.                                               |
| `dispatch_agent` redispatch completion                               | Completes replacement lineage while the replaced source Session remains idle                                        | Close the exact replaced Session only after the new worker descriptor and lineage are durable.                                                    |
| `continue`, `ask_user`, and pending redispatch                       | Same Session continues or a decision remains pending                                                                | Preserve; do not terminalize these live/pending semantics.                                                                                        |
| `cancel_worker`                                                      | Owns explicit physical cancellation                                                                                 | Preserve its existing cancellation path.                                                                                                          |
| `failTaskLifecycle()` direct scheduler caller                        | Has no exact A2A source Session                                                                                     | Preserve Task/Goal-worktree behavior; A2A source settlement remains owned by coordination handling.                                               |
| current architecture and July indexes                                | Current architecture says 40/44 while the July index says 17/19 and the record body says 16/18                      | Correct current facts and append this repair record; retain the historical failure description in the July 29 record with an explicit correction. |
| installed project package                                            | Existing projects do not auto-overwrite an installed package                                                        | Validate a fresh canonical import in an isolated project and use that package for the real Task. Do not mutate the active Overlay installation.   |

## Implementation

1. Restore the Prism Requirements agent, local Skill, and manifest projection.
2. Reconnect generic as researcher -> Requirements -> Architect and AInvest as Watch -> researcher -> mapper -> Requirements -> Architect.
3. Make the selected terminal FrontendResearchBrief Artifact payload/resources the sole immutable downstream system-contract source; keep `.mirror/prd/tmp/system-project-contract.json` Turn-local and forbid repeat source dispatch to recover it.
4. Update package/Mission documentation, version, exact node counts, generated payloads, and package tests.
5. Add one coordination Session settlement helper used only when a redispatch replacement is durable or an A2A `fail_task` decision is about to terminalize the Task.
6. Add positive non-UI tests proving the settled source Session has the exact terminal ledger fact and the replacement/action/Task facts are durable.
7. Run focused contracts, generation checks, typecheck, document-health checks, and a fresh isolated real OpenCorvus Task without disturbing the active application.

## Verification

- `bun test packages/opencorvus/test/expert-squad/mirror-prism-package.test.ts`
- `bun test packages/opencorvus/test/expert-squad/mirror-prism-source-capability.test.ts`
- `bun test packages/opencorvus/test/expert-squad/goal-mode-requirement-handoff.test.ts`
- `bun test packages/sdk/js/test/mirror-prism-authoring.test.ts packages/sdk/js/test/mirror-prism-collaboration.test.ts`
- focused coordination lifecycle contract test
- canonical expert-squad and Mission Skill payload generators
- generated-artifact and payload-generation tests
- `bun run typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- relevant document single-source and document-health tests
- fresh isolated OpenCorvus runtime process + installed Prism package + real Task: verify exactly one Requirements Session, one RequirementSet artifact, Architect dispatch after that artifact, nonzero Goals, and no retained idle replaced/failed worker Session.

### Real isolated Task evidence

- Task `tsk_fb454fbea001QWk7jEaSWQS6sc` ran against a fresh project, fresh isolated SQLite database, a fresh project-scoped Prism `2026.07.31.2` import, and the real public `https://example.com/` page.
- Dispatch order was exactly `mirror-prd-general-researcher` -> `mirror-prd-stage-requirements-analyst` -> `mirror-prd-stage-architect`; every worker reached `terminal/completed`.
- Persisted facts: one RequirementSet with 8 requirements and 13 Goals.
- All 23 Goal acceptance sources were typed `{kind:"requirement", id:"REQ-N"}` references that resolved to the same RequirementSet; drift count was 0.
- No Agent-to-Agent coordination request was created. The prior missing working-file blocker and duplicate source redispatch did not recur.
- After the acceptance query, the isolated Task was explicitly cancelled and settled. The live application, port 7878, and production database were never modified or restarted.

## Full-workflow correction and continuation

### Recall

- User requirement: run the entire Prism workflow, not merely prove the repaired Requirements-to-Architect handoff.
- Acceptance boundary: a fresh isolated `mirror-prism-generic` Task for `https://www.tradingview.com/spaces/` must execute every applicable instance of all 17 mandatory nodes, reach terminal accepted Task evidence, produce the implemented routed project and current visual/non-User-Interface acceptance evidence, and retain no live worker Session.
- Hard constraints: preserve unrelated worktree changes; do not touch or restart the live application, port 7878, or production database; do not add, modify, or run User Interface automation tests; visual acceptance must use the real rendered page, direct interaction, screenshots, and human inspection.
- Read records: this repair record, `2026-07-25-overlay-web-benchmark-retirement-and-direct-prism-run.md`, current Agent/extension architecture, and the package-owned Prism README, manifest, scheduler prompt, and coordination Skill.
- Whole-repository search: enumerated `mirror-prism-generic`, every manifest `agent_id`/`depends_on`/`dispatch_scope`, Task creation and isolated-home entry points, prior Prism E2E evidence, Task status observation, and project-scoped package installation.
- Independent agent feedback: none; the user did not request sub-agent review for this continuation.

The earlier acceptance stopped after the first three nodes and then explicitly cancelled the Task. It proves the topology and lifecycle repair but does not prove the complete Prism workflow. It must not be cited as a whole-Prism success. This continuation owns the missing end-to-end execution and any root-cause repair exposed after Architect.

### Full-run incident 1: concurrent Integrity adapter initialization

- Fresh isolated Task `tsk_fb545b9b9001UMj8WmBn3eMtR2` used project-scoped Prism `2026.07.31.2`, the real `https://www.tradingview.com/spaces/` source, and a separate SQLite authority/runtime on port 56936.
- The Task completed source research, one Requirements analysis, one Architect pass, three Goal-scoped User Interface research passes, three asset-curation passes, and three PRD author passes. It persisted 12 requirements, 33 Goals, and 46 Artifact Catalog entries before PRD review dispatch.
- The Orchestrator dispatched all three Goal-scoped `mirror-prd-reviewer` calls. The first created a worker Session, while the other two returned the exact infrastructure outcome `Projected agent "mirror-prd-reviewer" failed via adapter "integrity": Cannot access 'IntegrityJudgmentSchema' before initialization.` No child Session was fabricated for either failed adapter call.
- This is a shared runtime defect, not a Prism Requirement or content defect. `createIntegrityReviewStage()` dynamically imported the `@/integrity` barrel inside every concurrent Goal dispatch. Bun exposed a partially initialized re-export namespace to two callers while the first caller was evaluating `team-agent.ts`; the hoisted review function then reached the module-scoped judgment schema before that binding had initialized.
- Repair: statically bind `reviewIntegrity` from its owner module when the Integrity stage module initializes. All later concurrent Goal dispatches then share one fully evaluated implementation. Keep the post-review Engine persistence import dynamic because that import addresses a separate Engine dependency boundary.
- Positive regression: three concurrent Goal reviewer tool kits each expose the full registration/judgment tool set and independently record a `pass` judgment. Existing singleflight tests continue to prove that distinct projected reviewers and distinct Goal scopes execute concurrently without collapsing ownership.
- Because the failed Task already crossed nine workflow identities, acceptance will restart from a fresh Task and database after this repair; resuming only the two missing reviewers would not prove clean initialization or complete workflow repeatability.

### Full-run incident 2: concurrent Visual QA adapter initialization

- Fresh isolated Task `tsk_fb598508a001bWq5n7VrI3RrQk` restarted from source research after the Integrity repair and successfully created both concurrent PRD Reviewer Sessions, proving the first repair in the real adapter path.
- It then completed both page designs. The Orchestrator dispatched both Goal-scoped `mirror-design-visual-reviewer` calls; the first created a Visual QA Session, while the second returned `visual_qa_adapter: undefined is not an object (evaluating '(await import("@/visual-qa")).VisualQaAgent.analyze')` before any child Session existed.
- `createVisualQaStageDispatcher()` had the same unsafe shape as the repaired Integrity stage: each concurrent Goal call dynamically imported a barrel and immediately dereferenced its agent export. The shared defect therefore affects every goal-scoped Visual QA identity, including design, implementation, and final visual review surfaces.
- Repair: statically bind `VisualQaAgent` from its owner module during Visual QA stage initialization. Preserve the existing injectable `analyze` dependency for focused tests and do not add a retry, gate, serialized dispatch, or package-specific fallback.
- Positive regression: two concurrent Goal-scoped Visual QA dispatches each receive a distinct persisted specialist observation, persist their exact Goal ownership, and return terminal success. The previously stale persistence-failure test now constructs the required parentless Task root Session and persisted assistant producer message, so it verifies the current artifact-provenance contract rather than bypassing it.
- Focused result after repair: 14 tests passed across Integrity, Visual QA stage, and domain tool composition; package TypeScript typecheck passed.
- Full acceptance must restart again from a fresh Task/database. Resuming the single failed visual reviewer would not prove that both Visual QA imports initialize cleanly from process start or that later Visual QA identities are safe.

### Systemic projected-adapter initialization audit

- User correction: stop discovering one adapter at a time through long Prism runs. The third fresh Task `tsk_fb608fbe1001vu6hHaLKLD1gIy` was therefore intentionally stopped during source research; it is not a failed acceptance attempt and supplies no new defect diagnosis.
- Audit boundary: every adapter registered by `DispatchAdapterContractRegistry`, its exact Agent implementation owner, concurrent module-initialization shape, child Session creation boundary, and post-Turn evidence writer were enumerated before another real Task is allowed to start.

| Adapter | Agent owner and initialization disposition | Session/evidence disposition |
| --- | --- | --- |
| `delegated_worker` | `DelegatedWorkerAgent` was already statically bound from `delegated-worker/agent`. | `runAgentSession` owns the child; terminal outcome returns its exact Session/message. |
| `requirements` | Replace per-dispatch `@/requirements` barrel import with static `RequirementsAgent` owner import. | Agent owns the child; adapter persists the immutable RequirementSet after the Turn. |
| `architect` | Replace per-dispatch dynamic owner import with one static `ArchitectAgent` binding. | Agent owns the child; adapter persists Projection/Candidate and exact provenance. |
| `frontend_design` | `FrontendDesignAgent` was already statically bound. Remove redundant dynamic imports of already static `AttachmentStore`, filesystem, and path owners. | Agent owns the child; adapter records the design Artifact or typed partial evidence. |
| `frontend_research` | Replace per-dispatch `@/frontend-research` barrel import with static exact owner binding. | Agent owns the child; adapter records complete/partial research and linked resources. |
| `deep_research` | Replace per-dispatch `@/research` barrel import with static exact owner binding. | Agent owns the child; adapter records complete/partial research. |
| `visual_qa` | Incident 2 already replaced the barrel import with static `VisualQaAgent`. | Agent owns the child; adapter records one specialist observation per Goal. |
| `workload_analysis` | Replace per-dispatch `@/goal-workload-analyst` barrel import with static exact owner binding. | Agent owns the child; adapter persists workload briefs and provenance. |
| `analyze_intent` | Replace per-dispatch dynamic owner import with static `IntentAnalysisAgent`. | Agent owns the child; adapter persists intent facts and uses the real clarification path. |
| `fact_check` | Replace per-dispatch `@/fact-check` import with a single static `FactCheckAgent` binding. | Agent owns the child; adapter persists the optional review from the completed Turn. |
| `build` | Replace per-dispatch dynamic owner import with static `BuildAgent`/prompt binding. | Build owns the child/goal attempt; Host observation and scheduler wake remain independently durable. |
| `explore` | `ExploreAgent` was already statically bound from its exact owner. | Agent owns the child; terminal outcome returns the visible exact answer. |
| `integrity` | Incident 1 already replaced the barrel import with static `reviewIntegrity` from `integrity/team-agent`. | Agent owns the child; adapter records the exact judgment and provenance. |

- Remaining dynamic imports are not Agent implementation lookup: Architect/Requirements/Integrity/Build persistence, Build Worktree/store, Fact Check persistence, and Architect decision-log calls remain at their established Engine/cycle boundaries. They use exact owner modules, have already executed concurrently in the isolated runs, and do not immediately dereference an Agent barrel namespace while that namespace is evaluating.
- Positive regression: concurrent composition loads all 13 registered adapter factories and their exact Agent entry points as fully initialized functions; the existing real concurrent Integrity, Visual QA, and Goal Build contracts remain the execution-level regressions. The obsolete source-inspection test that asserted the absence of an old Build gate was deleted instead of being rewritten around the new import spelling.
- Exit condition for this audit is one clean typecheck plus the focused positive adapter/Integrity/Visual QA/Build contracts. Only after they pass may one final clean-database Prism Task start.

## Codex review feedback

- Do not change acceptance-spec sources to point directly at `system-project-contract`; that would create a second traceability model beside RequirementSet.
- Do not make the SDK infer package semantics from role names or prompt text.
- Do not treat the Orchestrator's terminal tool unwind as an independent running worker. The actionable lifecycle defect is the settled A2A source Session retained as idle; close it at the exact coordination action boundary.

## Bounded Goal graph and concurrent acquisition correction

### Recall

- User requirements:
  - the complete Prism workflow must run end to end;
  - identify adjacent defects before another long run instead of discovering them one by one;
  - independent browser acquisition must run concurrently rather than being serialized merely because one researcher owns discovery;
  - every Prism Task must have fewer than eight Goals.
- Acceptance:
  - Architect persists one to six end-to-end delivery Goals plus exactly one dependent system-acceptance Goal, for a total of two to seven;
  - every evidence-backed delivery surface and route remains present with its exact identity and evidence inside exactly one delivery Goal;
  - every Goal-scoped PRD/design/code/surface-review node processes the complete assigned-surface set; Task-scoped integration/integrity nodes own Artifacts rather than synthetic Goals; MirrorTest runs only against the sole system-acceptance Goal;
  - independent source candidates use reusable concurrent Browser acquisition lanes, while true click/navigation/state dependencies remain ordered;
  - a fresh isolated TradingView Spaces Task proves the Goal count before downstream dispatch and then completes all 17 mandatory workflow identities.
- Hard constraints:
  - this is a package-owned prompt/contract correction, not a Host Goal-count gate, fallback, route/surface cap, or second workflow engine;
  - no surface, route, requirement, screenshot, state, journey, or review evidence may be discarded to satisfy the Goal bound;
  - browser parallelism must not regress to one Browser Session per candidate, and all Sessions must be destroyed after acquisition;
  - preserve unrelated worktree changes and do not touch the live application, port 7878, or production database;
  - no User Interface automation test may be added, modified, or run.
- Read sources and records:
  - this repair record and the full-workflow incidents above;
  - `2026-07-26-prism-surface-evidence-fanout-resource-stability.md`;
  - package Architect, Orchestrator, source-research, all Goal-scoped lifecycle agents, task-scoped fan-in agents, MirrorTest agents, manifest, README, Mission Skill references, and package/SDK tests;
  - Browser MCP session lifecycle contract proving operations against one Browser Session are serialized.
- Full-repository search:
  - enumerated every old `PRD Goal`, `Design Goal`, `Code Goal`, `verification Goal`, `integration Goal`, `surface Goal`, `system-acceptance Goal`, and fixed formula reference across source package, Mission payload sources, tests, and current record;
  - enumerated every `reuse it sequentially`, `one Browser Session`, and browser-session concurrency reference;
  - found that the old Architect formula was repeated through Orchestrator, Mission decomposition/ownership/stage map, downstream single-surface prompts, integration fan-in, MirrorTest ownership, and positive package fixtures.
- Independent agent feedback: none; the user did not request sub-agent delegation.

### Causal evidence

- Clean isolated Task `tsk_fb61a5947001F5fX2EEpWRdR2J` completed real TradingView Spaces source research and one Requirements pass with 15 registered requirements.
- Its Architect drafted 18 Goals before persistence: four lifecycle Goals per discovered surface plus shared/integration/acceptance Goals, directly following the package prompt and the package test formula. It had not persisted a Goal when the Task was deliberately cancelled, so durable Goal count remained zero and every Session settled terminally.
- The defect is therefore the package's explicit Goal model, not an uncontrolled Host API or an LLM ignoring instructions.
- One Browser MCP Session serializes operations by contract. The earlier “one Session reused sequentially” correction prevented 30 sidecars but also prohibited real candidate concurrency. The correct ownership is a reusable pool of acquisition lanes: one Session per concurrently active lane, reused for multiple independent candidates, never one Session per candidate.
- A provider `429` occurred during the cancelled clean run and the same Session resumed after cooldown. It is external capacity evidence, not the Goal-cardinality root cause.

### Current contract

1. Architect creates one to six end-to-end delivery Goals plus one system-acceptance Goal.
2. Every delivery Goal owns the full Product Requirements, design, implementation, and surface-verification lifecycle for one or more assigned surfaces.
3. When more than six surfaces exist, the Architect partitions every surface into at most six coherent execution batches using evidenced runtime ownership, dependencies, template/behavior families, and writable-path boundaries. Batching changes scheduling ownership only.
4. Task-scoped design integration, code-system integration, and code integrity publish exact Artifacts and never receive synthetic local Goals.
5. MirrorTest's implementer, integrity reviewer, and visual reviewer all execute the sole system-acceptance Goal.
6. Independent discovery candidates run across the smallest reusable pool of concurrent Browser acquisition lanes that provides real parallelism. Only actual navigation/state dependency chains remain sequential within one lane.

## Initial Task wake message boundary

### Recall

- The first bounded-Goal E2E attempt used a fresh isolated home, database, project clone, project-scoped Prism `2026.07.31.3` package, and server on port `51551`; the live application and port `7878` were untouched.
- Task `tsk_fb66c4fd6001wfCj0Ktdwtlihs` received its creator request directly as the Orchestrator's visible `# User Request`, with no `rootMessage` identity because no later Task-root operator message triggered this wake.
- The Orchestrator read the Task intent bundle correctly, then called `read_task_message`; that tool returned `Task ... wake has no task-root message identity`.
- The processor did continue to the next model step. The second provider request then produced no bytes for 300 seconds, retried once, and reached the configured 300-second inactivity timeout. This was not a scheduler/session deadlock.
- The Task was explicitly cancelled through the isolated API. Cancellation aborted the live prompt, terminalized both Task-owned Sessions, wrote the lifecycle report, and the isolated server then shut down cleanly.

### Causal evidence and disposition

1. The initial creator request and later Task-root messages have different transport identities. The former is already the normal User Request; only the latter has the exact `rootMessage` ID required by `read_task_message`.
2. The dynamic prompt correctly requires `read_task_message` when `event.rootMessage` exists, but the static core and tool description only said that the tool reads “this wake.” They did not explicitly prohibit treating the initial User Request as an unread Task-root message.
3. The model therefore made an avoidable tool call. Its error forced a second full Orchestrator inference over approximately 63,000 estimated input tokens, where the external provider subsequently hit its inactivity timeout.
4. Repair the model-facing contract at all three prompt surfaces: static core, dynamic no-root provenance, and tool description. `read_task_message` is eligible only when Wake Provenance explicitly supplies `Current rootMessage=<id>`.
5. Do not add a Host gate or hide the tool. The execution-time identity check remains the data-integrity boundary, while correct tool selection remains prompt-owned.
6. Add positive prompt contracts for both identities: the initial User Request is already readable input, and an explicit Current Wake Root Message requires exactly one `read_task_message` call.
7. Restart end-to-end acceptance from a new Task and clean isolated database so the repaired first decision is proven without a historical tool error or provider retry.
