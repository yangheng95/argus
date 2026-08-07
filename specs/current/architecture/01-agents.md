# 01 — Agents And Scheduler Runtime

> Current sources: `packages/opencorvus/src/agent/primary-assistant-registry.ts`,
> `helper-agent-registry.ts`, `host-agent-registry.ts`,
> `runtime-template-registry.ts`, `dispatch-adapter-contract.ts`,
> `runner.ts`, `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`,
> and `packages/opencorvus/src/orchestrator/agent.ts`.

OpenCorvus core provides a general streaming development runtime. Agent-team
inventory, labels, collaboration policy, and domain instructions belong to the
active expert-squad package.

Goal is the user-facing name for a versioned Delivery Slice. It is a durable
description of one delivery surface and its acceptance contract; it does not
own execution, concurrency, retries, workspaces, or lifecycle. Task is the sole
business-lifecycle owner.

## Identity Families

| Registry/projection          | Identity                                 | Owns                                                                                                       |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Primary assistant registry   | product-facing assistant ID              | Coding, Chat, Mission, and Control session contracts.                                                      |
| Helper registry              | private helper ID                        | Title, summary, and compaction model/prompt slots.                                                         |
| Host registry                | host agent ID                            | The scheduler/Orchestrator runtime identity.                                                               |
| Runtime template registry    | `base_role` template ID                  | Core prompt seed, session kind, model default, trusted tools, permission boundary, and typed adapter.      |
| Active capability projection | `capability_projection.agents.<agentID>` | Exact dynamic worker identity and its effective prompt/model/tool/skill/Model Context Protocol projection. |

These identity spaces are disjoint. A runtime template is never a running
worker identity. Display stage, session kind, author, label, and directory name
cannot replace the projected `agentID`.

## Active Expert Squad

`prompt_profile.active` is the only active expert-squad selection source.
`PromptProfileResolver` loads that exact project package and produces a frozen
scheduler capability plus one frozen worker capability per projected agent.
The materialized default is the embedded `base` package. Base is Advanced's
convenient composite non-Goal delivery package. Its compact binding workflow
dispatches the distinct Explore `base-researcher`, Delegated Worker `base-planner`,
Build `base-developer`, and Delegated Worker `base-tester` identities in order.
Its fixed verified-delivery variants additionally dispatch package-owned
Integrity `base-integrity-reviewer` and Visual Quality Assurance
`base-visual-reviewer` identities when system completeness or real rendered
acceptance evidence is required. Their canonical core handoffs are
`base/research-report`, `base/implementation-plan`, `base/development-report`,
and `base/test-report`; the specialist reviewers use the platform typed
IntegrityReview and VisualReview artifacts. The embedded `advanced` package remains independently
selectable as the full requirements, architecture, investigation, interface,
and specialist-review team. The embedded `research-studio` package independently
projects its five research identities and three report-delivery workflows. None of the packages aliases, inherits, or combines the
other package's projection.
Inactive packages remain discoverable through catalog manifest and selector
metadata for Task planning and installation management. They do not contribute
active runtime prompts, tools, skills, Model Context Protocol providers, mounts,
or runtime hashes. Mission selects an exact manifest ID when it creates a new
Task; an existing Task never exposes a runtime squad-selection tool. Discovery
is complete enumeration plus exact selector-name loading; host keyword filtering
is not a routing source.

Each worker capability binds:

- squad and exact agent identity;
- required runtime template and dispatch-adapter Application Binary Interface
  versions;
- effective prompt and model digests;
- trusted core tools plus explicit package tool, skill, and Model Context
  Protocol grants;
- session/tool projection contract and projection hash.
- immutable workflow-node identity and optional Delivery Slice revision
  subjects supplied by the scheduler.

Every scheduler and worker also receives the non-shadowable Task Artifact
discovery/provenance tools `artifact_search`, `artifact_read`, and
`artifact_select`; workers additionally receive `artifact_snapshot` and
`artifact_publish`. Consumers enumerate the catalog themselves, completely
read exact immutable locators, and select only the Artifacts that semantically
support their typed output. Complete but unselected reads remain observations,
and zero selections are valid. Dispatch input and Agent messages never
transport Artifact inventories, locators, or bodies.

