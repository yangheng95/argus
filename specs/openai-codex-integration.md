# OpenAI Codex 集成方案

## 背景

OpenAI 现在有两套常见入口：

| 入口 | Endpoint | 认证方式 | 适用场景 |
|---|---|---|---|
| Platform API | `https://api.openai.com/v1/*` | API Key (`sk-...`) | 需要单独开 API billing |
| Codex API | `https://chatgpt.com/backend-api/codex/responses` | OAuth Token | ChatGPT Pro/Plus 订阅 |

`packages/opencorvus` 当前已经统一走 Codex OAuth 链路。benchmark、PRD E2E、live E2E 的默认模型都改成了 `openai/gpt-5.3-codex`。

## 默认模型

- Benchmark 默认模型：`openai/gpt-5.3-codex`
- E2E 默认模型：`openai/gpt-5.3-codex`
- 可覆盖环境变量：
  - `OPENCORVUS_BENCHMARK_MODEL`
  - `OPENCORVUS_E2E_MODEL`

如果只传裸模型名，例如 `gpt-5.3-codex`，代码会自动归一化成 `openai/gpt-5.3-codex`。

## Auth 过程

### 首次登录

在仓库根目录执行：

```bash
bun run packages/opencorvus/src/index.ts auth login
```

然后按下面流程操作：

1. 选择 provider：`openai`
2. 选择认证方式：`ChatGPT Pro/Plus (browser)`
3. 浏览器打开 OpenAI 登录页并完成授权
4. 回到 CLI，等待 token 写入本地

### 验证登录状态

```bash
bun run packages/opencorvus/src/index.ts auth list
```

预期结果：`openai` 显示为 `oauth`。

### 凭据存储位置

- Windows：`%LOCALAPPDATA%\opencorvus\auth.json`
- Linux/macOS：`~/.local/share/opencorvus/auth.json`
- 如果设置了 `OPENCORVUS_HOME`，则写到 `OPENCORVUS_HOME/auth.json`

结构大致如下：

```json
{
  "openai": {
    "type": "oauth",
    "access": "eyJ...",
    "refresh": "rt_...",
    "expires": 1774099960929,
    "accountId": "4142897c-..."
  }
}
```

### 刷新机制

请求前会检查 `expires`。如果 access token 过期，会自动用 `refresh_token` 调用：

```text
POST https://auth.openai.com/oauth/token
```

刷新后的新 token 会回写到 `auth.json`。

## 运行时行为

`openai + oauth` 模式下，请求不会走普通 OpenAI API key 路径，而是会：

1. 从 `auth.json` 读取 `access` / `refresh` / `accountId`
2. 把鉴权头改成 `Authorization: Bearer <access_token>`
3. 附加 `ChatGPT-Account-Id: <account_id>`
4. 把 `/v1/responses` 重写到 `https://chatgpt.com/backend-api/codex/responses`
5. 用 Codex responses 形态发送请求，system prompt 走顶层 `instructions`

## 当前跑法

所有命令都不再依赖 `OPENAI_API_KEY`。

### Benchmark 测试

```bash
cd packages/opencorvus
bun test test/benchmark/agent-quality.test.ts --timeout 300000
```

### Benchmark 脚本

```bash
cd packages/opencorvus
bun run script/benchmark-agents.ts
```

### PRD 全链路 E2E

```bash
cd packages/opencorvus
bun run script/prd-e2e.ts
```

如果要指定 PRD：

```bash
cd packages/opencorvus
bun run script/prd-e2e.ts --prd ../../specs/prd.txt
```

### Live Full Pipeline E2E

除了 OpenAI OAuth，还需要 Slack 环境变量：

- `OPENCORVUS_E2E_SLACK_BOT_TOKEN` 或 `SLACK_BOT_TOKEN`
- `OPENCORVUS_E2E_SLACK_APP_TOKEN` 或 `SLACK_APP_TOKEN`
- `OPENCORVUS_E2E_SLACK_CHANNEL_ID` 或 `SLACK_CHANNEL_ID`

运行：

```bash
cd packages/opencorvus
OPENCORVUS_RUN_LIVE_E2E=1 bun test test/e2e/full-pipeline.test.ts
```

### E2E Evaluation Script

```bash
cd packages/opencorvus
bun run script/eval-e2e.ts
```

这个脚本现在也会显示 `OPENCORVUS_E2E_MODEL` 对应的 Codex 模型，而不是旧的 Qwen 文案。

## 常见问题

### 提示缺少 OpenAI OAuth 凭据

先执行：

```bash
bun run packages/opencorvus/src/index.ts auth login
```

完成登录后再重新运行 benchmark 或 E2E。

### Live E2E 被自动 skip

需要同时满足：

1. `OPENCORVUS_RUN_LIVE_E2E=1` 或 `true`
2. 本地已有 `openai` OAuth 凭据
3. Slack token 和 channel 环境变量齐全

## 结论

仓库里现在默认把 Codex 当作 `openai` provider 的 OAuth 模式来使用，而不是依赖 `OPENAI_API_KEY`。后续如果 benchmark 或 E2E 需要升级模型，优先改 `DEFAULT_OPENAI_CODEX_MODEL`，并保持 `auth login` 这条流程不变。
