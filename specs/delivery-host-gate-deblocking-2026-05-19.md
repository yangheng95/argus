# Delivery Host Gate Deblocking

- Date: 2026-05-19
- Status: implementation plan
- Scope: delivery decision authority, repeated delivery failure scheduling, runtime readiness root discovery, client contract surface evidence

## Problem

Delivery currently lets host evidence gates author the final delivery verdict before the DeliveryAgent can run. In monorepo tasks this can reject a valid integrated deliverable for host discovery defects, then repeated rejection feedback remains non-terminal and the orchestrator can keep launching task-level direct builds that cannot change host-side discovery rules.

The failing task showed this concrete chain:

- `DeliveryService.verify` short-circuits before `DeliveryAgent.verify` when `hostGatePassedPreAgent` is false.
- `composeDeliveryDecision` synthesizes `source: "host_gate"` final rejected verdicts.
- repeated manifest signatures only return strategy feedback and do not stop a same-signature repair loop.
- runtime readiness checks a package directory for a lockfile even when the install lockfile belongs to the workspace root.
- `client_contract` can be selected from dependency evidence alone, then the specialist treats missing client file evidence as a blocking finding.

## Call Points

| Symbol | Call points | Change |
|---|---|---|
| `composeDeliveryDecision` | `delivery/service.ts`; `test/delivery/arbiter.test.ts`; `test/delivery/service.test.ts` | Final verdict must always be the DeliveryAgent verdict. Host gate failure is evidence only. |
| `DeliveryService.verify` | `orchestrator/tools.ts` only | Always run `DeliveryAgent.verify`; post-repair manifest remains evidence and cannot override final. |
| `emitGateRejectedIfNeeded` | `delivery/service.ts` only | Remove host-gate-final dependency; no final-rejection card emitted from advisory evidence. |
| `ensureProjectReadyForRuntime` | `project-gate.ts`; `preview/managed.ts`; tests | Keep `projectRoot` as script/package cwd; resolve lockfile owner upward for workspace installs. |
| `detectDeliverySurfaces` | `project-gate.ts`; surface tests | Dependency-only client libraries do not select `client_contract` without client file/endpoint evidence. |
| `runClientContractReview` | `project-gate.ts`; backend-client tests | Dependency-only evidence cannot produce blocking empty-inventory findings. |
| `delivery_repeated_failure_signature_*` | `orchestrator/tools.ts`; repeated-failure tests; prompt | Repeated signatures require operator/strategy escalation, not another blind direct build. |

## Implementation

1. Delivery authority
   - Delete the pre-agent host-gate return in `DeliveryService.verify`.
   - Keep manifest/runtime/visual evidence collection, but pass no host conclusions into the agent.
   - `composeDeliveryDecision` throws if no agent verdict exists and returns agent verdict verbatim regardless of hostGate status.
   - `source` becomes `llm`; `host_gate` is removed as a final verdict source.

2. Repeated delivery scheduling
   - Change repeated-signature deliver result text from "No host rule may end scheduling here" to a blocking operator/strategy escalation.
   - Stop queueing automatic task-scope rework wakes for task-scope rejections without `goal_id`.
   - Update orchestrator prompt so task-level direct build is not a valid next step after repeated same-signature delivery failure.

3. Runtime readiness
   - Resolve the lockfile owner by walking upward from `projectRoot` until a matching lockfile or workspace owner is found.
   - Report both `package_root` and `lockfile_owner` in evidence.
   - Keep dependency install cwd as `projectRoot` to avoid changing script execution semantics.

4. Client contract surface
   - Only concrete client files/endpoint evidence selects `client_contract`.
   - Dependency evidence can be retained under other surfaces but cannot create a blocking client-contract review by itself.
   - If a selected client surface has no concrete client inventory, the review records non-blocking evidence instead of a blocking finding.

## Tests

- Delivery service: manifest failure still calls `DeliveryAgent.verify`; final is the raw agent verdict.
- Arbiter: failed host gate with agent verdict returns agent verdict; failed host gate without agent verdict throws.
- Runtime readiness: pnpm workspace package passes with root `pnpm-lock.yaml` and `pnpm-workspace.yaml`.
- Surface detector: `axios` without client files does not select `client_contract`.
- Backend/client review: dependency-only client evidence does not create blocking empty-inventory finding.
- Repeated delivery tests: repeated signature text blocks blind repeat builds instead of declaring non-terminal strategy feedback.
