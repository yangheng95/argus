# OpenAI Codex 集成方案

## 背景

OpenAI 提供两套 API 入口：

| 入口 | Endpoint | 认证方式 | 适用场景 |
|------|----------|----------|----------|
| **Platform API** | `api.openai.com/v1/*` | API Key (`sk-...`) | 需要开通 API billing |
| **Codex API** | `chatgpt.com/backend-api/codex/responses` | OAuth Token | ChatGPT Pro/Plus 订阅即可 |

OpenCode 内部通过 AI SDK 调用时，会将 `/v1/responses` 请求**重写到 Codex endpoint**，无需 API billing。Mirror 独立运行（benchmark、CLI）时需要复刻这一路径。

## 架构

```
┌──────────────┐     OAuth Token      ┌───────────────────────────────────────┐
│  auth.json   │ ──────────────────►  │  chatgpt.com/backend-api/codex/      │
│  (OpenCode)  │     + AccountId      │           responses                  │
└──────────────┘                      └────────────┬──────────────────────────┘
       │                                           │
       │  Token 过期?                               │  SSE Stream
       ▼                                           ▼
┌──────────────┐                      ┌───────────────────────────────────────┐
│ auth.openai  │  refresh_token ───►  │  Collect deltas → response.completed │
│  .com/oauth  │  ◄─── new tokens     │  → parseResponsesResponse()          │
│    /token    │                      └───────────────────────────────────────┘
└──────────────┘
```

## 认证流程

### 1. Token 来源

OpenCode 在用户首次登录 OpenAI 时通过 PKCE OAuth 获取 token，存储在：

```
~/.local/share/opencode/auth.json
```

结构：

```json
{
  "openai": {
    "type": "oauth",
    "access": "eyJhbGci...",     // JWT access token
    "refresh": "rt_0827Q0...",   // Refresh token
    "expires": 1774099960929,    // 过期时间戳 (ms)
    "accountId": "4142897c-..."  // ChatGPT Account ID (从 JWT 提取)
  }
}
```

### 2. OAuth 参数

| 参数 | 值 |
|------|-----|
| Client ID | `app_EMoamEEZ73f0CkXaXp7hrann` |
| Issuer | `https://auth.openai.com` |
| Token endpoint | `https://auth.openai.com/oauth/token` |
| Scopes | `openid profile email offline_access` |

### 3. Token 刷新

每次请求前检查 `expires < Date.now()`，过期则自动刷新：

```typescript
POST https://auth.openai.com/oauth/token
Content-Type: application/json

{
  "grant_type": "refresh_token",
  "refresh_token": "<refresh_token>",
  "client_id": "app_EMoamEEZ73f0CkXaXp7hrann"
}
```

刷新后将新 token 写回 `auth.json`，避免重复刷新。

## 请求格式

Codex endpoint 使用 **OpenAI Responses API** 格式，与 Chat Completions API 有几个关键区别：

### 与 Chat Completions 的差异

| 特性 | Chat Completions | Codex Responses |
|------|------------------|-----------------|
| System prompt | `messages[0].role = "system"` | 顶层 `instructions` 字段 |
| 用户消息内容类型 | `type: "text"` | `type: "input_text"` |
| 图片内容类型 | `type: "image_url"` | `type: "input_image"` |
| 助手消息内容类型 | `content: string` | `type: "output_text"` |
| 消息数组字段名 | `messages` | `input` |
| 输出长度限制 | `max_tokens` | `max_output_tokens` |
| 流式 | 可选 | **必须** `stream: true` |
| 存储 | 默认 true | **必须** `store: false` |
| 完成原因字段 | `finish_reason` | `stop_reason` |

### 请求示例

```json
{
  "model": "gpt-5.4",
  "instructions": "You are a frontend code generator...",
  "input": [
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "Build a landing page with..." }
      ]
    }
  ],
  "stream": true,
  "store": false,
  "max_output_tokens": 65536,
  "text": { "verbosity": "low" },
  "reasoning": { "effort": "medium" }
}
```

### 必需 Headers

