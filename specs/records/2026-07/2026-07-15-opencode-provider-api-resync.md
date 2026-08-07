# OpenCode Provider / API 基建语义重同步

## Recall

### 用户原始要求

- “opencorvus fork了opencode的基建，帮我集成并测试”。
- 范围随后扩展为：“google等其他provider也要全部集成，也就是重新同步一次opencode的API基建，不要丢失hexin的更改”。
- 后续边界：“后续会删除外置Executor支持，所以不再维护外置Executor”。
- 实现来源：“不要自己攒代码，要clone复用上游代码”。

### 任务定义

以 `anomalyco/dev` 当前 Provider、Auth、Plugin 和流式 API 行为为上游语义基线，在 OpenCorvus
现有分层架构中重放全部仍有效的 Provider 能力；保留 Hexin 的模型目录、模型 profile、显式刷新、
预算、请求策略和 Overlay 行为。由于两个仓库历史已经没有 Git merge-base，本任务不是文件级 merge，
也不允许用整目录覆盖制造双源，而是逐项语义同步并用 benchmark 证明调用链。

### 输入 -> 输出

| 输入 | 合格输出 |
| --- | --- |
| API key / PAT（Personal Access Token，个人访问令牌） | 对应 Provider 被唯一认证来源加载，模型目录可见，流式请求走对应 SDK / endpoint |
| OAuth（Open Authorization，开放授权）浏览器回调 | `access` / `refresh` / `expires` / provider metadata 持久化，过期后按厂商协议刷新 |
| OAuth device code（设备码） | 无本机浏览器回调依赖地完成授权，结果进入同一 Auth 单一来源 |
| Provider 模型目录 + 当前 Auth | 只投影当前凭证真实可用的模型，不把 API-only 模型暴露给订阅 OAuth |
| Google Vertex ADC（Application Default Credentials，应用默认凭证） | 使用明确 project/location 和 Google Cloud scope 获取 token，流式调用 Vertex endpoint |
| Hexin API key | 保留当前显式 `/v1/models` 刷新、profile、budget、sticky header 和流式请求行为 |

### 验收指标

1. Plugin SDK 支持上游当前 Auth metadata、`enterpriseUrl`、声明式 prompt 条件和
   `provider.models(provider, auth)` 模型投影；同一 provider 只有一个最终投影。
2. 内置认证集合覆盖 OpenAI Codex、GitHub Copilot、GitLab、Poe、Cloudflare Workers、
   Cloudflare AI Gateway、Azure、DigitalOcean、Snowflake Cortex、xAI；未配置 provider 不伪装成功。
3. Provider SDK 集合至少覆盖当前上游的 Bedrock/Mantle、Anthropic、Azure、Google、Vertex、
   Vertex Anthropic、OpenAI、OpenAI-compatible、OpenRouter、xAI、Mistral、Groq、DeepInfra、
   Cerebras、Cohere、Vercel AI Gateway、Together、Perplexity、Vercel、Alibaba、GitLab、
   GitHub Copilot、Venice，且不降级 OpenCorvus 已使用的更高安全版本。
4. OpenAI Plus/Pro 测试覆盖 PKCE（Proof Key for Code Exchange，授权码交换证明密钥）、浏览器和
   headless 认证、token refresh 合并、account header、Codex endpoint、模型过滤和完整流式 tool loop。
5. Copilot 测试覆盖 device flow、enterprise metadata、远端模型发现、协议 SDK 选择、agent/user、
   vision 和认证 header；模型发现失败必须显式失败，禁止返回静态目录 fallback。
6. Google 测试覆盖 API-key Generative AI、Vertex ADC、Vertex Anthropic 区域 endpoint、
   `GOOGLE_VERTEX_*` 变量投影和真实流式响应契约。
7. xAI、Azure、DigitalOcean、Cloudflare、Snowflake、GitLab 和 Poe 各有认证正反例与请求层测试。
8. Hexin 现有 refresh/profile/budget/sticky routing/request transform 测试全部继续通过；新增 source
   contract 断言上游同步没有覆盖 Hexin owner。
9. CLI、Server、Overlay 使用同一认证方法投影；完成认证后 reset Provider 缓存，模型即时可见。
10. 所有 LLM 调用继续使用流式 API；不新增非流式生成路径、fallback、兼容 alias、gate 或状态机。
11. 相关 typecheck、`api:routes-check`、`docs:check`、文档健康和 benchmark 全部通过；随后人工二次 review。

### 硬约束

