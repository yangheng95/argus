# Sidecar Upgrade Startup Lease Boundary Repair

Status: complete

## Recall

### User request

- 修复 Windows Overlay 启动失败：`cannot publish embedded payload ... old payload ... has no ownership lease`。

### Acceptance criteria

1. 已存在无 lease 的历史 `sidecar-*` payload 时，新版本仍能原子发布并启动当前 embedded payload。
2. 无 lease 的历史 payload 没有 ownership 证据，不得自动删除；它的存在也不得充当后端启动 gate。
3. 当前 payload 必须在 lifecycle lock 内完成校验或原子发布，并在清理旧 payload 前持有自己的 shared lease。
4. 旧 payload 只有在存在协议 lease 且能立即取得 exclusive lease 时才可删除；live lease 必须保留但不得阻止当前 payload 启动。
5. 已中断的 `.sidecar-*-extract-*` unpublished 目录继续在 lifecycle lock 内清理；无关目录保持不变。
6. Rust 行为测试覆盖 legacy-unproven、live、collectible、current、unpublished 与 unrelated 路径；Overlay source-contract、typecheck、文档健康和 release build 通过。
7. 不删除用户 AppData 中的历史 payload，不停止、刷新或重启当前 OpenCorvus / Overlay 进程；提交以 `dsw-33987` 开头并推送 git-cc `myhexin` 远端。

### Hard constraints

- 不使用目录年龄、进程名、PID（Process Identifier，进程标识符）扫描或猜测来补造 ownership 证据。
- 不恢复无条件删除，不增加兼容执行路径、fallback、第二份 payload source 或启动 preflight gate。
- 保留 content-addressed immutable publication、父级 lifecycle lock 和 per-payload operating-system file lease 单一来源。
- maintenance collection 只能影响能够证明无主的协议参与者；历史未参与者保持不可删除。

### Evidence collected

- 初始读取 `C:\Users\10132\AppData\Local\ai.opencorvus.overlay\logs\overlay-startup.log` 时只有一次失败；最终审计时共有三次相同失败：新 payload `57d5...d1dc3` 在检查旧 payload `023a...e231` 时因缺少 ownership lease 中止。
- 现场 `embedded` parent 有 47 个 `sidecar-*` 目录，其中 46 个没有 lease；最早目录创建于 2026-07-11，唯一有 lease 的目录 `4152...d631` 创建于 2026-07-21。
- 失败时只有 `opencorvus-overlay.exe`，没有从旧 payload 路径运行的 OpenCorvus backend；失败发生在 `start_server()` spawn 之前。
- Git commit `68d8c82c3` 于 2026-07-21 把 post-publication lease-proven collector 改成 strict prepublication clean gate，并把 missing/live lease 都改为启动错误。
- `fs4::FileExt::try_lock` 提供 non-blocking exclusive ownership probe；Windows 官方文件语义也要求所有相关 handle 关闭后才能真正删除文件。由此可证明“exclusive lease acquired”适合作为删除授权，但“没有 lease 文件”不能证明无 owner。

### Sources read

