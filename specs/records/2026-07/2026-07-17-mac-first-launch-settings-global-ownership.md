# Mac first-launch settings global ownership

Status: Complete.

## Recall

### Original request

修复打包后的 macOS 版本无法配置 Hexin Key、无法打开 Skill 市场、无法打开 Agent Models 设置的问题；使用 Vite 版本测试并完成修复。

### Acceptance criteria

1. macOS 打包应用首次启动、尚未打开项目目录时，Providers 页面可以读取全局 Provider catalog 并保存 Hexin API key。
2. 保存 Hexin key 后，同一设置会话刷新全局 Provider/model catalog；Agent Models 立即读取同一个全局 catalog。
3. 尚未打开项目目录时，Skill Market 能读取全局市场并安装市场中的 git/URL Skill source；项目相关 Skill mounts 仍只在真实项目范围内读取。
4. Agent Models 在无目录时继续读取和写入 `/global/agents`、`/global/providers`、`/global/config`，不退回项目路由。
5. Vite 真页面覆盖 Providers、Skill Market、Agent Models 三个入口、关键操作、可见错误和网络请求；截图经人工检查。
6. 后端 route、Overlay service/component、browser regression、typecheck、API/SDK、docs 和 diff review 通过；最终重新生成 macOS 打包产物。

### Hard constraints

- 全局 Auth、Provider catalog、Skill 配置仍使用现有 `Auth`、`Config.getGlobal()`、`Provider.*Global`、`SkillManager` 单一 owner；不增加浏览器存储、fallback 或第二份配置。
- `/auth/:providerID` 是全局 credential 写入契约；项目目录不得成为保存 Hexin key 的伪前置条件。
- Skill Market 是全局配置面；Skill mount/matrix、project-local import 和 MCP 继续要求真实项目目录。
- 不刷新、重启或停止用户正在运行的 OpenCorvus/Overlay。验证只使用本任务启动的独立 Vite 和后端进程。
- 保留现有未提交的 frontend-replica E2E 文件和 `packages/overlay/dist-artifacts/darwin-arm64/`，不纳入本任务提交。
- 所有提交以 `dsw-33987` 开头并 push 到 `legacy-remote/v0.0.8beta`，不绕过 hooks。

### Sources read before implementation

- `AGENTS.md`
- Browser skill `control-in-app-browser/SKILL.md`
- `specs/current/architecture/{04-extensions,06-provider,07-panel}.md`
- `specs/records/2026-07/2026-07-10-provider-settings-contract-repair.md`
- `specs/records/2026-07/2026-07-17-global-model-squad-lifecycle-and-composer-stop.md`
- Provider/Auth/Global/Skill server routes and their managers
- Overlay API transport, config loading, Providers, Agent Models, Skill Market and Settings host sources
- Matching transport-protocol, unit, route and browser tests

### Full-repository search evidence

Repository-wide `rg` covered `global/providers`, `global/agents`, `providerScopedPath`, `loadProviderInfo`, every `loadSkillMarket`/`installSkill` caller, `skill/market`, `SkillManager.market/install`, `routeRequiresProjectDirectory`, Settings tab/open-dialog call sites, and all related tests.