- 不维护、不兼容、不扩展外置 Executor；`packages/opencorvus/src/executor/**` 明确排除。
- Provider/Auth/API 实现必须从固定上游 clone 的源码逐文件复用；禁止凭记忆重写或另造近似实现。
- 不重启、关闭、刷新或干预用户正在运行的 OpenCorvus / Overlay；测试使用隔离进程和 mocked upstream。
- 不创建 worktree，不 reset/stash/回退，不覆盖当前未提交 Overlay 测试修改。
- 不移植上游 fallback：例如 Copilot 模型发现失败返回静态模型、GitLab discovery `catch -> {}`、
  SDK 方法链 fallback、Snowflake 把错误响应伪造为成功等均不进入 OpenCorvus。
- Anthropic Claude Pro/Max 订阅 OAuth 已被上游移除且被厂商禁止，本任务只保留 Anthropic API provider。
- 所有新增提交以 `dsw-33987` 开头，并推送 `legacy-remote/v0.0.4beta`。
- 缩写首次出现必须说明全称和含义。

### 已读取的落盘资料

- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/05-config.md`
- `specs/current/architecture/06-provider.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-10-provider-settings-contract-repair.md`
- `specs/records/2026-07/2026-07-15-composer-budget-hover-and-home-cards-authority.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`

当前架构记录中“Codex/Copilot plugin 已删除，因为它们属于 Executor”的说法只覆盖外置 coding
进程，混淆了 Provider Auth Plugin 与 Executor。实现完成后必须修订 `04-extensions.md`：
订阅认证/请求改写属于内部 Provider 扩展，不恢复外置 Executor 所有权。

### 上游与 Git 证据

- `anomalyco/dev`：`8e2d422ffe56f3b2eb52e3f7195a2f9722a9fc46`。
- 固定上游 clone：`C:/Users/chuan/myhexin-local/opencode-upstream.git`，其中
  `refs/heads/upstream-dev` 精确指向上述 commit；`origin` 记录为
  `https://github.com/anomalyco/opencode.git`。后续源文件只从该 clone 的固定 ref 读取。
- 两次从 GitHub 创建 working-tree clone 均因网络连接被重置或 443 不可达而失败，且未留下工作目录。
  为避免改写实现，随后从当前仓库已经 fetch 完整的 `refs/remotes/anomalyco/dev` Git 对象创建专用
  bare clone，再把 clone 的 `origin` 校正为官方地址；`git show
  refs/heads/upstream-dev:packages/opencode/src/plugin/openai/codex.ts` 已验证对象可独立读取。
- `git merge-base --all HEAD anomalyco/dev` 返回空；`rev-list --left-right --count` 为
  `14857 / 4349`，因此禁止把常规 merge 当成同步手段。
- 预改动 `v0.0.4beta` 已推送至 `legacy-remote`；hook 的 typecheck、API route、docs、Overlay i18n 和
  secret scan 全部通过。
- 工作区存在其他并行任务的专家团、Overlay、测试、spec 和 dashboard 未提交修改；本任务只暂存
  本方案及后续 Provider/API 精确文件，不得暂存或覆盖任何不在本方案调用点矩阵中的改动。

### 全仓 grep 与调用点

| Surface / symbol | 当前调用点 | 本次处理 |
| --- | --- | --- |
| `Auth.Info` | `auth/index.ts`、Provider loader、Server routes、CLI auth、Overlay auth | 增加 metadata / enterpriseUrl，保持一个 `auth.json` owner |
| `AuthHook.loader` | `provider/provider.ts` | 保留为请求转译入口；禁止在 Session/Overlay 再实现一份 |
| `AuthHook.methods` | `provider/auth.ts`、`cli/cmd/auth.ts`、Server、Overlay | 同步条件 prompt 和返回 metadata，四端消费同一声明 |
| `Hooks.provider` | 当前缺失；上游用于 OpenAI/Copilot 模型投影 | 增加契约并在 Provider build 中唯一执行 |
| `INTERNAL_PLUGINS` | 当前只有 GitLab | 同步上游内置认证集合，删除“认证插件等于 Executor”的错误边界 |
| `BUNDLED_PROVIDERS` | `provider/bundled.ts` 与 `provider/provider.ts` 有重复表 | 收敛到 `bundled.ts` 唯一表，补齐上游 SDK，不保留双表 |
| `CUSTOM_LOADERS` | `provider/vendor.ts` | 增加 vars/discoverModels，重放上游 loader；保留 Hexin 专有层 |
| `ProviderTransform` | `provider/transform.ts`、`provider/llm.ts`、`session/llm.ts` | 对比重放上游模型/参数变化，保留 Hexin request/schema 修复 |
| `isOpenaiOauth` | `session/llm.ts`、provider connection test | 由真实 Codex Auth Plugin 激活并补回归，不再是悬空特判 |
| Provider auth routes | `server/routes/provider.ts` | 保留现有 prompt/execute/authorize/callback 路径和 reset 行为 |
| Provider auth UI | `overlay/src/services/llm.ts` | 继续消费后端方法；只补 schema 需要的 metadata/condition 行为 |
| Hexin catalog | `models.ts`、`hexin-discovery.ts`、`hexin-profiles.ts` | 保持唯一目录和显式 refresh，不被上游 models.dev 路径覆盖 |
| Hexin request | `vendor-headers.ts`、`vendor-messages.ts`、`transform.ts` | 保持 sticky `x-user`、消息修复和参数约束 |
| Hexin budget | Server provider route + Overlay resource | 完全保留，不迁入通用 provider auth |
| Executor | `src/executor/**` 及 UI 旧选择面 | 本任务排除；不新增兼容或测试 |

