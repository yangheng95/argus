# Delivery Loop Non-Convergence Refactor

Date: 2026-05-03

## Evidence

Four delivery attempts converged on the same two host blockers:

- `specialist:client_contract` reported `evidence_quality` for a pure frontend calculator because goal `imports` / `exports` were treated as a client API contract surface.
- `runtime:web:.` failed during isolated render launch because `bun install` timed out and the failure propagated as only `ETIMEDOUT`, without enough stderr/stdout context for the next build attempt.

The repeated failure guard already exists in `orchestrator/tools.ts`; the non-convergence evidence means the guard must be covered by regression tests and the retry prompt must carry deterministic manifest failure details, not only the delivery agent summary.

## Root Causes

1. `delivery/surface-detector.ts` mixed two meanings of contract: goal-to-goal imports/exports and frontend/backend client contracts.
2. `delivery/checks/visual.ts` discarded render install output on timeout/error paths.
3. `orchestrator/tools.ts` wrote per-goal retry feedback from `rejection_details`, but did not include host manifest failure details in the next build prompt.
4. Repeated failure detection was not pinned by a focused test for specialist review signatures.

## Implementation Plan

1. Remove goal `imports` / `exports` as a `client_contract` activation source. Client contract surfaces must be selected from project evidence such as client files, generated clients, contract dependencies, schemas, routes, or API adapters.
2. Preserve client specialist fail-loud behavior when `client_contract` is selected without file or endpoint evidence. That is a detector/manifest invariant failure, not an advisory user-code issue.
3. Include stdout/stderr tail in isolated render `bun install` failures for both non-zero exits and spawn errors such as timeout.
4. Include manifest failure details in per-goal delivery retry feedback so the build agent sees host gate facts, not just the LLM rejection summary.
5. Add regression tests for pure frontend goal imports/exports, render install failure detail formatting, retry feedback content, and repeated specialist failure signatures.

## Out Of Scope

- Do not add a new blocked task state or state-machine gate for repeated delivery failures. The existing guard stops identical rework; this refactor verifies and strengthens that path rather than adding a second source.
- Do not add a global node_modules cache until render install diagnostics are reliable. A cache must be lockfile-hash based if added later.
