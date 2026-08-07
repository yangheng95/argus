# Empty-workspace Provider and Chat control plane

## Recall

### User request

- 修复未打开项目时既不能配置 Provider、也不能新建 Chat 的设计回归；这两个全局工作台能力不得继续依赖活动项目。

### Acceptance criteria

1. Empty workspace 的左栏 New Chat 始终可用，并进入与标题栏、命令面板相同的全局 Chat launcher；首次发送只调用 `POST /global/chat`，不创建空的临时项目，也不复用旧项目。
2. Project 行内 New Chat 继续显式绑定该 Project，不改变现有 project-scoped `POST /coding/session` 契约。
3. Empty workspace 的 Providers 页面可读取全局 catalog/config，新增/编辑/删除 Provider、保存 API key、模型发现和连接测试均不要求项目目录。
4. 打开项目后，Provider catalog/config/model resolution 仍使用该项目的配置 owner；API key 仍由现有 `Auth` 单一来源持久化。本记录当时错误排除的全局 Plugin auth/OAuth 边界已由 `2026-07-20-empty-workspace-provider-auth-context.md` 取代。
5. 单元、route、真实 Node 浏览器交互和桌面截图证明两个入口均可用；不把 mock contract 结果称为真实视觉验收。

### Hard constraints

- 不增加浏览器 shadow state、fallback directory、startup implicit project、双源配置、route gate 或状态机。
- `/auth/:providerID` 仍是 API credential 的唯一持久化入口；Provider service 复用同一实现，仅显式传入 global/project config scope。
- 复用后端现有 `POST /global/chat` implicit-project allocator；点击 New Chat 本身不得制造未使用的项目。
- 不停止、刷新、重启或操作用户正在运行的 OpenCorvus/Overlay；浏览器验收使用本任务隔离 fixture。
- 保留现有未跟踪的 `C:/`；并发完成并推送的 database schema backup/restore 提交不属于本任务改动。
- 新 commit subject 以 `dsw-33987` 开头并 push 到 `legacy-remote/v0.0.11beta`。

### Sources read

- `AGENTS.md`
- `specs/current/architecture/06-provider.md`
- `specs/records/2026-07/2026-07-16-global-new-chat-implicit-project-and-visible-provider-errors.md`
- `specs/records/2026-07/2026-07-17-mac-first-launch-settings-global-ownership.md`
- Overlay `WorkLedger`, `TitlebarMenubar`, `CommandPalette`, `main`, `workspace`, `coding-assistant`, `ProvidersPanel`, `config-load`, and `llm` sources/tests
- OpenCorvus `server`, `global`, `provider`, `auth`, `Provider` registry sources/tests
- Browser control skill; current Node browser regression and its generated Provider screenshot

### Whole-repository search evidence

Repository-wide `rg` covered `createCodingAssistantSession`, `createGlobalCodingAssistantSession`, `global/chat`, every New Chat surface, `activeProjectDirectory`, `loadProviderInfo`, `global/providers`, `ProviderAuth`, Provider auth/discovery/test routes, config writers, and their route/unit/browser tests.

