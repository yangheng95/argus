# Decision - disable deliver host gate; use integrity as workflow gate

Date: 2026-05-19

## Problem

`deliver` currently runs host-owned checks, runtime probes, preview startup, and
specialist reviews outside the delivery agent session before producing or
overriding the final task verdict. Even with live review cards, this leaves a
non-closed verification path: evidence can be created outside a session and can
reject a task without a session transcript that owns the evidence.

## Decision

Disable `deliver` as a workflow acceptance gate. It must not run
`DeliveryService.verify`, `buildDeliveryEvidenceManifest`, runtime preview,
visual metric, specialist review, or host-gate arbitration in normal
orchestrator workflow.

The recommended `pipeline` workflow ends at `integrity`. The integrity review is
the final workflow gate because it is a real agent session with an explicit
terminal review result. A passing integrity verdict may complete the task. A
non-pass verdict remains actionable feedback for the orchestrator; it does not
trigger any hidden host-gate retry or blanket reset.

## Scope

- Change MiniWorkflow text and built-in `pipeline` steps: remove `deliver`, make
  `integrity` non-skippable and last.
- Change orchestrator prompt: no mandatory delivery acceptance gate; final gate
  is integrity for workflow tasks after builds are complete.
- Disable the `deliver` tool at runtime with an immediate disabled response, so
  old prompts or stale runs cannot start host-gate verification.
- Update build tool description so it routes next to integrity instead of
  deliver.
- Change integrity result handling so `pass` completes the task; non-pass does
  not complete and instructs explicit repair.

## Non-goals

- Do not delete the delivery source tree in this change. It becomes unreachable
  from the recommended workflow and runtime-disabled through the orchestrator
  tool. Full code deletion should be a separate cleanup after tests and UI
  references are adjusted.
- Do not add replacement host checks. No root script guessing, no runtime host
  gate, no specialist host gate.

## Tests

- Workflow registry: pipeline ends with integrity and has no deliver step.
- Orchestrator tools: `deliver` returns disabled text and does not call
  `DeliveryService.verify`.
- Orchestrator prompt hygiene: no mandatory deliver acceptance gate language;
  contains integrity final-gate guidance.
- Integrity pass path: completing integrity with `pass` completes the task.
