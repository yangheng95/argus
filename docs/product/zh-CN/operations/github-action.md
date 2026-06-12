# GitHub Action

OpenCorvus GitHub Action 让你在 PR 或 Issue 评论区用 `/oc` 或 `/opencorvus` 触发 AI 编码代理，无需离开 GitHub。

源码：`github/action.yml`（Action 定义）、`github/index.ts`（运行时）。

## 定位

以 **composite action** 发布。核心流程：

1. 安装 `opencorvus` CLI（版本缓存）
2. 执行 `opencorvus github run`，在 runner 内启动本地 `opencorvus serve`（127.0.0.1:7878）
3. 解析 GitHub 事件 payload，构造 prompt，通过 `@opencorvus-ai/sdk` 发给本地服务
4. 结果经 Octokit 写回 Issue/PR 评论；代码有变动时自动 commit、push、开 PR

支持触发事件（`github/index.ts:127-128`）：

- `issue_comment` — Issue 评论、PR 评论（通过 `issue.pull_request` 区分）
- `pull_request_review_comment` — PR "Files" 标签页的行级 review 评论

## 输入参数

| 参数               | 必填 | 默认                        | 说明                                                      |
| ------------------ | ---- | --------------------------- | --------------------------------------------------------- |
| `model`            | ✓    | —                           | `provider/model`，如 `anthropic/claude-sonnet-4-20250514` |
| `agent`            | —    | config 的 `default_agent`   | 主 agent；subagent 不生效                                 |
| `share`            | —    | 公开仓库 `true`             | 是否共享到 `opencorvus.ai/s/<id>`                         |
| `prompt`           | —    | —                           | 自定义 prompt，覆盖默认行为                               |
| `use_github_token` | —    | `false`                     | 用 `GITHUB_TOKEN` 直通，跳过 OIDC 流程                    |
| `mentions`         | —    | `/opencorvus,/oc`           | 触发短语（逗号分隔，大小写不敏感）                        |
| `variant`          | —    | —                           | provider 推理等级（`high` / `max` / `minimal`）           |
| `oidc_base_url`    | —    | `https://api.opencorvus.ai` | 自定义 App 安装时的 OIDC 换 token 接口                    |

（`github/action.yml:7-39`）

## 产物

Action 无 `outputs:` 字段。运行期产物：

- **评论更新**：立即创建 `[Working...](<run-url>)` 占位评论，完成后替换为 AI 回复
- **代码提交**：工作树脏 → 自动 commit + push；author=`opencorvus-agent[bot]`，co-author=触发用户
- **PR 创建**：Issue 场景下有代码变更时自动开 PR，title=AI 摘要（≤40 字符），body 含 `Closes #<issue>`
- **共享链接**（可选）：附 `opencorvus.ai/s/<shareId>` 与社交卡片

（`github/index.ts:141-208`）

## Secrets

### 方式 A：OpenCorvus GitHub App（推荐，默认）

需 `id-token: write`。Action 通过 OIDC 自动换 App Token，**不用管 GitHub token**。

只需 LLM key：

```yaml
env:
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

### 方式 B：直接用 `GITHUB_TOKEN`

```yaml
with:
  use_github_token: true
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

跳过 OIDC 与权限校验（`github/index.ts:762-764`）。

## GITHUB_TOKEN 权限

```yaml
permissions:
  id-token: write # OIDC（方式 A 必需）
  contents: write # git push / 分支
  pull-requests: write # 开 PR / 评论
  issues: write # 创建/更新 Issue 评论
```

本仓库 `.github/workflows/opencorvus.yml` 实际只声明了 `read` 权限（方式 A 下写权限由 App Token 携带，`GITHUB_TOKEN` 不需要写权限）。方式 B 需显式声明 write。

## 权限校验

用户发 `/oc` 时校验其仓库权限必须为 `admin` 或 `write`；失败拒绝执行。方式 B 跳过（`github/index.ts:757-782`）。

## 完整 workflow 示例

### 默认配置（App + Anthropic）

```yaml
name: opencorvus
on:
  issue_comment: { types: [created] }
  pull_request_review_comment: { types: [created] }
jobs:
  opencorvus:
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc') ||
      contains(github.event.comment.body, ' /opencorvus') ||
      startsWith(github.event.comment.body, '/opencorvus')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 1 }
      - uses: yangheng95/opencorvus/github@latest
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        with:
          model: anthropic/claude-sonnet-4-20250514
```

### 阿里云 DashScope（本仓库实际配置）

```yaml
# 参考 .github/workflows/opencorvus.yml
jobs:
  opencorvus:
    if: |
      contains(github.event.comment.body, ' /oc') ||
      startsWith(github.event.comment.body, '/oc')
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      pull-requests: read
      issues: read
    steps:
      - uses: actions/checkout@v4
      - uses: yangheng95/opencorvus/github@latest
        env:
          DASHSCOPE_API_KEY: ${{ secrets.CODING_DASHSCOPE_API_KEY }}
          OPENCORVUS_CONFIG_CONTENT: >-
            {"provider":{"alibaba-cn":{"options":{"baseURL":"https://coding.dashscope.aliyuncs.com/v1"}}}}
          OPENCORVUS_PERMISSION: '{"bash": "deny"}'
        with:
          model: openai/gpt-5.5
```

## 使用示例

| 评论                                      | 效果                              |
| ----------------------------------------- | --------------------------------- |
| `/opencorvus explain this issue`          | 阅读 Issue 线程，回复解释         |
| `/opencorvus fix this`                    | 新分支、实现、开 PR               |
| `/oc`（PR 评论）                          | 对当前 PR 做 review               |
| `/oc add error handling here`（行级评论） | 在指定行位置添加错误处理并 commit |

## 代码流转

```
issue_comment / pull_request_review_comment
  ├─ isPullRequest()
  │  ├─ 同仓库 PR → checkoutLocalBranch → chat → pushToLocalBranch
  │  └─ Fork PR   → checkoutForkBranch  → chat → pushToForkBranch
  └─ Issue → checkoutNewBranch → chat → pushToNewBranch → createPR
```

（`github/index.ts:163-208`）

## 本地调试

```bash
cd /path/to/test-repo

MODEL=anthropic/claude-sonnet-4-20250514 \
  ANTHROPIC_API_KEY=sk-ant-... \
  GITHUB_RUN_ID=dummy \
  MOCK_TOKEN=github_pat_... \
  MOCK_EVENT='{"eventName":"issue_comment","repo":{"owner":"o","repo":"r"},"actor":"u","payload":{"issue":{"number":1},"comment":{"id":1,"body":"/opencorvus explain"}}}' \
  bun /path/to/opencorvus/github/index.ts
```

`MOCK_TOKEN` 需 `admin` 或 `write` 权限的 PAT（`github/README.md:110-166`）。

## 已知问题

- `isScheduleEvent()` 在 `github/index.ts:580` 被调用但**未定义**——cron 触发未实装
- `cron` / `schedule` 事件不在 `assertContextEvent()` 白名单（`github/index.ts:292-298`），即使配置也会被直接拒绝