| Call point                                                                    | Disposition                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TitlebarMenubar.startNewChat` and `CommandPalette task:new`                  | Replace duplicated close/focus behavior with one global Chat launcher owner.                                                                                                             |
| `WorkLedger` top-level New Chat                                               | Remove the active-project disabled condition and invoke the same global launcher; keep Project-header New Chat project-bound.                                                            |
| `main.createWorkLedgerProjectChat`                                            | Retain only for explicit Project-row creation; do not use it as the empty-workspace path.                                                                                                |
| `coding-assistant.createGlobalCodingAssistantSession` and `POST /global/chat` | Retain as the sole first-send session/project creation path.                                                                                                                             |
| `ProvidersPanel` global catalog/config/API-key paths                          | Retain; current Node browser evidence proves these already work without a directory.                                                                                                     |
| `ProvidersPanel.handleDiscoverModels`                                         | Remove the unrelated directory rejection and select the explicit global Provider operation path when the captured scope is empty.                                                        |
| `ProvidersPanel.handleAuth`                                                   | 此处的 project-only 判断已被后续根因证据否定；由 `2026-07-20-empty-workspace-provider-auth-context.md` 改为显式 global/project auth scope。                                             |
| `testProviderConnection`                                                      | Select global or project operation paths from the explicit scope argument; no ambient directory fallback.                                                                                |
| `GlobalRoutes GET /providers`                                                 | Retain the global catalog owner and add discovery/test children backed by `Config.getGlobal()` and the shared Provider operations.                                                       |
| `ProviderRoutes` discovery/test handlers                                      | Extract/reuse shared operation functions so global and project routes do not fork behavior.                                                                                              |
| `AuthRoutes PUT/DELETE /auth/:providerID`                                     | Retain unchanged as the only credential persistence owner.                                                                                                                               |
| `transport-protocol` directory injection                                      | Preserve `/global/*` and `/auth/*` as control-plane paths and existing project Provider paths as project-scoped.                                                                         |

### Independent agent feedback

- None. The user did not request sub-agent or parallel-agent work; the primary agent will perform the required second diff review.

## Causal chain

- Observable disabled New Chat → the top-level Work Ledger button reads `activeProjectDirectory()` and disables itself → it was wired only to the Project-row creation callback even though the product already has a global launcher and `POST /global/chat` → the global design was implemented in titlebar/command surfaces but not projected into the primary left-rail surface.
- Observable incomplete Provider configuration → global catalog/config/API-key save work, but model discovery rejects empty directory and connection test uses a project route → the earlier first-launch repair covered Hexin key and catalog only, leaving these two API-key Provider operations bound to project middleware → the page was partially global and therefore contradicted its control-plane ownership. The later `2026-07-20-empty-workspace-provider-auth-context.md` investigation proved that treating `providerAuth: null` as a separate project-only boundary was also incorrect.

## Implementation plan

1. Centralize the global Chat launcher and make every global New Chat surface consume it; keep Project-row creation separate and explicit.
2. Extract Provider discovery/test operations behind one implementation that accepts explicit config scope, expose the global control-plane routes, and route the Overlay by its captured directory owner.
3. Add negative/positive regressions for no project, project isolation, request paths, and the absence of the old workspace-directory errors.
4. Run focused route/unit/type/API/docs checks, then a real Node browser flow at desktop size; inspect screenshots and correct any visual regression.
5. Perform a second exact-diff review, update this record with evidence, commit only task-owned hunks, and push `v0.0.11beta` to `legacy-remote`.

## Verification ledger

- PASS: final focused suite reports 142 tests and 699 expectations with no failures, including global discovery, missing-provider connection test, explicit project routing, directory injection, config-load isolation, Work Ledger ownership, and route OpenAPI publication.
- PASS: full repository typecheck reports 9/9 package tasks successful; `git diff --check` is clean.
- PASS: Node browser tests for empty-workspace New Chat/provider error projection and first-launch Provider/Agent Model synchronization.
- PASS: inspected `.scratch/empty-workspace-new-chat-provider-error.png` at the task desktop viewport; corrected the Agent identity flex basis after the first screenshot wrapped `chat` vertically, then rebuilt, reran, and reinspected the corrected screenshot. Also inspected `.scratch/provider-advanced-disclosure.png`, which shows the usable global Provider form and discovered model.
- The empty-workspace launcher now preserves its already-loaded global Provider/config control plane instead of closing an absent Project and clearing those owners.
- PASS: full repository typecheck reports 9/9 package tasks successful; generated SDK/OpenAPI and bilingual API documentation are current; `api:routes-check` is clean across 31 route files and `docs:check` reports 276 operations in 23 groups.
- PASS: real Node browser tests run together and prove the empty-workspace Work Ledger launcher focuses the composer, issues exactly one directory-free `/global/chat`, avoids `/coding/session`, and that global model discovery/connection test requests contain no `directory`.
- 本记录当时将 OAuth 排除在修复外，导致空项目 Provider 配置契约被错误缩水；该结论由 `2026-07-20-empty-workspace-provider-auth-context.md` 明确取代。
