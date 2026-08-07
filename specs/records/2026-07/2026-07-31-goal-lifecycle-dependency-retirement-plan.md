# Goal lifecycle dependency retirement plan

Date: 2026-07-31

Status: Implementation residuals closed after two independent read-only
audits. The operator rejected the intermediate ContractGraph protocol-version
field, so the implementation exposes exactly one strict unversioned graph.
Focused non-UI contracts, generated payload consistency, and a fresh persisted
Mirror Watch topology probe pass. Full Prism visual delivery and terminal
Mirror Watch report acceptance remain release-level work and are not claimed.

Independent review amendment: the first 2026-07-31 audit rejected the original
implementation-complete status and opened four P1 and two P2 findings. A second
audit found two remaining P1 implementation defects, two P2 verification
defects, and one P3 record contradiction. The implementation findings are now
closed with the exact repairs and verification recorded below; release-level
visual and terminal workflow acceptance deliberately remain open.

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Diagnose the cancelled Prism Task `tsk_fb6c3605c001BMuxy3LyKiQtgA`, separate infrastructure defects from Expert Squad defects, then decide whether `Goal.depends_on` should be deleted and package a complete systemic repair plan. The user explicitly removed network failures from this repair scope. |
| Acceptance criteria | Remove Goal-to-Goal whole-lifecycle blocking as a concept, not merely as one stored field. Preserve binding Expert Squad workflow-node evidence order. Contract, ownership, bootstrap, integration, acceptance, scheduling, public schema, generated payload, Software Development Kit (SDK), documentation, and real-task verification must converge on one source per responsibility. The repaired Prism workflow must have no Goal/workflow composition deadlock and must retain complete end-to-end evidence. |
| Hard constraints | No fallback, compatibility alias, hidden migration, Host admission gate, workflow engine, state machine, automatic dispatch, keyword rule, second readiness source, or versioned ContractGraph protocol. The project is unpublished: there is exactly one strict current ContractGraph shape, and the Database (DB) is rebuilt rather than migrated from old Goal or graph artifacts. Keep all Large Language Model (LLM) interaction streaming. Do not add, modify, update, or run User Interface (UI) automated tests. Non-UI tests must assert positive current contracts. Preserve unrelated worktree files. The user explicitly authorized the isolated `codex/goal-dependency-retirement` worktree after the initial plan draft; do not create another worktree. Commit subjects use `dsw-33987` and delivery pushes to `legacy-remote/v0.0.26beta`. |
| Runtime evidence | The Prism Task created three serial delivery Goals and one dependent system-acceptance Goal. Prism's binding workflow required a Task-scoped design integrator to wait for every applicable delivery Goal's design review, while each delivery Goal's implementation waited for that integrator. Goal 2 could not start before Goal 1 terminal completion, but Goal 1 could not reach implementation or terminal completion before Goal 2's design evidence. The Orchestrator detected this composed cycle only after Goal 1 design review. |
| Sources read | `specs/current/architecture/02-data.md`, `03-control.md`, `99-principles.md`; `2026-07-07-dependency-contract-single-source-repair.md`; `2026-07-25-virtual-workflow-goal-applicability-repair.md`; `2026-07-30-orchestrator-ready-frontier-parallel-dispatch.md`; `2026-07-31-prism-requirement-topology-and-coordination-lifecycle-repair.md`; the current Goal schema, Engine persistence/projection, Architect tools and validators, Orchestrator prompt and adapters, Expert Squad manifests/prompts, Mission payload sources, SDK authoring schemas, generated Application Programming Interface (API) surfaces, and directly affected non-UI tests. |
| Whole-repository search | `rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!opencorvus-dist/**' "depends_on|dependsOn" .`; focused searches across `packages/opencorvus/src`, `packages/opencorvus/test`, `packages/sdk`, `expert-squads`, `specs/current`, and `specs/records/2026-07`; exact searches for `GoalDependencyContractSchema`, `register_dependency_contract`, `contract_producer_not_ancestor`, `dependency_contract_missing_depends_on`, Goal readiness, bootstrap dependencies, owned-path overlap, workflow frontier, system-acceptance Goal, and every manifest `depends_on`. The unbounded first scan timed out on repository volume, so the same search was completed by owned source/spec directory and file type. |
| Git baseline | The initial branch was four commits behind `legacy-remote/v0.0.26beta`. The remote delta did not overlap any untracked user path, and the main worktree was fast-forwarded from `7166d27978` to `0505eeb126` before this plan was written. After the user's explicit authorization, the plan was moved to branch `codex/goal-dependency-retirement` at `D:\myhexin-local\opencorvus-goal-dependency-retirement`; the main worktree returned to zero task-owned tracked changes. Existing untracked cache, distribution, Overlay, test, and July record files remain untouched. |
| Independent agent feedback | The user later explicitly requested an independent residual audit. Newton's first audit rejected completion with four P1 and two P2 findings. Its second audit found active Build/General wording, nested ContractGraph silent stripping, remaining positive-coverage gaps, a Windows payload command-length failure, and this record's contradictory status. Those findings drove the final prompt, strict-schema, test, payload-tooling, and record repairs. |