### 独立 Agent 反馈

- 用户没有要求多个独立 Agent；按当前协作边界不启动子 Agent。主 Agent 负责上游审计、实现、
  benchmark、失败迭代和人工二次 review。

## 上游同步矩阵

### 内置认证插件

| 上游能力 | OpenCorvus 当前状态 | 处理 |
| --- | --- | --- |
| OpenAI Codex | 缺失，但 Session/connection test 有 OAuth 特判 | 移植认证、模型投影、请求改写和测试 |
| GitHub Copilot | 缺失 | 移植 device/enterprise auth、模型发现、SDK 和测试 |
| GitLab | 旧 npm auth plugin + 旧 SDK | 对齐当前插件/SDK 语义，保留现有 route |
| Poe | 缺失 | 加入上游官方 auth plugin |
| Cloudflare Workers / AI Gateway | 缺失 | 移植 prompt metadata、loader 和测试 |
| Azure | 缺失 | 移植 Azure CLI / API auth 声明和 loader |
| DigitalOcean | 缺失 | 移植 OAuth/PAT 流与 loader |
| Snowflake Cortex | 缺失 | 移植 browser/manual auth；错误必须 fail-fast |
| xAI | 缺失 | 移植 browser/headless OAuth 和 API key；自动刷新 |

### Provider loader / SDK

| 上游增量 | 当前状态 | 处理 |
| --- | --- | --- |
| Bedrock Mantle | 缺失 | 加 SDK 与精确 model method 选择 |
| Alibaba SDK | 使用 OpenAI-compatible 路径 | 增加官方 SDK，不移除现有 coding-plan provider identity |
| GitHub Copilot SDK | 缺失 | 增加专用 SDK |
| Venice SDK | 缺失 | 增加专用 SDK |
| Google Vertex vars / scope / Anthropic regional URL | 部分实现 | 对齐并补测试 |
| llmgateway / nvidia / cerebras headers | 部分缺失 | 同步明确 headers |
| Cloudflare / Snowflake loaders | 缺失 | 同步，不移植伪成功 fallback |
| GitLab dynamic models | 缺失或旧实现 | 同步；发现失败显式上抛 |
| Hexin loaders/transforms | OpenCorvus 专有 | 原样保留并加防覆盖测试 |

## 实施设计

1. 从固定 bare clone 的 `refs/heads/upstream-dev` 读取每个目标文件，并记录
   `upstream commit + source path + local adaptation`；禁止把差异矩阵当作手写实现说明。
2. `@opencorvus-ai/plugin` 先升级 Auth 与 Provider hook 契约。
3. `provider/bundled.ts` 成为唯一 bundled SDK registry；`provider/provider.ts` 删除重复 registry。
4. `Plugin` 加载内置 auth plugin，但 Provider Auth Plugin 与 Executor 保持不同类型和目录职责。
5. Provider build 顺序固定为：canonical catalog → env/Auth/config credential → auth loader →
   custom loader → config overlay → provider model projection → variants/filter。每一阶段只有一个 owner。
6. 动态模型发现由 custom loader/provider hook 返回并进入同一 Provider `Info.models`，失败显式抛出。
7. 流式请求仍由 `ProviderLLM.stream()` / `session/llm.ts` 进入 AI SDK，认证 plugin 只接管 SDK fetch。
8. Hexin 继续由本地 catalog + explicit refresh 进入同一 Provider state，不新增上游或缓存 fallback。

