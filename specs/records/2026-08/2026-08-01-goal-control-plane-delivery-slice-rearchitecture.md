# Goal control-plane and Delivery Slice rearchitecture

Date: 2026-08-01

Status: implementation in progress

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | The operator supplied two cancelled production Tasks whose Goal sets remained pending while their Orchestrators were stopped, asked why Goal-enabled Tasks fan out, loop, and lose forward progress, then explicitly requested that the architecture be dismantled and rebuilt. All Squad Software Development Kit (SDK) surfaces and every adapted Expert Squad must converge. Independent Agents must review repeatedly until a complete audit round finds no new defect. |
| Additional acceptance | The control plane must remain complete. In particular, the panel's Goal rows must continue to update progress from real execution and review facts. Removing mutable Goal lifecycle state must not produce a static or blank Goal panel. |
| Observed incidents | Prism created four delivery Goals but no recorded contribution. The earthquake Task produced one scaffold contribution while the remaining six Goals stayed pending. Both Tasks ended only because the operator stopped the root Task. These terminal labels are symptoms, not root cause evidence. The shared implementation currently multiplies every `dispatch_scope: "goal"` workflow node by every applicable Goal, opens a Goal attempt, returns `started`, and relies on a later `goalTerminalRefill` prompt-only wake to make the Orchestrator consume the terminal result. |
| Hard constraints | No Host workflow gate, ready-frontier state machine, compatibility alias, fallback, synthetic/hidden message, automatic step advancement, or second lifecycle source. Host code may validate typed identity and immutable provenance only. Task is the sole business lifecycle. Goal becomes a thin versioned Delivery Slice contract. All Large Language Model calls remain streaming. Database (DB) schema is rebuilt, not migrated. Non-User Interface (UI) changes require positive current-contract tests. UI automated tests are not added, modified, or run; UI acceptance uses the real page and personally reviewed screenshots. Preserve all concurrent work, especially Expert Squad package-revision provenance. |
| Current architecture read | `specs/current/architecture/02-data.md`, `03-control.md`, `04-extensions.md`, `07-panel-reactivity.md`, `09-verification-evidence.md`, `13-agent-communication-matrix.md`, `15-agent-facts-and-turns.md`, `99-principles.md`; `2026-07-31-goal-lifecycle-dependency-retirement-plan.md`; `2026-07-30-terminal-refill-and-prompt-loop-convergence.md`; `2026-08-01-expert-squad-project-over-global-resolution.md`. |
| Whole-repository search | Enumerated Goal schema, Goal revision, attempt/result/workspace/status, lifecycle tools, terminal-refill ingress, Build dispatch, Session/runtime identity, Artifact Catalog, Task API, panel/Board projection, generated OpenAPI/SDK, manifest `dispatch_scope`, agent `goal_concurrency`, portable templates, all tracked package manifests, and installed project/global package copies. Eight tracked package definitions contain 46 Goal-scoped workflow nodes: General 1, Prism 22, OpenTest 8, Mirror Watch 3, Frontend Innovate 5, Frontend Replica 3, portable template 4; Research Studio and Review Debug contain no Goal node but still declare Goal concurrency. |
| Concurrent changes | The dirty worktree contains another valid Expert Squad package-revision and project-over-global installation implementation, including runtime descriptors, Registry/Resolver, Artifact Catalog, package Manager/routes, Overlay settings, plugin producer, generated SDK/OpenAPI, tests, and two screenshots. This rearchitecture must reuse its exact package revision/digest types and merge around it; generated SDK/OpenAPI run once after both source changes converge. |
| Git baseline | The unpushed checkpoint subject was rewritten from `Checkpoint before Phase 02: ...` to `dsw-33987 Checkpoint before Phase 02: ...` without changing either commit tree. The old head remains recoverable at `refs/backup/codex-before-dsw-subject-rewrite-20260801`. Baseline `28f9df3c58` was pushed to `legacy-remote/v0.0.27beta` after SDK import, AI runtime, package typecheck, route, docs, Overlay i18n, and secret-scan hooks passed. |
| Independent Agent feedback | Three read-only Agents independently reached the same boundary: deleting only Goal dependencies or repairing refill is insufficient; the complete Goal attempt/result/retry/workspace/status/fan-out chain must retire. Reviews additionally require stable logical Delivery Slice identity plus immutable revision identity, exact package revision binding, real-message-linked terminal facts, Task-owned completion decisions, Task-level workflow node cardinality, and a derived—not mutable—panel progress projection. |