## Independent residual-audit amendment

The user explicitly requested an independent Agent after the first delivery.
That read-only audit found the following concrete residuals, and the user then
authorized continued repair:

1. Mirror Watch `research-survey-report` encodes cross-Goal phase handoffs as
   goal-to-goal workflow edges, while the Resolver defines goal-to-goal evidence
   as same-applicable-Goal evidence. Research, expert/persona survey, and report
   nodes therefore cannot satisfy one another. The package Orchestrator also
   still requires six retired dependency-reason records.
2. `ArchitectContractGraphSchema` was not strict and defaulted graph fields, so
   an obsolete object containing only `dependency_contracts` could be silently
   parsed as an empty graph.
3. the global Orchestrator prompt retains live Goal dependency mutation and
   readiness wording after the field was deleted.
4. the built-in Expert Squad authoring Skill, generated payload, and portable
   template still teach Goal dependencies as the Goal-mode contract.
5. several touched non-UI positive suites were over-deleted together with the
   retired dependency tests, removing provenance, atomicity, structural
   re-entry, context-projection, requirement-coverage, and no-op mutation
   coverage.
6. the final Prism initial-dispatch prompt repair has only static string tests;
   the prior runtime stopped after successful Task-relative reads. No complete
   Prism or Mirror Watch terminal run was persisted as reviewable evidence.

The remediation order is fixed: one strict unversioned ContractGraph;
executable
Mirror Watch topology and package wording; Core and authoring convergence plus
payload regeneration; restoration of positive current-contract tests; focused
and full non-UI verification; then fresh traceable runtime acceptance. The
repair must not add a Host gate, Goal ancestry replacement, compatibility
reader, fallback, or workflow state machine.

## Decision

Delete `Goal.depends_on` and every mechanism whose meaning is “one Goal must
reach terminal success before another Goal may start.”

Keep `capability_projection.virtual_workflows.*.nodes.*.depends_on`. A workflow
node dependency is a package-owned evidence-order contract between exact Agent
steps. It is not a Goal lifecycle dependency and is the sole remaining
scheduling-order source.

Also delete `ArchitectContractGraph.dependency_contracts`,
`GoalDependencyContractSchema`, and `register_dependency_contract`. Ordinary
ContractGraph contracts already name one producer Goal and zero or more
consumer Goals. That relationship defines an interface and its evidence; it
must not imply that the producer Goal's complete Product Requirements Document
(PRD), design, implementation, review, and acceptance lifecycle precedes the
consumer Goal's first action.

This decision supersedes the Goal-dependency portions of:

- `specs/current/architecture/99-principles.md` section 3;
- `2026-07-07-dependency-contract-single-source-repair.md`;
- `2026-07-25-virtual-workflow-goal-applicability-repair.md`;
- `2026-07-30-orchestrator-ready-frontier-parallel-dispatch.md`;
- the dependent system-acceptance Goal language in the current Prism record,
  package, and Mission Skill.

Their historical incident evidence remains valid. Their Goal dependency design
is retired rather than preserved as a compatibility mode.

## Why the current abstraction is structurally wrong

The same `Goal.depends_on` array currently owns four unrelated meanings:

1. **Whole-lifecycle scheduler barrier.** The DB comment and Goal contract say
   the producer Goal must complete before the consumer Goal starts.
2. **Contract ancestry.** A ContractGraph consumer is invalid unless its
   producer appears in Goal dependency ancestry.
3. **Writable-path overlap waiver.** Two feature Goals may claim overlapping
   paths when dependency reachability serializes them.
4. **Bootstrap and integration ordering.** A bootstrap Goal is expected in
   every other Goal's dependency list, while dependency reasons can be
   `bootstrap_scaffold` or `integration_order`.

The binding virtual workflow independently owns Agent-step evidence order.
Composing the two graphs creates edges at different granularities:

```text
Goal graph:       entire Goal A lifecycle -> entire Goal B lifecycle
Workflow graph:   A/B research -> A/B PRD -> A/B design
                  -> Task design fan-in -> A/B implementation
```

A Task fan-in before a Goal terminal point makes the combined graph cyclic even
when both source graphs are individually acyclic. This is not solvable by
stronger cycle validation on either graph in isolation.

