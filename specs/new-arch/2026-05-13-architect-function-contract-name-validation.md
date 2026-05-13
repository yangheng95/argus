# Architect Function Contract Name Validation False Positive

## Context

Task `tsk_e1ffd2773001fiy3pRAnxKCW5h` stalled in the Architect stage after repeated
`submit_architect` attempts. The latest validation output had only two remaining
issues:

- `Contract "useKeyStatisticsData": props/data shape contracts must be registered as type_contract`
- `Contract "useKeyStatisticsConfig": props/data shape contracts must be registered as type_contract`

Both names are lower-camel callable React hook contracts. The validator rejected them
because `isTypeShapeContractName` checks only suffixes:

```ts
/(Props|State|Config|Options|Payload|Data|Model|DTO)$/
```

That suffix-only rule correctly catches `SuggestionChipProps`, but it also catches
callable APIs such as `useKeyStatisticsData`.

## Decision

Keep the deterministic validation gate, but make the shape-name predicate match
type-like identifiers only:

- reject function contracts when the name is PascalCase and ends with a shape suffix
  such as `Props`, `Data`, or `Config`;
- allow lower-camel callable contracts, including hook names ending in the same
  suffixes.

This preserves the existing single validation source in
`packages/opencorvus/src/architect/output-tools.ts` and avoids adding a second
compatibility path or prompt workaround.

## Call Sites Checked

- `packages/opencorvus/src/architect/output-tools.ts`
  - `architectValidationIssues` is the only caller of `isTypeShapeContractName`.
  - `register_function_contract` already encodes callable intent with `kind:
    "function"`.
- Tests:
  - existing reject coverage lives in
    `packages/opencorvus/test/acceptance/contract-audit.test.ts`.
  - add allow coverage there for `useKeyStatisticsData` and
    `useKeyStatisticsConfig`.

## Validation

- Targeted test:
  `bun test packages/opencorvus/test/acceptance/contract-audit.test.ts`
- Manual DB evidence:
  latest `submit_architect` for task `tsk_e1ffd2773001fiy3pRAnxKCW5h` had only the
  two hook-name false positives left.
