<p align="center">
  <a href="https://github.com/yangheng95/opencorvus">
    <img src="packages/console/app/src/asset/brand/mascot-ar-icon.png" width="160" alt="OpenCorvus mascot">
  </a>
</p>

<h1 align="center">OpenCorvus</h1>

<p align="center">From prompt to shipped result: one agent for code and GUI.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/opencorvus-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencorvus-ai?style=flat-square" /></a>
  <a href="https://github.com/yangheng95/opencorvus/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/yangheng95/opencorvus/publish.yml?style=flat-square&branch=dev" /></a>
  <a href="https://github.com/yangheng95/opencorvus/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/yangheng95/opencorvus?style=flat-square" /></a>
</p>

---

## Slogan

**写下目标，交付结果。**  
**Write the goal. Ship the outcome.**

## Positioning

OpenCorvus is an **execution agent** for software teams.
It is not only a coding copilot, and not a traditional RPA bot.
It bridges three worlds in one loop:

- **Code** — implement and refactor in real repositories
- **Desktop** — operate browser and GUI apps like a human operator
- **Workflow** — report progress in Slack/Telegram and continue autonomously

## Vision

Build a general AI teammate that can complete real-world software tasks end-to-end:

- From requirement to merged PR
- From code change to UI verification
- From local development to team collaboration channels

## Mission

Make "intent-to-delivery" the default way of building software: humans define direction, OpenCorvus executes across tools.

## What is OpenCorvus?

OpenCorvus is an AI-powered desktop assistant that combines **code development** and **GUI automation** in a single agent. It can:

- **Write & edit code** — explore codebases, make targeted edits, run tests, manage git workflows
- **Control the desktop** — observe the screen, click, type, scroll, and interact with any GUI application
- **Combine both** — e.g., write code in the editor, then switch to the browser to test it visually

Unlike pure coding agents, OpenCorvus can see and interact with your entire desktop environment, making it suitable for tasks that span the terminal and graphical applications.

## Features

- **Dual-mode agent** — coding tools (read/write/edit/bash/glob/grep) + desktop tools (screenshot/click/type/key/scroll)
- **Skill system** — loadable skills for coding, desktop automation, and more
- **Multi-provider** — works with Claude, OpenAI, Google, Qwen, and other LLM providers via AI SDK
- **TUI** — built-in terminal user interface (SolidJS + opentui, 30 themes, session management, undo/redo)
- **Client/server architecture** — headless server with SDK, TUI, and bot adapters
- **LSP support** — built-in Language Server Protocol integration for code intelligence
- **MCP support** — Model Context Protocol for extending tool capabilities
- **Sub-agent system** — spawn focused sub-agents for parallel exploration and complex tasks

## Installation

```bash
# npm (or bun/pnpm/yarn)
npm i -g opencorvus-ai@latest

# macOS and Linux (Homebrew)
brew install yangheng95/tap/opencorvus

# Windows (Scoop)
scoop install opencorvus

# Windows (Chocolatey)
choco install opencorvus

# Arch Linux
sudo pacman -S opencorvus

# Nix
nix run nixpkgs#opencorvus
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

## Quick Start

```bash
# Launch TUI in the current directory
opencorvus

# Launch TUI in a specific directory
opencorvus /path/to/project

# Start headless API server only
opencorvus serve

# Start server on a specific port
opencorvus serve --port 8080
```

## Agents

OpenCorvus includes two built-in agents, switchable with the `Tab` key in the TUI:

- **build** — Default, full-access agent for development and desktop automation
- **plan** — Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

A **general** subagent is also available for complex searches and multistep tasks.

## Skills

OpenCorvus uses a skill system to load specialized instructions on demand:

| Skill | Loaded when | Capabilities |
|-------|------------|-------------|
| **coding** | Any software engineering task | Code exploration, editing, debugging, testing, git workflow |
| **desktop** | Any GUI automation task | Screen observation, window management, mouse/keyboard interaction |

Skills are loaded automatically based on the task. Only one skill is active at a time.

## Bot — Slack / Telegram 接入

Bot 是 OpenCorvus 的首选启动方式。它在内部自动启动 OpenCorvus 服务器，并通过 Slack 或 Telegram 接受指令、汇报进度。

### 快速启动

```bash
# 1. 复制并填写环境变量
cp packages/bot/.env.example packages/bot/.env