## Root causal chain

1. A package declares a binding workflow containing Goal-scoped nodes.
2. Resolver language turns each such node into one runtime instance per applicable Goal.
3. Build opens a Goal attempt, starts an asynchronous child Session, and returns `started` before terminal evidence exists.
4. Child termination writes mixed physical/business result data and emits `goalTerminalRefill`.
5. The root Session receives provenance in a system prompt but no new natural participant message. A normal prompt turn may therefore settle with prose, fail to call completion/rejection tools, or re-enter the same scheduling explanation.
6. The panel renders a second Goal lifecycle derived from attempts/results while Task terminality is owned elsewhere. The two lifecycles drift, so a cancelled Task can truthfully remain a set of pending Goals even after useful work was committed.
7. Prism magnifies this shared defect: 22 Goal-scoped nodes multiplied across delivery surfaces create dozens of Sessions for a workflow that should have one Task-wide research/design/build/review chain.

The terminal `cancelled` state and package names are not causes. The causes are cardinality multiplication, split terminal delivery, and duplicate business lifecycle ownership.

## Target responsibility model

| Concern | Sole owner after cutover |
| --- | --- |
| Task business lifecycle | Task plus append-only `task_completion_decision` |
| Delivery scope | Stable `delivery_slice_id` and immutable `delivery_slice_revision_id` containing objective, acceptance specifications, owned paths, priority, kind, and exact RequirementSet/ContractGraph refs |
| Workflow order | Selected package `virtual_workflows.*.nodes.*.depends_on`; every node is instantiated once per Task |
| Workflow selection | One immutable, visible selection decision bound to Task, workflow ID, package revision/digest, and selecting scheduler message/tool identity; no current-node or step-status storage |
| Physical execution | Session, dispatch lineage, execution attempt, completed assistant message or terminal error/tool event |
| Review | Reviewer artifact bound to exact Slice revision and exact execution evidence, with accepted/rejected/inconclusive judgment |
| Goal panel progress | Read-only projection from applicable Task workflow nodes, live/terminal Sessions, Artifact Catalog entries, reviewer artifacts, and Task completion decision |
| Package identity | Existing exact Expert Squad package revision/digest provenance; no latest-version fallback |

## Goal panel control-plane contract

The user-facing label remains **Goal** in this cutover because it is the product term operators already use. Its internal contract is a Delivery Slice, not an execution owner.

Each panel row projects these independent facts:

- contract revision: title, objective, acceptance, ownership, revision time;
- execution activity: applicable Sessions currently streaming or retrying;
- workflow coverage: applicable Task nodes with terminal evidence versus total;
- evidence coverage: artifacts explicitly subject-tagged with the exact Slice revision;
- review: latest exact-revision accepted/rejected/inconclusive reviewer fact;
- Task settlement: whether the Task completion decision cites the accepted review.

The display state is computed on read and event refresh:

- `not_started`: no applicable execution or evidence;
- `in_progress`: a live applicable Session or terminal node coverage is incomplete;
- `in_review`: execution coverage is complete and a reviewer decision is pending;
- `changes_requested`: the current exact revision has a rejected review;
- `accepted`: the current exact revision has an accepted review;
- `settled`: Task completion cites that accepted review.

These names are transport/UI projection values, not stored lifecycle fields and not scheduling gates. Editing a Goal creates a new Slice revision; evidence from an older revision remains visible history but cannot satisfy the current row.

## Schema and runtime deletion matrix

