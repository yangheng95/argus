# Orchestrator Protocol v1

Status: complete

This document defines the internal control-plane protocol for single-product, multi-agent orchestration in `packages/opencorvus`.

## Scope

This protocol covers:
- task lifecycle events
- plan/spec lifecycle events
- run lifecycle events
- interaction request and resolution events
- delivery and evaluation events
- executor progress/output bridging into orchestrator-visible events

This protocol does not attempt to be a general agent-to-agent interoperability standard. It is the internal protocol between:
- orchestrator runtime
- executor bridge
- channel bridge
- UI and API subscribers

## Checklist

- [x] Define protocol goals and envelope fields
- [x] Define control-plane event categories
- [x] Persist orchestrator control-plane messages in an append-only table
- [x] Route orchestrator event publishing through one helper
- [x] Move task/run/spec/plan/interaction/delivery/evaluation events to the helper
- [x] Expose stored protocol messages through store/service APIs
- [x] Add regression tests for persistence, ordering, and replay

## Goals

The protocol must provide:
- one envelope shape for all control-plane events
- stable identifiers for correlation and causation
- append-only persistence for replay and diagnostics
- task-local ordering through a monotonic sequence
- explicit source and optional target ownership
- compatibility with the existing in-process `Bus`

## Envelope

Every persisted control-plane message uses this logical shape:

```ts
type Envelope = {
  id: string
  kind: "event" | "command" | "reply"
  type: string
  task_id: string
  run_id?: string
  goal_run_id?: string
  session_id?: string
  interaction_id?: string
  executor_session_id?: string
  source: string
  target?: string
  correlation_id?: string
  causation_id?: string
  sequence: number
  summary: string
  payload?: Record<string, unknown>
  time_emitted: number
  time_created: number
  time_updated: number
}
```

## Event Categories

The v1 control-plane categories are:
- `orchestrator.task.*`
- `orchestrator.spec.*`
- `orchestrator.plan.*`
- `orchestrator.run.*`
- `orchestrator.interaction.*`
- `orchestrator.delivery.*`
- `orchestrator.evaluation.*`
- `orchestrator.agent.updated`
- `orchestrator.task.message`
- `orchestrator.message.injected`

## Rules

1. The append-only message table is the replay and diagnostics source for control-plane events.
2. The in-process `Bus` remains the live fan-out transport.
3. Every control-plane publish must first allocate a task-local sequence and persist the envelope.
4. The `payload` should contain the exact event properties emitted on the `Bus`.
5. `source` identifies the subsystem that emitted the event. Default source is `orchestrator`.
6. `target` is optional and only used for directed replies or future commands.
7. New long-running workflows should use `correlation_id` and `causation_id` instead of implicit coupling.

## Completion Notes

- [x] Documented the protocol scope, envelope, and rules.
- [x] Persistence and helper rollout completed.
