# 14 - Agent Runtime Identities

> Current sources: `packages/opencorvus/src/agent/runner.ts`,
> `runtime-template-registry.ts`, `role-contract.ts`,
> `expert-squad/prompt-profile-resolver.ts`, `session/loop.ts`,
> `session/llm.ts`, and `orchestrator/agent.ts`.

OpenCorvus separates runtime identity from reusable execution templates.

## Identity Classes

| Class             | Owner                        | Runtime identity                                    |
| ----------------- | ---------------------------- | --------------------------------------------------- |
| Primary Assistant | `PrimaryAssistantRegistry`   | `coding`, `chat`, `control`, `mission`              |
| Helper            | `HelperAgentRegistry`        | `title`, `summary`, `compaction`                    |
| Scheduler Host    | `HostAgentRegistry`          | `orchestrator`                                      |
| Projected Worker  | active expert-squad manifest | exact `capability_projection.agents.<agent-id>` key |
| Platform Build    | `PromptProfileResolver`      | exact scheduler-only `universal-build` identity     |

Requirements analysis, architecture, build, integrity review, and similar
specialties are runtime-template roles. A package may project IDs such as
`opentest-requirements-analyst` or `frontend-replica-implementer` onto those
templates. The strings `requirements`, `architect`, `build`, and `integrity`
are not runnable worker identities unless a manifest deliberately declares the
same exact key.

The default built-in `base` package projects the distinct `base-researcher`,
`base-planner`, `base-developer`, `base-tester`, `base-integrity-reviewer`, and
`base-visual-reviewer` identities. Research uses Explore, planning and testing
use Delegated Worker, implementation uses Build, and the specialist reviewers
use Integrity and Visual Quality Assurance runtime templates. The compact
workflow uses the first four identities; fixed verified-delivery workflows add
the specialist reviewers while keeping every selected node binding. The independently
selectable built-in `advanced` package projects fourteen package-owned agents. All
manifest keys are the runnable identities; their specialized `base_role` values remain reusable host
Application Binary Interface (ABI) template seeds rather than team membership.
Platform-owned `universal-build` supports bounded direct and planned Task-level
implementation. A dispatch may cite exact Delivery Slice revisions as subjects.

Advanced declares four immutable manifest v1 scheduler-contract graphs:
`planned-delivery`, `evidence-investigation`, `greenfield-interface-delivery`,
and `reference-interface-delivery`. The greenfield graph owns its complete
requirements, architecture, original design, workload, rendered-review, and
interface-integrity lineage without a source URL. Only the reference graph
requires `interface-investigator` and one operator-supplied source URL. They are
not engines or state machines. The Orchestrator records one immutable visible
workflow-selection decision bound to the Task and exact package revision; it is
not a current-workflow pointer or step progress. After selection,
all declared nodes and dependencies are mandatory and missing predecessor
evidence remains visible. Every workflow node is instantiated once per Task.
One fixed-Squad Task is one Mission Phase. A physically interrupted mandatory
node continues through its exact bound lineage; Build never replaces that
node's terminal-success evidence or Artifact. After every mandatory node and
the package Build owner's initial occurrence succeed, the sole
production-closure exception is one same-Task dispatch of that exact Build or
final-delivery owner for a downstream `blocking` product or final-deliverable
defect. Immutable dispatch lineage proves whether the closure occurrence
already exists; later wakes continue or judge it instead of allocating another.
The closure finishes repair and affected verification without restarting other
nodes or publishing a parallel canonical Build Artifact. Dismissed questions use reversible evidence-backed assumptions;
extra commits are inspected by path, diff, ancestry, and current behavior while
unrelated changes remain preserved. An Integrity `concerns` result whose
findings are all `advisory` is acceptable residual-risk evidence and does not
dispatch Build or fail the current Task. Failure is reserved for external
authority, destructive approval, different-Squad ownership, or an irreducible
product decision.
Requirements always precede Architect in delivery graphs. All independent
root nodes are ready together; post-architecture workload and delivery work,
and post-implementation test and independent-review work, occupy the same
frontier whenever their declared Artifact dependencies are satisfied.
The user-facing Goal is a versioned Delivery Slice contract and owns no
execution, concurrency, workspace, retry, or lifecycle data.

Selecting another expert-squad package replaces the current package's complete
projection. Packages inherit none of Base, Advanced, or sibling agents, prompts,
skills, tools, mounts, Model Context Protocol resources, or guidance graphs.
They do not replace or own the platform scheduler-only Build projection.

