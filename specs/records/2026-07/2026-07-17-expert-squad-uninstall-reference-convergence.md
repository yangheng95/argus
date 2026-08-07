# Expert-squad uninstall reference convergence

Status: Implemented and verified.

## Recall

### Original request

用户报告“专家团删除功能异常”。

### Acceptance criteria

1. 删除一个非内置专家团时，不再因历史项目或根会话残留的 `prompt_profile.active` 引用陷入无法完成的重试循环。
2. 删除仍是显式确认的不可逆操作；确认文案明确说明会把该专家团的全局、项目与根会话引用替换为 `general`，然后删除准确安装目录。
3. manifest `id` 继续是唯一身份，`prompt_profile.active` 继续是唯一 active 来源；不增加 alias、fallback、第二份 active state 或路径猜测。
4. 服务端在同一个卸载契约内枚举并替换全部引用，返回替换摘要；Overlay 使用该摘要展示完成结果并刷新 catalog/market。
5. 单元、路由与真实 Node/Playwright 页面测试覆盖点击、确认、请求、引用替换、目录删除和页面刷新；前端截图必须亲自复核。
6. 不干预用户正在运行的 OpenCorvus/Overlay；验证只使用独立测试进程和浏览器夹具。

### Hard constraints

- 复用 `updateGlobalConfigPatch`、项目 `Config.updateProjectPatch`、`Session.mergeConfigOverlayInProject`、Registry/Manager manifest-ID lock 与既有应用确认对话框。
- 不静默改写引用：Overlay 必须把替换语义放进删除确认文案，服务端请求必须显式携带 replacement expert-squad ID。
- 不删除内置包，不猜测安装 scope，不保留旧的“只检查首个引用并失败”双路实现。
- 保留当前工作区内与本任务无关的 E2E、Tauri 配置、窗口测试与 dist artifact 改动。