| Call point                                                          | Disposition                                                                                                                                                                                              |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GlobalRoutes GET /providers`, `Provider.databaseGlobal/listGlobal` | Retain as global catalog owner; add explicit global refresh operations that reuse Provider refresh implementation with global config.                                                                    |
| `AuthRoutes PUT/DELETE /auth/:providerID`                           | Retain as the only credential owner; remove Overlay's unrelated project-directory prerequisite.                                                                                                          |
| `ProvidersPanel` and `loadProviderInfo`                             | Use global catalog/auth-refresh path when no directory; retain project paths when a real directory is active.                                                                                            |
| `AgentModelsPanel` and `agent-models-data.ts`                       | Retain existing `/global/agents`, `/global/providers`, `/global/config` path; add regression coverage proving it stays usable beside the other two panels.                                               |
| `SkillRoutes /market`, `SkillManager.market/install`                | Keep project route for existing callers; expose the global market/install subset and make market installed-state derive from the same global Skill source config rather than project-only `Skill.all()`. |
| `extensions.ts`, `SkillMarketPanel`                                 | Select global market/install routes without a directory; keep mounts/import/MCP mutations project-scoped.                                                                                                |
| `routeRequiresProjectDirectory`                                     | Retain `/global/*` and `/auth/*` bypass protocol; add exact route contract tests, not a new gate.                                                                                                        |
| Settings navigation (`ConfigDialogHost`, command palette, titlebar) | Retain; Vite proved tab opening works. The failure is the panel's directory ownership, not the navigation event.                                                                                         |
| macOS packaging scripts                                             | Rebuild only after Vite/browser and source checks pass so packaged assets contain the verified current source.                                                                                           |

### Independent agent feedback

No sub-agent was started because the user did not request delegation. The primary agent will perform a separate post-implementation diff review.

## Causal analysis

The isolated Vite app on `127.0.0.1:5173` connected to a task-owned backend on `127.0.0.1:7878` with no active directory. The real page showed:

- Agent Models opens and renders global model selectors, proving current source navigation and `/global/agents` + `/global/providers` + `/global/config` are valid.
- Skill Market opens but immediately renders `Choose a workspace folder` and an empty catalog because its component refuses to call the market API without a directory.
- Providers opens with zero catalog entries and `Choose a workspace folder` because `ProvidersPanel.onMount` refuses `loadProviderInfo()` without a directory, even though that service already implements `GET /global/providers`.
- Hexin key save repeats the same directory check before calling global `PUT /auth/hexin`; the UI therefore blocks its own authoritative credential route.

The observable macOS failure is caused by incomplete global-settings ownership after the Agent Models repair. A packaged app legitimately starts with no selected directory, but Providers and Skill Market still encode the old project-only assumption. The navigation layer itself is not the root cause, and the current Agent Models source already works; the packaged artifact must be rebuilt from the corrected source to remove stale behavior.

## Implementation plan

1. Complete global Provider refresh/Auth presentation so Providers and Hexin key work without a project.
2. Complete global Skill Market read/install while leaving project Skill mounts/imports isolated.
3. Add server, transport, Overlay data/component and real Node-browser regressions for all three settings surfaces.
4. Run Vite against the real isolated backend, inspect fresh screenshots, correct visual issues, and perform a second source/diff review.
5. Run type/API/docs checks, update this verification ledger, commit/push, then rebuild the macOS artifact from the verified commit.

## Verification ledger

- Provider ownership: global catalog/config load, credential save/delete, custom-provider config, catalog refresh, and Hexin model refresh now use the existing global owners when no project directory is active. Project-selected sessions retain the project configuration paths.
- Skill ownership: the global routes expose market read and git/URL install through `SkillManager`; market installed state comes from global Skill configuration and the managed checkout. Path import, mounts, matrix, and MCP remain project-only.
- Agent Models: unchanged global `/global/agents`, `/global/providers`, and `/global/config` ownership was exercised in the same first-launch browser regression; no project settings route was requested.
- Focused backend tests: 34 passed, zero failed.
- Focused Overlay service/component tests: 35 passed, zero failed.
- Type validation: OpenCorvus, Overlay, and repository TypeScript checks passed; the repository run completed all 10 tasks.
- API and documentation: regenerated OpenAPI, JavaScript SDK, and bilingual API reference; `api:routes-check` passed 6 rules across 31 route files and `docs:check` passed 272 operations across 24 groups.
- Documentation suites: after staging the indexed record, historical links, product-doc single-source, and document-health passed all 81 tests with 1,282 assertions. The earlier unstaged-record failure is resolved by the tracked record, not by weakening the check.
- Overlay policy: panel internationalization check passed at revision `8086d1b8b04d6219`.
- Real Vite browser regression: Node Playwright runner built 2,489 modules and passed the first-launch flow that saves a Hexin key, opens Agent Models, opens Skill Market, and installs a market entry without a directory.
- Visual review: Providers, Skill Market, and Agent Models screenshots were inspected at desktop size. All three surfaces opened without the workspace warning, controls were aligned and readable, and the installed Skill changed to its open action. Evidence: `.scratch/mac-first-launch-providers-vite.png`, `.scratch/mac-first-launch-skill-market-vite.png`, `.scratch/mac-first-launch-agent-models-vite.png`, and `packages/overlay/.scratch/mac-first-launch-global-settings.png`.
- Second review: the staged diff preserves global credential/config owners, rejects global path imports, keeps project mounts/MCP isolated, and the browser fixture proves no project settings route is used on first launch. Whitespace checks are clean.
- Source delivery: commit `100bbccda` passed the legacy remote pre-push TypeScript, API route, generated-doc, i18n, and secret checks and was pushed to `legacy-remote/v0.0.8beta`.
- macOS packaging: the first matrix invocation overlapped a separately started production matrix for the same commit; that process removed the shared Tauri bundle while the first invocation was archiving it, so the first invocation was correctly rejected rather than publishing partial output. The existing matrix owner then completed the GUI build from `100bbccda`, producing the ARM64 application archive, DMG, and staged executable.
- Native artifact verification: both staged and archived executables are Mach-O 64-bit ARM64; `CFBundleShortVersionString` and `CFBundleVersion` report `0.0.8-beta`; strict deep code-sign verification passes; `hdiutil verify` reports a valid DMG checksum.
- Final GUI SHA-256: staged executable `8dad69d8c233b2dcd2a5917872357037ffaccd8f2dcd3f1092eeefb64fa1cb31`; DMG `baa2f979902738f8731b982b05040913ab88210e1ad894e8f41a7211f4741bc0`; application archive `8d64c7355ef3e704813e50c05144fc02cdc54c17d2e4a8f7e0b637644e0129c9`.
