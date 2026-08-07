# Global model, expert-squad lifecycle, and composer stop convergence

Status: Implemented and verified.

## Recall

### Original request

彻底解决三个桌面端问题：未打开文件夹时仍可配置模型；专家团除 Multica 外也能可靠地全局安装、跨新文件夹复用并方便删除；Chat、Mission、Task 运行期间发送按钮切换为停止按钮并停止对应执行。

### Acceptance criteria

1. Agent Models 在没有活动目录时读取并写入用户全局配置，使用全局 Provider 和 Primary Assistant 目录；有活动目录或 Session 时继续写唯一对应配置源。
2. 市场、文件夹和 ZIP 安装都显式携带 `project | global`，界面默认用户全局；市场包不再硬编码项目目录，因此 Mirror Watch 等包在新项目中直接可见。
3. 非内置专家团可以按 catalog 返回的准确安装范围卸载；删除使用 manifest `id` 和安装范围定位，拒绝删除仍被全局、项目或 Session 配置引用的包，不猜测路径、不删除内置包。
4. Catalog/OpenAPI/SDK 明确返回包的安装范围；安装、发现、导出、删除继续共用 Registry/Manager 的严格单一身份协议。
5. Composer 以 Work Ledger/Board 的后端执行状态为运行来源：Chat active、Mission interruptible、Task queued/active 均显示停止按钮；停止动作分别调用现有 Chat abort、Mission abort、Task cancel 契约。
6. 覆盖无目录模型读写、全局市场安装/跨项目发现、精确卸载与 active 引用拒绝、三类 Composer 停止态及真实页面视觉截图。
7. 通过聚焦测试、Overlay 与服务端 typecheck、API/SDK 生成检查、文档健康检查、diff review；使用 `dsw-33987` 提交并 push 到 `myhexin/v0.0.8beta`。

### Hard constraints

- `prompt_profile.active` 是唯一 active expert-squad 来源，manifest `id` 是唯一身份；不增加兼容 alias、fallback、自动迁移或第二份安装索引。
- 全局配置使用 `Global.Path.config` 和既有 `Config` 写入锁；全局与项目安装使用现有 `ExpertSquadPackageLocations`、Registry 和 manifest-ID install lock。
- 删除是显式、精确、可验证操作；不自动改写用户的 active 配置来掩盖引用关系。
- 运行状态来自后端 Board/Work Ledger 响应及现有事件刷新，不以按钮本地状态冒充执行状态。
- 不重启、刷新或终止用户正在运行的 OpenCorvus/Overlay；视觉验收使用独立测试页面。
- 保留 `packages/overlay/dist-artifacts/darwin-arm64/` 和 `packages/overlay/src-tauri/gen/schemas/macOS-schema.json` 等非本任务未跟踪产物。

### Sources read before implementation

- `AGENTS.md`
- `specs/README.md`, `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-17-multica-global-expert-squad-storage.md`
- `packages/opencorvus/src/{config,agent,expert-squad,server/routes,project,session}/**`
- `packages/overlay/src/components/settings/{AgentModelsPanel,ExpertSquadPanel}.tsx`
- `packages/overlay/src/components/ChatComposer.tsx`, `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/{config,config-load,expert-squad,expert-squad-scope,work-ledger,mission,task,coding-assistant,chat}.ts`
- Matching server, Overlay service, component-contract, browser and document-health tests.

### Full-repository search evidence

Repository-wide `rg` searches covered `global/config`, `global/providers`, `PrimaryAssistantRegistry`, every `loadConfigInfo` and Agent Models caller; `installationScope`, all Manager import/payload/export and Registry discovery callers, catalog source schemas, routes and SDK types; every `ChatComposer` instance, `busy`, `onStop`, `stopCodingAssistantSession`, `abortMission`, `cancelTask`, Work Ledger runtime fields and session status events.

| Call point | Disposition |
| --- | --- |
| `GlobalRoutes /config`, `/providers` | Make global PATCH use the same sparse JSON Merge Patch contract as project config; add global Primary Assistant listing resolved from global config. |
| `agent-models-data.ts`, `AgentModelsPanel.tsx` | Select global endpoints/config when no directory; retain project and Session ownership when present. |
| `config-load.ts`, config events/init | Retain project loading; Agent Models owns its explicit global snapshot so channel/project initialization is not duplicated. |
| `ExpertSquadPackageLocations`, Registry, Manager | Retain canonical roots and strict combined identity inventory; generalize payload install target and add exact scoped uninstall under the manifest-ID lock. |
| `expert-squad.ts` route + generated OpenAPI/SDK | Require payload install scope, expose catalog package scope, add uninstall body/result and active-reference validation. |
| Overlay expert-squad service/panel | Default explicit install scope to global, expose scope selection for local imports, and offer uninstall only for non-built-in packages using returned scope. |
| Multica import | Retain ordinary explicit global import; no branded deletion or catalog path. |
| `work-ledger.ts`, `WorkLedger.tsx` | Cache the same loaded rows as a shared reactive runtime snapshot; no second API or guessed status. |
| `main.tsx`, `ChatComposer.tsx` | Keep the existing send/stop primitive; expand `busy` and `onStop` ownership to selected Chat/Mission rows and Task Board status. |
| Existing Work Ledger row actions | Retain; Composer calls the same service operations rather than introducing a separate stop API. |

