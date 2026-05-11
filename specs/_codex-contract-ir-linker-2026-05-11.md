# Contract IR + Linker for Cross-Goal Interface Safety - 2026-05-11

## Recall

Task `tsk_e14c1cdad001mW5q2RkU5zPfTX` (csharp-react-rewrite-workflow -> KeyStatisticsMTts) shipped a runtime UI bug: `KeyStatisticsMTts.hooks.ts:239` produced `valueBrushKey = "brush-data-rise"` while the reused consumer `AcrossKeyValue.tsx` expects the raw `BrushKey` literal such as `"DataRise"`. The consumer prepends `text-brush-`, so the rendered class became `text-brush-brush-data-rise`, which does not exist in the Tailwind safelist.

The bug matters because the harness passed even though integrity review predicted the failure class.

## Corrected Pipeline Facts

1. Architect wrote markdown contracts into `decision_log.value` through `RegisteredContract.spec: string`. The relevant shared type contract declared `valueBrushKey: string`, so the value domain was not machine-checkable.
2. `engine_goal.imports` / `exports` are `string[]`. `pipeline/types.ts` promises imports are a subset of dependency exports, but `architectValidationIssues` does not enforce that relation or bind symbols to contracts.
3. The main build path is not `phasePromptSectionForGoal`. Orchestrator composes context in `orchestrator/tools.ts` using `decisionLog.readByPhase("architect")`, then `build/agent.ts` expands full `c.spec` for current-goal, dependency, and task-wide contracts. Only sibling-only contracts compact to 320 chars. The 600-char cap remains real only on `phasePromptSectionForGoal` / general decision-log prompt rendering paths, not on the primary BuildAgent contract path.
4. Single-goal contract rows are tagged with `goalID`; multi-goal contracts are task-scoped. This is still a visibility risk if architect misattributes a shared contract, but it is not the main BuildAgent truncation path.
5. Integrity review is not free-text-only. It already has dimension-scoped `IntegrityIssueType` values. The delivery gate maps `verdict="concerns"` to passed only when `corrections_count === 0 && missing_count === 0`; it is not unconditional pass.
6. The reuse boundary is untyped: `sourceCoverage.action === "reuse"` records paths and rationale, but no harness component extracts exported interfaces from those files.

## Root Problem

Cross-goal interfaces are currently authored as prose/code markdown and consumed by LLMs as text. There is no single typed contract index that can answer:

- Which symbol is imported by which goal?
- Which contract defines that symbol?
- What value domain applies to each field?
- Is a reused source file exporting a type that the task consumes?
- Does the dependency graph make the producer-consumer relation schedulable?

## Scope For This Spec

This spec implements:

- Move 1: replace markdown contracts with ContractIR.
- Move 2: deterministic linker inside architect validation.
- Move 4: extend existing integrity issue types with hard-block issue values if the patch is small.

Move 3 (`contract_audit`) is intentionally split out because it requires a complete scorer chain: `AcceptanceScorer` schema, `renderSpecsAsText`, trigger rules, goal-run evidence, `criteria_results` sink, and delivery-gate consumption. See `specs/_codex-contract-audit-scorer-2026-05-11.md`.

## Move 1 - ContractIR As The Only New Contract Format

Replace `RegisteredContract.spec: string` with `RegisteredContract.ir: ContractIR`.

```ts
type ContractIR =
  | { kind: "type"; name: string; fields: FieldSpec[] }
  | { kind: "function"; name: string; params: FieldSpec[]; returns: TypeSpec }
  | { kind: "enum"; name: string; variants: { value: string; meaning: string }[] }

interface FieldSpec {
  name: string
  typeExpr: string
  valueDomain: ValueDomain
  semantic?: string
}

type ValueDomain =
  | { kind: "open"; reason: string }
  | { kind: "literal_union"; values: readonly string[] }
  | { kind: "branded"; brand: string; examples: string[] }
  | { kind: "numeric_range"; min?: number; max?: number }
  | { kind: "ref"; contractName: string }
```

`open` is allowed only when `reason` explains why the domain is genuinely open. "Unknown", "TBD", "unsure", or an empty reason is invalid because that means the architect failed to identify the domain. `branded` examples are positive examples only. Known bad strings are not a substitute for a positive domain; for `BrushKey`, use `ref` to an extracted or registered literal union / enum such as `BrushKey`.

Architect tools:

- `register_type_contract({ name, fields, goal_ids })`
- `register_function_contract({ name, params, returns, goal_ids })`
- `register_enum_contract({ name, variants, goal_ids })`

The old markdown `register_contract({ category, title, spec })` tool is removed for new architect output. `decision_log.value` remains `TEXT`, but stores `JSON.stringify(ContractIR)`. Prompt rendering uses an IR-aware renderer. There is no second markdown source.