`artifact_snapshot` returns one compact `TaskArtifactResourceSetLocator` whose
snapshot digest content-addresses the complete canonical tree manifest. The
model passes that locator, never expanded `TaskArtifactRef` arrays, to generic
or typed publishers. Trusted Host code resolves and verifies the complete
ordered refs before persisting the unchanged Engine Artifact envelope. A null
resource set is the sole model-facing representation of an output with no
files.

The frozen scheduler capability also carries the manifest v1
`capability_projection.virtual_workflows` record. An explicit empty record means
the package is a direct-dispatch Squad and does not fabricate Requirements,
Architect, or Goal stages. Each declared graph is an immutable scheduler
contract: it names projected agents, descriptions, and evidence dependencies.
Every node is instantiated once for the Task. The Orchestrator visibly selects the
exact graph matching the request before dispatch. Every node in that selected
graph requires terminal-success evidence, and every dependency edge is binding;
missing evidence causes refusal rather than omission, skipping, substitution,
or reordering. The graph has no active/default selection field, step status,
auto-advance, persisted state, or host execution authority.

Missing templates, adapters, resources, provider refs, or dynamic identities
fail during resolution or dispatch. No alias or name-guessing path exists.

## Scheduler Decision Loop

The host Orchestrator receives the user request, immutable Task source, and
persisted task evidence. It chooses real tool calls using the active package
scheduler instructions. The core does not supply a stage list or automatic
transition table. At each decision epoch the Orchestrator reasons backward from
the Task's observable acceptance claims: it binds each claim to its exact
projected producer or verifier, binds required predecessor evidence and runtime
facts, derives the dependency-ready frontier, dispatches every mutually
independent owner up to capacity, and reconciles terminal evidence before the
next decision.

Every scheduler decision epoch reads the selected virtual workflow, real
predecessor evidence, immutable workflow-selection decision, active Sessions,
dispatch lineage, and Task-wide capacity. Independent nodes fill
the available capacity through separate `dispatch_agent` calls in the same
assistant response. A `started` acknowledgement closes duplicate scheduling
only for that exact dispatch lineage; it does not defer an already-eligible sibling to a
later wake. Explicit selected-workflow predecessor paths, exhausted capacity,
active ownership, and overlapping current-project
Build mutations are the serialization boundaries. The Host does not compute or
persist a frontier, admit workers, or dispatch automatically.

Each Delivery Slice has a stable logical identity and immutable revisions that
define objective, acceptance, ownership, priority, kind, and exact RequirementSet
and ContractGraph references. Slice revisions have no lifecycle or scheduling
fields. ContractGraph producer/consumer relations
are interface facts and never become a hidden readiness graph.

`dispatch_agent` requires an exact active projected `agentID`. The dispatch
adapter validates typed input, creates the real child session, persists its
worker descriptor, streams the model/tool conversation, records terminal
evidence, and returns visible output to the scheduler. Subsequent decisions
read task, goal, run, artifact, message, review, and decision-log facts.

The session row can precede descriptor persistence by one bounded runtime-tool
projection interval. Conversation and board projections omit that newborn row
only while it has no descriptor, message, or lifecycle evidence. Once any
observable worker activity exists, a missing descriptor is corruption and the
projection fails rather than guessing identity. The descriptor remains the
only projected-worker identity authority.

Physical Session cancellation has one separately typed origin. The initiating
Control, Mission, Session, Task, scheduler, Agent, Orchestrator, or runtime
boundary supplies actor, exact source/surface, request identity, reason, target
Session, and any Task, Mission, message, Tool, wake, queue, or causation-event
identity it owns. Prompt ownership and Large Language Model activity propagate
that origin unchanged; they do not infer it from error text or replace it with
a generic AbortError. Logical dispatch identity, Task lifecycle, and physical
Session cancellation remain distinct facts.

The visible task-root operator message that triggered a scheduler wake is the
operator request for that wake.
Diagnostic and status questions do not authorize continuation or graph
mutation. After execution starts, a point correction creates a new revision of
the exact Delivery Slice and binds its RequirementSet/ContractGraph refs. A new
Requirements turn appends another immutable RequirementSet interpretation; it
does not silently supersede existing Slice revisions. The Orchestrator exposes and
judges any conflict.

The scheduler prompt renders every projected worker with the exact legal
target-specific field names derived from that adapter's strict Zod schema.
Packages provide responsibility guidance, but cannot maintain a parallel field
table or relax the executable schema. This lets the model distinguish, for
example, one multi-source `deep_research` dispatch from a one-URL
`frontend_research` dispatch without a host routing gate.

