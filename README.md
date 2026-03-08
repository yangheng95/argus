<p align="center">
  <a href="https://opencorvus.ai">
    <img src="packages/overlay/src/opencorvus.svg" width="64" height="64" alt="OpenCorvus logo">
  </a>
</p>
<p align="center">The open source AI development operator for delegated software work.</p>
<p align="center">Runs in your repo. Works from API, Slack, and local sessions. Plans, executes, evaluates, retries.</p>
<p align="center">
  <a href="https://www.npmjs.com/package/opencorvus-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencorvus-ai?style=flat-square" /></a>
  <a href="https://github.com/yangheng95/opencorvus/actions/workflows/test.yml"><img alt="Tests" src="https://img.shields.io/github/actions/workflow/status/yangheng95/opencorvus/test.yml?style=flat-square&branch=dev&label=tests" /></a>
  <a href="https://github.com/yangheng95/opencorvus/actions/workflows/typecheck.yml"><img alt="Typecheck" src="https://img.shields.io/github/actions/workflow/status/yangheng95/opencorvus/typecheck.yml?style=flat-square&branch=dev&label=typecheck" /></a>
</p>

OpenCorvus sits between human requests and coding agents. You hand it a task. It expands the request into an executable spec, turns that into goals and a plan, dispatches an executor, evaluates the delivery, and either completes, retries, or replans.

### Why OpenCorvus

- Delegated development instead of live pair-programming only
- Durable orchestration state in SQLite: `task`, `plan_version`, `run`, `interaction`, `delivery`, `evaluation`, and progress snapshots
- Scoped project knowledge: session memory plus global memory and preferences shared across sessions
- Built-in `opencode` execution path, with optional `codex` and `claude-code` executors when those CLIs are present
- Human-in-the-loop permission and question handling
- Evaluator-driven loops for `build`, `test`, `lint`, `startup`, `artifact`, `visual`, `puppeteer`, and LLM review checks
- Local TUI, headless server, overlay UI, and Slack gateway in the same repo
- A separate bot package with adapters for Slack, Telegram, Discord, Feishu, WhatsApp, Google Chat, Microsoft Teams, Line, Matrix, Mattermost, Signal, WeCom, and DingTalk

### How It Works

1. Accept a task from API, Slack, or a local session.
2. Expand the request into a concrete PRD, goals, and subtasks.
3. Dispatch an executor against the repo.
4. Capture delivery artifacts and run evaluator checks.
5. Retry the same plan or create a new plan version until the task passes or the budget is exhausted.

### Installation

```bash
# Install script
curl -fsSL https://opencorvus.ai/install | bash

# Package managers
npm i -g opencorvus-ai@latest     # or bun/pnpm/yarn
brew install yangheng95/tap/opencorvus
scoop install opencorvus
choco install opencorvus
```

### Quick Start

Start the headless server in the repository you want OpenCorvus to work on:

```bash
cd /path/to/your/repo
opencorvus serve
```

Open the local overlay UI at `http://127.0.0.1:7878/ui/`, then create a task over HTTP:

```bash
curl -X POST http://127.0.0.1:7878/task \
  -H "content-type: application/json" \
  -d '{
    "request": "Implement the requested change, run validation, and stop only when the delivery is ready."
  }'
```

The server returns `202` with a `task_id`. Stream progress with SSE:

```bash
curl -N http://127.0.0.1:7878/task/<task_id>/events
```

Useful task endpoints:

- `GET /tasks`
- `GET /task/<task_id>`
- `GET /task/<task_id>/board`
- `POST /task/<task_id>/message`
- `POST /task/<task_id>/retry`
- `POST /task/<task_id>/replan`
- `POST /task/<task_id>/cancel`

> [!TIP]
> If you expose `opencorvus serve` beyond localhost, set `OPENCORVUS_SERVER_PASSWORD` first.

### Slack Threads

Slack is the first channel wired directly into the headless orchestrator.

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
opencorvus slack
```

What the Slack gateway does today:

- Starts a task from the first message in a thread
- Mirrors plan, run, delivery, and evaluation updates back into the thread
- Accepts permission replies like `allow`, `always`, and `reject`
- Accepts follow-up operator messages and routes them into the task loop

### Executors

OpenCorvus always has the built-in `opencode` executor. It can also dispatch to external coding CLIs when they are installed and auto-discovery is enabled.

```bash
export OPENCORVUS_AUTO_DISCOVER_EXECUTORS=1
```

Supported executor names today:

- `opencode`
- `codex`
- `claude-code`

If `codex` or `claude-code` are not discovered, task creation with that executor is rejected instead of silently falling back.

### Product Surface

| Surface | Status | Notes |
| --- | --- | --- |
| Local TUI and sessions | Available | Default `opencorvus` command, session continue/fork/export flows |
| Headless HTTP API | Available | `opencorvus serve`, task lifecycle routes, SSE event stream |
| Overlay UI | Available | Served from `/ui/` by the headless server |
| Slack gateway | Available | First integrated remote channel for the orchestrator |
| Multi-channel bot adapters | In repo | `packages/bot` includes Slack, Telegram, Discord, Feishu, WhatsApp, Google Chat, Microsoft Teams, Line, Matrix, Mattermost, Signal, WeCom, and DingTalk |
| GitHub Action | Available | See [`github/README.md`](./github/README.md) |

### Development

```bash
# repo root
bun install

# core CLI and orchestrator
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/opencorvus test

# bot adapters
bun run --cwd packages/bot test

# regenerate the JavaScript SDK
bun ./packages/sdk/js/script/build.ts
```

### FAQ

#### How is this different from a direct coding agent?

OpenCorvus is built for delegated development workflows. It adds durable task orchestration, goal tracking, evaluator-driven retries, remote channels, and operator feedback loops on top of direct coding-agent execution.

#### Is OpenCorvus only a Slack bot?

No. The repo includes a local TUI, headless API server, overlay UI, GitHub Action, and a broader multi-channel bot package. Slack is simply the first channel promoted into the headless task orchestration flow.

#### Does it keep state between runs?

Yes. Tasks, plans, runs, interactions, deliveries, evaluations, session state, and project knowledge are persisted locally in SQLite.
OpenCorvus now keeps both session-scoped and global memory/preferences. New memory and preference entries default to global so they are available across future sessions in the same project.

#### Is it finished?

No. The core orchestration loop is implemented, but the product surface is still expanding. This README reflects what is in the repo today, not a promise that every planned interface is already fully integrated.

### Docs and Contributing

- Docs: https://opencorvus.ai/docs
- GitHub Action: [`github/README.md`](./github/README.md)
- Contributing: [`CONTRIBUTING.md`](./CONTRIBUTING.md)

### Acknowledgments

OpenCorvus extends direct coding-agent execution toward delegated development, remote channels, and evaluator-driven automation.

### License

[MIT](./LICENSE)