- `AGENTS.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-10-official-cross-platform-project-open-risk-reduction.md`
- `specs/records/2026-07/2026-07-17-sidecar-payload-lease-garbage-collection.md`
- `specs/records/2026-07/2026-07-20-desktop-managed-sidecar-ownership-and-session-diff-failure.md`
- `specs/records/2026-07/2026-07-21-sidecar-prepublication-clean-boundary.md`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/test/official-runtime-paths.test.ts`
- live filesystem, process, startup-log and Git-history evidence gathered on 2026-07-21
- `fs4` crate documentation and Microsoft Windows file-lock/delete documentation

### Whole-repository search and call-point inventory

Repository-wide `rg` covered `ensure_embedded_server_path`, `prepare_embedded_payload_parent_for_publication`, the removed `collect_stale_embedded_payloads`, `embedded_payload_lease_path`, `embedded_payload_temp_dir`, lifecycle/lease constants, `start_server`, settlement ownership, Rust behavior tests, Overlay source-contract tests and all July architecture records mentioning the lifecycle.

| Surface | Evidence and disposition |
| --- | --- |
| `OverlayRuntimePaths.embedded_dir` | Keep: it remains the only default and portable embedded-parent resolver. |
| `embedded_server_payload_dir_name` | Keep: it remains the single content-addressed current payload identity. |
| `ensure_embedded_server_path` | Publish or validate current payload under the lifecycle lock, acquire its shared lease, then collect only ownership-proven stale protocol payloads. |
| `prepare_embedded_payload_parent_for_publication` | Replace: its clean-parent precondition is the direct upgrade-blocking gate. |
| `collect_stale_embedded_payloads` | Restore as the single post-publication collector; skip live and ownership-unproven payloads, remove only exclusively leased stale payloads. |
| `.sidecar-*-extract-*` cleanup | Retain inside the same lifecycle-owned maintenance pass because unpublished directories are never executable payload owners. |
| `start_server` | Keep: it is the only call to `ensure_embedded_server_path` and receives the current payload lease before spawning. |
| `stop_server` / dead-child `ensure_server` path | Keep: they remain the exact lease-release owners. |
| Rust tests in `main.rs` | Replace the prepublication rejection assertions with upgrade-safe collection behavior and explicit negative deletion assertions. |
| `official-runtime-paths.test.ts` | Replace the strict-gate source assertions with publication-before-collection and skip-on-unproven/live assertions. |
| Historical architecture records | Mark the 2026-07-21 strict prepublication record superseded and make this record the latest lifecycle source. |

### Independent agent feedback

- No sub-agent was created because the user did not request delegation and the active collaboration instruction forbids implicit spawning. The primary agent owns implementation and second review.

## Causal chain

1. Observable symptom: native Overlay reports backend startup failure before any backend process appears.
2. Direct trigger: `prepare_embedded_payload_parent_for_publication()` returns an error for the first old `sidecar-*` directory without a lease file.
3. Deeper design cause: commit `68d8c82c3` converted garbage collection into a clean-parent startup precondition, even though the same repository records that legacy pre-protocol payloads intentionally have no lease evidence and must be preserved.
4. Why the previous path did not root-fix it: unit fixtures proved strict rejection in a clean temporary parent but did not exercise an upgrade parent containing real pre-lease payloads. The asserted invariant was therefore internally consistent in the fixture and incompatible with every long-lived installation.

## Implementation plan

1. Add failing Rust and source-contract tests for a parent containing unproven legacy payloads, a live leased payload, a removable leased payload, an interrupted unpublished directory and the current payload.
2. Replace strict prepublication cleanup with one lifecycle-locked collector that removes unpublished residues and only exclusively leasable stale protocol payloads while preserving live/unproven paths.
3. Order `ensure_embedded_server_path` as current validate/publish, current shared lease acquisition, then stale collection; remove strict clean-parent error strings and tests.
4. Update this record and documentation indexes, run targeted Rust/Overlay tests, full Rust suite, typecheck, document health and release build, then inspect the final diff.
5. Commit and push the completed repair to `myhexin`; do not alter runtime state or user payload directories.

## Verification ledger

- Implemented `collect_stale_embedded_payloads()` as the single lifecycle-owned maintenance pass. It removes interrupted unpublished directories and stale protocol payloads only after obtaining their exclusive lease; a missing lease or contended live lease is preserved and skipped.
- Reordered `ensure_embedded_server_path()` to validate or atomically publish the current content-addressed payload, acquire its shared lease, and only then collect stale payloads. The strict `prepare_embedded_payload_parent_for_publication()` gate and its startup errors no longer exist.
- Replaced the strict-rejection Rust fixtures with a combined upgrade fixture proving that the current payload, a live leased payload, an ownership-unproven payload and an unrelated directory survive while only an unpublished residue and an exclusively leased stale payload are removed. A second pass proves the formerly live payload becomes collectible after its lease is released.
- Overlay source-contract test passed 6/6 with 58 expectations and proves publication plus current lease acquisition both precede collection; it also rejects restoration of the strict prepublication function and missing-lease startup error.
- Complete Tauri Rust suite passed 55/55. Overlay TypeScript typecheck and panel internationalization check passed.
- Historical-link, document-health and product-document single-source suites passed 87/87 with 1,409 expectations under an explicit 30-second per-test timeout. An earlier parallel run exceeded the default 5-second timeout in three repository-wide scans; the same assertions passed without competing build load.
- Isolated Windows release build passed in `packages/overlay/src-tauri/target/x86_64-pc-windows-msvc/release/opencorvus-overlay.exe` without touching the live `target/release` or `dist` executable. Its SHA-256 (Secure Hash Algorithm 256-bit，256 位安全散列算法) is `983BCDD142D028632878BA710291C1C3224996E0DC1E89B69181951CD0536411`, and the embedded payload stamp remains `57d5b64e5a5f1c0fd6803c957e4acd86fc6af39b40cfa99d6fe54afeba6d1dc3`.
- This task issued no AppData deletion and no OpenCorvus / Overlay stop, restart, refresh, launch or replacement. Initial and final audits both found 47 payload directories and one lease. The isolated build did not touch the live hardlinked destination.
- The initially observed Overlay PID (Process Identifier，进程标识符) `6436` was absent in the final audit, and the startup log gained two more failures from the unchanged strict-gate binary. No task command launched or terminated that process, so the external runtime owner and trigger remain unknown.
- Second review found unrelated concurrent Web changes in the shared worktree. They were preserved and excluded from this repair; the Sidecar diff remains limited to `main.rs`, its source-contract test and this already-indexed record.