The dependency field also rewards incorrect ownership. An Architect can make
overlapping `owned_paths` appear valid by serializing Goals instead of choosing
one owner, grouping coupled surfaces, or assigning shared stitching to the
Task-scoped integrator.

## Target responsibility model

| Concern | Sole owner after repair |
| --- | --- |
| What independently accepted result the Task must deliver | Goal contract: identity, objective, acceptance specifications, responsibility paths, priority, kind, RequirementSet and ContractGraph provenance |
| Which Expert Agent step may run after which evidence | Selected manifest virtual-workflow node `depends_on` |
| Which Goal defines an interface and which Goals consume it | ContractGraph `contracts[].producer_goal_id` and `consumer_goal_ids` |
| Which Goal coordinates a shared surface | Architect fidelity `assemblyOwners` |
| Which files or directories one Goal coordinates | Disjoint `owned_paths`; overlapping delivery ownership is repartitioned, never serialized |
| Bootstrap or shared environment preparation | A Task-scoped workflow node and its immutable Artifact |
| Shared design/code integration | A Task-scoped workflow node and its immutable Artifact |
| Terminal system acceptance | The sole system-acceptance Goal as an evidence scope; MirrorTest workflow predecessors determine readiness |
| Parallelism | Orchestrator derives the complete eligible workflow-node-instance frontier from selected workflow evidence, active execution, declared concurrency, and ownership |

Goals are therefore independent result scopes from creation. “Independent”
does not mean every Agent runs immediately: the selected workflow still
requires exact predecessor evidence for each node instance.

## Required invariants

1. A durable or projected Goal has no dependency field.
2. No DB row, API body, SDK type, worker context, prompt, or generated payload
   carries Goal dependency data.
3. ContractGraph contains interface contracts only. It has no executable
   dependency edge collection.
4. A contract producer/consumer relation does not create Goal readiness,
   terminal-success ancestry, or dispatch order.
5. Every delivery `owned_path` has one coordinating Goal. Overlap is repaired
   by ownership repartition, Goal grouping, or a Task-scoped assembly owner.
6. A bootstrap concern is not a lifecycle-wide prerequisite Goal. It is a
   Task-scoped workflow producer whose Artifact is consumed by the exact later
   nodes that require it.
7. A system-acceptance Goal has no Goal predecessors. Its projected MirrorTest
   nodes remain ineligible until their declared workflow predecessors have
   terminal-success evidence.
8. Orchestrator remains the only Task scheduler. Infrastructure exposes facts
   and executes exact calls; it does not compute a hidden ready set or queue.
9. Manifest workflow `depends_on` remains immutable, validated for references,
   canonical order, and acyclicity, and enforced by visible Orchestrator
   decisions.
10. Existing Goal/ContractGraph DB contents are not upgraded. The development
    DB is reset and rebuilt with current schemas.

## Complete production call-site disposition

### Goal contract, storage, and projection

| Files | Current responsibility | Disposition |
| --- | --- | --- |
| `packages/opencorvus/src/pipeline/types.ts`, `pipeline/goal-contract.schema.ts` | Canonical Goal contract and mutation schema include `depends_on`. | Delete the field from create/update types and normalization. Keep the remaining strict Goal contract. |
| `packages/opencorvus/src/engine/engine.sql.ts` | Stores `engine_goal.depends_on`. | Delete the column from the current schema. Reset DB; do not add a migration or legacy JSON reader. |
| `packages/opencorvus/src/engine/model.ts` | Projects Goal schemas through Engine events and API types. | Converge every Goal projection on the new exact contract. |
| `packages/opencorvus/src/engine/goal-graph-projection.ts` | Candidate and executable GoalGraph artifacts include dependency arrays. | Remove the arrays and update the exact projected Goal codec. Existing artifacts are discarded with the DB reset. |
| `packages/opencorvus/src/engine/persist.ts` | Maps logical/durable dependency IDs, validates add/modify references, cascades deletion, and versions dependency changes. | Delete dependency mapping, validation, mutation, cascade, digest, and comment paths. Preserve append-only Goal revision/projection identity for real contract fields. |
| `packages/opencorvus/src/engine/store.ts` | Resolves `effectiveDependsOn` through current Goal lineage. | Delete dependency resolution and the derived field. Preserve current Goal revision membership and provenance checks. |
| `packages/opencorvus/src/engine/describe.ts` | Renders dependencies for LLM scheduling. | Delete dependency data and prose. Render current Goal/attempt/owner facts only. |

### Architect and ContractGraph

