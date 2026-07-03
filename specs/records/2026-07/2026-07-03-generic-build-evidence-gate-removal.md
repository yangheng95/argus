# Generic Build Evidence Gate Removal

Date: 2026-07-03
Status: Completed

## Recall

| Item | Details |
| --- | --- |
| User request | After task `tsk_f27349e1f001Bas0d2mDBv13yN` failed while cloning `https://www.tradingview.com/markets/world-economy/`, the user asked why status was contradictory, why a gate was added despite explicit no-gate constraints, then asked to expand the impact investigation with multiple agents and start implementation. |
| Current failure evidence | The root task failed after multiple component goals because Build redispatch hit `BuildInputEvidenceValidationError`: `target_reference` entry `url-www_tradingview_com-1783069799246.png` did not match canonical AttachmentStore metadata, expected filename `<unset>`. The failure happens before `BuildAgent.run`, so retry/direct repair cannot enter the agent. |
| Acceptance criteria | Generic Build must not be blocked by frontend-replica evidence preflight gates; frontend design `region` must not be treated as AttachmentStore `filename`; data integrity checks must remain at real byte/storage boundaries; failed/no-acceptance build attempts must expose actual attempt file/commit facts distinctly from accepted/published files; tests and specs must stop pinning `BuildAgent.run`-not-called behavior as a success condition. |
| Hard constraints | No fallback or compatibility path; no new gate mechanism; no blind patch; no git reset; preserve unrelated dirty worktree changes; do not create a new worktree; do not restart or interfere with OpenCorvus/overlay processes; specs live only under root `specs/`; every code change needs focused regression coverage. |
| Sources read | `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`; `specs/records/2026-07/2026-07-03-multi-task-storage-namespace-consensus.md`; `specs/records/2026-07/2026-07-02-build-evidence-pack-role-separation.md`; `specs/records/2026-06/2026-06-25-visual-evidence-no-hard-gate-root-repair.md`; `specs/records/2026-07/2026-07-03-no-diff-source-row-goal-repair.md`; `specs/current/architecture/02-data.md`; `specs/current/architecture/10-worktree-lifecycle.md`; `packages/opencorvus/src/build/evidence-manifest.ts`; `packages/opencorvus/src/build/evidence-pack.ts`; `packages/opencorvus/src/frontend-design/design-resource-manifest.ts`; `packages/opencorvus/src/orchestrator/tools.ts`; `packages/opencorvus/src/build/agent.ts`; `packages/opencorvus/src/workbench/board.ts`; `packages/overlay/src/utils/debug-info.ts`; `packages/overlay/src/services/diff.ts`; `packages/opencorvus/src/agent/prompt-profile.ts`; `packages/opencorvus/src/agent/runner.ts`; `packages/opencorvus/src/agent/role-contract.ts`. |
| Whole-repository grep | `rg -n "composeBuildInputEvidenceManifest\|inputEvidenceManifest\|evidencePack requires validated\|BuildInputEvidenceValidationError\|direct build rejects foreign input evidence\|fresh Build project mismatch\|build_session_contract\\.input_evidence\|payload\\.input_evidence" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-06 specs/records/2026-07 -g "*.ts" -g "*.md"`; `rg -n "visual_reference_unreadable\|unreadableReferencePromptMarker\|Visual Reference Contract\|DEFAULT_PROMPT_PROFILE_ID\|frontend-replica\|consumed_visual_qa\|reference parity\|desktop-only clone\|browser_preview_reference_regions\|scroll-slice" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-06 specs/records/2026-07 -g "*.ts" -g "*.txt" -g "*.md"`; `rg -n "changedFiles\|changedFileDiffs\|buildOutcome\|actual_changed_files\|findBuildOutcomeByGoalRun\|findLatestDeliveredGoalRun\|/goal-run/.*/diff\|changed_files\|published_commit_ref\|contribution_commit_ref" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records/2026-06 specs/records/2026-07 -g "*.ts" -g "*.tsx" -g "*.md"`; `rg -n "designResourceManifestFileRefs\|region: resource\\.filename\|manifestSha\|AttachmentStore\\.write\\(\|readReference\\(\|parseReferenceMetadata\|stageToWorktree\|displayFilename\|filename" packages/opencorvus/src/storage packages/opencorvus/src/frontend-design packages/opencorvus/src/build packages/opencorvus/src/task-api packages/opencorvus/test/storage packages/opencorvus/test/frontend-design packages/opencorvus/test/build-agent -g "*.ts"`. |
| Independent agent feedback | Peirce identified the immediate region-to-filename semantic bug and the pre-`BuildAgent.run` manifest gate in goal/direct build. Linnaeus expanded AttachmentStore sidecar risks: metadata can be missing or overwritten by same sha/ext later writes, while old session replay can still read bytes. Kuhn found frontend-replica semantics leaking into default prompt profile, generic Build prompt/schema, and runner visual hard failures. Nietzsche and Carson identified board/debug state projection: accepted files and failed-attempt host facts are separate, but debug text presents `changedFiles=0` as if no attempt changed files. Raman listed tests/specs that pin the wrong `BuildAgent.run`-not-called gate. |

