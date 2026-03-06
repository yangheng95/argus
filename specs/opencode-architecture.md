# OpenCorvus Headless Orchestration Architecture

## Review Outcome

The earlier draft was directionally correct but not complete enough to act as the V1 architecture baseline.

The missing pieces were:

- no first-class `interaction` model for permission and question handoff
- no first-class `delivery` or `artifact` model
- no explicit task and run state machines
- no failure, retry, timeout, or budget policy
- no public orchestrator API contract
- no clear source-of-truth mapping between orchestrator objects and opencode session state

This revision adds those missing layers.

Conclusion:

- `opencorvus/opencode` remains the execution kernel
- a new orchestrator protocol sits above it
- operator context and board projection are first-class control-plane concerns
- the architecture is now structurally complete enough for a V1 design baseline
- implementation details and tuning will still evolve, but the object model and boundaries should now stay stable

## Goal

Build a headless coding orchestration system on top of the latest `sst/opencode` kernel.

The product is not an IDE replacement and not a GUI automation tool. It is an async control plane that:

- accepts coding tasks from API and chat channels
- creates and updates plans
- dispatches work to coding executors
- evaluates results against explicit goals
- loops until pass, escalation, or budget stop

## Product Statement

`OpenCorvus = a headless coding orchestration service built on opencode, with async task intake, explicit planning, goal-based acceptance, executor routing, and channel delivery.`

Primary modes:

- API-first
- chat-first
- repo-centric
- headless-by-default
- human-on-demand

## Why Use `sst/opencode` As The Kernel

The active upstream `sst/opencode` already provides the right low-level primitives:

- headless server
- JS SDK
- session model
- prompt and `prompt_async` APIs
- agent and subagent runtime
- worktree support
- ACP server support
- plugin and skill loading

This makes it a good kernel for repository execution and session state.

It is not enough by itself because it does not yet provide:

- durable task orchestration
- operator context and long-lived task memory
- explicit goal gating
- project-level progress assessment
- multi-executor routing
- chat channel runtime
- delivery and artifact normalization
- web visual evaluation

So the architecture should add these above the kernel instead of forking the kernel into a product monolith.

Physical packaging should stay simple:

- keep the new system in one directory
- separate concerns by module boundaries, not by many workspace packages

## Non-Goals

- Rebuilding a full TUI or desktop client
- Making GUI automation the main execution path
- Embedding all orchestration logic into `packages/opencorvus/src/session/prompt.ts`
- Binding product behavior to a single executor such as Codex or Claude Code
- Using ACP as the internal system-of-record protocol

## Protocol Layers

The architecture must separate three protocol layers plus the kernel.

### 1. Channel Protocol

Used by API clients, Slack, Telegram, and OpenClaw-like gateways.

Responsibilities:

- submit a task
- watch status
- answer questions
- reply to approvals
- fetch summaries and artifacts

### 2. Orchestrator Protocol

The actual product protocol.

Responsibilities:

- own `task`, `plan_version`, `run`, `interaction_request`, `delivery`, `evaluation`
- own retries, budgets, escalation, and progress
- expose a stable API to channels
- translate executor-specific behavior into normalized events

### 3. Execution Protocol

Implemented by executor adapters.

Responsibilities:

- submit work to a coding assistant
- monitor execution
- surface tool progress, blocking requests, and output
- abort or resume execution

### 4. Kernel Protocol

Provided by opencode itself.

Responsibilities:

- session storage
- message and part storage
- tool execution
- agent runtime
- worktree lifecycle
- SDK and API surface
- ACP compatibility

The main architectural rule is:

- channels talk to the orchestrator
- the orchestrator talks to executors
- executors may use opencode kernel APIs
- opencode session state is never the source of truth for product workflow

## Layered Architecture

### 1. Kernel Layer

Base: latest `sst/opencode`

Responsibilities:

- session storage
- message and part storage
- tool execution
- agent runtime
- worktree lifecycle
- SDK and API surface
- ACP compatibility

Kernel stays as thin and upstream-compatible as possible.

### 2. Orchestrator Layer

Module inside `packages/opencorvus`

Responsibilities:

- task intake
- plan lifecycle
- goal lifecycle
- run scheduling
- retry and escalation policy
- executor selection
- progress calculation
- event normalization
- durable delivery and evaluation records

This is the real product core.

### 3. Workbench Layer

Module inside `packages/opencorvus`

Responsibilities:

