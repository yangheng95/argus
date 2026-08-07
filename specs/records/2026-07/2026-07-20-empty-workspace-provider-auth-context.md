# Empty-workspace Provider authentication context repair

## Recall

### User request

- 未打开项目时 Provider 仍无法配置，界面显示 `No context found for instance`，并且 OpenAI 订阅鉴权入口消失；修复该设计回归。

### Acceptance criteria

1. 无活动项目时，Providers 读取完整的全局 Provider auth method catalog，OpenAI 的 ChatGPT Plus/Pro 与 headless 订阅入口可见。
2. API key、声明式 prompt、OAuth authorize/callback 均通过显式全局控制面工作，不读取或伪造 Project `Instance`。
3. 打开项目后的 Provider auth 继续使用项目 Plugin 投影；全局与项目流程共享 `ProviderAuth` 行为及 `Auth` 凭据单一来源。
4. Overlay 不再把空项目的 `providerAuth` 写成 `null`，也不以缺少目录拒绝鉴权动作。
5. route、单元和真实 Node 浏览器截图覆盖空项目 OpenAI 订阅入口与全局请求路径；二次审查后提交并推送到 `myhexin/v0.0.11beta`。

### Hard constraints

- 不创建临时 Project、fallback directory、ambient Instance、双份 auth registry、route gate 或浏览器 shadow state。
- 全局 auth capability 只投影进程内内置 Provider auth plugin；项目安装 plugin 仍由项目 `Plugin.list()` 与项目配置拥有。
- OAuth pending callback 按显式 global/project scope 隔离；持久化仍只写 `Auth` 的 `auth.json`。
- 不停止、重启或刷新用户正在运行的 OpenCorvus/Overlay；视觉验收使用隔离 Node Playwright fixture。
- 保留现有未提交设置、transport、spec 索引与 `C:/` 改动；本任务提交只包含自己拥有的 hunks。
- commit subject 以 `dsw-33987` 开头并 push 到 `myhexin/v0.0.11beta`。

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-20-empty-workspace-provider-chat-control-plane.md`
- `specs/current/architecture/04-extensions.md`、`06-provider.md`
- OpenCorvus `provider/auth`、`plugin/index`、`server/routes/provider`、`server/routes/global`、`config`、`auth` 与 in-process client
- Overlay `config-load`、`llm`、`ProvidersPanel` 及 provider auth unit/browser tests
- `@opencorvus-ai/plugin` `PluginInput` contract 与全部内置 Provider auth plugin 输入使用点

### Whole-repository search evidence

全仓 `rg` 覆盖 `ProviderAuth`、`Plugin.list()`、`createInstanceState`、`providerAuth`、`auth/prompts`、`auth/execute`、`oauth/authorize`、`oauth/callback`、`global/providers`、`No context found` 和全部 route/unit/browser 调用点。

| Call point | Disposition |
| --- | --- |
| `ProviderAuth` instance state | 抽取共享 auth catalog/state 行为；保留 project instance owner，并新增进程级 global owner，pending OAuth 不跨 scope。 |
| `Plugin.list()` | 保留完整项目 Plugin 投影；新增只加载同一 `INTERNAL_PLUGINS` 声明的 global auth projection，不读取 `Instance` 或项目 plugin 配置。 |
| 内置 OpenAI/xAI/Copilot 等 plugin factories | 复用同一 factories；global 投影构造无 directory 注入的 in-process client，只消费返回 Hook 的 `auth` 能力。 |
| `ProviderRoutes` auth/prompts/execute/OAuth | 保留 project scope，显式调用 project ProviderAuth owner。 |
| `GlobalRoutes /providers` | 增加 auth catalog、prompts、execute、OAuth authorize/callback 子路由，显式调用 global ProviderAuth owner。 |
| `config-load.loadProviderInfo` | 空目录同时读取 `global/providers`、`global/providers/auth`、`global/config`，原子提交 catalog/config/auth。 |
| `llm.providerPath` auth callers | auth 操作按显式 directory 选择 project 或 `/global/providers/...`，不依赖环境猜测。 |
| `ProvidersPanel.handleAuth` | 删除空目录拒绝；复用 captured scope，成功后刷新同 scope Provider owner。 |
| `Auth` | 不改；仍为 API/OAuth credential 唯一持久化来源。 |
| CLI auth callers | 不改；CLI 已在显式 `Instance.provide` 中使用项目 Plugin 投影。 |

### Independent agent feedback

- None. 用户未要求子 Agent；主 Agent 执行完整二次 diff 审查。

## Causal chain

- 可观察现象：空项目 Providers 不显示 OpenAI 订阅方法，并在鉴权时报 `No context found for instance`。
- 直接触发点：`loadProviderInfo()` 在空目录分支硬写 `providerAuth: null`；`ProvidersPanel.handleAuth()` 又以空目录直接失败；后端唯一 auth routes 位于 project middleware 下。
- 深层原因：此前只把 catalog/config/API-key/discovery/test 建成全局控制面，却把同一 Provider 设置面的 plugin auth capability 错误归类为必须依附 Project；`ProviderAuth` 又把 plugin catalog 和 OAuth pending state都绑定到 `createInstanceState(Plugin.list())`。
- 为什么之前没有根治：上一份方案明确把 OAuth 排除在验收外，视觉 fixture 也给了空 auth catalog，因此测试证明的是被缩水后的契约，而不是用户要求的完整全局 Provider 配置。

## Implementation plan

1. 从同一内置 Plugin 注册表投影不依赖 Project 的 global auth hooks，并让 `ProviderAuth` 以显式 scope 选择 project/global owner。
2. 在 `/global/providers` 下发布完整 auth/prompts/execute/OAuth 契约，复用项目 routes 的 schema 与 reset 语义。
3. 接通 Overlay global auth catalog 与 operation paths，删除空目录拒绝。
4. 补齐负向 `No context`、OpenAI subscription method、OAuth pending scope、route/OpenAPI、Overlay path 和真实浏览器视觉回归。
5. 更新架构与被本记录取代的错误边界，完成 type/API/docs/视觉/二次审查后精确提交并推送。

## Verification ledger

- PASS: `GET /global/providers/auth` executes directly through `Server.App()` with no directory or Project `Instance` and returns OpenAI browser OAuth, headless OAuth, and manual API-key methods.
- PASS: focused route/config/auth suites report 38 tests with no failures; Overlay path tests prove all global prompts/execute/authorize/callback requests omit `directory` while an explicit project directory retains `/provider/**?directory=...`.
- PASS: `bun run typecheck` reports 9/9 package tasks successful; `api:routes-check` is clean across 31 route files; `docs:check` reports 281 operations in 23 groups; historical docs health reports 21 tests passing; `git diff --check` is clean.
- PASS: the full Provider browser file reports 8/8 tests through the required Node runner. The empty-workspace case opens the real built Overlay, exposes all three OpenAI auth methods, rejects the old `No context found for instance` text, and captures `.scratch/provider-global-openai-subscription-auth.png`.
- PASS: manual screenshot review confirms a centered, readable OpenAI authentication dialog with three unclipped selectable methods over the empty-workspace shell; no visual correction was required.
- PASS: second exact-diff review confirmed the global projection uses the canonical `INTERNAL_PLUGINS` list, does not load project plugin config or synthesize a directory/Project, keeps `Auth` as the only credential store, and preserves project-scoped routes for explicit directories.