Packages declare exact collaboration variants in
`capability_projection.virtual_workflows` and explain it in their README,
selector, scheduler overlay, and worker prompts. A selected graph is binding on
the Large Language Model scheduler: all nodes and dependencies must be
satisfied, while every dependency-independent ready node instance belongs to
the same parallel-first frontier up to the declared capacity and ownership
bounds.
Conditional paths require separate graph declarations. Neither the structured
graph nor prose may define a host workflow, hidden state, automatic transition,
dispatch engine, or synthetic progress event. Real scheduling and refusal
remain observable Orchestrator tool calls.

Cross-squad composition preserves the same boundary through Mission. Mission
owns the final outcome and dependent Task-sized delivery-closure ledger. Before
grouping delivery closures, Mission enumerates the complete requested scope and
partitions every deliverable, operation, mutable resource, acceptance obligation,
and evidence surface by positive held-Squad catalog ownership. Every unavoidable
ownership change is a separate stage and separate fixed-`promptProfile` Task;
only scope inside one such partition may be grouped into a coherent closure. The
graph contains one Task for every independently acceptable outcome with a
coherent mutable-resource and evidence lifecycle. One Task may satisfy several
Mission acceptance claims and produce several product, data, report, audit, and
validation deliverables when they form one accepted result. The same selected
Squad may own several Tasks when their results can be accepted, retried, and
delivered independently; Squad identity is capability authority, not Task
identity. Every unavoidable cross-squad scope partition is a separate Task
with one explicit `promptProfile` fixed for its complete lifetime; that Task
owns only its local Delivery Slices; and Agents are mandatory local
workflow roles rather than implicit cross-squad stages. Mission creates only
the earliest ready stage Task, passes exact terminal accepted predecessor
evidence, and creates the next stage only after reconciliation. A stage
is eligible for batching only when one exact selected Squad positively owns its
complete deliverables and acceptance boundary. Workload size, acceptance-item
count, formats, directories, Agent roles, Goal count, and parallel opportunity
alone never decide a Task boundary. Mission uses independently meaningful
acceptance, mutable-resource ownership, and real evidence dependencies.
Same-Squad Artifact exchange stays Task-local for one coherent result, while
independently accepted producer/consumer results remain separate Tasks with an
explicit Artifact edge. Different fixed-Squad ownership, a genuinely external
terminal-evidence or operator-authority boundary, and an explicit
separate-lifecycle request also require distinct Tasks. When the selected catalog owns
only an independently acceptable earlier subset of the request, Mission creates
that stage without waiting for authority needed only by a later stage, records
the uncovered dependent deliverables, and requests additional Squad authority
before creating their Task. The verbatim Original user input remains audit
evidence and cannot widen a stage beyond its authored in-scope, out-of-scope,
and acceptance contract. The stage
workflow may use one Requirements/Architect pair before Task-level delivery
nodes. Nodes cite affected Slice revisions but never repeat per Slice. The
fixed-profile Task and its complete selected workflow own the stage;
collaboration metadata never assigns it to one worker.

Mission acceptance is evidence-first. For each terminal child Task, Mission
enumerates the complete Artifact catalog and uses its Mission-only exact reader
to consume the current Completion Decision and every relied-on canonical
deliverable, report, and review through complete byte coverage. If a completed
or failed result still has a gap inside the same fixed-Squad authority, Mission
uses the explicit evidence-backed resume action: one visible Mission-authored
Task-root message, the exact reviewed terminal lifecycle reference, its fully
read locators, the same Task/root Session/workflow binding, and one new durable
execution occurrence. Ordinary terminal follow-up remains conversation-only.
Cancellation remains operator lifecycle authority. A later Task is reserved
for a genuinely independent accepted closure, different fixed Squad, external
evidence/authority boundary, or explicit separate lifecycle.

Every Task atomically binds its initial active profile and exact package revision
before it becomes visible. A wrong initial selection is corrected by creating a
new Task with the intended `promptProfile`; Task messages, Session overlays, and
package prompts cannot mutate the existing binding. Package prompts never choose
the next squad.