## Benchmark

### 环境加载地址

- 无真实订阅密钥的确定性 benchmark：Bun test 内隔离 `fetch`、Auth 文件、models catalog 和 project root。
- 可选真实 smoke：只在本机已存在对应凭证时由显式命令运行；不把缺少外部账号包装为通过。
- 上游参考：本地只读 remote ref `anomalyco/dev`，不在测试时访问网络。

### 超时

- 流式 benchmark 以最后一个 response/tool/event chunk 为活动时间；每次活动重置计时器。
- OAuth device polling 以每次有效 HTTP response 为活动；无活动超过测试阈值才失败。
- 不使用从进程启动开始的机械总时长来判定长流失败。

### 可执行分层

1. Contract：Plugin/Auth/Provider schema 与内置注册表。
2. Provider：每个 custom loader、SDK 选择、模型投影与错误路径。
3. Auth：浏览器、code、device、refresh、metadata、credential persistence。
4. Request translation：URL、headers、body、stream、tool result。
5. Server/CLI/Overlay：方法投影、输入 prompt、callback、reset 后模型可见。
6. Hexin protection：catalog/profile/refresh/budget/request transform 全回归。
7. Quality：typecheck、routes、docs、document health、diff check。

### 初始验证命令

```text
bun test packages/opencorvus/test/auth packages/opencorvus/test/plugin packages/opencorvus/test/provider packages/opencorvus/test/server packages/opencorvus/test/session --timeout 120000
bun test packages/overlay/test/provider-settings-contract.test.ts packages/overlay/test/llm-auth.test.ts --timeout 120000
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000
bun run typecheck
bun run api:routes-check
bun run docs:check
git diff --check
```

命令中的全目录测试会在实现后依据真实文件名收敛为精确 benchmark 集；不存在的测试路径不得被忽略，
必须创建对应测试或修正文档命令。

## 当前状态

- 固定上游 clone 与来源 commit 已验证；Provider/Auth/Plugin/SDK 语义同步完成，外置 Executor 未改动。
- bundled SDK 单一注册表覆盖 24 个上游包；内部 Provider Auth 集合覆盖 OpenAI Codex、GitHub
  Copilot、GitLab、Poe、Cloudflare Workers、Cloudflare AI Gateway、Azure、DigitalOcean、Snowflake
  Cortex、xAI。
- OpenCorvus 接入层把 API `key` 与 provider metadata 显式分离；Azure resource、Cloudflare
  account/gateway、Snowflake account 不再被误存为 token。CLI、Server、Overlay 共享同一 Auth 记录。
- Google Vertex project/location、ADC scope、regional Anthropic endpoint，以及 llmgateway、NVIDIA、
  Cloudflare、Snowflake loader 已按固定上游源码重放；Hexin owner 与请求层保持原实现。
- 确定性订阅协议组合测试：65 pass / 0 fail；Provider Auth 跨层契约：9 pass / 0 fail；Google
  Vertex 精确测试：2 pass / 0 fail；Hexin/Provider/Overlay 精确回归命令成功退出。
- SDK generation、全仓 typecheck、`api:routes-check`（254 operations）、`docs:check`、历史链接、
  document health、product docs single-source 与 `git diff --check` 均通过。
- 文档健康首次复核发现 lockfile 携带内网 registry、当前架构字面量与 GitLab 旧 package alias 三项
  真实问题；已用当前 manifests 从 npm 官方 registry 重算 lockfile，并同步文档与健康断言后复测通过。
- 未执行真实外部账号 smoke：本任务没有注入订阅/API 凭证；没有把缺少外部凭证包装成成功。

## 2026-07-15 Overlay Provider 认证回归重开

### Recall

