# Attachment Replay Lifecycle Root Repair

Date: 2026-07-03
Status: Local verification passed; remote resume observation pending

## Recall

| Item | Details |
| --- | --- |
| User request | Find all causes behind the recurring missing-image failure, use independent agents if needed, repair by root-cause formula, then API-resume the three remote cancelled tasks without starting over and observe until the same task class no longer recurs. |
| Acceptance criteria | No fallback, copied image, symlink, cross-project attachment tolerance, or provider missing-file ignore path; all durable attachment owner surfaces are retained by GC; managed Build retry validates task/session/project ownership and repairs all repairable replay image refs before provider replay; unrecoverable missing tool screenshots fail with an explicit corrupt-evidence error before another blind retry; focused tests cover the recurrence paths; after local verification, resume the existing remote cancelled tasks through API and inspect their status/log evidence. |
| Hard constraints | No fallback or compatibility logic; no gate mechanism; no blind patch; no git reset; no new worktree; preserve unrelated dirty files; inspect landed specs before editing; code changes require tests; do not restart, kill, refresh, or otherwise disturb local OpenCorvus/overlay processes; push to `legacy-remote` after verification. |
| Sources read | `specs/records/2026-07/2026-07-01-build-staged-reference-single-source.md`; `specs/records/2026-07/2026-07-02-build-staged-reference-first-run-race.md`; `specs/records/2026-07/2026-07-02-build-evidence-pack-role-separation.md`; `specs/records/2026-07/2026-07-02-project-alias-identity-convergence.md`; `specs/records/2026-07/2026-07-03-project-exact-worktree-identity-convergence.md`; task debug attachment `C:\Users\chuan\.codex\attachments\4afb05a8-9d90-4857-ad87-1f367dd5b5ed\pasted-text.txt`; remote task board/conversation/status evidence for `tsk_f2374ecd2001lOvyMtWOS53lde`; `packages/opencorvus/src/storage/attachment-store.ts`; `packages/opencorvus/src/build/agent.ts`; `packages/opencorvus/src/session/message.ts`; `packages/opencorvus/src/mcp/materialize.ts`; `packages/opencorvus/src/session/loop.ts`; `packages/opencorvus/src/project/project.ts`. |
| Whole-repository search evidence | `rg -n "attachment|AttachmentStore|stageToWorktree|filePartsFromStagedReferences|repairManagedBuildSessionStagedFileParts|collectReferencedShas|projectID|project_id|browser\\.screenshot|screenshot\\.attachmentUrl" specs packages`; `rg -n "PartTable.data|EngineTaskTable.attachments|EngineTaskTable.system_artifacts|DecisionLogTable|EngineArtifactTable|EngineInteractionRequestTable|EngineProgressSnapshotTable|EngineChannelBindingTable|Message.toModelMessages|state.attachments|attachmentUrl" packages/opencorvus/src packages/opencorvus/test`. |
| Independent agent feedback | Three read-only agents audited the code. The attachment lifecycle audit found GC only retained `part.data`, `engine_task.attachments`, and `engine_task.system_artifacts`, missing `decision_log.value` and engine artifact/progress/interaction/channel payloads. The project identity audit found stale embedded `/attachment/<oldProjectID>/...` refs are a second identity carrier and Build retry must reject foreign project sessions instead of repairing across namespaces. The Build replay audit found retry repair only scans top-level file parts and misses tool-result `state.attachments` plus browser screenshot metadata. |

## Causal Chain

1. Previous repairs fixed managed Build first-turn staged byte sourcing, same-session top-level file part repair, and deduplicated write mtime refresh.
2. The failing remote task still replayed older Build session history containing nested tool-result/browser screenshot image refs under `/attachment/<projectID>/<sha>.png`.
3. `Message.toModelMessages()` strictly reads those refs from `AttachmentStore`; retry repair only inspected top-level file parts, so nested refs were never repaired or rejected before provider replay.
4. Attachment GC retained only three owner surfaces, so durable refs written into decision logs and engine artifact payloads could become orphan on disk before a later Build consumed them.
5. Project identity convergence updated direct `project_id` columns but embedded `/attachment/<projectID>/...` text remains a separate identity carrier; Build retry must bind the existing session to the task project before any repair.
6. The remote orchestrator attempted to copy a reference image into missing sha paths. That is fallback, corrupts content-addressed semantics, and produced new missing hashes on the next retry.

## Repair Contract

1. Expand attachment live-set collection to every durable table that may persist `/attachment/<projectID>/<sha>.<ext>` references.
2. Keep all read paths strict. Missing canonical bytes remain errors.
3. Replace the Build retry helper with a managed replay repair/audit that:
   - verifies the build session belongs to the task project;
   - repairs top-level file parts from staged `references/` with sha verification;
   - repairs nested tool-result attachments only from explicit artifact paths already persisted in the tool metadata and verified by sha;
   - updates browser screenshot metadata only when the repaired attachment remains the same content-addressed URL;
   - hard-fails unrecoverable missing image refs before provider replay.
4. Tighten `AttachmentStore.write()` so non-missing `fs.stat()` errors are surfaced as storage errors, not treated as absent files.
5. Add focused regression tests for each repaired surface and preserve strict negative behavior.

## Remote Resume Plan

After local tests and push, use the existing remote API task IDs from the provided debug payload. Do not create replacement tasks. Resume only the cancelled task records and observe their board/status/conversation evidence for the same missing-image error class. If it recurs, spawn independent read-only agents for the new evidence and continue the repair loop.

## Local Verification

- `bun test packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts packages/opencorvus/test/storage/attachment-store-sweep.test.ts packages/opencorvus/test/storage/attachment-write-from-path.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/browser-preview/evidence-runner.test.ts packages/opencorvus/test/browser-preview/scroll-slice-comparison.test.ts --timeout 120000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`
- `bun run typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
