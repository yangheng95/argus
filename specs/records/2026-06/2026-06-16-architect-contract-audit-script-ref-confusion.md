# Architect ContractAudit ScriptRef Confusion

## Incident

Task `goal_calculator_page` repeatedly attempted to register acceptance scorers
that used `spec.kind="script_ref"` with path `.opencorvus/scripts/contract-audit`.
The tool correctly rejected the missing script path, but the Architect model kept
submitting the same payload. This is the remaining loop after
`2026-06-16-architect-script-ref-feedback-loop.md`.

## Call-Point Inventory

Searches performed:

- `rg -n "contract_audit|script_ref|contract-audit|ScorerSchema" packages/opencorvus/src packages/opencorvus/test specs -S`
- `rg -n "missing script_ref|Use spec.kind=\"shell\"|collector unchanged" packages/opencorvus/src packages/opencorvus/test -S`
- `.opencorvus` directory listing confirmed no `.opencorvus/scripts/contract-audit`
  exists.

Relevant sources:

- `packages/opencorvus/src/acceptance/types.ts` — canonical scorer schema.
- `packages/opencorvus/src/prompt/core/architect-core.txt` — Architect scorer
  guidance visible to the model.
- `packages/opencorvus/src/architect/output-tools.ts` — missing `script_ref`
  validation and tool feedback.
- `packages/opencorvus/test/architect/output-tools.test.ts` and
  `packages/opencorvus/test/architect/grep-only-as-rejection.test.ts` —
  regression coverage.

## Root Cause

The first fix prevented nonexistent `script_ref` paths from entering the
collector, but its feedback only said to use shell or an existing script. It did
not explicitly name the semantic confusion: `contract_audit` is a scorer type
for registered graph contracts, not a repo script named `contract-audit`.

For page checks, Architect must emit inline `shell` scorers. For graph contract
checks, Architect must emit `type="contract_audit"` with registered
`contract_ids`. Creating or referencing `.opencorvus/scripts/contract-audit`
would create a second source and hide the real contract-shape error.

## Decision

- Keep the existing hard rejection for missing `script_ref` scripts.
- Strengthen the schema descriptions, Architect prompt, and tool feedback to
  explicitly distinguish `contract_audit` from `script_ref`.
- Do not create a helper script or any fallback path.
- Add tests for the exact `.opencorvus/scripts/contract-audit` confusion.

## Verification

- `bun test packages/opencorvus/test/architect/output-tools.test.ts`
- `bun test packages/opencorvus/test/architect/grep-only-as-rejection.test.ts`
- `bun test packages/opencorvus/test/agent/core-prompt-hygiene.test.ts`