- 用户反馈：“好几个我测试要么无法点击要么错误，例如 xAI 和 openai”。
- 验收指标：xAI 与 OpenAI 的 Connect 必须打开包含上游全部认证方法的选择框；默认值来自上游方法声明顺序；选择 API Key 必须继续打开密钥输入框并把 `key` 与 provider metadata 一次提交；取消不得写入认证；失败必须在 Provider 面板可见。
- 硬约束：继续以固定 clone `C:/Users/chuan/myhexin-local/opencode-upstream.git` 的 `upstream-dev` 为语义来源，不给 xAI/OpenAI 手工加私有 `preferred` 标记，不新增 fallback/gate，不改外置 Executor，不干预当前运行中的 OpenCorvus/Overlay。
- 已读取资料：本文件完整 Recall/同步矩阵/Benchmark；上游 `packages/opencode/src/cli/cmd/providers.ts`、`packages/opencode/src/provider/auth.ts`、`packages/opencode/src/plugin/openai/codex.ts`、`packages/opencode/src/plugin/xai.ts`；本地 `packages/overlay/src/services/llm.ts`、`ProvidersPanel.tsx`、`AppDialogHost.tsx`、`app-dialog.ts`、`native.ts`、Provider browser test 与 Provider Auth server owner。
- 全仓 grep：`preferredAuthMethod` 仅在 Overlay 多方法选择中使用；`providerPreferredOauthMethod` 仅为未显式指定 OAuth 方法的 Overlay 入口选初值；`runProviderAuthMethod` 的 `"input"` 结果只有 `authenticateSelectedProvider` 消费且被转换为 `false`，没有任何调用者会聚焦 API Key 字段；`ProviderAuth.execute` 已要求 API 方法的 `inputs.key` 并把其余输入保存为 metadata；`ProvidersPanel` 已有唯一 `role="alert"` 错误面。二次 grep 还发现 Azure、Cloudflare Workers、Cloudflare Gateway 与 Snowflake 本地插件曾为旧 CLI 补入上游不存在的 `key` prompt，而本地 CLI 又依赖该字段；二者构成一套偏离上游的双源认证协议。
- 独立 Agent：用户未要求子 Agent；按协作边界不启动委托。

### 根因与上游证据

1. 上游 CLI（Command-Line Interface，命令行界面）在多方法时始终展示 `plugin.auth.methods.map(...)`，没有 `preferred` 字段或前置 gate；单方法才直接使用索引 `0`。本地 Overlay 却在打开选择框之前强制“恰好一个 preferred”，而 OpenAI/xAI 上游方法均不声明该字段，因此 Connect 点击后抛错。
2. 上游 CLI 对 API 方法先收集方法 prompts，再无条件打开 password prompt 收集 API Key，并把 Key 与 metadata 一起写入 Auth。本地 Overlay 在 prompts 为空时返回孤立的 `"input"`，调用者只把 `true` 当成功，因此 API Key 方法无 UI 后续动作。
3. 修复 owner 是 `packages/overlay/src/services/llm.ts`：方法数组声明顺序是后端投影的唯一权威；API Key 输入复用现有 app dialog primitive，最终仍由现有 `/provider/:id/auth/execute` 和 `ProviderAuth.execute` 持久化。
4. 二次 review 按固定 clone 逐文件复核 Azure、Cloudflare 与 Snowflake，确认上游 prompts 只声明 resource/account/gateway 等 metadata，API Key 由 CLI 统一 password prompt 收集。本地三个插件恢复上游声明；`handlePluginAuth` 复用上游 API 分支，删除对 `inputs.key` prompt 的依赖，并保留 Auth 单一持久化来源。

### 回归验证

```text
bun test packages/overlay/test/llm-provider-auth-select-source.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/provider-auth-panel.test.ts
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

浏览器验收必须在隔离页面打开 xAI/OpenAI 方法选择框、核对声明顺序、选择 API Key、输入密钥并验证 execute payload；随后查看截图并二次 review。真实第三方 OAuth 不在无凭证 benchmark 中伪造通过。

### 验证结果

- Overlay auth/Provider 精确单元：40 pass / 0 fail，其中 xAI/OpenAI 声明顺序、masked Key、取消、dialog 单一来源均覆盖。
- Provider/CLI/插件精确组合：31 pass / 0 fail，覆盖 Azure/Cloudflare 上游声明、Snowflake、API Key/metadata 分离与授权结果 metadata 合并。
- Node 驱动真实浏览器：6 pass / 0 fail；xAI 与 OpenAI 均完成“Connect → 方法选择 → 手工 Key → execute → Connected”，payload 使用真实上游索引 `2`。
- 已查看 `.scratch/provider-auth-xai-upstream-method-order.png` 与 `.scratch/provider-auth-xai-api-key-password.png`：三项方法完整可见、声明顺序正确、Key 使用 password input；未发现遮挡或不可点击问题。
- `packages/opencorvus` 与 `packages/overlay` typecheck 均通过；当前交付分支为 `v0.0.5beta`，最终提交使用 `dsw-33987` 前缀并推送 `legacy-remote`。