| Files | Current responsibility | Disposition |
| --- | --- | --- |
| `packages/opencorvus/src/architect/contract-graph.ts` | Defines dependency reasons/edges, dependency cycles, contract ancestry, dependency/contract parity, and goal-neighborhood filtering. | Replace it with the sole strict ContractGraph containing only `contracts`. Delete dependency types, cycles, ancestry, parity findings, dependency-neighborhood traversal, and protocol-version fields. Preserve contract identity, kind-specific shape, producer/consumer existence, evidence, artifact paths, summaries, and Contract Intermediate Representation (IR) validation. |
| `packages/opencorvus/src/architect/output-tools.ts` | Registers dependency edges, mutates Goal arrays, allows path overlap through dependency reachability, and requires bootstrap dependency fan-out. | Delete `register_dependency_contract`, dependency mutation/cascade/rendering, reachability helpers, and bootstrap fan-out. Make overlapping executable Goal ownership an Architect blocker resolved only by disjoint ownership, Goal grouping, or explicit Task-scoped assembly ownership. |
| `packages/opencorvus/src/architect/agent.ts` | Carries dependencies from collector to result and prompt summary. | Project the dependency-free Goal and ContractGraph result. |
| `packages/opencorvus/src/orchestrator/architect-stage.ts` | Validates and persists Architect Goal dependencies. | Remove unknown-dependency and mapping paths; persist the exact dependency-free GoalGraph and ContractGraph atomically. |
| `packages/opencorvus/src/prompt/core/architect-core.txt` | Documents Architect tool sequence and assembly responsibility. | Make Goal partition, unique ownership, contracts, and assembly owners explicit. Do not introduce a replacement ordering tool. |

### Orchestrator and worker inputs

| Files | Current responsibility | Disposition |
| --- | --- | --- |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Treats unsatisfied Goal dependencies as dispatch blockers and uses them to derive the frontier. | Define the frontier only over selected workflow node instances, terminal evidence, active execution, `goal_concurrency`, task capacity, and worktree/ownership facts. |
| `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts` | Says Goal graph controls readiness while workflow controls node order. | Delete Goal-readiness language. Preserve same-Goal, Goal-to-Task, Task-to-Goal, and Task-to-Task workflow evidence semantics and complete-frontier dispatch. |
| `packages/opencorvus/src/orchestrator/tools.ts`, `goal-lifecycle-tools.ts` | Permit/guard Goal dependency mutation and display it in tool results. | Remove dependency inputs, graph-mutation guards, comparison/digest logic, and result text. Keep explicit Goal add/modify/remove for current fields and Architect structural re-entry ownership. |
| `packages/opencorvus/src/orchestrator/build-tool.ts`, `packages/opencorvus/src/build/types.ts`, `build/agent.ts` | Send effective Goal dependencies to Build. | Remove that input. Build receives the exact current Goal, selected RequirementSet/ContractGraph, relevant Artifacts, and natural Orchestrator guidance. |
| `packages/opencorvus/src/delegated-worker/context.ts` | Projects Goal dependencies into delegated context. | Remove the field; keep exact work scope and current Goal facts. |
| `packages/opencorvus/src/goal-workload-analyst/input-projection.ts`, `prompt.ts` | Include dependency arrays in workload analysis. | Analyze the Goal's objective, acceptance, paths, contracts, evidence, and repository facts without lifecycle edges. |
| `packages/opencorvus/src/integrity/acceptance-tools.ts`, `fact-projection.ts`, `team-agent.ts` | Project dependencies as acceptance/review context. | Remove the field. Integrity evaluates current Goal acceptance and evidence; workflow order is not copied into the Goal review payload. |

### Public and generated surfaces

| Files | Current responsibility | Disposition |
| --- | --- | --- |
| `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/types.gen.ts`, `gen/sdk.gen.ts` | Publish generated Goal dependency fields. | Regenerate from the current OpenAPI source after Core schemas change; do not hand edit generated files. |
| `packages/sdk/js/src/expert-squad-manifest-v1.ts`, `expert-squad-authoring.ts` | Define manifest workflow node dependencies. | Preserve. These are workflow evidence edges, not Goal dependencies. |
| `packages/opencorvus/src/expert-squad/catalog-profile.ts`, `multica-import.ts`, `packages/opencorvus/src/skill/builtin/multica-import.md` | Copy, validate, and explain manifest workflow dependencies. | Preserve except wording that could confuse workflow edges with Goal payload transport. |
| `packages/opencorvus/script/generate-portable-expert-squad-template.ts`, `packages/opencorvus/generated/expert-squad-payload.ts`, `packages/opencorvus/src/skill/builtin-payload.ts`, `mission-skill/builtin-payload.ts` | Generate manifests, Skills, and Mission payloads containing both workflow edges and historical Goal-dependency prose. | Preserve manifest edges; regenerate payloads after source prompts/references remove Goal lifecycle dependency language. |