The Composer also fixes Mission's complete held-Squad authority. One or more
visible `@squad("<id>")` references authorize exactly those IDs; when no Squad
reference is present, including `@mission("<name>")` alone, the Mission catalog
snapshots every Squad installed at launch. The launch path persists those
exact IDs; later installation does not widen the Mission. Mission Skills
constrain orchestration but do not add Squad authority. Mission assigns every
stage to one persisted ID and never selects, borrows, installs, or generates
another Squad. A Mission-created Task renders `Task source: mission` into the
Orchestrator context, so its fixed profile cannot enter the ordinary
pre-execution selector correction path. If no held Squad owns a dependent
stage, Mission preserves its acceptance obligation and requests new operator
authority after completing any independently acceptable authorized stages.
Concurrent first wakes for the same Mission share the Mission-session creation
lock: an identical snapshot converges on the same session, while a different
snapshot returns an explicit immutable-authority conflict.

## Primary-Assistant Local Delegation

Coding and Chat expose `delegate_agent` for bounded work inside the current
interactive request. It creates one real standalone child session with the
parent session ID, directory, exact assistant identity, exact model, visible
messages, and inherited permissions. The child capability removes
`delegate_agent`, `batch`, durable workflow-control tools, and user-question
tools, so delegation is one level and cannot re-enter through a wrapper. Parent
cancellation cancels the child; the retained child session settles with an
explicit terminal status. The parent receives a compact conclusion plus a
`session:<id>` pointer and remains responsible for synthesis and verification.

This is not scheduler dispatch. `delegate_agent` does not create an engine
task or goal, select an expert squad, resolve a projected worker identity,
create a worktree, write workflow artifacts, or own task lifecycle.
`dispatch_agent` remains exclusive to the host Orchestrator and exact active
capability projection. Control, Mission, Orchestrator, and projected workers do
not receive `delegate_agent`; Coding and Chat do not receive `dispatch_agent`.

Mission is a full-function primary execution agent in addition to owning
durable Mission coordination. It shares the ordinary Coding execution surface:
shell commands, provider-appropriate file mutation, Browser Preview, Skills,
research, planning, and verification. Mission may complete bounded coordination
and direct operator work in its own session. Research, implementation, product
testing, or independent review required by the durable Mission outcome belongs
in a fixed-Squad Task through `panel`; Mission Skills may further constrain that
Task graph. This does not give Mission scheduler-only
`dispatch_agent` / `manage_task` or the separate Coding/Chat local-child
protocol.

## Operator Steer

The only targeted operator-steer entrypoint is
`POST /task/:taskID/session/:sessionID/operator-steer`. It writes an
`origin="operator_steer"` durable coordination request and wakes the
scheduler to decide the visible response/action. It does not write a task-root
operator message, send a direct child-session reply, or forge
`respond_agent_coordination` tool identity.

`POST /task/:taskID/message` represents task-root operator input only and
accepts no target session/build field.

## Runtime Templates And Adapters

`base_role` chooses a reusable trusted Application Binary Interface (ABI)
template seed; it does not name the running agent. Specialized
templates exist only where the host owns a typed capability such as persisted
requirements, architecture, implementation, exploration, research, visual
review, or integrity review. A generic delegated-worker template serves roles
that need only the shared session runtime.

Dispatch adapters own their input schema, trusted streaming implementation,
and Application Binary Interface version. They do not own business completion
or require a terminal tool. Agent packages select adapters through their runtime
template; they cannot upload trusted host implementations or redefine adapter
schemas.

## Observable Lifecycle

- All model interaction is streaming.
- User, scheduler, worker, and tool/result messages are real visible messages.
- Observable agents emit ordinary assistant text at meaningful work boundaries:
  confirmed facts, current action, changed assumptions, blockers, and validation
  outcomes. This narrative is not private chain-of-thought, a synthetic
  heartbeat, or a substitute for durable domain artifacts.
- Cancellation settles the real execution owner before records may be deleted.
  Current-process prompt ownership is proven by `SessionPromptState` or its
  registered activity monitor, not by the `SessionStatus` UI projection alone.
  A `streaming`/`retry` projection with neither owner is contradictory stale
  state: cancellation publishes one visible `terminal/aborted` status before
  the existing archive/delete lifecycle continues. A prompt owner in another
  directory or an activity monitor that has not released still fails typed
  cancellation settlement and preserves the record. After a process restart,
  successful Task cancellation also converges any non-terminal status remaining
  only in the durable Task Agent ledger; already-terminal child evidence keeps
  its original reason.