- store durable operator preferences
- store short-term task notes
- compile assistant briefs before each run
- project normalized board views for humans and channels

This layer is not just prompt decoration. It is the operator context that keeps API, Slack, and UI aligned.

### 4. Executor Layer

Module inside `packages/opencorvus`

Responsibilities:

- adapt `opencode`
- adapt `Codex`
- adapt `Claude Code`
- expose a single contract to the orchestrator

This layer prevents the control plane from being coupled to one tool.

### 5. Evaluation Layer

Module inside `packages/opencorvus`

Responsibilities:

- build, test, and lint checks
- repo policy checks
- artifact inspection
- web visual evaluation
- LLM judge fallback only when deterministic checks are insufficient

### 6. Channel And UI Layer

Module inside `packages/opencorvus`

Responsibilities:

- Slack and Telegram delivery
- thread binding
- user replies
- approval and escalation prompts
- artifact and status summaries
- board and dashboard surfaces over the orchestrator API

OpenClaw can later be used here as a gateway, but product state remains inside the orchestrator.

## Proposed Single-Directory Structure

```text
packages/
  opencorvus/
    src/
      kernel/        # kernel-facing wrappers and reused opencode logic
      orchestrator/  # task/plan/run/evaluation control plane
      workbench/     # preferences, notes, briefs, board projection
      executor/      # opencode/codex/claude adapters
      evaluator/     # acceptance and visual checks
      channel/       # Slack/Telegram/OpenClaw gateway
      app/           # composition root and public entrypoints
    test/
      orchestrator/
      executor/
      evaluator/
      channel/
  sdk/               # existing SDK
specs/
  opencode-architecture.md
```

This keeps everything under one product directory while still enforcing clear ownership boundaries.

## Source Of Truth And Ownership

The system must be explicit about which layer owns which state.

### Orchestrator-Owned State

- `task`
- `plan_version`
- `goal`
- `run`
- `interaction_request`
- `delivery`
- `evaluation`
- `progress_snapshot`
- `channel_binding`
- `workbench_preference`
- `workbench_task_note`
- `workbench_brief_snapshot`

### Executor-Owned State

- `session_id`
- executor-native thread or job ids
- raw streaming events
- tool call details
- temporary workspace handles

### Kernel-Owned State

- opencode `session`
- opencode `message`
- opencode `message.part`
- opencode permission and question requests
- opencode file and diff state

### Ownership Rule

- orchestrator state may reference executor state
- executor state may mirror kernel state
- kernel state may not replace orchestrator state

Examples:

- `run.executor_ref.session_id` points to an opencode session
- `delivery.artifacts` may be assembled from opencode messages and diffs
- `evaluation` references artifacts, not raw messages, as its evidence boundary

## Core Domain Model

The product must introduce its own durable objects instead of overloading `session`.

### Project

Purpose:

- repository-level policy and defaults

Fields:

- `id`
- `root`
- `default_branch`
- `executor_policy`
- `evaluation_policy`
- `progress_policy`

### Workspace

Purpose:

- concrete execution location for a run

Fields:

- `id`
- `project_id`
- `kind`
- `directory`
- `branch`
- `executor_ref`
- `status`

Kinds:

- `worktree`
- `container`
- `remote`

### Task

Represents the user request.

Fields:

- `id`
- `project_id`
- `source`
- `source_ref`
- `title`
- `request`
- `priority`
- `status`
- `blocking_reason`
- `active_plan_version_id`
- `current_run_id`
- `budget`
- `created_at`
- `updated_at`

Statuses:

- `queued`
- `planning`
- `running`
- `blocked`
- `evaluating`
- `completed`
- `failed`
- `cancelled`

Blocking reasons:

- `user_input`
- `permission`
- `environment`
- `budget`
- `policy`
- `manual_review`

### PlanVersion

Represents one concrete strategy for completing the task.

Fields:

- `id`
- `task_id`
- `version`
- `summary`
- `steps`
- `assumptions`
- `risks`
- `why_changed`
- `created_by`
- `status`

Statuses:

- `draft`
- `active`
- `superseded`
- `accepted`
- `rejected`

Invariants:

- exactly one active plan version per task
- a plan version becomes `accepted` only when the task completes

### Goal

Represents what must be true for the task to count as done.

Fields:

- `id`
- `task_id`
- `plan_version_id`
- `description`
- `criteria`
- `priority`
- `retry_budget`
- `current_attempts`
- `status`
- `metadata.check_selector`

Important rule:

- `goal` expresses the desired outcome
- evaluator checks express how that outcome is verified
- `metadata.check_selector` links a goal to one or more evaluator checks without collapsing goals into checker kinds

Priorities:

- `blocking`
- `non_blocking`

Statuses:

- `pending`
- `running`
- `passed`
- `failed`
- `skipped`

### Run

Represents one executor attempt.

Fields:

- `id`
- `task_id`
- `plan_version_id`
- `workspace_id`
- `executor_kind`
- `executor_ref`
- `status`
- `phase`
- `failure_kind`
- `summary`
- `started_at`
- `completed_at`
- `timeout_at`

Statuses:

- `queued`
- `accepted`
- `running`
- `blocked`
- `completed`
- `failed`
- `aborted`

Phases:

- `plan`
- `execute`
- `evaluate`
- `replan`

Failure kinds:

- `transient`
- `environment`
- `input`
- `permission`
- `evaluation`
- `strategy`
- `budget`
- `unknown`

### InteractionRequest

Represents a blocking handoff that needs a human or higher-level policy decision.

Fields:

- `id`
- `task_id`
- `run_id`
- `kind`
- `status`
- `question`
- `options`
- `payload`
- `deadline_at`
- `created_at`
- `resolved_at`

Kinds:

- `permission`
- `question`
- `approval`
- `manual_review`

Statuses:

- `pending`
- `answered`
- `rejected`
- `expired`

### Artifact

Represents one durable output produced during execution or evaluation.

Fields:

- `id`
- `task_id`
- `run_id`
- `kind`
- `uri`
- `label`
- `metadata`
- `created_at`

Kinds:

- `patch`
- `changed_file`
- `log`
- `report`
- `image`
- `diff`
- `html_trace`
- `link`

### Delivery

Represents the normalized result returned by a run.

Fields:

- `id`
- `task_id`
- `run_id`
- `summary`
- `status`
- `artifact_ids`
- `changed_files`
- `executor_output`
- `created_at`

Statuses:

- `ready`
- `incomplete`
- `failed`

### Evaluation

Represents the result of checking one or more goals.

Fields:

- `id`
- `task_id`
- `run_id`
- `goal_id`
- `checker`
- `status`
- `summary`
- `evidence`
- `created_at`

Statuses:

- `pass`
- `fail`
- `inconclusive`

### ProgressSnapshot

Represents the latest computed progress view for a task.

Fields:

- `task_id`
- `status`
- `active_plan_version`
- `completed_steps`
- `total_steps`
- `blocking_goal_pass_rate`
- `current_executor`
- `retry_count`
- `last_failure_reason`
- `last_progress_at`

### WorkbenchPreference

Represents durable operator preferences.

Fields:

- `id`
- `project_id`
- `task_id`
- `user_id`
- `scope`
- `key`
- `value`
- `source`
- `confidence`

### WorkbenchTaskNote

Represents short-lived task memory captured from user messages or system decisions.

Fields:

- `id`
- `task_id`
- `run_id`
- `kind`
- `source`
- `user_id`
- `content`
- `metadata`

### TaskBrief

Represents the compiled assistant-facing context for a task or run.

Fields:

- `task_id`
- `run_id`
- `content`
- `preferences`
- `notes`
- `goals`

Rule:

- assistants consume the brief, not raw database state

### TaskBoard

Represents the projected control-plane view for human operators.

Fields:

- `task`
- `plan`
- `run`
- `brief`
- `lanes`

Lane kinds in V1:

- `run`
- `goals`
- `blockers`
- `preferences`
- `notes`

### ChannelBinding

Fields:

- `task_id`
- `platform`
- `channel`
- `thread`
- `user_id`
- `state`

## State Machines

The system must be explicit about valid transitions.

### Task State Machine

Allowed transitions:

- `queued -> planning`
- `planning -> running`
- `planning -> blocked`
- `running -> blocked`
- `running -> evaluating`
- `evaluating -> running`
- `evaluating -> completed`
- `evaluating -> failed`
- `blocked -> running`
- `blocked -> failed`
- `queued|planning|running|blocked|evaluating -> cancelled`

Rules:

- a task enters `blocked` only with a non-empty `blocking_reason`
- a task enters `completed` only after all blocking goals pass
- a task enters `failed` only after retry, budget, or policy rules reject further progress

### Run State Machine

Allowed transitions:

- `queued -> accepted`
- `accepted -> running`
- `running -> blocked`
- `running -> completed`
- `running -> failed`
- `blocked -> running`
- `blocked -> failed`
- `accepted|running|blocked -> aborted`