## Expert Squad and Mission disposition

| Package or source | Disposition |
| --- | --- |
| All eight repository `expert-squad.jsonc` manifests, including the source-tree General package | Preserve every workflow-node `depends_on` edge and exact selected topology. No manifest dependency is renamed or deleted by this repair. |
| Prism Stage Architect prompt and `product-requirements-planning` Skill | Create independent delivery Goals plus one independent system-acceptance evidence scope. Remove “register exact dependencies” and “system acceptance depends on every delivery Goal.” Require disjoint ownership, coherent grouping, cross-route contracts, and assembly owners. |
| Prism Orchestrator prompt and coordination Skill | Schedule complete workflow-node-instance frontiers. Task-scoped fan-in waits on exact workflow evidence for all applicable delivery Goals; no Goal terminal state controls another Goal's first node. |
| Prism README and Mission references `goal-decomposition.md`, `goal-ownership.md`, `stage-map.md`, `virtual-workflow-contract.md`, and generated Mission payload | Replace dependent-Goal wording with workflow evidence fan-in and independent evidence-scope wording. Preserve 17/19 mandatory nodes and two-to-seven Goal cardinality. |
| Mirror Watch workflow Architect prompt | Delete its requirement to call `register_dependency_contract` six times or materialize Goal dependency arrays. Keep the canonical survey and expert/persona/report producer-consumer contracts. The manifest workflow remains the ordering authority. |
| Research Studio, Review & Debug, Frontend Replica, Frontend Innovate, OpenTest, General, and other Mirror Watch package prompts | Preserve manifest workflow order. Update only exact Goal-schema fixtures or prose that treats Goal dependencies as a second scheduler source. |
| Multica import | Preserve source workflow dependency import and validation. Imported workflow edges remain package execution contracts, not Engine Goal fields. |

## Test cleanup and positive verification matrix

The implementation touches existing negative dependency and UI-adjacent test
paths. Follow the current test rules:

- delete tests whose only contract is rejection or absence of the retired Goal
  dependency design;
- rewrite mixed tests around positive current outputs;
- do not add source-string absence assertions;
- do not create, update, or run any UI automated test.

| Positive contract | Required evidence |
| --- | --- |
| Dependency-free Goal contract | Create, persist, revise, describe, and load Goals with the exact current field set; current revision and provenance remain stable. |
| ContractGraph | A multi-Goal graph with typed producer/consumer contracts, evidence references, and assembly ownership persists and reloads exactly. |
| Unique ownership | A coherent multi-surface partition produces one exact owner per responsibility path and one explicit assembly owner for shared stitching. |
| Architect structural re-entry | Repartitioned Goals retain unchanged logical identities where appropriate and atomically publish the complete current GoalGraph plus ContractGraph. |
| Orchestrator direct Goal mutation | Add/modify/remove preserves exact current fields and reprojects one current graph without dependency-specific guards. |
| Build and delegated contexts | The exact current Goal, RequirementSet, ContractGraph, relevant Artifact provenance, and workload facts reach the selected worker. |
| Binding workflow projection | Every dispatch-scope combination retains exact evidence semantics; complete independent frontiers are dispatched in one decision epoch. |
| Prism resolved package | Generic and AInvest retain exact 17/19-node graphs; all delivery Goal instances can progress through PRD/design before Task fan-in, and MirrorTest targets the system-acceptance Goal after workflow predecessors. |
| Mirror Watch resolved package | Survey, expert, persona, and report stages retain exact workflow order and typed producer/consumer Artifact contracts without Engine Goal edges. |
| SDK and generated payload | Authoring, Registry, Resolver, OpenAPI, SDK, package payload, and Mission payload expose one current dependency-free Goal schema while retaining manifest workflow dependencies. |
| Fresh DB execution | A clean Task creates dependency-free Goals and executes the complete selected workflow without reading historical Goal or ContractGraph bytes. |

Directly affected test families discovered by the repository search include:

- Architect `output-tools`, owned-path overlap, structural re-entry, agent, Goal
  tool schema, and fidelity tests;
- Engine Goal contract, versioning, projection, deletion, description,
  collaboration facts, writer, artifact binding, attempts, completion, and
  rewind fixtures;
- Orchestrator tools, no-op mutation, core prompt, build contract audit,
  delegated worker, scheduler projection, and streamed fact-flow tests;
- Build, workload-analysis, Integrity, server route, Workbench, artifact
  catalog, project/runtime fixture, and shared Agent fixture tests;
- Expert Squad package/Resolver/Registry/Multica tests and SDK generated,
  authoring, Prism, and Review & Debug collaboration tests.

