# 06 — LLM Provider 适配层

> 对应代码：`src/provider/` · `src/session/llm.ts` · `src/config/config.ts`
>
> 实际目录：`provider/llm.ts` · `provider.ts` · `transform.ts` · `vendor.ts` · `auth.ts` ·
> `bundled.ts` · `error.ts` · `base-url.ts` · `models.ts` · `models-snapshot.ts` ·
> `codex-live.ts` · `dashscope.ts` · `install.ts` · `policy.ts` · `sdk/`

## 核心挑战

不同 LLM 提供商在 4 个维度上各不相同：

| 维度 | 差异 |
|---|---|
| **API 协议** | OpenAI Chat/Responses · Anthropic Messages · Google GenerateContent · Bedrock InvokeModel |
| **认证方式** | API Key (env) · OAuth · AWS IAM Role · GCP Service Account · 嵌入式密钥 |
| **参数格式** | reasoning → `thinking` / `reasoningEffort` / `thinkingConfig` / `reasoningConfig`（四种写法） |
| **模型能力** | tool_call · vision · audio · reasoning · streaming · caching — 每个模型组合不同 |

## 主流方案对比

| 方案 | 示例 | 优缺点 |
|---|---|---|
| **A. 统一 SDK 适配**（本项目） | Vercel AI SDK | ✓ 类型安全 · 灵活 · 官方维护 · 可定制 · ✗ provider-specific 逻辑分散 |
| **B. 代理网关** | LiteLLM / OpenRouter | ✓ 零代码 · 100+ provider · ✗ 额外跳转 · 参数丢失 · 第三方依赖 |
| **C. 抽象基类** | LangChain / LlamaIndex | ✓ 清晰分层 · OOP · ✗ 抽象泄漏 · TypeScript 生态弱 |

**本项目采用方案 A 深度定制**，与 opencode 同源，已支持 21+ provider，六层适配。

## 六层适配架构

调用顺序 **Agent → Provider API**：

```
┌─ Layer 1 · Model Registry ──────────────────────────────────┐
│  models.dev API + 内置定义 + config.provider 覆盖          │
│  → 统一 Provider.Model 对象                                │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─ Layer 2 · SDK Router ─────────────────────────────────────┐
│  BUNDLED_PROVIDERS (21 SDK) + 动态 npm install             │
│  + xxHash 实例缓存                                          │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─ Layer 3 · Auth ───────────────────────────────────────────┐
│  env API Key · OAuth Plugin · AWS IAM · GCP SA             │
│  · DashScope 动态密钥 · 配置覆盖                            │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─ Layer 4 · Custom Loader ──────────────────────────────────┐
│  OpenAI responses API · Bedrock 区域路由 · Vertex GCP Auth │
│  · Copilot chat/responses                                   │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─ Layer 5 · Parameter Transform ────────────────────────────┐
│  reasoning: thinking/reasoningEffort/thinkingConfig        │
│  caching: cacheControl/promptCacheKey/cachePoint           │
│  message 修复: Mistral tool ID · Anthropic 空内容过滤       │
│              · 缓存标记注入 · 不支持模态降级                │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─ Layer 6 · Error + Streaming ──────────────────────────────┐
│  Overflow 检测 (12 regex) · HTTP 错误提取                   │
│  流不活跃超时 (300s) · 可重试判定                           │
└─────────────────────────────────────────────────────────────┘
```

## Provider.Model — 统一模型抽象

所有 agent 消费同一 Zod 类型：

```ts
{
  id: string                 // "claude-sonnet-4-20250514"
  providerID: string         // "anthropic"
  api: { id, url, npm }      // API model ID · base URL · SDK package
  capabilities: {
    temperature, reasoning, toolcall, attachment,
    input:  { text, audio, image, video, pdf },
    output: { text, audio, image, video, pdf },
    interleaved: boolean | { field: "reasoning_content" | "reasoning_details" },
  }
  cost: { input, output, cache }   // $/M token
  limit: { context, output }        // token 限制
  variants: Record                  // reasoning effort (low/medium/high)
  options: Record                   // provider 透传
  headers: Record                   // 自定义 HTTP 头
}
```

## 调用链路