| Current surface | Disposition |
| --- | --- |
| `engine_goal` status semantics | Rename the contract source to Delivery Slice; preserve stable logical identity and immutable revisions. Remove status/retry/workspace execution meaning. |
| `goal_attempt`, `goal_attempt_result`, `goal_workspace_binding` artifacts | Replace with Session/dispatch execution facts and exact reviewer artifacts. Physical abort is not a business rejection. |
| `complete_goal`, `reject_goal_attempt`, `query_failed_goals` | Delete. Task completion remains an explicit Orchestrator decision citing exact accepted evidence. |
| `goalTerminalRefill` / `goal_terminal_refill` | Delete. A child terminal result is a real tool/session result linked to its final assistant message or terminal error event. |
| Goal work scope / Session `goal_id` / `goalAttemptID` | Delete as runtime ownership. Typed worker inputs may carry `delivery_slice_revision_ids` as subject selection only. |
| `dispatch_scope` | Delete from manifest v1. Workflow nodes are Task nodes by definition. |
| `goal_concurrency` | Delete. Agent concurrency belongs to Task dispatch capacity, not Goal multiplicity. |
| Goal status aggregation | Replace with the read-only panel projection defined above. It cannot affect scheduling or Task completion. |

## Complete call-site groups

The implementation must cover every member of these groups; a partial rename is not acceptable:

1. Engine and identity: `engine.sql.ts`, `model.ts`, `persist.ts`, `store.ts`, `describe.ts`, `artifact.ts`, `protocol.ts`, `writer.ts`, `rewind.ts`, `execution-abort.ts`, `queue.ts`, `id.ts`, `goal/**`.
2. Architect contracts: `architect/contract-graph.ts`, `fidelity.ts`, `output-tools.ts`, `agent.ts`, `orchestrator/architect-stage.ts`, and the Architect prompt.
3. Dispatch/runtime: `agent/projected-agent-work-scope.ts`, `runner.ts`, `worker-turn-descriptor.ts`, `session/runtime-contract*.ts`, Session schema, Build agent/tool/types, delegated worker context, decision/mailbox tools, cancellation, message bridge, and Task events.
4. Orchestrator: Goal lifecycle/diagnostic tools, tool schemas/effects, `orchestrator/event.ts`, `agent.ts`, `loop.ts`, `dispatch-agent-tool.ts`, Resolver text, and Core prompt.
5. Evidence/public surfaces: plugin Artifact Catalog/producer, OpenCorvus Artifact Catalog, metrics, verification, Task API, panel capabilities, server routes, OpenAPI, generated JavaScript SDK, and web API docs.
6. UI: Board/TaskBoard projection, Goal group, Task directory bar, progress utilities, diff grouping, debug information, status snapshot, i18n, and real desktop screenshots.
7. Expert Squad package system: manifest SDK, authoring SDK, Registry, Multi-Capability Agent (MultiCA) import, catalog/profile/resolver, authoring Skill, generated built-in payload, portable template, repository packages, project-installed Prism, and user-global Research Studio/Review Debug.

## Squad convergence matrix

| Package | Current Goal-node count | Required Task-level redesign |
| --- | ---: | --- |
| Advanced | 1 | Each declared implementation workflow node is one Task worker dispatch using explicit Slice refs when useful. |
| Mirror Prism | 22 | Each workflow becomes one Task-wide chain: research/requirements/architecture, UI evidence, Product Requirements Document (PRD)/design package, implementation/integration, independent review. Surfaces are Slice subjects, not workflow multipliers. |
| OpenTest | 8 | Test architecture/execution/review operates once per Task and cites affected Slice revisions. |
| Mirror Watch | 3 | Survey/research/aggregation/report chain runs once per Task. |
| Frontend Innovate | 5 | Research/design/build/visual review runs once per Task; UI regions are Slice subjects. |
| Frontend Replica | 3 | Evidence/design/build/parity review runs once per desktop Task. |
| Research Studio | 0 | Keep the embedded built-in package on the same Task-only terminology and schema revision. |
| Review Debug | 0 | Remove agent `goal_concurrency` and update terminology/schema revision. |
| Portable template | 4 | Demonstrate Task workflow plus typed optional Delivery Slice inputs, never per-Slice dispatch. |

