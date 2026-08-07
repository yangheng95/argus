# Permissions first-launch global switch

Status: Complete.

## Recall

### Original request

用户第一张截图显示 General → Permissions 中 Web Search、Web Fetch、Skill Invocation、External Directory 等 Allow / Ask / Deny 分段按钮无法点击切换。随后补充的 Providers 截图显示已有项目目录时 `provider?directory=...: Load failed`。要求调查并根治这组打包应用故障。

### Acceptance criteria

1. macOS/Vite 首次启动且没有活动项目目录时，五个权限分段控件都能点击和键盘切换。
2. 无目录时写入现有 `/global/config` 的 `tool_permissions`；有目录时继续写入捕获的项目 `/config?directory=...`，不创建第二份配置。
3. 服务端保存成功后当前按钮立即显示新值；保存失败通过现有诊断面暴露，不能伪装成功。
4. Node 浏览器回归覆盖无目录真实点击、请求路径、响应后的选中态及视觉截图；现有项目目录回归继续通过。
5. Overlay 单元/架构测试、TypeScript、i18n、Vite build、文档健康、二次 diff review、commit/push 通过；如用户当前交付仍要求打包版本同步，则从修复提交重建 macOS GUI 产物。
6. 重建的 macOS 应用必须从新的 immutable payload identity 解包 sidecar，内嵌 `bin/rg` 保持可执行，后端不会因 `EACCES` 退出；真实隔离启动的 Provider 路由和 health 请求通过。

### Hard constraints

- `Config.getGlobal()` / `/global/config` 与项目 `/config?directory=...` 继续是唯一配置 owners；禁止 localStorage、乐观伪状态、fallback 或隐藏错误。
- 复用成熟 `SettingsSegmented` / Kobalte primitive，不修改按钮交互原语来掩盖配置作用域错误。
- 保留并发 frontend-replica 文件、现有未跟踪打包产物和其他任务记录，不纳入本任务提交。
- 不干预用户运行中的 OpenCorvus/Overlay；仅使用本任务隔离的 Vite/fixture。
- 提交以 `dsw-33987` 开头并 push 到 `legacy-remote/v0.0.8beta`，不绕过 hooks。

### Sources read before implementation

- `AGENTS.md`
- Browser skill `control-in-app-browser/SKILL.md`
- 用户提供的 Permissions 截图
- `PermissionsPanel.tsx`, `GeneralPanel.tsx`, settings layout and canonical `SegmentedControl`
- config patch/load services, app/settings stores, global/project config routes and schema
- settings primitive, directory ownership, segmented accessibility and browser tests
- current provider/extension architecture records from the preceding first-launch repair

### Full-repository search evidence

Repository-wide `rg` covered permission labels, `PermissionsSettingsGroup`, `setPermission`, every `patchGlobalConfig` and `currentProjectConfigRequestOptions` caller, `tool_permissions` server consumers, settings segmented primitives/styles, and all matching unit/browser tests.