# 2. 启动 Bot（同时自动启动 OpenCorvus 服务器）
bun dev
```

> `bun dev` 等价于 `bun run --cwd packages/bot src/main.ts`。
> 如果只需要 TUI 或无头服务器，使用 `bun dev:tui` 或 `bun dev:server`。

### 环境变量配置

在 `packages/bot/.env`（或系统环境变量）中配置以下参数：

#### Slack 适配器

| 变量 | 说明 |
|------|------|
| `SLACK_BOT_TOKEN` | Bot Token，格式 `xoxb-...`。在 Slack App 的 **OAuth & Permissions** 页面获取 |
| `SLACK_SIGNING_SECRET` | 签名密钥，在 **Basic Information → App Credentials** 获取 |
| `SLACK_APP_TOKEN` | Socket Mode App-Level Token，格式 `xapp-...`。在 **Basic Information → App-Level Tokens** 创建，需 `connections:write` 权限 |

> Slack App 需开启 **Socket Mode**，并在 **Event Subscriptions** 订阅 `message.channels`、`message.im` 等事件。

#### Telegram 适配器

| 变量 | 说明 |
|------|------|
| `TELEGRAM_BOT_TOKEN` | 通过 [@BotFather](https://t.me/BotFather) 创建 Bot 后获取 |

> Slack 和 Telegram 可同时配置，Bot 会注册两个适配器。

#### LLM 模型配置

Bot 通过 `OPENCORVUS_CONFIG_CONTENT` 环境变量以 JSON 格式注入 OpenCorvus 配置，**不依赖**项目目录中的配置文件。

```bash
# 使用 Qwen（DashScope）
OPENCORVUS_CONFIG_CONTENT='{"model":"alibaba-cn/qwen3.5-plus","provider":{"alibaba-cn":{"options":{"baseURL":"https://coding.dashscope.aliyuncs.com/v1"}}}}'

# 使用 Claude（Anthropic）
OPENCORVUS_CONFIG_CONTENT='{"model":"anthropic/claude-sonnet-4-6","provider":{"anthropic":{"env":"ANTHROPIC_API_KEY"}}}'
ANTHROPIC_API_KEY=sk-ant-...