## Root Cause

The root cause is not a single corrupted PNG. Frontend-replica evidence was promoted into a generic Build dispatch manifest, then validated as a host-side pre-run condition. That made frontend visual evidence a gate for all Build calls. At the same time, the design-resource `region` display/provenance field was mapped into `filename`, so the manifest validator compared a frontend label against AttachmentStore canonical metadata.

The state contradiction is a separate projection bug: board top-level `changedFiles` means accepted/published files, while failed-attempt `buildOutcome.changedFiles` contains actual build-attempt files. The task debug blob currently reports only the former as `changedFiles=0`.

## Repair Plan

1. Stop requiring `inputEvidenceManifest` for every generic Build evidence pack. Build should receive evidence context and stage/read concrete bytes; byte/store errors should surface through Build execution or explicit storage APIs, not block `BuildAgent.run` from being created.
2. Keep `build_session_contract.input_evidence` as an audit record when a validated manifest exists, but do not treat manifest composition failure as a generic Build dispatch gate.
3. Repair `design_resource_manifest` projection so `region` remains provenance/display context and never becomes AttachmentStore `filename`.
4. Remove filename from hard identity drift checks where the record is a display name rather than byte identity. Preserve project URL, sha, mime, size, and real byte readability checks.
5. Move frontend-replica/Visual QA hard semantics out of generic defaults where the code path is directly responsible for this bug. Generic default prompt profile should be `general`; visual hard failures in runner must not infer Build business success from a prompt marker.
6. Add explicit attempt-vs-accepted file facts to board/debug/diff projection so failed attempts do not look like zero-change attempts.
7. Update tests and current architecture docs to reflect the corrected boundary.

## Implemented Changes

- Removed generic Build dispatch dependence on pre-composed `inputEvidenceManifest`. Fresh goal/direct Build calls now pass concrete evidence context to `BuildAgent.run`; `build_session_contract.input_evidence` remains an optional audit/retry record when a manifest already exists.
- Changed evidence and attachment identity checks so byte identity is sha/mime/size/project URL, while filename is canonical display/provenance metadata. AttachmentStore no longer lets a later same-content write overwrite canonical sidecar metadata.
- Changed frontend-design manifest file refs so `region` is a `label`, not an AttachmentStore `filename`; invalid manifest sha now throws instead of being hashed into a fallback value.
- Deleted the unused runner-level `visual_reference_unreadable` hard-fail mechanism and role-contract marker. The runner still tells the model when multimodal parts are filtered, but it no longer owns a prompt-marker gate for Build success.
- Changed the default prompt profile from `frontend-replica` to `general` in backend and overlay defaults.
- Added failed-attempt file/commit fields to board/debug payloads so accepted files and attempted files are reported separately.

## Verification Plan

- `bun test packages/opencorvus/test/build-agent/evidence-manifest.test.ts packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "input evidence|foreign input evidence|design resource manifest|retry reuses" --timeout 120000`
- `bun test packages/opencorvus/test/agent/runner-tool-scope.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/workbench/board.test.ts packages/overlay/test/task-debug-info.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- `bun run --cwd packages/opencorvus typecheck`

## Verification Results

- Passed: `bun test packages/opencorvus/test/build-agent/evidence-manifest.test.ts packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts packages/opencorvus/test/frontend-design/design-resource-manifest.test.ts packages/opencorvus/test/storage/attachment-project-isolation.test.ts packages/opencorvus/test/storage/attachment-store-sweep.test.ts --timeout 120000`
- Passed: `bun test packages/opencorvus/test/agent/runner-tool-scope.test.ts packages/opencorvus/test/agent/prompt-profile.test.ts packages/opencorvus/test/server/config-routes.test.ts packages/opencorvus/test/server/reply-error-taxonomy.test.ts --timeout 120000`
- Passed: `bun test packages/overlay/test/prompt-profile-config.test.ts packages/overlay/test/prompt-profile-task-session-owner.test.ts packages/overlay/test/task-debug-info.test.ts --timeout 120000`
- Passed: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 120000`
- Passed: `bun test packages/opencorvus/test/agent/runner-tool-scope.test.ts --timeout 120000`
- Passed: `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern 'goal build retry reuses the prior build session by default|goal build session contract records generic evidence without a dispatch manifest|direct build forwards foreign input evidence' --timeout 120000`
- Passed: `bun run api:routes-check`
- Passed: `bun run --cwd packages/sdk/js typecheck`
- Passed: `bun run --cwd packages/opencorvus typecheck`
- Passed: `bun run --cwd packages/overlay typecheck`
- Not counted as a pass: full-file `bun test packages/opencorvus/test/orchestrator/tools.test.ts --timeout 120000` exceeded the outer 300 second validation wrapper while running unrelated orchestration cases; the evidence-gate-specific orchestrator cases above passed.
