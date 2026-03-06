# OpenCorvus Headless Orchestration Architecture

## Intent

This document defines the V1 architecture baseline for OpenCorvus as a headless coding orchestrator.

It is intentionally narrower than earlier drafts.

The goal is not to describe every future capability. The goal is to define the smallest architecture that:

- matches the current working implementation
- keeps the product pointed at API-first, chat-first orchestration
- leaves room for later executor and evaluator expansion

## Product Statement

`OpenCorvus = a headless coding control plane built on opencode, with async task intake, versioned planning, goal-based evaluation, operator context, and lightweight channel/UI surfaces.`

Primary mode:

- headless first
- repo centric
- async by default
- human on demand

## V1 Scope

### V1 Core

- async task intake
- durable `task / plan_version / goal / run / interaction_request / delivery / evaluation`
- `opencode` as the only executor
- Slack as the first channel
- operator context via `workbench`
- assistant alignment via compiled `brief`
- lightweight board projection for humans
- deterministic evaluator core

### V1 Optional

- soft artifact checks
- soft web-only visual checks
- soft judge fallback

These may inform acceptance, but should not become a heavy operational dependency or require browser automation infrastructure to run every task.

### V2+

- multiple executors such as Codex or Claude Code
- richer project-level portfolio views
- explicit `workspace` resource orchestration
- strong visual regression pipelines
- Telegram and additional channel adapters

## Non-Goals

- GUI-first task execution
- desktop automation as the main product path
- turning opencode session state into the product source of truth
- making V1 depend on multiple executors
- making board UI the only way to operate the system

## Architectural Principles

1. `task/run` is the product truth, not `session/message`
2. operator context is first-class, not prompt glue
3. channel and UI surfaces consume control-plane state; they do not own it
4. deterministic checks win over model judgment
5. V1 may use a larger `service.ts` style orchestrator module if behavior stays coherent

## Layer Model

### 1. Kernel Layer

Backed by the latest active `sst/opencode` lineage.

Responsibilities:

- session storage
- message and part storage
- agent and tool execution
- file and diff inspection
- existing server and SDK surfaces

Rule:

- kernel state is executor state, not product workflow state

### 2. Control Plane

Lives in `packages/opencorvus/src/orchestrator`.

Responsibilities:

- task lifecycle
- plan lifecycle
- goal lifecycle
- run dispatch and retry/replan
- interaction tracking
- delivery and evaluation records
- progress snapshots
- normalized task event stream

This is the actual product core.

### 3. Operator Context

Lives in `packages/opencorvus/src/workbench`.

Responsibilities:

- durable preferences
- short-term task notes
- brief compilation for assistants
- board projection for humans

This layer exists because the product is not only orchestrating code. It is also aligning agents with evolving operator intent across API, Slack, and board surfaces.

### 4. Channel And UI

Responsibilities:

- Slack thread binding
- operator replies
- task summaries
- board and dashboard surfaces

Rule:

- channels and UI render orchestrator state
- they do not directly reason over raw session internals

### 5. Future Executor Expansion

The architecture allows more executors later, but V1 only proves `opencode`.

Design rule:

- keep the executor contract extensible
- do not let future executor abstraction dominate V1 design

## Runtime Design

This section is mandatory for V1. These are not implementation footnotes.

### Process Topology

V1 supports a simple topology:

- one `opencorvus serve` process
- orchestrator and API in the same process
- Slack gateway may run in the same binary as a separate command

This is acceptable for V1.

Later split is allowed:

- API process
- worker process
- channel process

But that is not required to validate the product.

### Concurrency And Isolation

V1 runtime rules:

- one active run per task
- each task is bound to one project directory
- each run references one executor session
- concurrent tasks may run in parallel as long as executor and repository state do not conflict

Practical isolation strategy in V1:

- rely on project directory scoping already present in the server
- rely on session-level separation inside the executor
- avoid introducing heavyweight `workspace` scheduling until there are multiple executors or explicit worktree pressure