Rules:

- at most one active run per task
- a run may be blocked by permission, question, or environment
- a run may complete even when the task later fails evaluation

### Interaction State Machine

Allowed transitions:

- `pending -> answered`
- `pending -> rejected`
- `pending -> expired`

Rules:

- each pending interaction must belong to one active run
- resolving an interaction emits a normalized task event and may move the task out of `blocked`

## Public Orchestrator API

This is the API channels and external systems should use.

### Task APIs

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

### Run And Delivery APIs

- `GET /task/:id/runs`
- `GET /run/:id`
- `POST /run/:id/abort`
- `GET /run/:id/delivery`
- `GET /run/:id/artifacts`
- `GET /run/:id/evaluations`

### API Rules

- `POST /task` returns immediately with `task_id`
- `GET /task/:id/events` uses SSE
- `POST /task` should accept a caller-provided `request_id` and return the existing task on replay
- all mutable operations should converge on caller-provided request ids or dedupe keys
- channels never call executor-specific APIs directly

## Event Model

Normalize all executor and evaluator events into one stream.

Minimum event kinds:

- `task.created`
- `task.status`
- `task.blocked`
- `task.escalated`
- `plan.created`
- `plan.activated`
- `run.created`
- `run.started`
- `run.status`
- `run.blocked`
- `run.completed`
- `run.failed`
- `interaction.requested`
- `interaction.resolved`
- `delivery.ready`
- `evaluation.completed`
- `goal.passed`
- `goal.failed`
- `task.completed`
- `task.failed`

Each event should include at least:

- `event_id`
- `task_id`
- `run_id` when applicable
- `type`
- `timestamp`
- `summary`
- `payload`

This event stream becomes the source for:

- chat updates
- dashboards
- audit logs
- retry decisions
- board refresh and live operator surfaces

## Executor Contract

All executors should implement one interface.

```ts
export interface ExecutorAdapter {
  kind: "opencode" | "codex" | "claude"
  submit(input: {
    taskId: string
    runId: string
    workspace: string
    plan: string
    constraints?: string[]
  }): Promise<{
    executorRef: Record<string, string>
  }>
  resume(input: {
    runId: string
    message: string
  }): Promise<void>
  status(runId: string): Promise<{
    state: "queued" | "accepted" | "running" | "blocked" | "completed" | "failed" | "aborted"
    summary?: string
    blockingReason?: "user_input" | "permission" | "environment"
  }>
  abort(runId: string): Promise<void>
  events(runId: string): AsyncIterable<{
    type: string
    summary?: string
    payload?: unknown
  }>
  delivery(runId: string): Promise<{
    summary: string
    artifacts: Array<{
      kind: "patch" | "changed_file" | "log" | "report" | "image" | "diff" | "html_trace" | "link"
      value: string
      metadata?: Record<string, unknown>
    }>
  }>
  capabilities(): {
    local_fs: boolean
    remote: boolean
    resume: boolean
    screenshots: boolean
    permission_callbacks: boolean
    question_callbacks: boolean
    streaming: boolean
  }
}
```

## First Executor: `opencode`

`opencode` should be the first and default executor.

Reason:

- already in-repo
- no external vendor dependency
- full repository execution semantics
- session and worktree support already exist

How it should be used:

- orchestrator creates a workspace
- orchestrator creates or reuses an opencode session
- orchestrator sends task content through server or SDK
- orchestrator stores `session_id` and `taskID` as executor state
- orchestrator polls or streams kernel events and maps them into normalized run events

Important rule:

Do not store orchestration truth in the opencode session alone.
Session is executor state, not product state.

## Mapping To Existing OpenCorvus Kernel

The current kernel APIs already cover much of the executor surface.

### Existing Kernel Inputs

- `session.create`
- `session.prompt`
- `session.prompt_async`
- `session.prompt_async_status`
- `session.abort`
- `question.reply`
- `permission.reply`

### Existing Kernel Observability

- `global.event`
- instance `/event`
- `session.status`
- `session.message`
- `session.messages`
- `session.diff`
- `file.status`
- `file.read`
- `session.exportHtml`

### Mapping Rules

- orchestrator `task` maps to one or more executor runs, not directly to one session
- orchestrator `run.executor_ref.session_id` maps to opencode `session.id`
- orchestrator `interaction_request` may be created from opencode permission or question events
- orchestrator `delivery` is assembled from opencode messages, parts, diffs, files, and trace artifacts
- opencode `task.report` remains bot-loop specific and is not a required system protocol

