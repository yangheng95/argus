# OfficeCLI Windows Runtime Digest Repair

## Recall

### User request

- Diagnose and then fix the `bun run build:overlay` failure caused by the
  packaged OfficeCLI Windows runtime SHA-256 mismatch.

### Acceptance criteria

- Keep strict SHA-256 verification; do not skip verification or dynamically
  trust a mutable remote checksum during packaging.
- Pin both Windows assets from OfficeCLI v1.0.143 to their independently
  verified official release digests.
- Keep the architecture record and exact regression assertions synchronized
  with the runtime configuration.
- Pass the focused non-UI packaging tests and the original
  `bun run build:overlay` command.
- Commit with the `dsw-33987` prefix and push the current branch to `myhexin`.

### Hard constraints

- Do not add, modify, update, or run UI automated tests.
- Do not restart or interfere with a running OpenCorvus or Overlay process.
- Do not add a fallback download, checksum bypass, retry gate, or second
  checksum source in the production build.
- Preserve unrelated concurrent Browser Preview, transport, architecture, and
  `AGENTS.md` changes already present in the worktree.
- Keep all investigation and repair records under the root `specs/` tree.

### Evidence read

- `packages/opencorvus/script/build-runtime-binaries.ts`
- `packages/opencorvus/test/script/build-artifact.test.ts`
- `specs/records/2026-07/2026-07-29-conversation-backed-work-office-capability.md`
- OfficeCLI v1.0.143 release API:
  <https://api.github.com/repos/iOfficeAI/OfficeCLI/releases/tags/v1.0.143>
- OfficeCLI v1.0.143 release checksum file:
  <https://github.com/iOfficeAI/OfficeCLI/releases/download/v1.0.143/SHA256SUMS>

Independent in-memory retrieval verified that the Windows x64 response is a
33,357,736-byte Portable Executable with `MZ` and `PE\0\0` headers, contains
the `OfficeCLI` and `1.0.143` strings, and hashes to
`d4d4c10fced307e209744cf98a56b003a6e613424fd651b08469274704afd2c6`.
The release API and `SHA256SUMS` independently publish the same digest.

### Exhaustive repository search

`rg -n "OFFICECLI_RUNTIME_VERSION|OFFICECLI_ASSETS|officecli-win-x64|officecli-win-arm64|acquirePinnedDownload|copyOfficeCliRuntime|d4d4dbf1|d4d4c10f|51baf12b|51baf511" packages/opencorvus specs .github`
found:

| Surface | Decision |
| --- | --- |
| `build-runtime-binaries.ts` asset table | Retain the concurrent x64 correction and correct ARM64 from the same official release checksum source. |
| `build.ts` and `build.local.ts` | Keep unchanged; both already consume the single `copyOfficeCliRuntime` implementation. |
| `build-artifact.test.ts` | Retain the concurrent exact x64 assertion and add the exact ARM64 assertion. |
| Conversation-backed Work Office capability record | Replace both stale Windows digests; preserve the other six verified platform pins. |
| Runtime cache | Keep unchanged. It deletes mismatched cached bytes and writes only verified assets. |
| Generated built-in Skill payload | Already regenerated, tested, and committed separately before this repair. |

No independent sub-agent feedback exists because the user did not request
delegation or parallel agents.

## Causal chain

1. Observable failure: runtime payload packaging rejects
   `officecli-win-x64.exe` with a SHA-256 mismatch.
2. Direct trigger: the downloaded official bytes hash to `d4d4c10f...`, while
   the runtime table expects `d4d4dbf1...`.
3. Root cause: the initial OfficeCLI integration recorded incorrect complete
   hashes for both Windows assets. The six non-Windows values match the
   official release; neither incorrect Windows value matches any asset digest
   in the latest 100 OfficeCLI releases.
4. Why previous verification missed it: real runtime acceptance covered macOS
   ARM64, while the cross-platform unit test checked only that each configured
   digest looked like 64 hexadecimal characters. Windows assets were never
   compared with the official release bytes or exact digest values.

The exact origin of the two incorrect complete strings is not recorded.
Their shared prefixes with the official values suggest incomplete or
unverified input, but that mechanism remains unproven.

## Implementation

1. Pin Windows ARM64 to
   `51baf511fe136ee216fcc13cf0da9d18078da42212b22805c3a81f4163a4d7b9`.
2. Pin Windows x64 to
   `d4d4c10fced307e209744cf98a56b003a6e613424fd651b08469274704afd2c6`.
3. Assert both exact asset records in the non-UI build Artifact test.
4. Correct both values in the current architecture record.
5. Run focused tests, document-health validation, typechecking, and the
   original `bun run build:overlay` command.

## Verification

- `bun test --timeout=0 packages/opencorvus/test/script/build-artifact.test.ts`:
  52 passed.
- `bun test --timeout=0 packages/opencorvus/test/script/historical-docs-links.test.ts`:
  22 passed.
- `bun test --timeout=0 packages/opencorvus/test/script/document-health.test.ts`:
  63 passed after adding the new record to the Git index as required by the
  monthly index contract.
- `bun test --timeout=0 packages/opencorvus/test/script/product-docs-single-source.test.ts`:
  8 passed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run --cwd packages/opencorvus script/build.ts --overlay-server`: passed.
  The Windows x64 executable compiled, the runtime payload completed in
  14.58 seconds without a digest mismatch, and final payload SHA-256
  generation completed.
- The first post-repair `bun run build:overlay` attempt was blocked before Vite
  or runtime packaging by unrelated concurrent Browser work that temporarily
  left `browser_preview.address.viewport_unavailable` unused. This repair does
  not delete or alter that UI locale contract; the exact top-level command
  remains pending until the concurrent worktree state settles.