Every production Expert Squad that owns a complete Phase declares a
package-owned Build-template final-delivery identity. Base uses
`base-developer`, Advanced uses `implementation-engineer`, and Research Studio
uses `research-studio-writer`; the latter remains research-only while using the
Build runtime for its own final report delivery and exact-lineage continuation. Verification-only Squads
remain read-only and cannot claim System Under Test repair ownership.

For cross-squad delivery, Mission creates a separate dependent Task for each
squad stage and supplies that Task's exact `promptProfile`. The profile is fixed
for the stage Task lifetime; the Task may create local Slice revisions and run
mandatory Task-level nodes from its selected virtual
workflow. A profile switch on one existing Task is not a stage transition.

## Derivation

The runner resolves the active worker capability by dynamic agent ID first.
Only then does it read `base_role` and obtain the code-owned session kind,
dispatch adapter, prompt seed, and tool seed from
`RuntimeTemplateRegistry` and `DispatchAdapterContractRegistry`. Persisted messages, tool
context, mounts, Agent-to-Agent (A2A) requests, wake, continuation, and
redispatch keep the dynamic ID.

## Model And Prompt Layers

Model and execution settings have three explicit layers:

1. Fixed identities: `agent.<fixed-id>`.
2. Worker template seed: `runtime_templates.<base-role>`.
3. Exact projected worker: `expert_squads.<squad-id>.agents.<agent-id>.runtime`.

The exact projected worker overrides its template, which overrides the project
default. Prompts follow the same ownership boundary: fixed registry prompt,
code-owned runtime-template prompt, then the active package's exact projected
prompt and mounted skills. Unknown identities or missing active projections
fail immediately.

Artifact transport is projected independently of package declarations.
Schedulers and workers receive `artifact_search`, `artifact_read`, and
`artifact_select`; workers additionally receive `artifact_snapshot` and
`artifact_publish`. The common resolver prompt defines the universal protocol,
so a new package does not need a hand-written locator handoff. A physical Turn
is delimited by the persisted assistant-message parent: only earlier complete
reads under that parent can authorize a selection or publication source.
Immediate publications carry publication-specific source locators, avoiding
Turn-global mutable epochs when one Turn publishes multiple outputs.
Snapshot publication returns one compact content-addressed resource-set
locator. Models never transport the manifest's expanded resource refs;
`TaskArtifactHost.resources` verifies and expands the exact set inside the
trusted Host boundary, while `null` is the only no-file publication value.
Ordinary text uses bounded inline reads. A large immutable
`task_artifact_resource` can instead be read once with
`delivery=materialized_file`; the Host verifies the complete content-addressed
bytes, exposes a read-only cache path, and records the same exact-locator
complete-read fact. Consumers inspect that path with bounded mature tooling
instead of repeatedly copying the whole resource through model context.

Helper messages retain their fixed helper identity even when they summarize a
projected worker Turn. Descriptor diagnostics therefore validate the projected
identity on primary worker messages while classifying `title`, `summary`, and
`compaction` through the canonical helper role contract.

## Session-Local Child Identity

`delegate_agent` does not introduce another fixed identity family or runtime
template. A Coding child runs as `coding`; a Chat child runs as `chat`. It uses
the parent model exactly, has a real standalone child-session row, and receives
the same shared interactive behavior kernel plus the Coding capability overlay.
The child permission surface inherits the parent and then explicitly denies
recursive delegation and durable workflow control. This keeps identity,
configuration, compaction, and prompt ownership single-sourced while preserving
an auditable transcript isolated from the parent's model context.

## Observable Narrative

One code-owned prompt fragment defines observable work narrative. Native
primary assistants receive it during non-complete LLM composition; runtime
templates receive it before projected prompt hashes are computed; the host
Orchestrator owns it in its complete system instructions. Helper-only title,
summary, and compaction calls do not receive it.

The internal projected-worker runtime streams ordinary assistant text parts into
the persisted text-part chronology and excludes private reasoning telemetry.
Narrative is semantic progress at meaningful boundaries, not a wall-clock
heartbeat or exposed private reasoning.

## Verification

- `test/agent/primary-assistant-registry.test.ts`
- `test/agent/helper-agent-registry.test.ts`
- `test/agent/host-agent-registry.test.ts`
- `test/agent/runtime-template-registry.test.ts`
- `test/tool/delegate-agent.test.ts`
- `test/session/prompt-final-input.test.ts`
- `test/agent/runner-base-template.test.ts`
- `test/expert-squad/dynamic-agent-resolver.test.ts`