# 使用 OpenAI
OPENCORVUS_CONFIG_CONTENT='{"model":"openai/gpt-4o","provider":{"openai":{"env":"OPENAI_API_KEY"}}}'
OPENAI_API_KEY=sk-...
```

> 完整的 provider 配置选项请参考 [OpenCorvus 配置文档](https://opencode.ai/docs/config)。

#### 权限配置

`OPENCORVUS_CONFIG_CONTENT` 中的 `permission` 字段控制 Bot 可以执行哪些工具：

```json
{
  "permission": {
    "*": "deny",
    "screen": "allow",
    "input": "allow",
    "bash": "allow",
    "edit": "allow",
    "write": "allow",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "websearch": "allow",
    "webfetch": "allow",
    "skill": "allow",
    "external_directory": "allow"
  }
}
```

> 生产环境建议将 `bash` 设为 `"ask"` 而非 `"allow"`，防止未经审查的命令执行。

#### 可选：语音识别（STT）

| 变量 | 说明 |
|------|------|
| `STT_PROVIDERS` | 逗号分隔的 STT 提供商列表，默认 `groq,openai-whisper,deepgram,google-gemini,local-cli` |
| `GROQ_API_KEY` | Groq STT（推荐，速度快且免费额度大） |
| `OPENAI_API_KEY` | OpenAI Whisper |
| `DEEPGRAM_API_KEY` | Deepgram |
| `GOOGLE_API_KEY` | Google Gemini STT |
| `STT_LOCAL_COMMAND` | 本地 CLI 命令（如 `whisper`） |
| `STT_LANGUAGE` | 转录语言，如 `zh`、`en`（留空自动检测） |

#### 可选：视觉分析（Vision）

当 `DASHSCOPE_API_KEY` 存在时，Bot 会对每张截图自动运行视觉分析并发送到 Slack 线程：

| 变量 | 说明 |
|------|------|
| `DASHSCOPE_API_KEY` | DashScope API Key（开启视觉分析） |
| `OPENCORVUS_VISION_MODEL` | 视觉模型，默认 `qwen3.5-plus` |

#### 其他配置

| 变量 | 说明 |
|------|------|
| `TUI_PROJECT_DIR` | Bot 指挥 TUI 工作的默认项目目录，默认 `process.cwd()` |

### 完整 `.env` 示例

```bash
# === LLM 模型（必填） ===
OPENCORVUS_CONFIG_CONTENT={"model":"alibaba-cn/qwen3.5-plus","provider":{"alibaba-cn":{"options":{"baseURL":"https://coding.dashscope.aliyuncs.com/v1"}}},"permission":{"*":"deny","screen":"allow","input":"allow","bash":"allow","edit":"allow","write":"allow","read":"allow","glob":"allow","grep":"allow","websearch":"allow","webfetch":"allow","skill":"allow","external_directory":"allow"}}

# === Slack（与 Telegram 二选一或同时配置）===
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...

# === Telegram（可选）===
# TELEGRAM_BOT_TOKEN=...

# === 语音识别（可选）===
GROQ_API_KEY=gsk_...

# === 视觉分析（可选）===
DASHSCOPE_API_KEY=sk-...

# === 项目目录（可选）===
TUI_PROJECT_DIR=D:/my-project
```

### 启动方式对照

| 命令 | 用途 |
|------|------|
| `bun dev` | **启动 Bot**（内嵌 OpenCorvus 服务器，推荐开发入口） |
| `bun dev:tui` | 启动 TUI（终端交互界面） |
| `bun dev:server` | 启动无头 API 服务器（供 SDK 或外部程序接入） |

---

## Architecture

```
┌──────────────────────────────────┐
│        OpenCorvus Server         │
│  (packages/opencorvus)                │
│  ┌──────────┐  ┌──────────────┐  │
│  │ Sessions │  │ Tool System  │  │
│  │ & Agents │  │ (code+desktop│  │
│  └──────────┘  └──────────────┘  │
│  ┌──────────┐  ┌──────────────┐  │
│  │ Provider │  │   Skills &   │  │
│  │ (AI SDK) │  │     MCP      │  │
│  └──────────┘  └──────────────┘  │
└────────┬──────────┬────────┬──┘
         │          │        │
    ┌────┴──┐  ┌────┴──┐ ┌───┴──┐
    │  TUI  │  │  SDK  │ │ Bot  │
    │       │  │  (JS) │ │Adapt.│
    └───────┘  └───────┘ └──────┘
```

- **packages/opencorvus** — Core: agents, sessions, tools, providers, skills, LSP, TUI
- **packages/sdk** — JavaScript SDK for programmatic access
- **packages/bot** — Chat bot adapters (Slack, Telegram)
- **packages/plugin** — Plugin system (`@opencorvus-ai/plugin`)

## Contributing

If you're interested in contributing to OpenCorvus, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

**Requirements:** Bun 1.3+

```bash
bun install
bun dev
```

## Acknowledgments

OpenCorvus is built upon code originally from [OpenCode](https://github.com/nicepkg/opencode). We are grateful to the OpenCode contributors for their foundational work. The project has since diverged in positioning and functionality — OpenCorvus extends the original coding agent with desktop GUI automation, a skill system, and a headless server architecture.

## License

[MIT](./LICENSE)