```
Authorization: Bearer <access_token>
ChatGPT-Account-Id: <account_id>    # 多组织支持，从 JWT claims 提取
Content-Type: application/json
```

## 响应解析

Codex endpoint 强制返回 SSE 流。关键事件：

| Event | 含义 | 数据 |
|-------|------|------|
| `response.output_text.delta` | 文本增量 | `{ delta: "..." }` |
| `response.completed` | 请求完成 | `{ response: { output, usage, stop_reason } }` |

解析策略：

1. 逐事件累积 `delta` 拼接完整文本
2. 等到 `response.completed` 事件获取最终 response 对象（含完整 output 和 usage）
3. 优先使用 completed 事件中的完整 response；fallback 到累积的 delta 文本

### response.completed 数据结构

```json
{
  "response": {
    "id": "resp_xxx",
    "model": "gpt-5.4",
    "output": [
      {
        "type": "message",
        "content": [
          { "type": "output_text", "text": "完整输出内容..." }
        ]
      }
    ],
    "stop_reason": "stop",
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 5678,
      "total_tokens": 6912
    }
  }
}
```

## 代码实现

### 涉及文件

| 文件 | 改动 |
|------|------|
| `packages/mirror/src/types.ts` | `ModelConfig.format` 新增 `"responses"` 类型 |
| `packages/mirror/src/infra/llm/models.ts` | 新增 `openai-gpt5` / `openai-gpt5.4` 模型配置 |
| `packages/mirror/src/infra/llm/client.ts` | Codex 认证、Responses API 请求构建、SSE 流解析 |

### 模型配置

```typescript
// packages/mirror/src/infra/llm/models.ts
"openai-gpt5.4": {
  provider: "openai-codex",
  endpoint: "https://chatgpt.com/backend-api/codex/responses",
  model: "gpt-5.4",
  format: "responses",
  temperature: 1.0,
  maxTokensParam: "max_completion_tokens",
  contextWindow: 128_000,
  supportsVision: true,
  maxImages: 10,
},
```

### 使用方式

```bash
# Mirror benchmark
bun run benchmark/run.ts --case url-baidu --model openai-gpt5.4

# Praxis benchmark
bun run benchmark/run-suite.ts --all --iters 3 --model openai-gpt5.4

# E2E 测试（使用 OpenAI GPT-5.4 + medium reasoning effort）
OPENAI_API_KEY=sk-xxx OPENCORVUS_RUN_LIVE_E2E=1 bun test test/e2e/full-pipeline.test.ts

# PRD 全链路 E2E
OPENAI_API_KEY=sk-xxx bun run script/prd-e2e.ts

# Agent 质量基准测试
OPENAI_API_KEY=sk-xxx bun test test/benchmark/agent-quality.test.ts --timeout 300000
```

前提：需要 `OPENAI_API_KEY` 环境变量（OpenAI Platform API key）。GPT-5.4 默认使用 `reasoningEffort: "medium"`（由 `transform.ts` 自动设置）。

## 与其他 Provider 的对比

| Provider | 模型名 | 速度 | 认证 | 备注 |
|----------|--------|------|------|------|
| `copilot` | `copilot-gemini-flash` | ~3-12s | GitHub OAuth | 免费，质量好 |
| `openai-codex` | `openai-gpt5.4` | ~2-10s | OpenAI OAuth | 需 ChatGPT Pro |
| `dashscope` | `qwen3.5-plus` | 20-117s | API Key | 推理慢 |
| `hexin-gpt` | `gpt-5` | - | hexin token | 需内网 |

## 限制与注意事项

1. **必须先通过 OpenCode 登录 OpenAI**——Codex endpoint 只接受 OpenCode 的 OAuth client_id 签发的 token
2. **强制流式**——Codex endpoint 要求 `stream: true`，`store: false`
3. **Token 有效期**——access token 约 10 天过期，通过 refresh token 自动续期
4. **无 API billing 限制**——走 ChatGPT Pro 订阅额度，不需要 platform.openai.com 充值
5. **`reasoning.effort`**——设为 `"medium"` 平衡质量和速度，可选 `"low"` / `"high"`