- Continuation validates the persisted worker descriptor and effective hashes.
- Concurrent workers sharing one template retain separate dynamic identities,
  sessions, tools, skills, prompts, and evidence.
- Task completion/failure is an explicit scheduler lifecycle tool decision,
  not a review verdict or automatic stage transition.

## Base, Advanced, And Domain Packages

The default built-in expert-squad package is `base`, Advanced's convenient
composite non-Goal development version. One Base Task is a complete delivery
closure even when the workload and output set are large. Its compact graph dispatches Explore
`base-researcher`, Delegated Worker `base-planner`, Build `base-developer`, and
Delegated Worker `base-tester` in order; each downstream identity selects the
canonical upstream research, planning, development, and testing Artifacts owned
by the package. The fixed `integrity-verified-delivery` graph appends
`base-integrity-reviewer` after testing. The fixed `visual-verified-delivery`
graph runs `base-tester` and `base-visual-reviewer` in parallel after development,
then joins both evidence branches at `base-integrity-reviewer`. The Orchestrator
selects exactly one graph; no selected graph contains an optional node.

The independently selectable built-in `advanced` manifest v1 projects the host
scheduler plus fourteen package-owned software-development agents:
request interpretation, requirements, architecture, workload review,
source and external research, interface investigation and
design, implementation, testing, visual review, system-integrity review, and claim verification. These
are package-owned dynamic identities, not core agent roles.

`universal-build` is the platform implementation and repair identity when no
narrower package-owned implementation contract applies. Advanced owns the
Build `implementation-engineer` and Delegated Worker `test-engineer` identities
used by its delivery graphs; the scheduler-only platform capability remains
separate.
Advanced's `planned-delivery`, `evidence-investigation`,
`greenfield-interface-delivery`, and `reference-interface-delivery` graphs
describe package-owned evidence relationships only. The greenfield graph owns
the complete original-interface planning and review lineage without a source
URL. Only the reference graph begins with `interface-investigator` and requires
one operator-supplied source URL.

Every Advanced delivery graph retains the exact Requirements → Architect
dependency. Independent request interpretation and source investigation share
the initial frontier, Architect joins their durable evidence, workload analysis
and implementation/design then proceed in parallel where their inputs permit,
and testing plus independent review fan out after implementation. The absence
of `depends_on` is the sole parallel declaration; no phase or workflow state is
added to manifest v1.

Advanced assigns coherent multi-source external facts to
`research-investigator`, one supplied page's observable interface evidence to
`interface-investigator`, and repository facts to `source-investigator`.
`interface-investigator` receives the existing Browser Model Context Protocol
tool projection so its page claims can come from direct observation; its prompt
must record access limitations instead of presenting repository prose as page
observation.

Domain teams such as `frontend-replica` use one explicit installation protocol.
Folder and ZIP callers choose either the current-project root
`.opencorvus/expert-squads/<namespace>/<id>/` or the user-global root
`Global.Path.config/expert-squads/<namespace>/<id>/`; Multica is one caller that
chooses the global scope. Registry validates both scopes separately and creates
one project-context effective catalog: a project package overrides a same-ID
global package with a typed warning, while same-scope duplicates remain errors.
An invalid project identity reserves its logical ID and never falls through to
the global package. Both locations follow the same selection, resolution,
catalog, and dispatch paths. Selecting an external package replaces Advanced's
complete package projection. It does not inherit or combine Advanced agents,
prompts, skills, tools, mounts, Model Context Protocol resources, or
virtual-workflow guidance. The Resolver independently retains platform-owned
`universal-build`; the active package ID is only its scope and projection epoch,
not its owner or package override namespace.

Manager validates uniqueness only inside the exact target installation scope
while holding the cross-process manifest-ID lock. Global writes do not scan
registered projects because a same-ID project installation is a valid override.
Project-local catalogs remain isolated, so unrelated projects may own the same
local ID. OpenCorvus does not scan the user's filesystem or persist a second
package-ID index.

Domain policy must remain inside those packages. Adding a new team means
adding a manifest and declared resources, not editing core agent lists or
scheduler routing.

## Verification

- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts`
- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts`
- `bun test packages/opencorvus/test/orchestrator/scheduler-capability-projection.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
