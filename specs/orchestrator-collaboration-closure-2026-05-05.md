# Orchestrator Collaboration Closure

## Problem

Overlay benchmark `20260505-151125` showed the orchestrator re-entering Architect after a goal had already passed. That is not a robust scheduling strategy. It means the initial goal graph was not treated as a durable collaboration contract after execution began.

The prior attempted fix was a hard tool gate. That is the wrong architectural direction: it blocks one symptom, but it does not improve the scientific quality of the scheduling surface the orchestrator reads.

## Root Cause

The orchestrator reads status snapshots, but it does not read a first-class collaboration-closure projection:

- whether the current graph has entered execution,
- which goals are now dispatchable by dependency evidence,
- which goals are blocked by unfinished dependencies,
- which repair lane fits ordinary collaboration drift,
- when Architect re-entry would be a structural re-plan instead of normal execution.

Without that durable projection, the LLM treats uncertainty as permission to ask Architect to solve the graph again.

## Fix Direction

Add a derived, persisted-read projection to `describeTask` and render it into the orchestrator context:

- It is computed from existing durable sources: goal contracts, goal-run attempts, dependency edges, and derived goal status.
- It does not disable any tool.
- It does not limit editable files.
- It makes the collaboration contract explicit every wake.
- It routes ordinary shared-file edits to Build `files_changed[]` and point contract corrections to `modify_goal`.
- It reserves Architect re-entry as a structural re-plan that requires delivery/prosecutor/reference-coverage evidence or an explicit upstream restart.

## Acceptance

- A task with any goal attempt renders a "Collaboration Closure" section.
- The section lists dispatchable pending goals whose dependencies are satisfied.
- The section lists blocked pending goals with the dependency statuses that block them.
- The section says ordinary shared-file collaboration belongs to Build reports and `modify_goal`, not Architect re-planning.
- Tests prove the projection appears after execution starts and remains absent or pre-execution-scoped before the first attempt.
