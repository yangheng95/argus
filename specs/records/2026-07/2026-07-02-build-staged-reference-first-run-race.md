# Build Staged Reference First-Run Race

Date: 2026-07-02
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | Explain why Economy Heatmap task G1 failed again when a related issue had already been fixed. |
| Acceptance criteria | Identify the real G1 root cause instead of the terminal `cancelled` state; distinguish it from the prior scaffold false-green repair; repair the missing attachment path without adding missing-file tolerance, fallback byte sources, or process gates; add focused regression coverage. |
| Hard constraints | No fallback or compatibility logic; no gate mechanism; no blind patch; no git reset; inspect landed specs before code changes; every code change needs tests; do not restart, kill, refresh, or otherwise disturb running OpenCorvus/overlay processes; keep the current worktree as the only worktree. |
| Sources read | `C:\Users\chuan\.codex\attachments\c102ba75-b306-4912-883a-95448d82d7d5\pasted-text.txt`, `specs/README.md`, `specs/records/2026-07/README.md`, `specs/current/architecture/18-webpage-replica-agent-workflow.md`, `specs/records/2026-07/2026-07-02-goal-scaffold-false-green-cascade.md`, `specs/records/2026-07/2026-07-01-build-staged-reference-single-source.md`, `packages/opencorvus/src/build/agent.ts`, `packages/opencorvus/src/storage/attachment-store.ts`, `packages/opencorvus/src/session/prompt/parts.ts`, `packages/opencorvus/test/storage/attachment-store-sweep.test.ts`, `packages/opencorvus/test/session/prompt.test.ts`, `packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`. |
| Remote task evidence | Task `tsk_f21b68da1001SyombE1xLMsLxM` G1 `gol_f21ea333d001bi35CW0vNSaLow` failed before producing a build verdict. Board evidence says `BuildAgent.run threw before producing a verdict: Error: ENOENT: no such file or directory, open '/workspace/markets-world-economy/.opencorvus/r/b/a/e50c342a3293dcf3c26b5efdb1081ee209b355068f20d70682b81f27ceff20a2.png'`. The build session contains only the host-created user prompt and no assistant response. |
| Whole-repository grep | `rg -n "writeFromPath|stageToWorktree|filePartsFromStagedReferences|sweep\\(|GC_MIN_AGE_MS|collectReferencedShas|repairManagedBuildSessionStagedFileParts" packages/opencorvus/src packages/opencorvus/test specs/current specs/records` found the Build staging path, SessionPrompt file materialization, provider replay, attachment sweep, staged-reference tests, and the July 1 retry repair record. |
| Independent agent feedback | Not obtained. The user did not request multiple independent agents, and the current instructions only require the main agent to inspect landed records and code directly for this diagnosis. |

## Diagnosis

The previous scaffold false-green repair is present and addresses a different failure mode: G1 used to pass while producing only blocker docs, then later goals failed on missing contracts. This G1 did not pass. It failed before the model produced any build verdict, changed no files, and had no acceptance record.

The July 1 staged-reference repair is also present: managed Build stages target evidence into `<goal-worktree>/references/` and passes `file://` staged files to `SessionPrompt`. The session evidence confirms that staging worked: the prompt included `references/url-www_tradingview_com-1782977850303.png` as host file context. The failure happened after `SessionPrompt` materialized that staged file back into the content-addressed attachment store and provider replay tried to read the canonical `/attachment/.../e50c342a...png` file.

`AttachmentStore.write()` is content-addressed. When the same bytes already exist, it does not rewrite the file and currently leaves the old file mtime unchanged. That creates a first-run race:

1. URL/reference evidence writes a screenshot blob.
2. Build stages the screenshot into `references/`.
3. `SessionPrompt` writes the staged file bytes back through `AttachmentStore.writeFromPath()`.
4. Because the sha already exists, `AttachmentStore.write()` treats the content-addressed blob as existing and only rewrites metadata.
5. If the blob is older than `GC_MIN_AGE_MS` and not yet visible from the new session part row, an attachment sweep can classify it as an old orphan and unlink it before provider replay reads the newly created user message.
6. Provider replay then fails strictly with ENOENT, which is the observed G1 failure.

This is not a provider tolerance problem and not a Build retry replay problem. It is the missing liveness update on a deduplicated content-addressed write.

## Repair Contract

`AttachmentStore.write()` must treat both new writes and deduplicated existing writes as a fresh claim on the content-addressed blob. When the payload already exists and the caller is writing the same bytes again, the store must refresh that blob's access and modification times before returning the reference. The existing `sweep()` min-age invariant can then protect the file while the caller persists the part row that will make the sha permanently live.

This keeps one byte source: the content-addressed attachment store. It does not add a second reader, missing-file tolerance, or a Build-specific gate.

## Test Plan

Add a focused storage regression test:

1. Write an attachment.
2. Backdate the on-disk blob past `GC_MIN_AGE_MS`.
3. Write the same payload again.
4. Run `AttachmentStore.sweep()` before any retaining part row exists.
5. Assert the file is counted as young/skipped, not deleted, and remains readable.

Run the storage sweep suite plus the existing staged-reference prompt/build suites that covered the July 1 repair.

## Implemented Fix

1. `packages/opencorvus/src/storage/attachment-store.ts`
   - `AttachmentStore.write()` now treats an existing content-addressed file as a fresh write claim by refreshing the file's atime and mtime before returning the reference.
   - If the target sha path exists but is not a file, `AttachmentStore.write()` throws a hard storage error.
2. `packages/opencorvus/test/storage/attachment-store-sweep.test.ts`
   - Added a regression that backdates an existing blob, writes the same payload again, immediately runs `AttachmentStore.sweep()`, and asserts the blob is skipped as young rather than deleted.

## Verification

Commands run:

```powershell
bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts
bun test packages/opencorvus/test/storage/attachment-stage.test.ts packages/opencorvus/test/session/prompt.test.ts packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun run --cwd packages/opencorvus typecheck
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Results:

- Storage sweep suite: 11 pass.
- Staged-reference prompt/build regression set: 32 pass.
- Historical docs links: 19 pass.
- `packages/opencorvus` typecheck: pass.
- Document health: 46 pass.
- Product docs single source: 4 pass.
