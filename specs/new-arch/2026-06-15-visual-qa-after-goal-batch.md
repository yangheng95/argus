# Visual QA After Each Goal Batch (2026-06-15)

## Problem

Visual QA currently reads as a post-integrity repair lane: the orchestrator runs
integrity first, then dispatches `visual_qa` only when non-pass integrity points
to frontend defects. That delays visible product inspection until the final gate
and misses the desired cadence: once a goal batch has reached terminal build
state, the frontend surface should be visually checked once before the
orchestrator dispatches the next implementation batch or final integrity.

The runtime already wakes the orchestrator when a terminal goal batch settles.
That wake must remain a natural engine wake. The fix is prompt and workflow
guidance, not a host-side route gate or state-machine bypass.

## Call Point Inventory

| Surface | Current behavior | Change |
| --- | --- | --- |
| `packages/opencorvus/src/engine/workflow.ts` | Pipeline order is `build -> integrity -> visual_qa`; `visual_qa` is described as post-integrity repair only. | Move `visual_qa` directly after `build`, before `integrity`, and describe one run after each terminal frontend goal batch. Integrity remains final acceptance. |
| `packages/opencorvus/src/prompt/core/orchestrator-core.txt` | Tells orchestrator to run integrity first and call `visual_qa` after non-pass integrity. | Tell orchestrator to call `visual_qa` once after every terminal frontend goal batch, before next batch or final integrity. Failed Visual QA evidence routes repair before integrity. |
| `packages/opencorvus/src/orchestrator/tools.ts` visual_qa description | Tool is described as post-integrity only. | Describe batch-settlement use and keep integrity context as optional prior evidence. |
| `packages/opencorvus/src/orchestrator/tools.ts` build result next-step text | Terminal wave advice lists `integrity` before `visual_qa`. | Return next-step guidance that terminal frontend waves should run `visual_qa` once before next build wave or final integrity. |
| Tests | Prompt and workflow tests assert integrity-before-visual_qa. | Update assertions to pin batch-after-build visual QA semantics and ensure the old post-integrity-only wording is gone. |

## Acceptance

- Workflow order shows `visual_qa` after `build` and before `integrity`.
- Orchestrator prompt says terminal frontend goal batches run exactly one
  `visual_qa` before the next goal batch or final integrity.
- Orchestrator prompt no longer says to run `integrity` first before
  `visual_qa`.
- The build tool's next-step text includes `visual_qa` in the terminal frontend
  batch cadence.
- Integrity remains the final workflow gate after Visual QA and any repair.