| Call point                                         | Disposition                                                                                                                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PermissionsPanel.setPermission`                   | Root cause: unconditional `currentProjectConfigRequestOptions()` throws with no directory before any request. Replace with explicit active config selection.                      |
| `patchConfig`                                      | Retain as project writer and returned-config store owner.                                                                                                                         |
| `patchGlobalConfig`                                | Retain as global writer; Permissions commits its returned authoritative config to the visible global state when no directory is active.                                           |
| `AgentModelsPanel.patchActiveConfig`               | Existing proof of the same global/project ownership boundary; do not duplicate session-specific behavior.                                                                         |
| `SettingsSegmented` / `SegmentedControl`           | Retain unchanged. Existing browser test proves Kobalte click semantics work when a project exists.                                                                                |
| `config-load.ts`                                   | Retain global/project loads; no-directory Provider load already supplies global config to `appStore.config`.                                                                      |
| `task-api/index.ts`                                | Retain `tool_permissions` consumption for new tasks; no runtime permission engine change is required.                                                                             |
| `settings-segmented-aria-label.test.ts`            | Extend with no-directory global write regression while retaining project route and accessibility assertions.                                                                      |
| directory/static architecture tests                | Update exact source contract to require both global and captured project writes.                                                                                                  |
| packaged sidecar log                               | Runtime evidence: server listened on `127.0.0.1:7878`, then exited on `EACCES` spawning extracted `bin/rg`; the project directory exists and no Provider HTTP error was returned. |
| `build-overlay-payload-stamp.ts`                   | Extend the content identity with the source executable bit and bump its explicit schema version so mode-only changes cannot reuse an old immutable payload.                       |
| Tauri `build.rs` payload identity/archive/manifest | Use the staged artifact's executable bit as the single source for hash, tar mode, and extracted-file manifest instead of an incomplete filename list.                             |
| `unpack_embedded_payload`                          | Retain its manifest-driven `set_permissions`; the manifest becomes complete and the new identity prevents reuse of the already-published broken directory.                        |

### Independent agent feedback

No sub-agent was started because the user did not request delegation. The primary agent will perform a separate post-implementation diff review.

## Causal analysis

The screenshot shows enabled-looking Kobalte segmented items with `Allow` selected. The canonical primitive already emits `onChange`, and the existing project browser fixture successfully clicks `Ask`. The failure occurs one layer later: `PermissionsPanel.setPermission()` unconditionally obtains `currentProjectConfigRequestOptions()`. That helper deliberately throws when there is no active directory. The catch reports a diagnostic but leaves the authoritative config unchanged, so Solid rerenders `Allow` and the user observes no switch. The packaged application starts without a directory, making the project-only assumption consistently reproducible. The correct repair is the config ownership branch already used by Agent Models, not a click/CSS workaround.

The Providers failure has a separate, deeper packaged-runtime cause. The current launch log proves the embedded server started normally and then terminated with `EACCES` when spawning `.../bin/rg`. Tauri's archive builder marks only the server, Browser MCP Node runtime, and plugin workers executable; it discards the already-correct executable bit on staged `bin/rg`. The immutable payload completion check validates only file sizes and a byte-only identity, so the broken extraction is accepted and reused. Once the backend exits, Fetch reports `Load failed` for Provider and any other request. The root repair must make executable mode part of the payload identity and archive manifest, rather than chmod one filename after failure.

## Implementation plan

1. Add a small active-scope permission writer in `PermissionsPanel`: project writer with captured directory, otherwise global writer; commit only the returned server config.
2. Extend service/component and Node browser regressions for no-directory global switching and retain project behavior.
3. Preserve the staged sidecar executable bit in the payload stamp, Tauri archive, and extraction manifest; test mode-only identity drift and `bin/rg` executability.
4. Run a real isolated Vite page, click multiple permission values, inspect network/state, screenshot, and visually review.
5. Run focused/full verification, update this ledger, second-review the exact diff, commit/push, rebuild the macOS GUI artifact, and verify its isolated backend plus Provider route.

## Verification ledger

- Permission ownership: no-directory writes use `/global/config` and commit its returned config; active-directory writes retain captured project request options.
- Real Vite interaction: the task-owned backend on port 4096 hosted the Vite-built UI; Web Search switched from Allow to Ask, the accessible button became pressed, and `GET /global/config` returned `tool_permissions.websearch = "ask"`.
- Visual review: both the in-app Browser render and `packages/overlay/.scratch/settings-segmented-global-ask.png` show the Ask state without layout or focus regressions.
- Node browser regression passed 1/1 and proves no project `/config` PATCH occurs before directory selection.
- Payload integrity: full build-artifact suite passed 46/46; focused Rust embedded-payload suite passed 11/11, including `bin/rg` executable metadata and missing-mode rejection.
- Type/i18n: repository typecheck completed 10/10 tasks; Overlay panel i18n passed at revision `8086d1b8b04d6219`.
- Documentation: historical links, product single-source, and document-health passed 81/81 with 1,282 assertions after the new record was staged.
- Formatting and focused directory/config tests passed; the exact source diff passed pre-commit review.
- Source delivery: commit `8bbe8c451` passed legacy remote pre-push typecheck, route, generated-doc, i18n, and secret hooks and was pushed to `legacy-remote/v0.0.8beta`.
- Native matrix: `darwin-arm64` rebuilt successfully from `8bbe8c451`; Vite built 2,489 modules, the production sidecar and Rust/Tauri application linked, and the matrix staged the executable, DMG, and application archive.
- Real packaged extraction: a task-owned portable launch extracted immutable root `sidecar-cbed8f1c...`; `bin/rg` was `-rwxr-xr-x`. `/global/health` returned healthy version `0.0.8-beta`, `/global/providers` returned 87 catalog entries, and the user's exact `/provider?directory=/Users/yangheng/Documents/OpenCorvus-Demos/nova-project` shape returned 87 entries without `Load failed`.
- Native integrity: staged GUI is Mach-O ARM64; both bundle versions are `0.0.8-beta`; strict deep code-sign verification and DMG checksum verification pass.
- SHA-256: GUI `31433693f6c8f627fbde6fe6919dd5d6a732f1b01f7104c501777571270cb41f`; DMG `5eef5bf10e712070582d183dc6437014f55fe3014e74676c751c8030923d617d`; application archive `388d7068fea698b5b34c97dc9d8d02998c668fca725c1294585245f25f5949d0`.
- Final review: the change preserves one global/project config ownership boundary and one payload-mode source; no segmented primitive, local browser state, filename-specific chmod fallback, or unrelated frontend-replica work is included.
