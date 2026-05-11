# Contract Audit Owner Binding - 2026-05-11

## Problem

`contract_audit` currently audits by field name. A field named `label` anywhere
inside a goal's owned source can be checked against `SuggestionChipProps.label`
even when that object is a context menu, not a suggestion chip. This causes false
failures, repeated build retries, and workaround code such as splitting a normal
literal into string concatenation.

The issue is systemic:

- Contract fields are indexed by `fieldName`, losing the owning contract.
- Props-like object contracts can be registered as `function_contract`, placing
  parameter names into the same field-name scan.
- Verification goals can own feature source files, so the final verification
  pass can edit and re-audit production code instead of routing defects to the
  feature goal.
- `criteria_results` are task-level rows keyed by name, so superseded failed
  criteria can affect later delivery attempts after the goal has passed.
- Visual-reference tasks rely on prompt instructions when the selected build
  model cannot actually see image/PDF bytes.

## Required Behavior

1. `contract_audit` must only audit values that can be bound to a target
   contract owner. `contractName + fieldName` is the audit key. Bare field-name
   matching is deleted.
2. Values that cannot be statically owner-bound are `inconclusive`; they are not
   guessed and not silently passed.
3. Literal evaluation must happen after owner binding and must fold simple
   deterministic expressions such as string literal, no-substitution template,
   string concatenation, const alias, and ternary literal branches.
4. Props and data shapes must be `type_contract`. `function_contract` is only for
   actual callable symbols.
5. Verification goals may own test / benchmark / integration paths. They must not
   own feature source files.
6. Delivery must consume criteria for the latest relevant goal run only; stale
   failed criteria from superseded attempts cannot block delivery.
7. Visual-reference dispatch must fail at host level when the selected execution
   path cannot provide the model/tooling access to the reference pixels.

## Acceptance Matrix

- `{ label: "删除" }` outside `SuggestionChipProps` does not fail
  `SuggestionChipProps.label`.
- `const x: SuggestionChipProps = { label: "删除" }` fails.
- `const x = { label: "删除" } satisfies SuggestionChipProps` fails.
- `<SuggestionChip label="删除" />` fails when the component props bind to
  `SuggestionChipProps`.
- `"删" + "除"` under `SuggestionChipProps.label` resolves to `"删除"` and fails.
- Registering `SuggestionChipProps` through `register_function_contract` is an
  architect validation issue.
- A `kind="verification"` goal with `owned_paths` under `src/**` is an architect
  validation issue.
- A superseded failed `contract_audit` criterion does not affect delivery after a
  newer goal run writes a passed criterion for the same scorer.
- A visual-reference build cannot report passed when the runner filtered the
  reference file part for lack of model modality support.
