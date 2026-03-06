# OpenCorvus Headless V1 Status

Date: `2026-03-07`

This document is the implementation status companion to [plan.md](D:/myhexin-local/argus-opencode/specs/plan.md).
It should be read together with the narrowed V1 baseline in [opencode-architecture.md](D:/myhexin-local/argus-opencode/specs/opencode-architecture.md).

Its purpose is:

- record what is already implemented
- call out where the code still deviates from the plan
- keep future work from drifting back toward the old GUI/overlay-centered product shape

## Current Position

The repository now has a real headless orchestration path inside `packages/opencorvus`.

Implemented center of gravity:

- `task / plan_version / goal / run / interaction / delivery / evaluation / artifact / progress_snapshot / channel_binding`
- HTTP task API
- `opencode` executor adapter
- evaluator command chain
- retry and replan loop
- Slack gateway
- Slack unit tests
- Slack live tests against real Slack APIs
- project-level task aggregation API
- console board UI with same-origin board proxies
- task console UI with project-level task creation and task list
- board workbench input and board projection view
- SSE-first board refresh with polling fallback

Architecture note:

- V1 scope is now intentionally narrower than older drafts
- `workbench` and `board` remain part of V1
- explicit `workspace` orchestration, multi-executor operation, and strong visual pipelines are deferred

Still present but no longer the product center:

- overlay manager
- TUI-first flows
- desktop automation oriented messaging
- `packages/bot` loop runtime

## Alignment Against `plan.md`

### 1. Backup And Branching

Status: `done`

Confirmed:

- backup branch created
- backup tag created
- current work moved to the headless implementation branch

No action needed.

### 2. Product Boundary Reset

Status: `partial`

Implemented:

- new headless orchestrator code is in `packages/opencorvus`
- Slack gateway moved into `packages/opencorvus/src/channel/slack.ts`
- new CLI command added at `opencorvus slack`
- README now describes the product as headless-first

Not yet done:

- old TUI/overlay commands are still present in the CLI
- old GUI and desktop code is still compiled and shipped
- `packages/bot` is still in the repo and still runnable

Assessment:

This is an acceptable short-term deviation. The architecture has shifted, but the old surface has not been removed yet.

### 3. Orchestrator Core

Status: `mostly done`

Implemented:

- durable tables for all core orchestrator objects
- task/run/interaction state persisted in SQLite
- active plan and active run tracking
- progress snapshots
- retry budget handling for runs and replans
- interaction bridge for permission and question requests

Current deviation:

- some logic is still centralized, but this is now acceptable for V1
- the remaining concern is behavioral clarity, not formal service-count purity

Assessment:

Behavior is present. The code is still somewhat centralized, but that is an acceptable V1 tradeoff.

### 4. Public API And Event Protocol

Status: `mostly done`

Implemented:

- `POST /task`
- idempotent `POST /task` via caller-provided request id
- `GET /task/:id`
- `GET /task/:id/progress`
- `GET /task/:id/events`
- `GET /tasks`
- `GET /task/:id/runs`
- `GET /run/:id`
- `GET /run/:id/delivery`
- `GET /run/:id/artifacts`
- `GET /run/:id/evaluations`
- `GET /task/:id/interactions`
- `POST /interaction/:id/reply`
- `POST /interaction/:id/reject`
- `POST /task/:id/cancel`

Implemented event coverage:

- `task.created`
- `task.updated`
- `plan.created`
- `plan.activated`
- `run.created`
- `run.updated`
- `interaction.requested`
- `interaction.resolved`
- `delivery.ready`
- `evaluation.completed`
- `goal.passed`
- `goal.failed`

Current deviation:

- event names are normalized from `orchestrator.*`, but not every granular event from the plan exists as a separate event type

Assessment:

The API is already usable for headless orchestration, but the event taxonomy is slightly coarser than the original plan.

### 5. `opencode` Executor

Status: `mostly done`

Implemented:

- `submit`
- `resume`
- `status`
- `abort`
- `delivery`
- session-scoped executor `events`
- `capabilities`

Current deviation:

- streaming still relies on orchestrator polling plus mapped bus events instead of executor-native queue streaming
- no second executor exists yet, so the contract is only proven against `opencode`