Every touched test file must be inspected before execution. Existing UI tests
encountered in a touched path are deleted without running; existing negative
tests are deleted or rewritten as positive current contracts.

## Implementation sequence

### Phase 0 — land the decision record

1. Add this record and both required indexes.
2. Run historical links, document health, product-document single-source, and
   diff checks.
3. Commit with the `dsw-33987` prefix and push to legacy remote before product code.

### Phase 1 — retire the Core Goal field

1. Remove `depends_on` from the canonical Goal contract, DB schema, Engine
   event/API model, GoalGraph codec, writer, current-revision resolver, and
   descriptions.
2. Remove Goal dependency mutations and delete-cascade behavior.
3. Update all worker input projections.
4. Add or rewrite positive Goal round-trip and revision contracts.
5. Reset the development DB after the schema lands; do not create a migration.

### Phase 2 — replace ContractGraph v1

1. Publish strict ContractGraph with `contracts` only.
2. Delete dependency reason/edge types, tool, validation, rendering, cascade,
   and ancestry utilities.
3. Make shared ownership converge through `assemblyOwners`; make delivery
   paths uniquely coordinated.
4. Rewrite Architect positive contracts around the exact unversioned output and structural
   re-entry.

### Phase 3 — make workflow evidence the sole scheduler order

1. Remove Goal readiness from the Orchestrator core and Resolver projection.
2. Preserve complete-frontier dispatch over exact workflow node instances.
3. Preserve all dispatch-scope fan-in semantics:
   - Goal-to-Goal requires predecessor evidence for the same applicable Goal;
   - Goal-to-Task uses the one Task predecessor;
   - Task-to-Goal waits for every applicable Goal predecessor instance;
   - Task-to-Task uses the one Task predecessor.
4. Remove dependency-specific Orchestrator mutation guards and Build context.
5. Verify no Host ready queue, state machine, or hidden gate was introduced.

### Phase 4 — converge packages, SDK, payloads, and documents

1. Rewrite Prism and Mirror Watch Goal-dependency instructions.
2. Preserve all manifest workflow dependency graphs.
3. Regenerate expert-squad payload, Mission Skill payload, OpenAPI, and SDK.
4. Update current architecture `01-agents.md`, `02-data.md`,
   `04-extensions.md`, and `99-principles.md`.
5. Append implementation and verification evidence to this record and update
   affected historical records only with explicit supersession notes; do not
   rewrite their incident history.

### Phase 5 — clean-runtime acceptance

1. Start from a fresh OpenCorvus home, DB, target repository, and
   project-scoped package import.
2. Run positive non-UI Core/Architect/Orchestrator/SDK/package contracts,
   typecheck, generation checks, API route checks, and docs checks.
3. Run a fresh complete Prism generic Task against a real desktop source:
   - inspect the persisted dependency-free GoalGraph before downstream work;
   - verify all applicable delivery Goal research/PRD/design instances can
     enter their workflow frontier without Goal terminal barriers;
   - verify Task-scoped design and code fan-in occurs only after exact
     predecessor evidence;
   - complete implementation, non-UI checks, real-page interaction,
     screenshots, personal visual review, and MirrorTest release judgment.
4. Run a fresh Mirror Watch Task to prove its report topology is preserved
   without `register_dependency_contract`.
5. Confirm terminal Task acceptance, exact Artifact provenance, no live
   Session, and no historical Goal dependency bytes in the fresh DB.

## Verification commands

The implementation must narrow commands as code lands, then run the complete
current non-UI suite relevant to the changed contracts. The final minimum is:

```powershell
bun test packages/opencorvus/test/architect
bun test packages/opencorvus/test/engine
bun test packages/opencorvus/test/orchestrator
bun test packages/opencorvus/test/expert-squad
bun test packages/sdk/js/test
bun run --cwd packages/opencorvus typecheck
bun run docs:check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

Do not run a broad test command blindly before inspecting touched test paths
for prohibited UI or negative tests. Real-page validation is an interactive,
task-bound acceptance activity and must not be saved as an automated test,
fixture, or screenshot baseline.

## Delivery and commit boundaries

1. Plan/index commit.
2. Core Goal schema and Engine commit.
3. ContractGraph/Architect commit.
4. Orchestrator/worker projection commit.
5. Expert Squad/SDK/generated/document convergence commit.
6. Focused repair commits for any defect exposed by the clean runtime.
7. Final acceptance-record commit.

Every commit subject starts with `dsw-33987`. Each meaningful repair commit is
pushed to `legacy-remote/v0.0.26beta` after the relevant checks pass. Concurrent remote
changes are fetched and incorporated on the main branch before the next push;
no additional worktree or second delivery branch is created.

## Rejected alternatives

- **Keep `Goal.depends_on` and add composed-cycle validation.** This preserves
  two scheduler graphs and merely rejects one symptom after creating it.
- **Rename the field to `blocked_by`, `requires_goal`, or `after_goal`.** This
  retains the same whole-lifecycle barrier.
- **Keep dependency contracts as non-executable metadata.** Ordinary contracts
  already carry producer/consumer identity; a second edge list would be a
  duplicate source.
- **Allow owned-path overlap when execution is serialized.** This hides
  ambiguous ownership and keeps integration coupling inside delivery Goals.
- **Move Goal dependencies into Host workflow state.** This creates the
  forbidden gate/state-machine design.
- **Delete manifest workflow dependencies too.** This discards mandatory
  package evidence order and allows implementation or release judgment before
  their required producers.
- **Upgrade historical DB rows or accept both old and current ContractGraph shapes.** The
  project is unpublished and explicitly requires a reset rather than
  compatibility debt.

## Completion criteria

This repair is complete only when all of the following are true:

- current production source, generated code, package resources, current
  architecture, and live Expert Squad instructions contain no Goal dependency
  field, type, prompt, tool, persistence, projection, API, SDK, or generated
  payload contract; dated incident records may retain explicitly historical
  descriptions;
- repository manifests still contain and validate their exact workflow-node
  dependencies;
- ContractGraph is the only accepted current graph shape;
- every delivery responsibility path has one coordinating Goal or explicit
  Task-scoped assembly owner;
- the current architecture documents Goal independence and workflow-owned
  evidence order;
- positive non-UI contracts, generation checks, typecheck, API/docs health,
  fresh Prism, and fresh Mirror Watch acceptance all pass;
- real Prism UI acceptance includes current screenshots and personal visual
  review without a persisted UI automation test;
- every Task/Session is terminal and legacy remote contains the complete main-branch
  delivery.

## Second review

The plan-only review traced the current field from Architect input through DB
persistence, API/SDK generation, Orchestrator projection, package prompts, and
generated payloads. It found and corrected three plan defects:

1. the package inventory originally counted seven manifests and omitted the
   source-tree General manifest from the count;
2. the delivery text originally prohibited the newly user-authorized worktree
   instead of prohibiting additional worktrees;
3. the completion grep originally included immutable dated incident records,
   contradicting the requirement to preserve their historical evidence.

The implementation review remains mandatory. It must trace the final schema
through the same boundaries plus clean-runtime evidence; separately enumerate
all surviving `depends_on` uses and prove each belongs to a manifest workflow
or Mission collaboration graph rather than an Engine Goal.

## Implementation and verification record

The implementation deleted the Goal dependency field from the canonical
schema, current DB schema, persistence and current-revision projection, API and
SDK types, Goal descriptions, worker inputs, Workbench, Integrity, Architect,
and Orchestrator mutation surfaces. ContractGraph is one strict unversioned
shape with `contracts` as its only collection; `version` and
`dependency_contracts` are both invalid unknown fields. Producer/consumer
interfaces no longer create lifecycle ancestry. Architect ownership overlap is
always a planning blocker to be repaired through repartition, coherent Goal
grouping, or a Task-scoped assembly owner.

All repository manifest and Mission-stage `depends_on` fields remain. An exact
source and generated-schema traversal classified the survivors as virtual
workflow or Mission collaboration edges; no production Goal object carries
`depends_on`, `dependsOn`, `GoalDependencyContractSchema`,
`register_dependency_contract`, or `dependency_contracts`.

The implementation also repaired five defects exposed by clean-runtime
acceptance:

1. package staging validation compiled package tools before the atomic Windows
   rename and retained filesystem handles, causing `EPERM` (Error: operation
   not permitted); staging now performs strict catalog validation and the
   installed canonical path performs the full runtime load;
2. the selection-only expert catalog intentionally omitted the active profile,
   but the Prism Orchestrator interpreted that omission as evidence to switch
   to General; Core and tool descriptions now preserve an explicit matching
   fixed Task profile;
3. the shared `read` executor accepted Task-relative paths while its public
   schema required an unspecified absolute path, inducing `/root/project` on a
   Windows Task. The dispatcher now renders the exact Task directory and the
   read contract truthfully prefers Task-relative paths. A fresh Prism Task
   then read its audit copy, repository root, HTML, CSS, server, and package
   files from the exact Windows directory;
4. the typed projected-worker regression cleared the Session runtime contract
   without disposing its scoped Browser Model Context Protocol (MCP) owner,
   leaving a live Windows file handle over the temporary fixture. The test now
   closes the real owner before disposing the project Instance;
5. the public Task brief route fixture created an Engine Task without its
   required root Session, so the route correctly returned `500`. The positive
   fixture now binds a real root Session and verifies the public brief.

Prism's scheduler also absorbed worker-owned repository and OpenTest
inspection before dispatching the source node. Its package system prompt and
coordination Skill now assign initial observation to the selected workflow's
sole initial worker and require immediate dispatch after loading the Skill.
This is package-owned decision guidance, not a Host gate.

Positive non-UI verification completed:

- OpenCorvus and JavaScript SDK typechecks;
- API route generation/check, documentation generation/check, historical-link,
  document-health, and product-document single-source checks;
- focused Goal create/revise/delete/describe/projection, ContractGraph,
  Architect ownership/re-entry, Orchestrator mutation/context/prompt,
  workflow projection, Prism/Mirror Watch package, Registry/Manager, Build,
  Integrity, Workbench, acceptance, and SDK collaboration contracts;
- fresh DB schema inspection proving `engine_goal` has no dependency column;
- clean Prism runtime startup proving the active Prism profile is retained and
  Task-relative reads resolve to the exact Windows Task directory.

Fresh OpenAI `gpt-5.6-sol` runtime evidence after removing graph versioning used
a new DB, new project, and freshly released bundled payload. Mirror Watch Task
`tsk_fb81bf9f8001szBXMpCY93X6Fs` completed Requirements Session
`ses_047dc9f33ffe3Vo242WN37PgpZ` and Architect Session
`ses_047d964e9ffezgwT1fB55z5Fqm`. It persisted exactly one final-report Goal
`gol_fb828c556001uKOO6o9MpIwGwl`. ContractGraph Artifact
`art_fb828c556002csGTOeSmzMTHe7` contains an actual `graph` value of exactly
`{"contracts":[]}`; no protocol-version field exists. Task-scoped research
Session `ses_047d69f25ffeq5dUktVi1eh3y0` then started. The probe was deliberately
cancelled before external iFind work. A required persona cohort count was
answered through the real Interaction route with `N=1`; the rerun bound the
first immutable authority identity rather than defaulting a cohort.

The full 17-node Prism product delivery, current screenshot/personal visual
review, and a terminal Mirror Watch delivery were not completed. They remain
explicit release-level acceptance work; mocked or startup evidence is not
presented as their substitute.

## Implementation second review

The second review retraced Goal construction, persistence, projection,
description, mutation, Build/delegated/Integrity/Workbench consumption,
OpenAPI/SDK generation, package payload generation, and current architecture.
It also inspected every surviving `depends_on` source and the generated OpenAPI
paths. The review found no second Goal readiness source and no Host-side ready
queue, gate, fallback, compatibility reader, migration, or state machine.

The review additionally rejected treating the clean-runtime `/root/project`
failure as generic model noncompliance. The visible system directory alone did
not correct it; the contradictory `read` schema was the causal instruction.
Correcting that contract changed the next fresh Task's actual tool inputs to
relative paths and produced successful Windows-bound reads.

The independent second audit then found two active implementation residuals:
Build Core still described prerequisite Goal references, and General's
Orchestrator still assigned generic dependencies/readiness to Architect and
Workload Review. It also proved that strictness stopped at the ContractGraph
root, allowing nested contract, route, component, ContractIR, field, and value
domain objects to silently strip unknown `version` or `depends_on` keys. The
active wording now names interface contracts, disjoint Goal boundaries,
acceptance coverage, and selected-workflow predecessor evidence. Every nested
ContractGraph and ContractIR object boundary is strict, with exact schema-error
tests at graph, contract, route, component, IR, field, and value-domain paths.

The same audit exposed two verification defects. The Build projection test had
been weakened to substring checks; it now compares the complete transient
Build message produced from the exact selected Goal and catalog-discovery
overlay. Current projection selection, append-only Goal revision, complete
delegated-worker Goal context, database immutability, and transactional
rollback have focused positive contracts. The payload suite's Windows
`ENAMETOOLONG` failure came from passing every authoring path to one
`git ls-files` process. It now compares the indexed payload module and complete
authoring root as bounded index sets, uses a Windows-realistic timeout, and
passes generation consistency without a command-line-length dependency.

The second audit's P3 status contradiction is closed by this record's current
status: implementation residuals are closed; full Prism visual delivery and a
terminal Mirror Watch report are still unperformed release acceptance, not an
implementation-complete or release-complete claim.

A third independent read-only closure review found no P0/P1 residual and one
P2 coverage omission: FieldSpec strictness was proven by runtime injection but
not pinned by the regression matrix. The matrix now injects `version` at the
exact `contracts/0/ir/fields/0` path and asserts the typed `unrecognized_keys`
error. The reviewer reran that contract and closed the final P2.