This means `workspace` is a future resource model, not a V1 core domain object.

### Persistence

V1 persistence is SQLite-backed and local to the opencorvus instance.

Operational expectations:

- SQLite with WAL
- schema migration via repo migrations
- orchestrator objects stored durably
- brief snapshots and notes stored durably

Retention in V1:

- keep full task/run/evaluation state unless manually cleaned
- allow later archival and retention policy work

### API Authentication

V1 API auth is simple and environment-driven.

Minimum expectations:

- support server password/basic auth
- allow local loopback use without complex auth setup
- keep same-origin proxying in console UI so browser clients do not need direct orchestrator credentials

### Observability

V1 minimum observability:

- structured logs
- normalized task event stream
- progress snapshots
- channel-visible summaries

Nice-to-have but not V1 blockers:

- metrics backend
- distributed tracing
- full audit export

## Source Of Truth

### Control-Plane Truth

- `task`
- `plan_version`
- `goal`
- `run`
- `interaction_request`
- `delivery`
- `evaluation`
- `progress_snapshot`
- `channel_binding`

### Operator Context Truth

- `workbench_preference`
- `workbench_task_note`
- `workbench_brief_snapshot`

### Executor State

- `session_id`
- queue task ids
- raw message and tool activity

Rule:

- control-plane truth may reference executor state
- executor state must not replace control-plane truth

## V1 Domain Model

### Task

Represents the user request and orchestration boundary.

Key fields:

- `id`
- `project_id`
- `request_id`
- `source`
- `title`
- `request`
- `priority`
- `status`
- `blocking_reason`
- `active_plan_version_id`
- `active_run_id`
- `budget`

### PlanVersion

Represents the current execution strategy.

Key fields:

- `id`
- `task_id`
- `version`
- `summary`
- `prompt`
- `status`
- `metadata`

V1 note:

- a richer planner structure can exist in metadata
- `plan_version` remains the durable record

### Goal

Represents what must be true for the task to count as done.

Key fields:

- `id`
- `task_id`
- `plan_version_id`
- `description`
- `criteria`
- `priority`
- `status`
- `metadata.check_selector`

Important rule:

- goals express desired outcomes
- evaluator checks express verification methods
- `check_selector` links the two without collapsing them into one concept

### Run

Represents one executor attempt.

Key fields:

- `id`
- `task_id`
- `plan_version_id`
- `session_id`
- `executor`
- `status`
- `phase`
- `retry_count`
- `executor_ref`

### InteractionRequest

Represents a blocking request for human input or approval.

Kinds in V1:

- `permission`
- `question`

### Delivery

Represents normalized executor output.

Key fields:

- `id`
- `task_id`
- `run_id`
- `summary`
- `result.changed_files`
- `result.diffs`

### Evaluation

Represents the result of checking a delivery.

Key fields:

- `id`
- `task_id`
- `run_id`
- `delivery_id`
- `status`
- `verdict`
- `summary`
- `checks`

### ProgressSnapshot

Represents a durable progress checkpoint for task-level status.

### ChannelBinding

Represents the mapping between a task and a Slack or future channel thread.

## Operator Context Model

### WorkbenchPreference

Durable operator preference.

Examples:

- `style=concise`
- `lockfile_policy=avoid_changes`

### WorkbenchTaskNote

Short-lived task memory.

Kinds in V1:

- `user_request`
- `operator_note`
- `plan_hint`
- `goal_update`

### TaskBrief

Compiled assistant-facing context.

Contents typically include:

- task request
- plan summary
- goals
- preferences
- recent notes
- selected memory snippets

Rule:

- assistants consume the brief
- they should not be handed raw database state by default

### TaskBoard

Projected human-facing control-plane view.

V1 board includes:

- task summary
- plan summary
- run summary
- brief preview
- lanes for:
  - `run`
  - `goals`
  - `blockers`
  - `preferences`
  - `notes`

The board is a projection, not a source of truth.

