# Mirror PRD initial Architect dispatch repair

Date: 2026-07-23

Status: Implemented and verified

## Recall

### User requirement

Determine why the Mirror PRD scheduler repeatedly failed to dispatch Architect in Task `tsk_f8aa8acae001jJwjHhG9kAhoOs`, identify whether a recent change triggered it, and repair the root cause.

### Acceptance criteria

- A fresh `mirror-prism-prd-stage` Task dispatches Requirements first and then sends Architect an exact legal `initial_decomposition` input.
- Initial Architect input never contains `evidence_refs`, continuation, invalid-artifact, defect-kind, or re-entry justification fields, including values serialized as `null`.
- A rejected malformed attempt is corrected from the tool result and is not repeated unchanged; the corrected call invokes and completes Architect exactly once through the real `dispatch_agent` adapter path.
- The scheduler does not try to open an external projected-cache reference with a project-file read tool. Domain workers retain the package-owned source-parity contract through projected Skill context.
- Authoring package, generated payload, package regressions, dispatch regressions, and documentation indexes remain synchronized.

### Hard constraints

- Preserve the strict Architect adapter contract. Do not add a host gate, fallback, compatibility alias, bypass, or state machine.
- Keep `PromptProfileResolver` projection and the manifest workflow as the single runtime sources.
- Do not restart or otherwise disturb the running OpenCorvus/overlay process.
- Preserve the unrelated user edit in `2026-07-22-mirror-prism-full-workflow-distillation.md` and stage only this repair.
- Commit subjects use `dsw-33987`; delivery is pushed from the current main worktree to `legacy-remote/v0.0.15beta`.

### Evidence read

- Task database messages and persisted tool inputs showed eleven identical Architect rejections: `mode: initial_decomposition` was combined with non-empty `evidence_refs`.
- `packages/opencorvus/src/orchestrator/tools.ts` reserves `evidence_refs` and the other named fields for `structural_reentry` and rejects them before an Architect session is created.
- `packages/opencorvus/src/agent/dispatch-adapter-input.ts` defines those optional fields in the shared input shape; legality depends on the selected mode.
- `expert-squads/mirror/mirror-prd/agents/orchestrator/system.md` described Requirements-before-Architect ordering but did not state the exact initial input shape.
- `expert-squads/mirror/mirror-prd/skills/workflow/SKILL.md` incorrectly required every scheduler and worker to read a relative reference, which prompted the scheduler to use a project-file read against an external projected cache path.
- Commit `a3953f902` introduced the local Requirements and Architect nodes into `mirror-prism-prd-stage`; the strict Architect contract predates that change, so the new workflow exposed a missing package prompt contract rather than a new adapter regression.

### Full-repository call-site inventory

| Surface | Disposition |
| --- | --- |
| `expert-squads/mirror/mirror-prd/agents/orchestrator/system.md` | Replace the ambiguous stage sentence with exact initial Requirements/Architect tool shapes, structural re-entry separation, and tool-error correction behavior. |
| `expert-squads/mirror/mirror-prd/skills/workflow/SKILL.md` | Keep the source-parity content package-owned, but assign the relative reference to projected domain-worker context and prohibit scheduler project-file reads of projected cache paths. |
| `expert-squads/mirror/mirror-prd/expert-squad.jsonc` | Bump package version because projected prompt and Skill behavior change. |
| `packages/opencorvus/generated/expert-squad-payload.ts` | Regenerate from tracked package authoring sources. |
| `packages/opencorvus/test/expert-squad/mirror-squads-package.test.ts` | Add exact package-prompt, reference-boundary, and version assertions. |
| `packages/opencorvus/test/orchestrator/tools.test.ts` | Add a real adapter regression proving malformed initial input creates no session or Architect invocation and corrected minimal input invokes Architect exactly once and succeeds. |
| `packages/opencorvus/test/fixture/dynamic-agent-squad.ts` | Align the shared real-dispatch fixture with the Registry contract by making its task-scoped Architect depend on Requirements and every Goal-scoped node depend on that Architect lineage; otherwise adapter tests fail during package loading. |
| `packages/opencorvus/src/orchestrator/tools.ts` and `packages/opencorvus/src/agent/dispatch-adapter-input.ts` | Retain unchanged; these enforce the correct data contract and are not the defective source. |
| `specs/README.md` and `specs/records/2026-07/README.md` | Add this record to both canonical indexes. |

### Independent agent feedback

No independent agent was requested or used. The investigation is grounded in persisted task/tool evidence, repository history, package sources, and the real adapter implementation.

## Causal chain

The visible symptom was a scheduler apparently retrying Architect without progress. The direct trigger was a tool payload that combined `initial_decomposition` with `evidence_refs`. The strict adapter correctly rejected that mode/field combination before creating a session. The scheduler then reasoned about omitted or `null` fields but retained the one actually illegal non-empty field, so it repeated the same payload eleven times. The deeper package defect was that the newly introduced PRD stage graph specified ordering but omitted the exact Architect input contract, while its workflow Skill also told the scheduler to project-read a worker reference. Cancellation occurred later and is not the cause of the failed Architect launch.

## Implementation plan

1. Make the Mirror PRD scheduler prompt explicit about exact initial and structural re-entry shapes and about correcting the actual rejected payload.
2. Restore the Skill reference ownership boundary so scheduling uses the projected main Skill and workers consume the domain reference without external project-file reads.
3. Bump and regenerate the package payload.
4. Add package-source assertions and a real `dispatch_agent` rejection-then-success regression.
5. Run focused package/adapter tests, payload freshness, typecheck, documentation health, and a final diff review before commit and push.

The focused dispatch runs exposed a pre-checker test-toolchain defect: the shared dynamic-agent fixture declared a task-scoped Architect with no Requirements dependency and Goal-scoped nodes outside that canonical lineage, which the current Registry correctly rejects. The fixture is repaired as part of step 4 so the original regression reaches the real adapter rather than being reported as a false product failure.

## Validation ledger

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts`: 131 passed, including malformed initial Architect rejection before invocation and one corrected successful Architect invocation.
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts packages/opencorvus/test/expert-squad/mirror-squads-package.test.ts`: 15 passed; generated payload is authoring-source fresh and the Mirror package prompt/Skill/version contract is projected correctly.
- `bun run typecheck`: 9 tasks passed across the repository typecheck graph.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 82 passed after the scoped record entered the Git index. The initial run's only failure was the expected pre-stage tracked-file check.
- `bun run docs:check`: passed with 287 operations across 23 groups.
- Final diff review confirms the strict adapter implementation is unchanged, the generated payload contains only the three intended Mirror PRD source changes, and the unrelated user edit to `2026-07-22-mirror-prism-full-workflow-distillation.md` remains excluded.