Installed copies are updated explicitly after tracked sources validate. The project Prism package has local cluster wording that must be merged, not overwritten. User-global package writes retain exact manifest identity and package lock behavior.

## Implementation sequence

1. Freeze this decision and positive contracts.
2. Remove `dispatch_scope` and `goal_concurrency` from SDK source; redesign all tracked workflows and package documentation; regenerate package payloads.
3. Introduce stable Delivery Slice identity/revision and derived progress while old read paths still compile; positive tests prove revision and projection.
4. Cut physical execution over to Task/Session/dispatch lineage and real terminal results; remove terminal refill and Goal attempt business results.
5. Delete obsolete Goal tools, status/retry/workspace ownership, API fields, and DB columns/artifacts; reset development DB rather than migrate it.
6. Update Artifact Catalog, metrics, review, API, generated SDK/OpenAPI/docs, and all current architecture documents.
7. Replace panel rendering with the derived progress contract. Delete any touched obsolete UI automated tests and dedicated fixtures without running them. Start the real page, interact with a running Task, capture and personally inspect screenshots for not-started, active, review, and accepted states.
8. Update project/global installed packages through the normal package protocol.
9. Run independent read-only audits in repeated rounds. Every finding returns to its owning layer; completion requires one entire round with zero new findings.

## Positive acceptance contracts

1. A Task with three Delivery Slices instantiates each selected workflow node exactly once, never three times.
2. Editing a Slice preserves logical identity, produces a new immutable revision, and makes the panel project only exact-revision review acceptance as current.
3. A child Session terminal event exposes its real final message/error locator to the parent tool result exactly once; restart reconstruction produces the same fact without duplicate business completion.
4. Task completion cites exact accepted current Slice revisions, selected workflow, and package revision/digest.
5. Panel Goal progress moves through real activity, evidence, review, and Task settlement facts without writing a Goal status field.
6. All eight tracked packages and the portable template validate through the new SDK schema; Prism no longer creates 22 nodes per delivery surface.
7. Installed Prism, Frontend Innovate, Mirror Watch, and Review Debug resolve with exact updated package revisions and no fallback; Research Studio resolves only from its embedded built-in package.
8. OpenAPI, JavaScript SDK, generated payload, API docs, current architecture, package README/prompts/Skills, and runtime schemas describe one model.
9. No production source contains live Goal attempt/workspace/refill/fan-out ownership. Historical records remain historical and are not rewritten.

## Independent audit exit searches

Each final audit round records production/SDK/package results for:

```text
goal_attempt|goal_attempt_result|goal_workspace_binding
complete_goal|reject_goal_attempt|query_failed_goals
goalTerminalRefill|goal_terminal_refill
dispatch_scope|goal_concurrency|disjoint_goals
work_scope.*goal|kind: "goal"|session.goalID|goalAttemptID
retryCount|workspaceDir|goalStatus
```

Matches are classified by exact code responsibility. Historical records and explicitly explanatory retirement text are allowed; runtime compatibility, aliases, generated stale fields, and package guidance are not.

## Codex independent review feedback

Round 2 found that the first implementation pass was incomplete. These findings are part of the implementation contract and must be re-audited after repair:

