# Architect ScriptRef Feedback Loop

## Incident

Task `tsk_ececb0f60001PGfpkhJEbthRKx` cancelled while Architect was decomposing the
TradingView world-economy task. The Architect session repeatedly said it needed
to replace `script_ref` acceptance scorers with inline `shell` scorers, but each
tool call continued to submit the same `script_ref` shape. The session then
registered temporary `test_shell*` goals to probe the schema and never called
`submit_architect`.

## Call-Point Inventory

Targeted search covered:

- `packages/opencorvus/src/acceptance/types.ts`
  - Canonical scorer schema. `heuristic.spec.kind` supports both `shell` and
    `script_ref`.
- `packages/opencorvus/src/prompt/core/architect-core.txt`
  - Architect prompt explains scorer shapes and now states that `script_ref`
    may only reference existing repo scripts.
- `packages/opencorvus/src/architect/output-tools.ts`
  - Architect collector tool surface. This is where registration feedback,
    `modify_goal` feedback, and script-ref data validation belong.
- `packages/opencorvus/test/architect/output-tools.test.ts`
  - Regression coverage for collector mutations and feedback.
- `packages/opencorvus/test/architect/grep-only-as-rejection.test.ts`
  - Prompt regression coverage for Architect acceptance discipline.

## Root Cause

The schema was not missing shell support. The failure came from three interacting
defects:

1. `script_ref` accepted nonexistent verifier scripts, so a hallucinated
   acceptance checker could enter the goal contract.
2. Goal snapshots only displayed scorer `type` (`heuristic`) and hid
   `spec.kind`, so the model could not observe that it was still submitting
   `script_ref`.
3. `modify_goal` reported `fields updated (1 change(s))` based on submitted
   field count rather than actual field differences, creating a false success
   signal for repeated identical updates.

## Decision

- Keep acceptance quality discipline in the Architect prompt. Do not add a
  host-side quality gate for "good" acceptance specs.
- Add a data-integrity check for `script_ref`: the referenced repo script must
  exist at registration/modification time. One-off checks must use inline
  `shell`.
- Include scorer implementation details in Architect goal snapshots:
  `heuristic:shell:<cmd preview>`, `heuristic:script_ref:<path>`,
  `prebuilt:<name>`, `contract_audit:<ids>`, or `llm_judge:<inputs>`.
- Make `modify_goal` report no-op when the submitted updates do not change the
  normalized goal.
- Tell Architect not to create helper-script goals or temporary test goals just
  to probe schema behavior.

## Verification

- `bun test packages/opencorvus/test/architect/output-tools.test.ts`
- `bun test packages/opencorvus/test/architect/grep-only-as-rejection.test.ts`
