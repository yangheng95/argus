# 2026-05-13: Build Context Spike From Empty Snapshot Patch Evidence

## Trigger

Task `tsk_e1f9c2cd4001z5TZEezacMOY84` reported build context suddenly growing beyond 400k. The visible symptom was compaction/summarize failing with provider context overflow, but DB evidence shows the oversized compaction input came from a build-session patch evidence part that listed the entire worktree.

This plan is scoped to root-cause investigation and implementation strategy. It is not a code patch.

## Evidence From Current Task

Read-only SQLite queries against `C:\Users\chuan\AppData\Local\opencorvus\.opencorvus\opencorvus.db` show:

| Session | Event | Evidence |
|---|---|---|
| `ses_1e041b267ffdFO3yajAEhfZENy` | Oversized patch part | `prt_e1fc7e100001ddAXma6acsS1Ns`, `hash=4b825dc642cb6eb9a060e54bf8d69288fbee4904`, `file_count=4478`, `length(data)=676984` |
| `ses_1e041b267ffdFO3yajAEhfZENy` | Compaction overflow | `msg_e1fc7e18a001epmqd9WtZBMNTc`, provider error: `Max Input Tokens=262144, Got=481283` |
| `ses_1e037b17affdw30mS4CpMi7PGv` | Oversized patch part | `prt_e1fcd34fd001vEoaV8VpjgWka3`, `hash=4b825dc642cb6eb9a060e54bf8d69288fbee4904`, `file_count=4479`, `length(data)=677156` |
| `ses_1e037b17affdw30mS4CpMi7PGv` | Compaction overflow | `msg_e1fcd358f001Ker0MisK2FZjUe`, provider error: `Max Input Tokens=262144, Got=465713` |

The hash `4b825dc642cb6eb9a060e54bf8d69288fbee4904` is Git's empty tree. In both failing build sessions, a `step-start` snapshot used that empty tree, then the subsequent `step-finish` snapshot was non-empty. `Snapshot.patch(emptyTree)` correctly reported every indexed file as changed, and the session persisted that list as a patch part.

Other recent patch parts in the same DB are small: the next largest rows are only a few KB. The failure is concentrated in this goal/worktree path.

## Current Implementation Map

| Area | File | Current behavior | Impact |
|---|---|---|---|
| Snapshot capture | `packages/opencorvus/src/snapshot/index.ts` | `track()` calls `add()` then `write-tree`. `add()` does not inspect `git add` exit status. | If `git add` fails or captures an empty temporary index, `write-tree` can return the empty tree and the caller treats it as a valid snapshot. |
| Snapshot diff | `packages/opencorvus/src/snapshot/index.ts` | `patch(hash)` diffs `hash` against current worktree and returns all changed file paths. | Correctly turns an empty-tree baseline into a whole-worktree file list. |
| Session patch emission | `packages/opencorvus/src/session/processor.ts` | On `finish-step` and in the catch/final path, emits a patch part whenever `Snapshot.patch(snapshot).files.length > 0`. | No guard rejects pathological patch evidence before it enters durable session history. |
| Normal provider replay | `packages/opencorvus/src/session/message.ts` | Patch parts become text: `[Patch evidence: hash: ${files.join(", ")}]`. | A single oversized patch part can be replayed into later model calls. |
| Compaction projection | `packages/opencorvus/src/session/compaction.ts` | `patchEvidence()` also expands every patch part with `files.join(", ")`; `runtimeContext()` appends this outside normal tool-output truncation. | Compaction can duplicate the same giant file list in selected history and runtime prompt. |
| Compaction budget | `packages/opencorvus/src/session/compaction.ts` | `selectCompactionInput()` estimates selected history but does not validate the final prompt including runtime context before calling the provider. | Compaction can be invoked with a request larger than the compaction model's input limit. |
| Session summary diff | `packages/opencorvus/src/session/summary.ts` | `computeDiff()` uses earliest `step-start` and latest `step-finish` snapshots for session diff. | An empty earliest snapshot can make overlay summary/diff report the whole worktree as changed. |
| Managed executor acceptance diff | `packages/opencorvus/src/executor/managed.ts` | Uses `Snapshot.track()` for `startHash` and acceptance `currentHash`, but catches failures and continues with missing or empty diff data. | Snapshot integrity failures can be hidden from executor and acceptance state. |
| Git checkpoint snapshot | `packages/opencorvus/src/engine/git.ts` | Stores `Snapshot.track()` result as baseline snapshot. | Bad snapshot hashes can enter task checkpoint metadata. |

## Root Cause

The immediate root cause is not "summarize got too large" by itself. The full chain is:

1. `Snapshot.track()` produced an empty-tree snapshot for a non-empty build worktree.
2. `SessionProcessor` persisted that empty-tree hash as a valid `step-start`.
3. On step finish, `Snapshot.patch(emptyTree)` generated a whole-worktree file list.
4. That file list was persisted as a patch part around 677k characters.
5. Compaction replayed the patch list into model input and exceeded `kimi-k2.6`'s 262144 input-token limit.

The design failure is that snapshot capture has no integrity contract, and patch evidence projection has no bounded structured representation. Both must be fixed. Fixing only compaction would leave bad snapshots contaminating overlay diff, session history, and executor acceptance paths. Fixing only snapshot would not protect existing polluted sessions or future unexpected large diffs.

## Non-Goals

- Do not add provider fallback or context-window fallback.
- Do not silently drop patch evidence without recording that it was rejected or compacted by a deterministic policy.
- Do not make compaction "try another weaker prompt" after overflow.
- Do not add a second diff system parallel to `Snapshot`; keep one snapshot/diff source with stricter validation.
- Do not migrate historical DB schemas. Existing polluted local rows may be explicitly cleaned by a targeted repair script if needed.

## Proposed Implementation

### Review Correction From Independent Agent

The first draft of this plan proposed bounding the persisted patch part itself. That is wrong for the current architecture: `packages/opencorvus/src/engine/rewind.ts` reconstructs `Snapshot.Patch` from `Message.PatchPart.files` and calls `Snapshot.revert(...)`. Truncating or replacing the persisted `files` array would corrupt rewind.

The corrected contract is:

- `Message.PatchPart` remains the functional source for rewind and must keep the complete file list for valid patches.
- Provider-bound text and compaction runtime context use a single bounded projection of that patch part.
- Pathological empty-tree whole-worktree patches are rejected before persistence because they are invalid snapshots, not valid large patches.
- If the project later moves patch data into a separate artifact, that artifact must become the single authoritative rewind source in the same change. This plan does not introduce that schema change.

### Phase 1: Make Snapshot Capture Fail Loudly

Files:
- `packages/opencorvus/src/snapshot/index.ts`
- `packages/opencorvus/src/executor/managed.ts`
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/test/snapshot/snapshot.test.ts`

Change:
- Introduce a small internal helper for git commands inside `Snapshot`, e.g. `snapshotGitText()`, that throws on non-zero exit with stderr.
- Use it in `add()`, `track()`, `patch()`, `diff()`, and `diffFull()` where failure means the snapshot result is invalid.
- `track()` must not return `4b825dc642cb6eb9a060e54bf8d69288fbee4904` for a non-empty worktree. If the temporary index writes the empty tree while the worktree has any non-ignored files, throw `SnapshotEmptyTreeError`.
- Keep genuinely empty repositories valid only when `git ls-files --others --cached --exclude-standard` or equivalent confirms there is no trackable content.
- Add explicit snapshot integrity errors to the message error schema and `Message.fromError()` so the visible assistant message is typed as `SnapshotIntegrityError` / `SnapshotEmptyTreeError`, not `Unknown`.
- Remove `.catch(() => undefined)` and `.catch(() => [])` around `Snapshot.track()` / `Snapshot.diffFull()` in `executor/managed.ts`. Snapshot errors must make executor submit/acceptance fail visibly.

Acceptance:
- Test `git add` failure is not ignored and `track()` rejects instead of returning empty tree.
- Test a real empty git repository can still produce empty tree only when no trackable files exist.
- Test a non-empty linked worktree never returns empty tree.
- Test error message includes cwd/worktree/git dir and stderr head so the underlying git issue is diagnosable.
- Test snapshot integrity errors round-trip through `Message.fromError()`.

### Phase 2: Reject Pathological Patch Parts Before Persistence

Files:
- `packages/opencorvus/src/session/processor.ts`
- `packages/opencorvus/src/snapshot/types.ts`
- `packages/opencorvus/test/session/processor-*.test.ts` or a focused new processor test

Change:
- Add a single patch-evidence projection function, e.g. `Snapshot.patchEvidenceSummary(patch)`, that returns a bounded provider-facing object:
  - `hash`
  - `fileCount`
  - `filesPreviewHead`
  - `filesPreviewTail`
  - `truncated`
  - `omittedCount`
- Keep persisted `Message.PatchPart.files` complete for valid patches because rewind depends on it.
- If the patch hash is the empty tree and the file list is clearly a whole-worktree capture rather than a legitimate greenfield patch, do not persist it as ordinary evidence. Mark the assistant message with a snapshot integrity error so the run fails visibly.

Acceptance:
- Test a valid patch with thousands of files remains complete in the persisted patch part.
- Test an empty-tree whole-worktree patch becomes a visible session error, not a 677k patch part.
- Test ordinary one-file patch parts still render and replay exactly enough evidence for the model.

### Phase 3: Single Bounded Patch Projection For Model Replay And Compaction

Files:
- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/test/session/message.test.ts`
- `packages/opencorvus/test/session/compaction.test.ts`

