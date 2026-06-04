# OpenCorvus

> An open-source harness for AI coding agents.

## What it is

Coding agents write code. Their raw output is **unreliable**: no spec, no acceptance criteria, no retries, no durable state.

OpenCorvus wraps one-shot code generation into a **repeatable, evaluator-driven, self-healing development workflow**. You hand it a task; it runs **spec → goals → plan → execute → evaluate → deliver** end-to-end, retrying or replanning until acceptance criteria are met or the budget is exhausted.

## Core capabilities

| Capability | Summary |
|---|---|
| **Spec-first planning** | A Spec agent turns vague requests into testable specifications with acceptance criteria and evidence chains |
| **Goal decomposition** | Architect analyzes boundaries, then breaks the spec into at least two modest, independently verifiable implementation goals |
| **Multi-executor dispatch** | Built-in OpenCorvus; auto-discovers and dispatches to Codex / Claude Code |
| **Evaluator-driven retry** | build/test/lint/startup/artifact/visual/Playwright/LLM review plus default-on `spec check` acceptance gate |
| **Multi-channel reach** | Local TUI, HTTP API, Overlay desktop app, 14 IM channels (Slack/Telegram/Feishu/Discord/…) |
| **Durable state** | All tasks, plans, runs, interactions, deliveries, and evaluations persist to SQLite; session and project memory reused across sessions |
| **Human-in-the-loop** | `ask/allow/deny` permissions, follow-up messages, manual feedback, all embeddable in unattended pipelines |

## Who it's for

- **Teams shipping AI coding agents to production** — they need auditability, retries, state, consistency.
- **Remote operators** — post a request in Slack, watch a PR ship.
- **Engineers with their own coding CLI** who need an orchestration layer — OpenCorvus doesn't replace your agent; it makes it **reliable**.

## Three-layer architecture

```
┌─ Channel layer ──────────────────────────────────────────┐
│  Local TUI / Overlay UI / HTTP API / 14 IM channels     │
├─ Orchestrator layer ─────────────────────────────────────┤
│  Task Agent → GoalPool → Planner → Executor → Evaluator │
│  (SQLite persistence + permissions + budget + retries)  │
├─ Executor layer ─────────────────────────────────────────┤
│  OpenCorvus kernel / Codex / Claude Code                 │
└──────────────────────────────────────────────────────────┘
```

See [Architecture](./concepts/architecture.md).

## Quick start

```bash
curl -fsSL https://opencorvus.ai/install | bash
cd /path/to/your/repo
opencorvus serve
# open http://127.0.0.1:7878/ui/
```

Full walkthrough: [Quickstart](./start/quickstart.md).

## Doc map

- **[Start](./start/install.md)** — install, first task
- **[Concepts](./concepts/architecture.md)** — architecture, [data model](./concepts/goal-run-task.md), [agentic loop](./concepts/agent-loop.md)
- **[OpenCorvus core](./opencorvus/configuration.md)** — [config](./opencorvus/configuration.md), [providers](./opencorvus/providers.md), [permissions](./opencorvus/permissions.md), [evaluator](./opencorvus/evaluator.md)
  - [Skills](./opencorvus/skills.md)
  - [Plugins](./opencorvus/plugins.md)
  - [MCP](./opencorvus/mcp.md)
- **[Overlay](./overlay/overview.md)** — Tauri desktop app
- **[Channels](./channels/overview.md)** — integrations for 14 IM platforms
- **[Operations](./operations/benchmark.md)** — [benchmark](./operations/benchmark.md), [troubleshooting](./operations/troubleshooting.md), [GitHub Action](./operations/github-action.md), [ACP](./operations/acp.md)
- **[Reference](./reference/env.md)** — [env vars](./reference/env.md), [CLI](./reference/cli.md), [HTTP API](./reference/api.md), [SDK](./reference/sdk.md)