## State Machines

### Task

Allowed transitions:

- `queued -> running`
- `running -> blocked`
- `running -> evaluating`
- `evaluating -> running`
- `evaluating -> completed`
- `evaluating -> failed`
- `blocked -> running`
- `blocked -> failed`
- `queued|running|blocked|evaluating -> cancelled`

V1 rule:

- `completed` requires blocking goals to pass

### Run

Allowed transitions:

- `queued -> accepted`
- `accepted -> running`
- `running -> blocked`
- `running -> completed`
- `running -> failed`
- `blocked -> running`
- `blocked -> failed`
- `accepted|running|blocked -> aborted`

### InteractionRequest

Allowed transitions:

- `pending -> answered`
- `pending -> rejected`
- `pending -> expired`

## Public API

### Core Task APIs

- `POST /task`
- `GET /task/:id`
- `GET /task/:id/progress`
- `GET /task/:id/events`
- `POST /task/:id/message`
- `GET /task/:id/brief`
- `GET /task/:id/board`
- `POST /task/:id/cancel`

### Interaction APIs

- `GET /task/:id/interactions`
- `POST /interaction/:id/reply`
- `POST /interaction/:id/reject`

### Run APIs

- `GET /task/:id/runs`
- `GET /run/:id`
- `POST /run/:id/abort`
- `GET /run/:id/delivery`
- `GET /run/:id/artifacts`
- `GET /run/:id/evaluations`

### API Rules

- `POST /task` returns immediately with `task_id`
- `POST /task` should accept `request_id` for idempotent replay
- `GET /task/:id/events` uses SSE
- board and browser clients should prefer same-origin proxying where possible

## Event Model

V1 event model should stay useful before it becomes exhaustive.

Minimum required event families:

- task created/updated
- plan created/activated
- run created/updated
- interaction requested/resolved
- delivery ready
- evaluation completed
- goal passed/failed

This event stream powers:

- Slack thread updates
- board live refresh
- audit and debugging

Refinement can happen in V1.1. Exhaustiveness is not required before the event model proves its usefulness.

## Executor Contract

V1 proven contract:

- `submit`
- `resume`
- `status`
- `abort`
- `delivery`
- `events`
- `capabilities`

Current proven executor:

- `opencode`

Future executors:

- Codex
- Claude Code

They should remain future-facing design notes, not V1 centerpieces.

## Evaluation Model

### Deterministic Core

- `build`
- `test`
- `lint`
- `verify_cmd`

### Optional Soft Checks

- `artifact`
- `visual` with `target = web`
- `judge`

Rules:

- visual checks are only for web targets
- soft checks should inform the operator without blocking flow by default
- strict mode may promote them into blocking failure
- LLM judgment is fallback, not primary truth

## Board UI

The board is part of the control plane, but it is not the product center.

V1 expectations:

- a lightweight web surface
- async refresh
- SSE preferred, polling fallback
- expandable cards and detail views
- free-form operator input back into workbench state

Desktop overlay may deep-link into the board later, but should not own board state.

## Implementation Notes For V1

- a larger orchestrator service module is acceptable if behavior stays coherent
- avoid over-splitting into many services before runtime behavior is settled
- prefer clarifying truth boundaries over maximizing object count

## Roadmap

### V1

- single executor (`opencode`)
- durable task/run/evaluation state
- Slack channel
- workbench and brief
- lightweight board
- deterministic evaluator core
- optional soft artifact/web/judge checks

### V1.1

- project-level aggregation
- stronger event taxonomy
- better board ergonomics
- stronger evaluator evidence outputs

### V2

- more executors
- explicit workspace/resource scheduling
- stronger visual pipelines
- more channel adapters

## Immediate Next Work

1. strengthen runtime event taxonomy
2. add project-level progress and aggregation APIs
3. improve web visual evidence beyond simple page fetch checks
4. reduce legacy CLI surface
5. add a second executor only after the contract proves stable in practice