Version rule: registering the same contract `name` overwrites the active collector entry in place before `submit_architect`. Only the finalized active snapshot is persisted to the decision log. Retry sessions seed from existing goals, not from legacy markdown rows; any retry that needs a contract must register a fresh IR contract.

Legacy boundary: old decision-log markdown rows may exist in stored tasks, but new architect collector/linker logic never treats them as valid ContractIR and never checks them. New tasks must use IR. This avoids the internal contradiction where reuse extraction failure would both require manual registration and silently no-op on markdown.

## Move 2 - Linker In Architect Validation

The linker is deterministic host-side data validation. It is invoked from `architectValidationIssues` / the `validate()` closure used by `submit_architect`, not after `submit_architect` succeeds. Therefore `submit_architect` returns `ISSUES` and the same architect agent retries in the original session.

`architect/linker.ts` exposes:

```ts
function linkContracts(input: LinkContractsInput): LinkResult
```

Responsibilities:

1. Build a single active index from `collector.contracts`.
2. Extract exported type/function/enum contracts from `sourceCoverage` rows with `action: "reuse"` and merge them into the same index.
3. Parse every goal `imports[]` and `exports[]` into symbols.
4. Verify imported symbols resolve to either:
   - a registered / extracted contract, and
   - when the importing goal has a producer dependency, a symbol exported by an ancestor goal.
5. Verify exported symbols have a registered or extracted contract.
6. Check cycles in `depends_on` and producer-consumer mappings.

No post-finalize linker phase exists.

### Symbol Parsing Rules

- `.ts` and `.tsx` are parsed with the TypeScript compiler API.
- Reuse extraction uses `checker.getExportsOfModule`, so barrel exports, re-exports, type-only exports, interfaces, type aliases, functions, enums, default exports, and named exports share one extraction path.
- Type-only imports are still contracts; `import type { Props }` must resolve.
- Default export names are indexed as both `default from <path>` and the declaration name when present.
- Import/export strings accepted by `engine_goal.imports` / `exports` are normalized by symbol name first. A suffix like `from path` narrows the path but does not create a second symbol namespace.
- External packages under `node_modules/**` are trusted. Existing project files outside `sourceCoverage.action === "reuse"` are not auto-extracted unless an intra-task goal imports them by declared symbol.

### Reuse Extraction Failure

For a new task, every reuse-consumed symbol must be IR. If extraction fails, linker emits `extraction_failed` and `submit_architect` does not pass. The architect must then register the missing IR manually with the new tools. Old markdown contracts are not consulted by the linker.

### Open Domain Rule

`{ kind: "open", reason }` is valid only for truly unbounded domains. If the value is a CSS class key, enum-like label, event name, route name, permission name, status string, or imported branded key, architect must register a literal union / enum or `ref`.

### Cycle Rule

The linker checks both:

- `depends_on` DAG cycles.
- contract producer-consumer cycles where a goal imports a symbol whose only declared producer depends on that same goal.

Any cycle is a linker issue and keeps `submit_architect` in `ISSUES`.

## Move 4 - Integrity Hard Blocks By Existing Type Axis

Current integrity issues already have dimension-scoped `type`; do not add a parallel `kind`. Extend `IntegrityIssueType` with values such as:

- `weak_acceptance_tsc_only_on_cross_boundary_goal`
- `unresolved_import_symbol`
- `value_domain_open_without_reason`
- `hallucinated_dependency`

Then define one host-side `HARD_BLOCK_INTEGRITY_ISSUE_TYPES` table. A hard-block issue forces `review:integrity` / delivery aggregation to failed even if the aggregate integrity verdict is `concerns`. This is an extension of the existing type axis, not a new issue-kind source.

## Acceptance For This Implementation Slice

1. `RegisteredContract.spec: string` is gone; `RegisteredContract.ir: ContractIR` is the only new contract source.
2. `architect-core.txt` lists the new register tools and no longer instructs architect to call markdown `register_contract`.
3. `architectValidationIssues` includes linker issues, so `submit_architect` itself returns `ISSUES` for unresolved imports, missing contracts, extraction failure, and cycles.
4. `decision-log.value` stores serialized IR JSON, and BuildAgent renders IR in a readable form from `orchestrator/tools.ts` + `build/agent.ts`.
5. Unit tests cover at least:
   - unresolved import symbol,
   - reuse extraction of an exported literal union from `.tsx`,
   - dependency cycle detection.
6. No `contract_audit` scorer is registered in this slice. That belongs to the split spec.

## Out Of Scope

- Replacing the LLM architect.
- Changing the `decision_log` table schema.
- Adding `contract_audit` scorer execution.
- Creating compatibility tooling that converts old markdown contracts into IR.
