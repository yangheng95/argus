# Contract Audit Scorer Follow-Up - 2026-05-11

## Reason For Split

`contract_audit` cannot be added by architect validation alone. It needs a complete execution chain:

- `AcceptanceScorer` schema extension.
- `renderSpecsAsText` rendering.
- trigger defaults and `resolveTrigger`.
- Build/goal-run evidence production.
- `criteria_results` sink.
- delivery gate consumption.

Adding only a schema enum would create a scorer that the system cannot execute, which violates the no-half-finished rule.

## Intended Behavior

Cross-boundary goals should require a contract-aware scorer only when a boundary exists:

- goal has `imports[]`,
- goal has `exports[]`, or
- linker reports a reuse-consumed symbol.

Single-goal tasks with no boundary do not require `contract_audit`.

## Execution Chain To Design

1. Extend `AcceptanceScorer` with:
   ```ts
   { type: "contract_audit"; name: string; spec: { kind: "contract_ir"; symbols?: string[] }; expect: { status: "passed" } }
   ```
2. Render it in `renderSpecsAsText` without losing the symbol list.
3. Define `resolveTrigger` behavior. Default should be `on_goal` because the audit scans goal-owned source before `report_build_result`.
4. Implement executor-side runner that receives linker index restricted to the current goal's imports/exports.
5. Write goal-run evidence with file/line findings.
6. Sink the result into `criteria_results`.
7. Teach delivery gate to fail when an essential `contract_audit` criterion failed or has no evidence.

## Tier 1 Audit Rules

- `literal_union`: fail on string literals assigned to a field outside the allowed values.
- `ref`: resolve to a literal union / enum contract before auditing.
- `branded`: examples are not a closed domain; only audit when the brand resolves via `ref` or a linked enum/literal union.
- Dynamic values become `needs_judge` only after the scorer chain exists; until then do not add this scorer type.
