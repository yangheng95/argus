# Provider 与模型

OpenCorvus 的 LLM 抽象构建在 [Vercel AI SDK](https://sdk.vercel.ai/) 之上，通过 `@ai-sdk/*` 子包接入各家 provider。

## 内置 provider（20 个）

权威源：`packages/opencorvus/src/provider/bundled.ts` 的 `BUNDLED_PROVIDERS`。

| Provider | 包 |
|---|---|
| Anthropic | `@ai-sdk/anthropic`（搭配 `@anthropic-ai/claude-agent-sdk`） |
| OpenAI / OpenAI 兼容 | `@ai-sdk/openai` + `@ai-sdk/openai-compatible` |
| Google Generative AI | `@ai-sdk/google` |
| Google Vertex / Vertex Anthropic | `@ai-sdk/google-vertex` + `@ai-sdk/google-vertex/anthropic` |
| Amazon Bedrock | `@ai-sdk/amazon-bedrock` |
| Azure OpenAI | `@ai-sdk/azure` |
| xAI | `@ai-sdk/xai` |
| Mistral | `@ai-sdk/mistral` |
| Groq | `@ai-sdk/groq` |
| DeepInfra | `@ai-sdk/deepinfra` |
| Cerebras | `@ai-sdk/cerebras` |
| Cohere | `@ai-sdk/cohere` |
| TogetherAI | `@ai-sdk/togetherai` |
| Perplexity | `@ai-sdk/perplexity` |
| Vercel | `@ai-sdk/vercel` |
| Vercel AI Gateway | `@ai-sdk/gateway` |
| GitLab AI | `@gitlab/gitlab-ai-provider` |
| OpenRouter | `@openrouter/ai-sdk-provider` |

国内常用别名（来自 `channel-runtime/.env.example` 与 `provider/provider.ts`）：

| 别名 | 底层 |
|---|---|
| `alibaba-cn` | DashScope（阿里云） |
| `alibaba-coding-plan-cn` | DashScope Coding Plan 专线 |
| `moonshotai-cn` | Moonshot（月之暗面） |
| `deepseek` | DeepSeek |

## 配置方式

### 方式 A：环境变量

各 provider 官方 key 名直接生效：

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
export GOOGLE_GENERATIVE_AI_API_KEY=...
export DEEPSEEK_API_KEY=...
export OPENROUTER_API_KEY=...

# 阿里云 DashScope（按 key 前缀自动路由）
export CODING_DASHSCOPE_API_KEY=sk-sp-...   # Coding Plan 专线
export DASHSCOPE_API_KEY=sk-...             # 标准 intl
```

### 方式 B：自定义 provider（OpenAI-兼容网关）

在 `opencorvus.jsonc` 里：

```jsonc
{
  "provider": {
    "hexin": {
      "api": "https://your-hexin-gateway/v1",
      "env": ["HEXIN_API_KEY"],
      "models": {
        "gpt-5.4": { "name": "GPT-5.4", "tool_call": true }
      }
    }
  },
  "model": "hexin/gpt-5.4"
}
```

`env` 数组声明该 provider 所需的环境变量名；缺失时报错退出，**不 fallback**。

### 方式 C：显式启用 / 禁用清单

```jsonc
{
  "enabled_providers": ["anthropic", "alibaba-cn"],
  "disabled_providers": ["deepseek"]
}
```

`enabled_providers` 非空时只启用清单内的 provider；`disabled_providers` 是黑名单。优先级高于"未配置 env 即不启用"的启发式。

## Provider Registry 显式刷新

从 commit `187cec77d` 起，**registry 不再自动后台 refresh**。可触发刷新的入口只有三个：

| 触发方式 | 路径 |
|---|---|
| Overlay UI | Settings → Providers → 刷新按钮 |
| CLI | `opencorvus models --refresh` |
| Route | `POST /provider/refresh` |

启发式（检测 env 缺失就跳过）仍然存在；如需强制启用某个 provider，请在 `enabled_providers` 列出，避免依赖 env 嗅探。

## 模型选择策略

OpenCorvus 在三种场景选模型：

| 场景 | 配置位置 |
|---|---|
| 默认执行模型 | `model` 字段 / `OPENCORVUS_DEFAULT_MODEL` |
| 各 agent 子项 | `assistant.<agent>.model`（per-agent 覆盖） |
| Vision / 截图理解 | `OPENCORVUS_VISION_MODEL` |
| 轻量任务（title / summary） | `small_model` |

per-agent 覆盖与执行模型分离的目的：**用强但慢的模型规划，用快但够用的模型执行**。典型配置：

```jsonc
{
  "model": "alibaba-cn/qwen3.5-plus",
  "small_model": "alibaba-cn/qwen2.5-7b",
  "assistant": {
    "requirements": { "model": "anthropic/claude-sonnet-4-6" },
    "architect":    { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

> ~~`assistant.planner.model`~~ 已不再有效——planning tool role 整体下线（见 [Agent 家族](../../../specs/new-arch/01-agents.md)）。

## Reasoning 模型注意事项

对于 claude reasoning、qwq、glm reasoning、o-series 等 reasoning 模型：

1. **必须用 `streamText`**，不能 `generateText`（否则 reasoning tokens 期间连接超时）。
2. **必须用 `toolChoice: "auto"`**，不能 `"required"`。
3. **prompt 缓存**对 Anthropic reasoning 模型有效，5 分钟 TTL；尽量让多次 LLM 调用复用 system prompt。

## 禁用 provider

推荐用显式 `disabled_providers` 数组或不配置该 provider 的 env。OpenCorvus 在检测到 provider 无 key 时把它从可用列表移除——**不要**依赖启发式关键字匹配。

## 你接下来要看的

- [配置](./configuration.md)
- [Permissions](./permissions.md)
- [Environment 全表](../reference/env.md)