1. Dispatch lineage must persist the selected workflow ID, exact workflow node ID, package identity, revision, and digest. Agent identity is not workflow-node identity. Task completion must cite the same selected workflow/package facts.
2. Board workflow totals must come from the selected declared graph, not from already-observed dispatches. Only terminal-success node evidence counts as complete; error and abort remain visible non-success facts.
3. Slice settlement requires a Task completion decision whose typed evidence locators reference the real accepted review Artifact for that exact current Slice revision. A completion decision must never be synthesized into a review.
4. Dispatch, Visual Quality Assurance review, Integrity review, and Task completion must validate exact current Slice membership at their immutable write boundaries.
5. Canonical Task schema, OpenAPI, generated SDK, and public docs must expose accepted Slice revision IDs and deliverable Artifact locators returned by runtime storage.
6. Every Artifact commit that changes Board projection must emit a post-commit invalidation event; Slice revision replacement must emit `TaskUpdated` just like add/delete.
7. Build is Task-only, always receives the canonical persisted Task request, and cannot retain a `kind: "goal"` target. Worktrees are created only after the child Session identity exists and always use Task+Session canonical identity.
8. Overlay conversation projection must not retain Session/message `goalID`, Goal badges, `role="goal"`, or Goal-grouped card ownership after the backend projection removes them.
9. General, Frontend Replica, and Prism package text and required references must not recreate executable Goals, per-surface attempt counters, repeatable workflow nodes, or singular-Goal Task-wide evidence packets.
10. Root/public documentation and positive generated-document tests must describe the Task-only lifecycle and current generated request fields.
11. Every Slice card projects the complete selected Task workflow; nodes without Slice-specific adapter fields still count because workflow execution is Task-owned. Slice-specific evidence/review remains exact-revision scoped.
12. Every Orchestrator wake directly exposes the immutable workflow/package binding and each declared node's dispatch plus real Session terminal facts, so context restoration does not guess once-per-Task history from prose.
13. Worktree ownership marker writes are awaited before entering the child Instance, and the child Session creation callback runs immediately after persistence so any later initialization error remains linked to the dispatch outcome and lineage.
14. Mailbox/message protocol, model events, scheduler descriptions, Artifact tool text, and benchmark metrics contain no Goal execution/retry identity.
15. Adapted Squad README, Orchestrator, implementer, and portable-template contracts cannot route a completed once-per-Task review node back into an already-run implementer node. Findings settle the Task as blockers or justify a separately scoped Task.
16. Every discovered project/global installed adapted Squad must be updated through `ExpertSquadPackageManager.updatePackage`; this includes installations outside the current repository project such as the Prism and Mirror Watch demo projects.
17. Task completion decision persistence and the Task terminal transition must be one database transaction. A concurrent terminal winner is reported with its real lifecycle result, and Board/Task description may consume only the completion fact that owns the real completed terminal timestamp.
18. The built-in Expert Squad authoring Skill and portable SDK template must generate the same complete completion contract as adapted packages: typed evidence, deliverable Artifact locators, accepted current Slice revisions, exact workflow identity, and immutable package revision/digest.
19. Every child Session enters the shared terminalization boundary immediately after persistence. Failures in lineage callbacks, lifecycle disposal checks, Model Context Protocol (MCP) owner initialization, or other pre-run setup must still persist a real terminal error/abort and return the child Session identity.
20. No Session test fixture, Task/Session lineage contract, or Overlay screenshot grouping may retain `goal_id`, `sessionGoalID`, message-part `goalLabel`, or Goal-owned execution headers.
21. Touched execution-boundary tests must prove the current Task-only outcome and typed error response; retired Goal execution inputs are deleted rather than retained as negative compatibility assertions.
22. A full audit round counts as clean only after authoring source, generated payload/template, installed packages, runtime transaction boundaries, and tests are all rescanned from the post-repair tree.
23. Core and package prompts cannot authorize same-Task redispatch of an already-dispatched workflow node, including a platform Build escape after terminal review. A finding that requires a node to run again blocks the current Task and belongs to a new fixed-profile Task.
24. Coordination continuation binds to the original dispatch lineage and exact logical workflow-node occurrence. The caller cannot choose a new workflow subject or create a second occurrence while fulfilling the original coordination action.
25. Expert Squad Manager, routes, OpenAPI, and JavaScript SDK expose canonical installed package version and digest; update availability is true when either version or digest differs, including same-version byte drift.
26. Every self-contained package contract, including Research Studio, states that each selected workflow node executes exactly once per Task.
27. Workflow progress may summarize one logical node occurrence but must not hide duplicate physical dispatch lineage. Duplicate prevention comes from exact lineage/continuation identity, not from panel deduplication or a host scheduling gate.
28. A coordination continuation must project the frozen original Delivery Slice revision subjects into the worker adapter input as well as lineage; caller-supplied subject arrays cannot diverge from the logical occurrence.
29. Every shared child-Session creator, including generic delegation, enters the same terminalization boundary immediately after persistence and awaits terminal status publication on cancellation.
30. Retired `goal_group` identity generation is deleted when it has no live caller; execution grouping is Task/Session-owned.
31. Installed-package discovery must enumerate every registered project again in each final audit round. Newly discovered legacy installs are updated through Manager before the next zero-finding audit.
32. Completion concurrency must identify the winning exact decision Artifact, not infer ownership from a possibly equal millisecond timestamp.
33. Coordination successor lineage creation, source Session settlement, and coordination-action completion form one atomic/idempotent write; one action owns one successor occurrence.
34. Manager `skipExisting` results report the actual installed target version and canonical digest, never the bundled source revision that was not installed.
35. Delivery Slice add/modify/delete notifications are awaited uniformly so task-list Server-Sent Events (SSE) become durable before the mutation tool returns.
36. `terminalTask` evaluates no-op and terminal competition only from the transaction-current Task row, never from a caller snapshot that may predate reopen.
37. Base is a real adapted built-in Squad and carries the same complete Task completion decision contract as every other package.
38. A real post-create signal cancellation returns typed evidence containing the persisted child Session identity after publishing its terminal abort.
39. Unregistered on-disk project installations are still existing adapted installations; e07 Frontend Innovate and e09 Review Debug must be updated and included in the next audit inventory.
40. After `recordSession`, any cancellation race normalizes a generic downstream error into cancellation evidence that retains the real child Session ID and original cause.
41. Core prompt and lifecycle/tool descriptions contain one non-pass review rule: fail the current Task and route repair through a new fixed-profile Mission Task; no same-Task repair branch remains.
42. Completion lifecycle schemas and persistence helpers have an acyclic import boundary and pass direct-module-import execution, not only application-entry typecheck.
43. Because Board workflow progress is Session-fact-derived, `session.status` Server-Sent Events refresh the selected Board as well as conversation cards; UI acceptance must visibly confirm terminal progress updates.
44. Every implementation adapter exposes explicit exact `goal_ids` subjects. Build dispatch lineage freezes those revision IDs, the worker sees the same immutable subject list, and Board progress derives from the resulting real Build Session instead of test-only lineage injection.
45. Task description exposes the stable Delivery Slice identity, exact current revision identity, numeric revision, and immediate prior revision for every current Slice; the Orchestrator must not reconstruct lineage from a one-hop `supersede_of` field.
46. Fact-check Session creation awaits asynchronous lineage binding inside the shared runner terminalization boundary, so callback rejection still produces a durable terminal child Session result.
47. The built-in Advanced package fully replaces the removed General package across runtime defaults, resolver contracts, authoring SDK, generated payloads, documentation, and positive tests; `general` remains only where it names an unrelated Mission skill or ordinary prose.
48. Runtime-template and package overlays must compose without contradictory work ownership. Advanced `test-engineer` uses the generic delegated-worker runtime so its independent test-only contract is not overridden by Build implementation instructions.
49. Dispatch lineage and Task completion decision enforce one immutable workflow binding symmetrically inside their write transaction. A late first dispatch cannot race a prepared completion decision into a conflicting direct or virtual binding.
50. Wrong immutable Slice subjects fail the current Task; they never authorize a fresh same-Task occurrence. The core prompt, dispatch target descriptions, and positive prompt contracts all route repair through a new fixed-profile Mission Task.
51. Squad authoring and portable SDK documentation name the real adapter field `goal_ids`; `delivery_slice_revision_ids` is the persisted lineage representation, not a public dispatch field.
52. Goal mutation and terminal-Task reopening share one transaction-owned persistence boundary; unchanged edits preserve the terminal lifecycle, and the post-commit wake is emitted only after an applied mutation.
53. Goal deletion returns one canonical typed mutation receipt through service, route schema, OpenAPI, and JavaScript SDK, including the exact new GoalGraph projection Artifact locator.
54. SDK generation resolves current SDK TypeScript source through an explicit package export condition before OpenAPI generation, so stale `dist` cannot hide or block new authoring exports.
55. Every Slice-aware dispatch adapter accepts the canonical `goal_ids` subject field, freezes it into lineage, and exposes the same subjects to its worker, including delegated worker, frontend research, and frontend design nodes used by adapted squads. Empty remains an explicit zero-Slice selection.
56. Base has the same non-pass settlement rule as every adapted Squad: a failed or blocked independent test fails the current Task, and repair plus fresh verification belongs to a new fixed-profile Mission Task.
57. Board progress projects a physical Session only onto lineage-selected Slice revisions; an explicit empty subject list means Task-wide. Declared workflow totals remain visible on every current Slice, while active and terminal counts stay exact-subject scoped.
58. Dispatch lineage and Task completion decision revalidate exact current Slice subjects inside their committing transaction, so a concurrent revision cannot leave terminal or execution facts bound to superseded revisions.
59. The built-in Research Studio identity supersedes its former installed-package form. Exact uninstall must still remove an already-installed stale package after that identity becomes built in, while runtime discovery and generated payloads expose only the built-in source.
60. Orchestrator execution-boundary fixtures must use the real initial-dispatch workflow subject, Advanced as the built-in implementation package, Task-owned Build targets, and the actual child-Session callback ordering; fabricated package revisions or Goal-owned targets cannot stand in for current lineage evidence.
61. A Task-wide dispatch lineage is applicable execution evidence for every current Slice even when its child Session terminates with error or abort. The panel cannot regress a real non-success occurrence to `not_started` merely because no active or terminal-success Session remains.
62. Rewind is conversation visibility only. Current Delivery Slice contracts and immutable Task workflow facts remain authoritative together; a post-cursor current revision cannot disappear from the Orchestrator prompt while its workflow execution remains visible.
63. Panel card, disclosure, and focus identity use stable `deliverySliceID`. The current Goal row ID remains only the exact revision subject for mutations and displayed revision facts, so editing a Slice cannot discard local disclosure/focus ownership.
64. Model-facing Task restoration guidance cannot authorize same-Task redispatch after infrastructure, orphaned tool, or failed child-Session evidence. A non-pass occurrence fails the current Task; repair, provider change, and fresh verification belong to a new fixed-profile Mission Task.
65. SDK repository package calibration discovers both runtime built-ins and external authored packages from the Git index. No hand-maintained built-in exception may omit Base, Advanced, Research Studio, or a future package from the fact/Turn contract.
66. Base publishes the same complete Fact and Turn and Artifact transport contract as every other package, including natural final narration, typed completion decisions, platform Artifact tools, strict JSON publication, exact locators, and immutable import lineage.
67. Base and Advanced package identities use role-compatible runtime templates: Explore owns research, Delegated Worker owns planning and independent testing, Build owns implementation, and no package overlay contradicts its inherited runtime ownership.
68. Explore final narration is visible Turn closure, not durable evidence transport. Package-required evidence is published through canonical Artifact tools and remains independently addressable from the Task catalog.
69. A direct Task workflow binding still projects one real Board progress unit. Its active child Session moves every current Slice to `in_progress`, and its terminal-success Session moves them to `in_review` without a virtual workflow node.
70. Frontend Research accepts the complete authorized HTTP source set in one workflow occurrence. A one-URL host maximum cannot force duplicate logical node dispatches.
71. Architect has one decomposition occurrence per selected Task workflow. No `structural_reentry`, rerun mode, or prior-run host path may create an additional same-Task Architect occurrence.
72. Goal mutation, retry, and replan are valid only before immutable workflow execution facts exist. After the first dispatch or completion occurrence they return a typed conflict that directs fresh execution to a new fixed-profile Mission Task; the current Task and Slice revision remain unchanged.
73. Every Task wake and worker turn restores the exact content-addressed package revision captured by its immutable workflow binding. Built-in and installed packages both resolve from the canonical snapshot digest in persistent application data, never from disposable cache or the latest active package bytes.
74. Every Goal producer converges on the sole transactional writer guard, and retry/replan/Goal HTTP routes publish the same typed `TaskWorkflowOccurrenceConflictError` 409 contract in runtime and OpenAPI.
75. Reopening a completion-only Task preserves its immutable direct workflow binding in Task description and Board progress, while settlement remains current-terminal-only and cannot leak the prior accepted completion into the new wake.
76. An existing worker Session may continue only with the exact `WorkerTurnDescriptor.packageRevision` that created its prior Turn; matching agent projection hashes cannot conceal package digest drift.
77. The first workflow occurrence freezes `prompt_profile.active` and the selected package revision. Same-ID selection reports the pinned projection; different-ID tool or operator-message changes return the typed profile-change conflict.
78. Direct Task description projects one canonical logical progress node while preserving every physical dispatch, exact Slice subject list, child Session status, terminal success, and duplicate lineage entry.
79. `add_goal`, `modify_goal`, and `delete_goal` are model-visible pre-occurrence contract-authoring tools only. Post-occurrence correction fails the current Task and belongs to a new fixed-profile Mission Task.
80. Adapted package Skills invoke tracked helper scripts through an explicit interpreter (`bash` or `python3`) because package snapshots and ZIP transport do not preserve executable mode as a runtime contract.
81. Base publishes one complete Fact/Turn/Artifact contract at version `2026.08.01.8`; duplicate prose is removed rather than retained as a second authoring authority.
82. Scheduler recovery and proposal guidance never routes a rejected review, failed wave, or Architect validation finding back into same-Task Goal mutation, structural re-entry, or redispatch; it fails the immutable occurrence and lets Mission create a new fixed-profile Task.
83. Profile-change compensation is transactionally occurrence-aware. If asynchronous continuation or message processing has already committed workflow evidence, rollback returns the typed conflict and preserves the profile/package identity that owns that occurrence.
84. Task-message transport publishes both cancellation-incomplete and immutable workflow profile conflicts as an explicit 409 union in OpenAPI and generated SDK types; the runtime and control-plane client cannot disagree about the profile freeze boundary.
85. The Session config writer is the sole profile-mutation authority: it derives Task-root ownership and current/next active IDs itself, so direct session-config routes and package-removal rewrites cannot bypass the post-occurrence freeze with omitted or forged guard inputs.
86. Every Task root persists its creation-time active profile even when the caller omits `promptProfile`; the first dispatch/completion transaction compares its package ID to that root source, rejecting a stale scheduler wake that resolved before a legal pre-occurrence profile change.
87. Clearing a pre-occurrence Task profile override materializes the resolved project-default ID back into the root overlay, so the Task never falls through to a mutable project source or a stale creation snapshot.
88. Session profile updates for registered execution directories derive their base from the owning Project worktree, and the public Session config route publishes the same typed 409 profile-freeze conflict in OpenAPI and SDK.
89. Root Session creation persists the Task config snapshot and explicit active profile before the Task row becomes visible. First dispatch/completion rejects a missing frozen active source instead of accepting an undefined profile after a process interruption.
90. Expert Squad uninstall replaces project and unbound root references only. A workflow-bound Task root keeps its frozen active profile and resolves the exact content-addressed package revision after the installed package is removed; route code delegates binding ownership reads to the engine service boundary.
91. Retry/replan accepts only a terminal pre-occurrence Task. Lifecycle and occurrence validation, passive-wake cleanup, and the exact intent wake insertion share one database transaction, while active/queued callers receive a typed lifecycle conflict and cannot race an already-running root wake.
92. Retry/replan cleanup discards only passive wait/activity wake facts. Accepted operator messages, coordination requests, infrastructure recovery, and control intents remain durable and are never erased by a fresh control intent.
93. The final post-repair independent audit round closed with zero new issue locations from three separate reviewers: Goal/control-plane projection, physical execution/workflow occurrence boundaries, and Squad SDK/package/installed-closure consistency.
