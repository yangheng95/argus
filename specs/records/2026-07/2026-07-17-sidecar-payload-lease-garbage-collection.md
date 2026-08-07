# Sidecar Payload Lease Garbage Collection

Status: complete

## Recall

### User request

- Repackage the current macOS Overlay, clean old sidecar/squad payloads, explain why immutable sidecars accumulate instead of being overwritten, and fix the accumulation at its root.

### Acceptance criteria

1. Preserve immutable content-addressed `sidecar-<payload SHA-256>` publication; never overwrite a payload used by another process.
2. A live Overlay instance owns a cross-process shared lease for the exact payload backing its managed server.
3. Concurrent startup/publication/collection is serialized by one lifecycle lock.
4. Collection removes only a non-current payload that participates in the lease protocol and whose exclusive lease can be acquired; live or legacy-unproven directories remain untouched.
5. A crashed owner releases its operating-system file lock automatically, allowing later collection.
6. Tests cover live ownership, collectible stale payloads, legacy unproven payloads, unrelated files, and current-payload preservation.
7. Rebuild and verify the macOS package, commit with the `dsw-33987` prefix, merge current `myhexin/v0.0.8beta`, and push without force.

### Hard constraints

- Do not restore the deleted unconditional `cleanup_stale_embedded_sidecars` behavior.
- Do not inspect process names, infer ownership from directory age, keep a second PID registry, or add a compatibility/fallback execution path.
- Do not stop, restart, refresh, or replace the user's running Overlay processes without explicit authorization.
- Use one mature cross-platform file-lock implementation and keep the lock handles as the ownership evidence.
- Preserve project expert-squad packages; runtime sidecar payloads and `.opencorvus/expert-squads/**` are different lifecycle domains.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-10-official-cross-platform-project-open-risk-reduction.md`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/src-tauri/build.rs`
- `packages/overlay/src-tauri/Cargo.toml`
- `packages/overlay/test/official-runtime-paths.test.ts`
- fs4 1.1.0 official crate documentation for synchronous shared/exclusive advisory locks on Unix and Windows.

### Whole-repository search and call-point inventory

| Surface | Evidence and disposition |
| --- | --- |
| Payload identity | `embedded_server_payload_dir_name()` is the only published root naming owner. Retain `sidecar-<EMBEDDED_SERVER_STAMP>`. |
| Publication | `ensure_embedded_server_path()` validates or atomically renames one completed payload. Extend it to return the server path plus a held payload lease. |
| Managed startup | `start_server()` is the sole managed child spawn path and currently drops all payload ownership after path resolution. Store the returned lease in `ServerState` before releasing startup ownership. |
| Child settlement | `stop_server()` and the dead-child branch in `ensure_server()` clear child/port/log ownership. Clear the payload lease in the same ownership boundary. |
| Existing cleanup | The old `cleanup_stale_embedded_sidecars` was deliberately deleted because it removed every old directory without live-owner proof. Do not restore it. |
| Runtime-path regression | `official-runtime-paths.test.ts` currently asserts that cleanup does not exist. Replace that stale assertion with the lease/collector single-source contract. |
| Rust unit tests | Embedded payload tests already use isolated temporary roots. Add lease/collection behavioral tests there without launching the real Overlay. |
| Package output | `packages/overlay/script/build.ts` produces the current host `.app` and `.dmg`; the GUI installer matrix stages and validates tracked darwin-arm64 artifacts. |

### Independent agent feedback

- No sub-agent was created because the user did not request delegation and the active collaboration instruction forbids implicit spawning. The primary agent owns implementation and review.

## Implementation plan

1. Add fs4's synchronous cross-platform file locks and define one parent lifecycle lock plus one per-payload lease file.
2. Make payload resolution acquire the lifecycle lock, publish/validate the current payload, acquire its shared lease, collect exclusively leasable stale protocol participants, then return the held lease with the executable path.
3. Store/drop the lease with `ServerState` child ownership and cover spawn failure plus child settlement.
4. Add isolated Rust behavioral tests and update the source-contract test.
5. Run Rust, Overlay, document-health, package-tool, typecheck, release-build, payload-identity, and installer validations; perform a second diff review.

## Implementation and verification log

- Added `fs4` 1.1 synchronous cross-platform shared/exclusive file locks. One lifecycle lock serializes publication, lease acquisition, and collection; one per-payload shared lease remains in `ServerState` for the exact managed child lifetime.
- `collect_stale_embedded_payloads()` now removes only non-current `sidecar-*` directories that have a protocol lease file and whose exclusive lease is immediately available. A contended lease, a legacy directory without ownership proof, the current payload, and unrelated directories are preserved.
- `stop_server()` and dead-child settlement release the lease together with child ownership. Spawn and setup failures release the local lease automatically when the owning file handle drops.
- Deleted 13 historical runtime sidecar payload directories, including the 11-directory 4.4 GB Trash batch, without stopping or restarting Overlay processes. Two already-orphaned PTY helper processes kept running with their loaded executable image; no historical `sidecar-*` directory remains on disk.
- Deleted the prior macOS build outputs before rebuilding from current source, then repeated the clean rebuild after merging the latest remote Overlay changes. The final payload identity is `bf702d941c758f0082a2e1ddd1ad607977be7f74883755a37654295036f1a4b5`, and that identity occurs exactly once in the packaged application binary; none of the deleted payload identities occur in it.
- `cargo test`: 52 passed, 0 failed.
- `bun test packages/overlay/test/official-runtime-paths.test.ts`: 6 passed, 0 failed.
- Mirror Watch package-tool regression: 30 passed, 0 failed.
- Historical links, document health, and product documentation single-source suites: 81 passed, 0 failed.
- Overlay TypeScript typecheck and GUI installer matrix validation passed.
- `codesign --verify --deep --strict` passed for the rebuilt application. `hdiutil verify` reported the rebuilt DMG checksum valid.
- Artifact SHA-256 values: standalone binary `795eca2293fc69348f038d39b4ada384e807e38f025f085496528298374f553d`; application binary `514f4c16b6be4bd64373c6fd7177bc442331db0a541fa4d5b196919b62d40160`; app archive `d2595d87931be4cc714f79e774010ea78c6477ae2b606ddf4eb0c8f0e030caf8`; DMG `42c47745d6dd61dbec5fa7e658c98e7c7fb8ede37e1cde81229cd01dcc0f91ea`.
- A Windows cross-target check reached Tauri resource compilation after `fs4` compiled for Windows, then stopped because this macOS host has no `llvm-rc`; no Windows deliverable is claimed by this macOS task.
