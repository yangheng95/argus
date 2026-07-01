# Build Staged Reference Single Source

Date: 2026-07-01
Status: Implemented

## Problem

Three goal builds for URL/webpage replica tasks can fail immediately with:

```text
BuildAgent.run threw before producing a verdict:
Error: ENOENT: no such file or directory, open '<project>/.opencorvus/r/b/a/<sha>.png'
```

The observed Economy Heatmap task had a frontend-design URL screenshot system artifact:

```text
/attachment/8b9e90b619b338df46427dd0b67857fce27b0cb1/2620f83e83782968844b6e1040a829e8db3cc7ffaf0c9dd273e4d4cb61a9335a.png
```

Build successfully named the staged worktree file in `references/`, but the user-message file part still referenced the original `/attachment/...` blob. When that original content-addressed blob was missing, provider input conversion tried to read `.opencorvus/r/b/a/<sha>.png` and the build session died before the build agent could report a verdict.

## Recall

| Item | Details |
| --- | --- |
| User request | Fix why goals exit immediately; three tasks show the same error; do not treat as simple; user checked disk and the file is absent; first inspect commits and specifically today's introduced issue before choosing a repair. |
| Acceptance criteria | Identify the commit/history path that exposed the problem; fix without fallback or missing-file ignore logic; managed Build must not depend on the original attachment blob after it has staged references into the goal worktree; focused regression tests must prove provider model input can be built from staged references after the original blob is removed. |
| Hard constraints | No fallback/compatibility path; no blind patch; no git reset; no new worktree; inspect landed specs before edits; code changes require tests; do not restart OpenCorvus/overlay processes. |
| Sources read | `specs/README.md`, `specs/records/2026-07/README.md`, `specs/records/2026-06/2026-06-09-project-identity-state-isolation-fix.md`, `specs/records/2026-06/2026-06-19-system-performance-high-confidence-pass.md`, `packages/opencorvus/src/build/agent.ts`, `packages/opencorvus/src/storage/attachment-store.ts`, `packages/opencorvus/src/session/prompt/parts.ts`, `packages/opencorvus/src/session/message.ts`. |
| Commit evidence | Today's `git log --since="2026-07-01 00:00"` shows `21ed94328e dsw-33987 fix(opencorvus): repair orchestration evidence flow` as the only current-branch commit matching `AttachmentStore`, `inlineFileParts`, `stageToWorktree`, `system_artifacts`, `visual_reference`, `rendered_output`, `retryAttachments`, or provider file-part conversion. Later visual/review commits affect Visual QA/Integrity evidence, not the first Build prompt's attachment byte source. |
| Whole-repository grep | `rg "AttachmentStore\.(sweep|collectReferencedShas|delete|write|stageToWorktree|inlineFileParts)|collectReferencedShas|sweep\(" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-06 specs/records/2026-07` found Build, Architect, Requirements, Frontend Design, Intent Analysis, Integrity, Orchestrator wake attachments, and storage tests as callers. `git log -G "AttachmentStore|inlineFileParts|stageToWorktree|system_artifacts|visual_reference|rendered_output|retryAttachments|modelBoundFilePart|toModelMessages" --since="2026-07-01 00:00" -- packages/opencorvus/src packages/opencorvus/test` narrowed today's source-changing commit to `21ed94328e`. |
| Independent agent feedback | Not obtained. The available multi-agent tool's higher-priority instructions forbid spawning sub-agents unless the user explicitly asks for sub-agent/delegation work. |

## Causal Chain

1. `collectBuildReferenceAttachments(task)` merges user attachments and `task.system_artifacts` with `intent === "visual_reference"`.
2. Managed Build stages those references into `<goal-worktree>/references/` through `AttachmentStore.stageToWorktree(...)`.
3. The same Build turn then calls `AttachmentStore.inlineFileParts(allMultimodal)`, which re-reads the original `/attachment/<projectID>/<sha>.png` blob and creates user-message file parts from that original source.
4. `SessionPrompt.createUserMessage(...)` stores those file parts as canonical `/attachment/...` rows. Later `Message.toModelMessages(...)` converts the persisted file part into provider input through `AttachmentStore.read(...)`.
5. If the original blob is missing after staging, Build has a valid worktree-local reference file but provider input still reads the missing original blob and throws `ENOENT` before the build agent can run.

The commit that exposed the issue today is `21ed94328e`: it repaired orchestration evidence transport and made Build consume frontend/visual evidence more reliably. That did not introduce the old double-source code itself; it made the existing bad contract hit common URL-screenshot tasks. The direct bad contract predates today: staging and inline provider input are separate byte sources.

## Repair Contract

Managed Build must use the staged worktree file as the single byte source for model-bound file parts after staging succeeds.

1. Add an `AttachmentStore` helper that converts `StagedAttachment[]` into PromptInput file parts with `file://` URLs pointing at the staged files.
2. In managed Build, stage the actual multimodal set that will be shown to the model, including retry rendered images when present.
3. After staging, Build must pass staged file parts to `SessionPrompt`; `SessionPrompt` already materializes `file://` binary file parts through `AttachmentStore.writeFromPath(...)`.
4. The original `/attachment/...` URLs can remain in the textual inventory as provenance, but they must not be the provider byte source in managed Build after staging.
5. Caller-owned worktrees keep their existing caller-owned contract because Build does not stage files there.

## Tests

Focused tests prove:

1. `AttachmentStore.filePartsFromStagedReferences(...)` returns deterministic `file://` file parts for staged references.
2. A managed-build-style prompt assembled from staged file parts can be converted to provider messages even after the original attachment blob is removed.
3. A Build prompt for managed references uses staged file parts instead of canonical `/attachment/...` file parts.

## Implemented Fix

1. `packages/opencorvus/src/storage/attachment-store.ts`
   - Added `AttachmentStore.filePartsFromStagedReferences(...)`.
   - It converts staged `references/` files into `file://` prompt file parts with staged filenames.
2. `packages/opencorvus/src/build/agent.ts`
   - Managed Build now computes the complete multimodal dispatch set before staging.
   - Managed Build stages that set and uses the staged file parts as the model-bound byte source.
   - Caller-owned worktrees keep their caller-owned contract because Build does not stage files there.
3. Tests cover the helper, the `SessionPrompt` materialization path, provider replay from the recreated attachment, and the BuildAgent source contract.

## Verification

Commands run:

```powershell
bun test packages/opencorvus/test/storage/attachment-stage.test.ts
bun test packages/opencorvus/test/session/prompt.test.ts -t "materializes staged reference"
bun test packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts
bun test packages/opencorvus/test/storage/attachment-stage.test.ts packages/opencorvus/test/session/prompt.test.ts packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun run --cwd packages/opencorvus typecheck
```

Results:

- `bun test packages/opencorvus/test/session/prompt.test.ts -t "materializes staged reference"`: pass.
- `bun test packages/opencorvus/test/storage/attachment-stage.test.ts -t "filePartsFromStagedReferences"`: pass.
- `bun test packages/opencorvus/test/storage/attachment-stage.test.ts packages/opencorvus/test/session/prompt.test.ts packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`: 28 pass.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 19 pass.
- `bun run --cwd packages/opencorvus typecheck`: pass.