## Optional Executors: Codex And Claude Code

These should be added as adapters later.

### Codex

Use for:

- long-running remote coding jobs
- parallel work units
- non-local tasks

### Claude Code

Use for:

- local or containerized repo execution
- tasks requiring strong local tool use
- repos already aligned with Claude workflows

The orchestrator should choose executor by policy, not by hardcoded preference.

## Planning Model

Do not reuse opencode's current plan flow as the product planner.

Upstream plan mode is interactive and file-centric:

- good for human-approved planning
- not enough for unattended orchestration

Recommended planner design:

- planner writes `plan_version`
- planner may still emit a plan file into the workspace for executor context
- orchestrator owns plan status and version transitions

This means:

- `plan file` is an execution artifact
- `plan_version` is the system record

## Goal And Evaluation Model

This is the missing product-critical layer.

A task completes only when all blocking goals pass.

Evaluation order:

1. deterministic checks
2. web visual checks when configured
3. artifact inspection
4. LLM judge fallback

LLM judge should never be the only source of truth when build or test evidence exists.

Rules:

- every blocking goal must point to at least one checker
- every evaluation must produce evidence
- evaluation may fail the task even when the executor run completed successfully

## Delivery Model

Execution output must be normalized before evaluation or channel delivery.

Rules:

- channels receive `delivery`, not raw executor messages
- evaluators consume `delivery` and `artifact`
- raw message streams remain available only for debugging and traceability

Minimum delivery contents:

- summary
- changed files
- diff artifacts
- logs
- screenshots when applicable
- trace or report links

## Failure, Retry, And Budget Policy

Unattended execution requires explicit failure classification.

### Failure Classes

- `transient`: network hiccup, flaky subprocess, temporary upstream error
- `environment`: missing dependency, missing secret, broken workspace
- `input`: unclear requirement or missing user info
- `permission`: denied or unresolved permission request
- `evaluation`: code executed but did not meet acceptance criteria
- `strategy`: plan itself is wrong and needs replan
- `budget`: retries, time, or cost exhausted
- `unknown`: uncategorized

### Default Policy

- retry transient failures within the same plan
- block on input or permission failures
- replan on strategy failures
- mark failed on budget exhaustion
- keep evaluation failures separate from execution failures

### Budget Dimensions

- max executor attempts per task
- max evaluation attempts per task
- max elapsed wall time
- optional token or cost budget

### Timeout Rules

- each run gets a timeout
- each interaction request gets a deadline
- timed out runs emit `run.failed` with `failure_kind = budget` or `environment`

## Web Visual Evaluation

This product should not depend on desktop GUI checks for the main path.

Instead, support web visual evaluation as:

- target URL or route
- viewport list
- optional auth or bootstrap script
- baseline screenshot or rules

Outputs:

- pass or fail
- screenshot artifacts
- diff summary
- rule violations

Implementation direction:

- Playwright for capture
- evaluator-owned visual checker
- optional vision model for layout or readability analysis

## Progress Assessment

Progress should be computed by orchestrator state, not guessed from chat text.

Minimum task-level metrics:

- task status
- active plan version
- completed plan steps
- blocking goals pass rate
- current executor
- retry count
- last failure reason
- time since last meaningful progress

Minimum project-level metrics:

- open task count
- blocked task count
- completed task count
- executor failure rate
- median task completion time

This should be exposed as both API response and channel summary.

## Board UI

The board is a control-plane surface, not a desktop overlay.

Purpose:

- let operators inspect the current task state without reading raw session logs
- let operators inspect the compiled brief and current plan
- let operators send free-form updates that become preferences, goals, plan hints, or notes

Rules:

- board data is projected from orchestrator + workbench state
- board refresh should prefer SSE and fall back to polling
- desktop overlay may deep-link into the board, but should not own the board state model

## Channel Model

Channels are adapters, not the source of truth.

Responsibilities:

- create tasks
- subscribe to task event stream
- render summaries
- collect replies to pending interaction requests
- support approvals and cancellation

Rules:

- channel threads map to `task_id`
- multiple channels may bind to the same task
- channels do not inspect executor-native state directly

## End-To-End Flows

### Flow A: Normal Completion