Change:
- Remove direct `part.files.join(", ")` from both `Message.toModelMessages()` and `SessionCompaction.patchEvidence()`.
- Route both through the same bounded renderer.
- The renderer must include file count and representative paths, not a raw all-paths dump.
- For truncated evidence, include an explicit marker: `Patch evidence truncated: N files total, M omitted`.
- Do not treat this as fallback. It is the one authoritative model projection of patch evidence.
- Do not change the rewind-facing `PatchPart` schema in this phase.

Acceptance:
- Test `Message.toModelMessages()` projects a 4,000-file patch under the cap and includes file count/omitted count.
- Test `SessionCompaction.runtimeContext()` uses the same projection and does not duplicate raw file lists.
- Test `Token.estimate(JSON.stringify(await Message.toModelMessages(...)))` stays below a configured budget for the synthetic 4,000-file case.

### Phase 4: Add Compaction Request Preflight

Files:
- `packages/opencorvus/src/session/compaction.ts`
- `packages/opencorvus/src/session/summary.ts`
- `packages/opencorvus/test/session/compaction.test.ts`

Change:
- After building the final compaction `messages` array, estimate tokens for the exact provider-bound payload.
- If it exceeds `ContextBudget.usable({ config, model })`, fail the compaction with a `ContextOverflowError` before provider call.
- The failure must be explicit and terminal for that compaction attempt. Do not retry with hidden truncation or a different model.
- Because patch evidence is already bounded by Phase 3, this preflight should only catch real non-compressible overloads.
- `SessionSummary.summarize()` must not write `session_diff` or summary counts from invalid snapshot diffs. `Snapshot.diffFull()` failures should propagate to a visible summary failure path instead of creating polluted summary artifacts.

Acceptance:
- Test final compaction preflight catches oversize runtime context before invoking `processor.process()`.
- Test a normal bounded patch-evidence compaction proceeds.
- Test the stored assistant compaction message reports `ContextOverflowError` clearly and is not accepted as a valid summary boundary.
- Test `SessionSummary` does not persist whole-worktree `session_diff` when the baseline snapshot is invalid.

### Phase 5: Repair Existing Polluted Local Rows

Files:
- Prefer a one-off debug script under `packages/opencorvus/script/` only if this needs to be repeatable.
- Otherwise perform a targeted SQL repair manually with a dry-run query first.

Change:
- Identify patch parts where `hash=4b825dc642cb6eb9a060e54bf8d69288fbee4904` and `json_array_length(files) > threshold`.
- Remove only those invalid patch parts or replace the affected assistant messages with explicit snapshot integrity errors. Do not truncate them into "valid" patch evidence because that would preserve a false baseline.
- Repair related polluted artifacts for the same sessions: `step-start.snapshot=4b825dc642cb6eb9a060e54bf8d69288fbee4904`, `session_diff`, and summary counts derived from the invalid empty baseline.
- Keep the original DB backup before mutation.
- Do not touch source worktree files or unrelated messages.

Acceptance:
- Dry-run lists exactly the two polluted parts for task `tsk_e1f9c2cd4001z5TZEezacMOY84`.
- After repair, `Message.toModelMessages()` and compaction selection for both build sessions no longer exceed model budget.
- Overlay no longer shows whole-worktree patch evidence for those two turns.
- Rewind remains correct for all valid patch parts because their complete `files` arrays remain intact.

### Phase 6: End-To-End Regression

Files:
- `packages/opencorvus/test/snapshot/snapshot.test.ts`
- `packages/opencorvus/test/session/message.test.ts`
- `packages/opencorvus/test/session/compaction.test.ts`
- Optional focused integration test around `SessionProcessor` patch emission

Commands:
- `bun test packages/opencorvus/test/snapshot/snapshot.test.ts`
- `bun test packages/opencorvus/test/session/message.test.ts`
- `bun test packages/opencorvus/test/session/compaction.test.ts`
- `bun run typecheck`

Additional DB validation:
- Query latest patch parts ordered by `length(data)`; no new patch part should exceed the bounded cap.
- Query compaction errors containing `ContextWindowExceeded`; no new compaction request should reach provider with a predictable oversize payload.

## Current Task Operational Recommendation

Do not continue retrying the active build task until the two oversized patch parts are repaired or the code fix is in place. Retrying currently reproduces the same pollution pattern: the second build session already generated another empty-tree patch and another compaction overflow.

## Review Checklist

- Does `Snapshot.track()` have exactly one validity contract and fail on impossible state?
- Is patch evidence represented once, through one bounded renderer, for both replay and compaction?
- Are existing polluted DB rows handled explicitly rather than hidden by provider fallback?
- Are tests covering linked worktrees, non-empty worktrees, and synthetic 4,000-file patch evidence?
- Does any path still call `part.files.join(", ")` for provider-bound text?
