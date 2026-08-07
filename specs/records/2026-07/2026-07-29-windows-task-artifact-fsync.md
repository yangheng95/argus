# Windows Task Artifact fsync Repair

## Recall

### User request

- Synchronize the current `work-v0.0.24beta-yr-0729` branch with the latest
  remote `myhexin/v0.0.24beta` code.
- Preserve local work, complete the existing merge, and push the synchronized
  result to the git-cc remote.
- The preceding packaging-failure repair was superseded by the synchronization
  request.

### Acceptance criteria

- The current branch contains remote commit `24725c27da` and is pushed to
  `myhexin/work-v0.0.24beta-yr-0729`.
- Both branches' July 29 spec index entries survive merge resolution.
- Non-UI contract tests introduced or exercised by the synchronized Artifact
  changes pass on the Windows host.
- The final worktree is clean and the post-repair commit is pushed through the
  repository hooks.

### Hard constraints

- Do not add, modify, update, or run UI automated tests.
- Do not restart or otherwise interfere with a running OpenCorvus or Overlay
  process.
- Do not bypass durability checks, ignore `EPERM`, add a fallback, or turn
  platform failure into a gate.
- Keep plans and investigation records under the root `specs/` tree and update
  both required indexes.
- New commits use the `dsw-33987` subject prefix and push to `myhexin`.

### Read records and primary evidence

- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
  defines the single durability contract: flush every regular file and
  manifest before atomic rename, and additionally flush directory metadata on
  Portable Operating System Interface platforms.
- Microsoft documents that `FlushFileBuffers`, the Windows primitive behind
  file synchronization, requires a handle with `GENERIC_WRITE` access:
  <https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-flushfilebuffers>.
- The synchronized non-UI contract tests reproduced
  `EPERM: operation not permitted, fsync` at
  `packages/opencorvus/src/task-artifact/store.ts:249`.

### Exhaustive repository search

`rg -n "syncRegularFile|\\.sync\\(\\)|fsync|publishTaskArtifactProjectFiles" packages/opencorvus specs`
found:

| Surface | Decision |
| --- | --- |
| `syncRegularFile` in `store.ts` | Replace the read-only file handle with one carrying write access; preserve the same flush and close error semantics. |
| `syncDirectoryMetadata` in `store.ts` | Keep unchanged. It is already skipped on Windows and uses the valid Portable Operating System Interface directory contract. |
| `writeSyncedExclusiveFile` in `store.ts` | Keep unchanged. Its `"wx"` handle already carries write access. |
| `publishTaskArtifactProjectFiles` callers in Artifact catalog, Plugin Host, and store tests | Keep unchanged; they must all consume the repaired single persistence implementation. |
| `store.test.ts`, `plugin-tool-host.test.ts`, and `mirror-watch-package.test.ts` | Reuse as real non-UI regression coverage because each reaches the failing publication path without mocking `fsync`. |
| `2026-07-26-unified-task-artifact-catalog-protocol.md` | Keep as the architecture source; this record documents the Windows correction rather than creating a second durability design. |

No independent sub-agent feedback exists because the user did not request
delegation or parallel agents.

## Causal chain

1. Observable failure: synchronized Artifact publication tests fail on Windows
   with `EPERM` at `FileHandle.sync()`.
2. Direct trigger: `syncRegularFile` opens a newly copied snapshot file with
   the read-only `"r"` flag and then asks the operating system to flush it.
3. Root cause: Windows `FlushFileBuffers` requires `GENERIC_WRITE`; the
   read-only handle cannot satisfy the platform API contract.
4. Why the prior path did not root-fix it: the implementation already modeled
   Windows directory-handle differences but incorrectly assumed the Portable
   Operating System Interface read-handle behavior also applied to regular
   Windows files. The newly synchronized binary and package-tool contract tests
   made that platform mismatch consistently observable.

## Implementation

1. Open regular snapshot files with `"r+"` before calling `FileHandle.sync()`.
   This changes handle capability only; it neither rewrites bytes nor weakens
   the immutable snapshot protocol.
2. Document why write access is required on Windows.
3. Run the three real non-UI publication paths that reproduced the failure,
   the Task Artifact store suite, the required historical-doc links test, and
   repository typechecking.
4. Review the final diff, commit with the required prefix, and push through all
   git-cc hooks.

## Verification

- `bun test --timeout=0 packages/opencorvus/test/task-artifact/store.test.ts -t "publishes projected-worker project files as one immutable catalog snapshot"`:
  1 passed.
- `bun test --timeout=0 packages/opencorvus/test/tool/plugin-tool-host.test.ts`:
  7 passed.
- `bun test --timeout=0 packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts`:
  12 passed.
- `bun test --timeout=0 packages/opencorvus/test/script/historical-docs-links.test.ts`:
  22 passed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- The complete Task Artifact store suite reached 30 passing tests. Its one
  remaining case was blocked before product execution because this Windows
  account cannot create a file symbolic link (`fs.symlink` returned `EPERM`);
  the real project-file publication test covering the repaired flush path
  passed independently.