1. user submits task
2. orchestrator creates task
3. planner produces `plan_version = 1`
4. orchestrator provisions workspace
5. orchestrator dispatches `run 1` to `opencode_executor`
6. executor produces normalized delivery
7. evaluator runs goals
8. all blocking goals pass
9. task marked completed
10. channel layer sends completion summary

### Flow B: Replan

1. evaluator fails a blocking goal
2. orchestrator classifies the failure as `evaluation` or `strategy`
3. if retryable within same plan, create next run
4. if strategy is invalid, create `plan_version = 2`
5. dispatch again
6. stop on pass, escalation, or budget exhaustion

### Flow C: Need User Input

1. executor or evaluator declares missing information
2. orchestrator creates `interaction_request`
3. task and run move to `blocked`
4. channel layer asks a focused question
5. user reply resolves the interaction
6. orchestrator resumes the current run or replans

### Flow D: Permission Denied

1. executor emits a permission request
2. orchestrator records `interaction_request(kind=permission)`
3. approver rejects the request
4. orchestrator classifies the run as `permission` failure
5. task either replans or fails based on policy

## Integration With Existing Kernel

Prefer reuse:

- `serve`
- `sdk/js`
- `session`
- `tool/task`
- `worktree`
- `control-plane/workspace`
- `ACP`

Avoid deep product logic inside:

- `session/prompt.ts`
- `tool/plan.ts`
- TUI-only flows

Rule of thumb:

- if it is executor behavior, keep it in `src/kernel` or `src/executor/opencode`
- if it is product workflow, put it in `src/orchestrator`

## Recommended Iterations

### Iteration 0: Protocol Baseline

- freeze the boundary that `opencorvus` is the execution kernel, not the orchestrator
- document kernel-to-orchestrator mappings
- define the canonical event dictionary

### Iteration 1: Run Facade

- add `task`, `run`, and `interaction_request`
- wrap `session.prompt_async` behind orchestrator APIs
- surface task and run status without exposing raw message internals

### Iteration 2: Delivery Layer

- add `artifact` and `delivery`
- normalize session messages, diffs, files, and traces into durable outputs

### Iteration 3: Evaluator

- add deterministic build, test, lint, and verify checks
- persist evaluation evidence
- gate task completion on blocking goals

### Iteration 4: Goal Retry Loop

- classify failures
- retry, replan, block, or fail by policy
- add budget and timeout enforcement

### Iteration 5: Planner

- introduce durable `plan_version`
- keep exactly one active plan per task
- record why replans happened

### Iteration 6: Multi-Executor

- keep `opencode` as the first executor
- add `codex` and `claude` adapters behind the same executor contract
- add policy-driven routing

### Iteration 7: Channels

- add Slack first
- then Telegram
- optionally add OpenClaw as ingress or multiplexing layer

## Architectural Risks

### Risk 1

Too much logic ends up in opencode prompt and session internals.

Mitigation:

- keep orchestration state outside executor session state

### Risk 2

Planning and execution stay coupled to interactive assumptions.

Mitigation:

- planner writes durable plan versions
- task completion depends on goals, not on a chat turn ending

### Risk 3

Executor adapters leak tool-specific semantics into the control plane.

Mitigation:

- normalize around `task`, `run`, `interaction_request`, `delivery`, `evaluation`, and `artifact`

### Risk 4

Chat delivery becomes the product core.

Mitigation:

- make channels consumers of orchestrator events, not owners of task state

### Risk 5

Evaluation remains prompt-driven instead of evidence-driven.

Mitigation:

- store evaluation results and evidence as first-class records
- let LLM judgment remain a fallback, not the primary verifier

## Recommended First Implementation Decisions

- Use latest `sst/opencode` as the only kernel baseline.
- Keep the implementation under one directory: `packages/opencorvus`.
- Separate modules inside that directory instead of creating many workspace packages.
- Make `opencode` the default executor for MVP.
- Treat plan files as artifacts, not the main planning record.
- Treat goal evaluation as a first-class subsystem, not a prompt convention.
- Treat `delivery` as the only channel-facing result object.
- Treat permission and question handling as orchestrator `interaction_request` records.

## Immediate Next Work

1. Add idempotent task creation using caller-provided `request_id`.
2. Regenerate OpenAPI and JS SDK from the current headless API surface.
3. Complete executor contract parity by adding real `resume` and executor event streaming.
4. Add evaluator layers for artifact checks, web visual checks, and judge fallback.
5. Add project-level progress and board aggregation APIs.
6. Reduce legacy CLI surface so headless entrypoints become the obvious default.
