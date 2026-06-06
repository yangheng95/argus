# Compaction Instruction Path Match Fix

## Problem

G1 failed inside the internal compaction checkpoint before the build agent could call
`report_build_result`. The compaction agent did call `StructuredOutput`, but the
handoff validator rejected all three attempts with:

`Compaction handoff omitted required evidence fields: durableInstructionSources`

The submitted payload did include `durableInstructionSources`, but it used Windows
absolute paths with forward slashes (`D:/.../AGENTS.md`) or a relative path
(`AGENTS.md`). The validator compared required instruction paths by exact string,
so a native Windows path and the same path rendered with forward slashes were not
recognized as the same instruction source.

## Grep Coverage

Commands reviewed before editing:

- `rg -n "durableInstructionSources|validateHandoffPayload|omitted required evidence fields" packages/opencorvus/src/session/compaction-handoff.ts packages/opencorvus/src/session/compaction.ts packages/opencorvus/test/session -S`
- `rg -n "systemPaths\\(|AGENTS\\.md|CLAUDE\\.md|InstructionPrompt\\.systemPaths" packages/opencorvus/src packages/opencorvus/test -S`

Relevant call points:

| Location | Decision |
| --- | --- |
| `session/compaction.ts::runtimeContext` | Keep `InstructionPrompt.systemPaths()` as the single source of required instruction paths. |
| `session/compaction.ts::validateHandoffPayload` | Keep schema validation and minimum evidence validation unchanged at the call site. |
| `session/compaction-handoff.ts::validateMinimumEvidence` | Replace exact string comparison only for `durableInstructionSources` path matching with semantic path key comparison. |
| `test/session/compaction.test.ts` | Existing rejection tests must still reject genuinely wrong instruction paths. |
| `test/session/compaction-evidence-contract.test.ts` | Add regression coverage for Windows native path versus forward-slash path. |

## Fix

Normalize only instruction-source path comparison keys:

- convert backslashes to forward slashes;
- normalize Windows drive letter casing;
- trim trailing slashes except root-like values.

This keeps the contract strict enough to reject `AGENTS.md` when the required
source is an absolute path, but accepts equivalent Windows slash variants.

Also render missing instruction paths in the error detail so the compaction model
can repair the exact omitted source instead of guessing.