```
Agent.run()                                     agent 发起 LLM 调用
  │
  └→ ProviderLLM.stream({ model, system, ... })  统一 LLM 入口 (provider/llm.ts)
       ├→ Provider.getLanguage(model)             Layer 1-4: 解析 + SDK + Auth + LanguageModelV2
       ├→ ProviderTransform.options(model)        Layer 5: 参数适配 (reasoning, caching, store)
       ├→ ProviderTransform.providerOptions()     Layer 5: SDK namespace 封装
       ├→ ProviderTransform.maxOutputTokens()     Layer 5: 输出 token 限制
       ├→ ProviderLLM.wrapModel() + message()     Layer 5: 消息格式修复 middleware
       └→ streamText({ wrappedModel, ... })       Vercel AI SDK 统一调用
  │
  └→ Error Normalization                          Layer 6: 错误分类 + 超时
```

**session/llm.ts** 复用 `ProviderLLM.wrapModel()` + `baseHeaders()`，叠加 session 特有逻辑
（plugin / trace / permission / inactivity）。

## Agent ↔ Model 映射

每个 agent 独立选模型：

```jsonc
// opencorvus.jsonc
{
  "agent": {
    "task": { "model": "anthropic/claude-sonnet-4-..." },         // 协调者，最强
    "requirements": { "model": "anthropic/claude-sonnet-4-..." }, // 需求分析
    "planner":      { "model": "openai/gpt-5" },                  // 规划
    "evaluator":    { "model": "openai/gpt-4o-mini" }             // 低成本评估
  },
  "model": "anthropic/claude-sonnet-4-...",   // 全局默认
  "small_model": "openai/gpt-4o-mini"         // 小任务快速
}
```

**格式**：`{providerID}/{modelID}` → 运行时通过 `Provider.getModel()` 解析为 `Provider.Model`。

不同 agent 可用不同 provider — Task Agent 用 Claude，Eval 用 GPT，零耦合。
**Executor**（外部 agent）有自己的 LLM，不受此层管理。

## 核心文件

| 文件 | 职责 |
|---|---|
| `provider/llm.ts` | `ProviderLLM.stream()` — agent 唯一 LLM 入口 + `wrapModel` / `baseHeaders` helpers |
| `provider/provider.ts` | Model Registry + SDK Router + 状态管理 |
| `provider/transform.ts` | Parameter Transform + Message 标准化 |
| `provider/vendor.ts` | Custom Loaders — per-provider 特殊逻辑 |
| `provider/auth.ts` | Auth 管理 — API Key / OAuth / IAM |
| `provider/error.ts` | Error Normalization + Overflow 检测 |
| `provider/bundled.ts` | 21 个打包 SDK 映射 |
| `provider/base-url.ts` | 自定义 base URL 解析 |
| `provider/models.ts` · `models-snapshot.ts` | 模型元数据 + 本地快照 |
| `provider/dashscope.ts` · `codex-live.ts` | 特殊 provider 实现 |
| `provider/sdk/` | provider-specific SDK 定制 |
| `session/llm.ts` | Session LLM — 复用 ProviderLLM helpers + plugin/trace/permission |
| `config/config.ts` | Agent model 配置 + Provider 配置 |

## 新增 Provider 三条路径

### Path 1 — OpenAI 兼容（零代码）
```jsonc
// config.provider 配置 api URL + env API Key
{ "provider": { "my-oai-compat": { "api": "https://...", "env": ["MY_KEY"] } } }
```
自动使用 `@ai-sdk/openai-compatible`。

### Path 2 — 有 Vercel AI SDK 包（一行代码）
在 `bundled.ts` 加映射：
```ts
"@ai-sdk/new-provider": createNewProvider
```
自动参数适配。

### Path 3 — 特殊行为（vendor.ts）
```ts
CUSTOM_LOADERS["new-provider"] = {
  getModel, options   // 区域路由 / 认证流 / API 切换
}
```

**所有路径**：models.dev 或 `config.provider` 定义模型元数据 + capabilities + cost。

## 与 Agent 架构的集成原则

1. **Agent 调用 `ProviderLLM.stream()`** — 不直接 import `streamText`，不接触 provider 差异
2. **session/llm.ts 复用 `ProviderLLM.wrapModel()` + `baseHeaders()`** — session 特有逻辑留在 session 层
3. **每个 Agent 通过 config 独立选模型** — Task Agent 可用 Claude，Eval 可用 GPT
4. **新增 provider 只改 `provider/`** — agent 代码零变更

## 相关文档

- [01-agents.md](01-agents.md) — 哪些 agent 消费 Provider
- [04-extensions.md](04-extensions.md) — Provider 与 Executor/Plugin/MCP/ACP 的独立关系
