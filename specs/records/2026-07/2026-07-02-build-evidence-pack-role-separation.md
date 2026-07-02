# Build Evidence Pack Role Separation

Date: 2026-07-02
Status: Implemented

## Recall

| Item                       | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ---------------- | --------------------------------- | ------------- | ---------------------------- | --------------- | ----------------------------- | ------------------------ | ---------------------- | --------------- | ---------------- | ----------------- | --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| User request               | Explain why Build appears to load two screenshots, decide the generic repair, ask independent agents to review it, then start the fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Acceptance criteria        | Build image inputs must be typed by evidence role instead of flattened into one attachment list; `target_reference` drives the visual reference contract; `previous_output` is repair context only; same-session retry must not resend images; fresh-session retry must not misclassify previous output as a target; URL screenshot plus design manifest must not double-load the same target; no fallback or dual-source semantics may be introduced.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Hard constraints           | No fallback, no compatibility path, no gate; no broad git reset; preserve unrelated dirty worktree changes; inspect landed specs before edits; write focused tests for code changes; do not restart OpenCorvus or overlay processes; keep specs under `specs/records/2026-07/` and update indexes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Sources read               | `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/18-webpage-replica-agent-workflow.md`; `specs/records/2026-07/2026-07-01-build-staged-reference-single-source.md`; `specs/records/2026-07/2026-07-01-visual-qa-feedback-consumption-chain.md`; `specs/records/2026-07/2026-07-01-visual-evidence-bundle-producer.md`; `packages/opencorvus/src/build/agent.ts`; `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/engine/engine.sql.ts`; `packages/opencorvus/src/frontend-design/design-resource-manifest.ts`; `packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`; `packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts`; `packages/opencorvus/test/orchestrator/tools.test.ts`.                                                                                    |
| Whole-repository grep      | `rg -n "BuildEvidencePack                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | collectBuildReferenceAttachments | retryAttachments | loadLatestRenderedRetryAttachment | allMultimodal | renderVisualContractPreamble | stageToWorktree | filePartsFromStagedReferences | design_resource_manifest | designResourceManifest | rendered_output | visual_reference | existingSessionID | managedWorktree | buildUserPartsFn | buildExternalPromptText" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 -S`. |
| Independent agent feedback | Three read-only agents reviewed the plan. Architecture review accepted `BuildEvidencePack` only as a non-persistent one-time projection, warned that `design_resource_manifest` must remain the single frontend_design semantic index, identified `loadLatestRenderedRetryAttachment()` warn-and-return-undefined as fallback, and required `previous_output` to be goal/run scoped. Data-flow review found the real two-image condition is fresh session or fresh retry with one `visual_reference` plus readable latest `rendered_output`, not every Build; it also required preserving same-session replay semantics and AttachmentStore strictness. Test review required real data-flow assertions for orchestrator-to-BuildAgent and BuildAgent-to-session/provider prompt paths, plus same-sha multi-role and URL screenshot/manifest no-double-load coverage. |

## Current Root Cause

Build currently loses evidence role before prompt construction:

1. `BuildAgent.run()` calls `collectBuildReferenceAttachments(input.task)`.
2. That helper flattens user `attachments` and task `system_artifacts` with
   `intent === "visual_reference"`.
3. Orchestrator separately adds `context.retryAttachments` from latest
   `system_artifacts intent === "rendered_output"` when retry / review
   feedback exists.
4. Build combines both arrays into `allMultimodal`.
5. `renderVisualContractPreamble(allMultimodal)` then treats every image as an
   authoritative target reference.

The issue is semantic flattening, not the raw count of screenshots. A previous
rendered screenshot is useful repair evidence, but it is not a target to clone.

## Repair Contract

1. Introduce a typed Build evidence projection for binary evidence only.
   - It is not a new durable manifest.
   - It must not replace `design_resource_manifest`.
   - It must not include requirements, frontend design text, Visual Quality
     Assurance (QA), Integrity, or acceptance feedback markdown.
2. Compose the projection in the orchestrator build tool after retry-session
   selection and before `BuildAgent.run(...)` context assembly.
3. BuildAgent consumes the projection and only handles delivery:
   - stage files into `references/`;
   - create provider-bound file parts from staged files for managed in-process
     Build;
   - render role-specific prompt sections for internal and external executors.
4. Remove old role-erasing selection paths:
   - `collectBuildReferenceAttachments()`;
   - `BuildContext.retryAttachments`;
   - `loadLatestRenderedRetryAttachment()`.
5. `target_reference` is the only role listed in Visual Reference Contract.
6. `previous_output` is repair context and must not be described as a target.
7. Same-session retry must not add new file parts; it only repairs persisted
   staged file parts and appends failure facts.
8. Caller-owned `workDir` with external executors must not claim staged
   `references/<file>` exist unless staging actually happened.

## Validation Plan

- Unit/helper tests for role rendering:
  - no attachments means no visual contract;
  - only `target_reference` appears in the visual contract;
  - `previous_output` and `comparison_artifact` render outside the target list;
  - same SHA can carry multiple roles without semantic loss.
- BuildAgent data-flow tests:
  - managed first turn stages evidence pack files and uses staged file parts;
  - bait task attachments/system artifacts are ignored when the pack is empty;
  - same-session retry does not replay new evidence;
  - external managed build prompt names staged refs only when staging exists.
- Orchestrator data-flow tests:
  - ordinary goal build creates scoped target evidence once;
  - retry with rendered output classifies it as `previous_output`;
  - URL screenshot plus manifest does not double-load the same target;
  - fresh-session retry does not put previous output into the target contract.

## Open Implementation Notes

- Keep `AttachmentStore.stageToWorktree()` and
  `AttachmentStore.filePartsFromStagedReferences()` as the byte-source
  authority after staging.
- Keep `repairManagedBuildSessionStagedFileParts()` for stale same-session
  replay repair.
- If rendered-output provenance cannot be tied to the current goal/run yet,
  expose that explicitly rather than silently using task-level latest output as
  a goal-scoped fact.

## Validation Results

- `bun test packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "goal build uses design resource manifest target once when task attachment has same screenshot|goal build retry forwards previous rendered screenshot through attachment store URL|goal build rejects persisted contract_audit graph id mismatch before build starts" --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`
- `bunx prettier --check packages/opencorvus/src/build/evidence-pack.ts packages/opencorvus/src/build/agent.ts packages/opencorvus/src/orchestrator/tools.ts packages/opencorvus/test/build-agent/visual-reference-prompt.test.ts packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts packages/opencorvus/test/orchestrator/tools.test.ts specs/records/2026-07/2026-07-02-build-evidence-pack-role-separation.md specs/README.md specs/records/2026-07/README.md`
