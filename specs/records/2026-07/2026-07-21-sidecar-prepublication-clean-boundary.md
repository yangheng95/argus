# Sidecar Prepublication Clean Boundary

Status: superseded by `2026-07-21-sidecar-upgrade-startup-lease-boundary-repair.md`

> Correction: the clean-parent precondition introduced here blocks every upgrade parent that contains pre-lease payloads. The superseding record restores lease-proven collection without treating ownership-unproven historical directories as a startup gate.

## Recall

### User request

- 检查硬盘 Sidecar 残留后，要求“释放新 sidecar 前一律要删除旧 sidecar”。

### Acceptance criteria

1. 新的 immutable `sidecar-<payload SHA-256>` 目录只能在同一 embedded parent 中不存在任何旧 `sidecar-*` payload 后发布。
2. 发布前删除所有拥有协议 lease 且已证明无主的旧 payload；不得先发布新 payload 再做事后垃圾回收。
3. 旧 payload lease 仍被持有时必须拒绝新发布并暴露精确路径；不得删除 live payload，也不得继续形成双 payload。
4. 没有 lease ownership 证据的旧 payload 必须拒绝新发布并暴露精确路径；不得把目录年龄、进程名或猜测当成所有权证明。
5. lifecycle lock 内清理已中断发布遗留的 `.sidecar-*-extract-*` 目录；非 Sidecar 目录保持不变。
6. Rust 行为测试覆盖无主旧 payload、live lease、无 lease 旧目录、未发布 extraction、当前 payload 与无关目录；Overlay source-contract、typecheck、文档健康和打包检查通过。
7. 不停止、刷新或重启用户正在运行的 OpenCorvus；提交以 `dsw-33987` 开头并推送 `legacy-remote/v0.0.12beta`。

### Hard constraints

- “一律删除旧 Sidecar”解释为发布前必须达到“无旧 payload”前置状态，不解释为删除仍有真实 owner 的运行文件。
- 不增加 fallback、兼容 alias、进程名扫描、PID registry、目录年龄判断、重试 gate 或第二份 payload source。
- 保留 content-addressed immutable publication、父级 lifecycle lock 和 per-payload operating-system file lease 单一来源。
- 本任务不删除正式运行 payload，也不干预 PID 39804/39815/39876/39887。

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-17-sidecar-payload-lease-garbage-collection.md`
- `specs/records/2026-07/2026-07-20-desktop-managed-sidecar-ownership-and-session-diff-failure.md`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/test/official-runtime-paths.test.ts`
- `script/package-gui-installer-matrix.ts`
- live filesystem, process, file-lock and port evidence gathered on 2026-07-21

### Whole-repository search evidence

Repository-wide `rg` enumerated `ensure_embedded_server_path`, `collect_stale_embedded_payloads`, `embedded_payload_lease_path`, `embedded_payload_temp_dir`, lifecycle/lease constants, `start_server`, settlement ownership, Rust tests, Overlay source-contract tests, `OPENCORVUS_HOME` portable roots and package-matrix records.

| Call point                                                 | Disposition                                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overlay_runtime_paths`                                    | Keep: remains the only default/portable embedded-parent resolver.                                                                                                                  |
| `ensure_embedded_server_path`                              | Move cleanup before any extraction/rename and fail unless the parent is free of older payloads.                                                                                    |
| `collect_stale_embedded_payloads`                          | Replace the post-publication collector with a strict prepublication cleanup operation.                                                                                             |
| `embedded_payload_lease_path` / file locks                 | Keep as the only old-payload ownership proof.                                                                                                                                      |
| `embedded_payload_temp_dir` / `remove_unpublished_payload` | Keep atomic publication; add lifecycle-locked removal of abandoned unpublished siblings before extraction.                                                                         |
| `start_server` / `ServerState.payload_lease`               | Keep: the managed child retains the exact new payload lease for its lifetime.                                                                                                      |
| stop/dead-child settlement                                 | Keep: owner release remains coupled to managed-child settlement.                                                                                                                   |
| Rust embedded-payload tests                                | Replace permissive “skip active/legacy” expectations with strict prepublication removal-or-error behavior and ordering evidence.                                                   |
| `official-runtime-paths.test.ts`                           | Assert prepublication cleanup occurs before `unpack_embedded_payload` and postpublication collection is absent.                                                                    |
| package matrix script                                      | No current temp-root creator exists here; the 2026-07-17 `/private/tmp/opencorvus-*` roots came from historical isolated verification commands, not this current release function. |

### Independent agent feedback

- None. The user did not request delegated or parallel-agent work.

## Causal chain

- Observable: the disk audit found 16 abandoned 2026-07-17 portable test roots totaling 3.661 GiB, including nine complete Sidecar payload copies.
- Direct trigger before this repair: `ensure_embedded_server_path` published/acquired the new payload first and only then called `collect_stale_embedded_payloads`.
- Deeper contract gap: the collector treats live and ownership-unproven old directories as silently acceptable, so successful startup does not prove the parent contains only the selected payload.
- Separate historical residue boundary: isolated `OPENCORVUS_HOME` test roots each own a different embedded parent, so an in-parent collector can never reclaim abandoned parent roots. Current repository package scripts do not recreate the named historical roots; they remain explicit disk-cleanup candidates rather than a second runtime publication path.
- Root repair: make “no older payload” an atomic lifecycle-locked precondition of publication; delete only ownership-proven unowned payloads and fail loudly for every unsafe old payload.

## Implementation plan

1. Replace postpublication best-effort collection with strict `prepare_embedded_payload_parent_for_publication` behavior under the existing lifecycle lock.
2. Remove ownership-proven unowned old payloads and abandoned unpublished extraction directories; reject leased or unproven old payloads.
3. Run cleanup before inspecting/extracting/renaming the new payload and acquire the new lease only after publication validation.
4. Update Rust behavioral tests and Overlay source-contract assertions for ordering and strict failure.
5. Run targeted Rust/Overlay tests, typecheck, document health, diff review and push.

## Verification ledger

- PASS: `prepare_embedded_payload_parent_for_publication` runs under the existing lifecycle lock before new-payload inspection, extraction or atomic rename; the former postpublication collector no longer exists.
- PASS: the inspection phase acquires exclusive locks for every removable old protocol payload without deleting anything. A live lease or an old payload without lease evidence returns an exact publication error and leaves all candidates intact.
- PASS: after the complete inspection succeeds, old payload directories and their lease files are removed before publication; abandoned `.sidecar-*-extract-*` directories are removed in the same prepublication boundary, while the selected payload name and unrelated directories remain untouched.
- PASS: targeted embedded-payload Rust tests passed 13/13; the complete Tauri Rust suite passed 53/53.
- PASS: Overlay runtime-path and managed-startup diagnostics passed 11/11 with 71 expectations; Overlay TypeScript and i18n checks pass.
- PASS: historical-link/document-health tests passed 82/82 with 1,356 expectations; root 11-package typecheck, API route inventory and generated API documentation checks pass.
- PASS: `cargo build --release --quiet --manifest-path packages/overlay/src-tauri/Cargo.toml` returned 0 and produced the release Overlay binary with the repaired publication path.
- PASS: no OpenCorvus process was stopped, restarted or refreshed. The live payload and its held lease remain intact; the separately rooted historical `/private/tmp` test residues were not silently treated as part of this code-change authorization.