Assessment:

Good enough for the first executor. The adapter boundary now exists in a more honest form and can be extended later.

### 6. Evaluator And Delivery Normalizer

Status: `partial but real`

Implemented:

- delivery normalization from session summary and diffs
- artifact generation for report, diff, changed files, evaluation logs
- evaluator command chain:
  - `build`
  - `test`
  - `lint`
  - `verify_cmd`
- soft/strict artifact checks
- web-only visual checks
- soft judge fallback when a model is available
- automatic script discovery from `package.json`
- failure result persistence into `evaluation`

Not yet done:

- richer web visual evidence such as screenshots and diffs
- HTML trace capture into delivery
- stronger judge prompting and model policy

Assessment:

This is a meaningful implementation, not a stub, but it is still narrower than the full plan.

### 7. Slack Channel

Status: `done for V1 Slack scope`

Implemented:

- root Slack message creates task
- Slack thread binds to `task_id`
- permission interaction can be answered in-thread
- operator note can queue a follow-up run
- orchestrator events are summarized back into the same thread

Real verification completed:

- Slack auth
- Socket Mode connection
- outbound message send/delete
- gateway start/stop
- real inbound root message creates task
- real thread reply resolves permission interaction

Current deviation:

- only Slack is implemented
- Telegram and other channels are still deferred

Assessment:

Slack is no longer conceptual. It is implemented and real-tested.

### 8. SDK / Generated Artifacts / Docs

Status: `partial`

Implemented:

- README now reflects the headless direction
- live and unit tests now document the Slack path by executable example

Not yet done:

- dedicated headless API docs page
- CLI docs for `serve` and `slack` beyond README

Assessment:

Documentation direction is corrected and SDK generation is now refreshed, but dedicated docs still lag.

### 9. Board UI

Status: `done for V1 web scope`

Implemented:

- web board page in `packages/console/app`
- unified board view over `task / plan / run / brief / lanes`
- same-origin proxy routes for board read and task message write
- SSE-first refresh path through task events, with polling fallback
- free-form operator input from the board into workbench state

Current deviation:

- local development currently prefers `/board?task_id=...&directory=...`
- nested dynamic routes remain fragile on Windows dev server
- the board still uses refresh-on-event rather than fully incremental client-side event application

Assessment:

The board is now a real control-plane UI, not just a backend projection. The remaining issue is route portability, not core board viability.

## Major Deviations To Watch

These are the places most likely to cause future drift if left unchecked.

### 1. Legacy Surface Still Dominates The CLI

Risk:

- even though the architecture is headless-first, the shipped CLI still exposes many legacy commands and code paths

Needed:

- explicitly decide whether old TUI/overlay commands remain supported or become legacy-only

### 2. Orchestrator Logic Is Too Centralized

Risk:

- `src/orchestrator/service.ts` can turn into a new monolith

Needed:

- split into planner, run, delivery, evaluation, and channel-facing services

### 3. Evaluator Is Still Narrower Than The Plan

Risk:

- command success may be overused as the proxy for completion

Needed:

- artifact checks
- visual checks
- richer goal-to-check mapping

### 4. Live Slack Tests Are Real But Expensive

Risk:

- they are slower and depend on real Slack state

Needed:

- keep them opt-in
- keep cleanup best-effort and explicit

## What Is Already Proven

These are no longer design assumptions.

- headless API task intake works
- run persistence works
- retry and replan work
- evaluator failures can drive retries and replans
- Slack outbound summaries work
- Slack inbound task creation works
- Slack thread permission replies work

## Recommended Next Work

Priority order:

1. split `src/orchestrator/service.ts` into clearer sub-services
2. strengthen project-level task and result exploration in the UI
3. improve web visual evidence beyond lightweight page checks
4. document `opencorvus serve`, `opencorvus slack`, and `/tasks` as the canonical V1 flow
5. add board/task route portability cleanup
6. decide which legacy GUI/TUI entry points are still officially supported

## Guardrail

When changing product scope, prefer this question:

`Does this strengthen task/plan/run/evaluation/channel orchestration, or does it pull the product back toward GUI-first session tooling?`

If the answer is the latter, it is probably drift from Headless V1.