### Sources read

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`, `specs/current/architecture/07-panel.md`, `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-17-global-model-squad-lifecycle-and-composer-stop.md`
- `packages/opencorvus/src/expert-squad/{manager,registry,locations,catalog,prompt-profile-resolver}.ts`
- `packages/opencorvus/src/server/routes/expert-squad.ts`
- `packages/opencorvus/src/config/{config,update-global}.ts`, `packages/opencorvus/src/session/index.ts`
- `packages/overlay/src/services/{expert-squad,config,app-dialog}.ts`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- Matching Manager, route, service, component-contract and browser tests.
- Runtime logs under `~/.local/share/opencorvus/log/` for 2026-07-17.

### Full-repository search evidence

Repository-wide `rg` covered `uninstall`, `uninstallPackage`, `installationScope`, `installed_package`, `prompt_profile.active`, `Config.getGlobal`, `Project.registeredDirectories`, `Session.list`, `configOverlay`, `mergeConfigOverlayInProject`, `showAppDialog`, every Overlay uninstall selector, and generated OpenAPI/SDK uninstall types.

| Call point | Disposition |
| --- | --- |
| Overlay `uninstallCurrent` | Retain one confirmation/action path; make the replacement semantics explicit, send replacement ID, and render returned replacement counts. |
| Overlay lifecycle service | Extend the existing uninstall request/result only; no second endpoint or state store. |
| `POST /expert-squad/uninstall` | Replace the reject-on-first-reference helper with one explicit reference-convergence operation before exact Manager deletion. |
| `Config.getGlobal` / global updater | Detect and replace the global `prompt_profile.active` value through the canonical locked global writer. |
| `Project.registeredDirectories` / project `Config` | Enumerate every registered project plus the request project, read only the project-owned writable config, and replace exact matching active IDs without materializing inherited global values. |
| `Session.list` / `mergeConfigOverlayInProject` | Replace exact root-session overrides in their owning project namespace; child sessions inherit root ownership and are not a second source. |
| `ExpertSquadPackageManager.uninstallPackage` | Keep exact scope/root/manifest validation and manifest-ID lock; it remains the sole filesystem deletion owner. |
| Generated OpenAPI/SDK | Regenerate from the changed route schema; do not hand-edit generated types. |
| Existing tests | Extend route/service/browser coverage; retire assertions that only prove button presence while claiming lifecycle completion. |

### Independent agent feedback

No sub-agent was started because the current execution policy permits delegation only when the user explicitly requests it. The primary agent will perform a separate post-change diff review.

## Evidence-backed causal chain

- Observable symptom: the user clicks Uninstall, confirms, and the package remains installed.
- Direct trigger: runtime requests reached `POST /expert-squad/uninstall` and returned HTTP 400. One log names session `ses_09141ce12ffeau9xH8rcQwe0FZ`; subsequent logs name registered project `/Users/yangheng/Documents/OpenCorvus-Demos/nova-project`.
- Deeper cause: the server intentionally rejects the first stored global/project/session reference, while the UI only changes the currently visible project/session and exposes no way to enumerate or clear historical references. The user must therefore discover hidden references one at a time and often cannot reach them from the deletion surface.
- Why prior work did not root-cause it: Manager and route unit tests covered active rejection plus inactive deletion, and the browser test rendered an Uninstall button, but the browser fixture never handled `/expert-squad/uninstall` and never clicked the button. The prior verification record therefore overstated UI lifecycle coverage.

## Implementation plan

1. Define the explicit uninstall replacement contract and a structured replacement summary.
2. Converge exact global/project/root-session references through their canonical writers, then call the existing exact-scope Manager deletion.
3. Update Overlay confirmation/result handling and focused tests, including a real rendered confirm/delete/refetch path.
4. Regenerate API/SDK artifacts, run type/API/docs tests, visually review screenshots, inspect the final diff, commit with `dsw-33987`, and push `myhexin/v0.0.8beta`.

## Verification ledger

| Surface | Evidence |
| --- | --- |
| Runtime cause | 2026-07-17 application logs show HTTP 400 first for root session `ses_09141ce12ffeau9xH8rcQwe0FZ`, then for registered project `/Users/yangheng/Documents/OpenCorvus-Demos/nova-project`; both errors came from the former reject-on-first-reference route. |
| Manager | Full `bun test packages/opencorvus/test/expert-squad/package-manager.test.ts --timeout 180000` — 52 passes, 1 intentional skip, 839 assertions, including the same-lock pre-remove callback result. |
| Server route | `bun test packages/opencorvus/test/server/expert-squad-routes.test.ts --timeout 180000` — 1 isolated route suite pass, 45 assertions. The uninstall case replaces one global, two explicit project, and two root-session references, deletes the global package, and proves a third project that only inherited the global value remains without a local override. |
| Overlay unit contracts | `bun test test/expert-squad-lifecycle-service.test.ts test/expert-squad-settings-surface.test.ts test/app-dialog-timeout.test.ts --timeout 180000` — 19 passes, 250 assertions. |
| Rendered browser flow | `node test/browser-runner.mjs test/browser/expert-squad-panel.test.ts` from `packages/overlay` — 4 passes. The test clicks Uninstall, verifies the explicit replacement warning, submits `{ id, installationScope, replacementID: "general" }`, observes the package disappear after refetch, and sees the replacement-count receipt. |
| Visual review | Personally inspected `.scratch/expert-squad-uninstall-confirm-current.png` and `.scratch/expert-squad-uninstalled-current.png`: the confirmation is centered and readable with clear destructive semantics; the refreshed settings page contains two remaining squads and a visible green `replaced 3 references with General` receipt, with no clipping or stale deleted row. |
| Static/API contracts | Root `bun run typecheck` passes all 10 applicable packages; SDK build/generation consistency passes; `bun run api:routes-check` passes across 31 route files; Overlay i18n check passes. |
| Documentation | `bun run docs:check` passes with 272 operations/24 groups; `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 180000` passes 21 tests/70 assertions. |

## Post-change review

The review found and fixed one inherited-config defect before delivery: using `Config.get()` would have treated a global selection as if every project explicitly stored it, then written `general` into every project. The final implementation adds `Config.getProject()` as the project-owned writable-config reader, and the route regression test proves an inherited-only project is not modified. The final path has one request contract, one reference-convergence operation, one exact Manager deletion owner, and no compatibility alias, fallback, second active field, or UI-only success claim.