### Independent agent feedback

No sub-agent was started because current execution policy permits delegation only when the user explicitly requests it. The primary agent will perform a separate post-implementation diff review.

## Causal analysis

- Model configuration: the UI calls project-only `/agent` and `/config/providers` and throws before loading when `settingsStore.directory` is empty, even though global config/provider primitives already exist. The missing part is a complete global Agent Models contract, not a folder picker workaround.
- Expert squads: Manager/Registry already support global packages and Multica uses that protocol, but the market installer and Overlay local-import UI explicitly choose `project`, while no uninstall contract exists. New folders therefore expose only packages installed by the one global caller.
- Composer: `ChatComposer` already renders Stop whenever `busy` is true. `main.tsx` computes `busy` only from the short-lived local request object and selected Task status, so asynchronous Chat/Mission execution drops back to Send after `prompt_async` returns.

## Implementation plan

1. Complete the global Agent Models HTTP and Overlay data/write path.
2. Generalize bundled payload installation scope, enrich catalog provenance, and implement exact safe uninstall.
3. Add global/project controls and uninstall actions to the Expert Squad settings surface.
4. Project Work Ledger execution state into Composer and route Stop to the correct existing lifecycle operation.
5. Regenerate API/SDK artifacts, run focused and full verification, perform independent diff review, capture real-page screenshots, then commit and push.

## Verification ledger

- Global Agent Models:
  - Overlay data test proves the empty-directory path requests `global/agents`, `global/providers`, and `global/config`, and rejects malformed/timeout responses.
  - Browser test opens Agent Models with no directory, edits independent assistant overrides through `PATCH /global/config`, and captures `.scratch/agent-models-global-no-folder-zh-cn.png`.
  - Visual review corrected the initial project-scoped copy; the accepted page now says `全局默认` and `继承全局默认`.
- Expert squads:
  - Manager tests prove ordinary folder/ZIP and payload packages install globally, are discovered from a second project, reject cross-scope duplicate identities, reject built-in/wrong-scope deletion, and delete only the exact global package.
  - Route tests prove active project references reject uninstall and that an inactive exact-scope package is removed.
  - Browser test proves market installs send `installationScope: "global"`; screenshots show `All projects` on Install and the mature danger `Uninstall` action on package Details.
- Composer Stop:
  - Runtime projection test covers active/idle Chat and interruptible/non-interruptible Mission rows.
  - Main wiring regression assertions cover Chat stop, Mission abort, and Task cancel service ownership.
  - The real controls page rendered `Stop` for an active Task and the stop action incremented the fixture cancel request before the broad legacy controls test reached unrelated Right Dock layout assertions; `.scratch/task-actions-cancel-focus.png` records the same active Task control surface.
- Focused runtime suites: 103 passing assertions/tests across global config/routes, expert-squad routes/manager/catalog, Agent Models, expert-squad Overlay lifecycle/settings, and Work Ledger runtime/consolidation; one pre-existing skipped folder-import case remains skipped.
- Browser suites: Agent Models and Expert Squad suites pass 7/7 using the Node browser runner.
- Static/type validation: OpenCorvus, Overlay, and generated JavaScript SDK TypeScript checks pass; `api:routes-check`, Overlay i18n check, `docs:check`, and `git diff --check` pass.
- Documentation validation: historical links, product-doc single-source, and document-health suites pass after the new record is tracked.

## Post-implementation review

- Confirmed global writes use the existing locked `Config` writer and runtime invalidation rather than a second config store.
- Confirmed payload/folder/ZIP installation converges on the same atomic Manager installer and manifest-ID lock; the retired project-only payload implementation was removed.
- Confirmed uninstall resolves the Registry identity, installation scope, canonical root, non-symlink directory, and manifest before recursive deletion; active configurations are rejected rather than silently rewritten.
- Confirmed Composer reuses the existing `ChatComposer` send/stop primitive and existing lifecycle APIs; no duplicate stop endpoint or local execution-state machine was introduced.
- The Browser skill materially influenced the global-model copy correction after visual inspection; no product layout discrepancy remained in the accepted screenshots.
