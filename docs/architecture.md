# OpenCorvus Architecture

## System Architecture Overview

```
+========================================================================================+
|                                    CLIENT LAYER                                         |
|  +---------------------------+   +---------------------------+   +-------------------+  |
|  |     Overlay UI (Current)  |   |   VSCode Extension (WIP)  |   |  Channel Bots     |  |
|  |  Solid.js + Tauri Desktop |   |   WebView / Native Panel  |   |  Slack/Discord/   |  |
|  |                           |   |                           |   |  Telegram/Teams/  |  |
|  |  components/              |   |  (Future)                 |   |  Feishu/DingTalk  |  |
|  |    Board.tsx              |   |  - Editor integration     |   |  WeChat/QQ/...    |  |
|  |    Conversation.tsx       |   |  - Inline diff review     |   |                   |  |
|  |    AgentCard.tsx          |   |  - Terminal panel          |   |                   |  |
|  |    ChatComposer.tsx       |   |  - Status bar widget      |   |                   |  |
|  |    TaskList.tsx           |   |  - Command palette        |   |                   |  |
|  |    Settings/*             |   |                           |   |                   |  |
|  |                           |   |                           |   |                   |  |
|  |  stores/                  |   |  Reuses:                  |   |                   |  |
|  |    app, board, messages   |   |  - SDK (packages/sdk)     |   |                   |  |
|  |    executor, settings     |   |  - SSE event protocol     |   |                   |  |
|  |                           |   |  - REST API client        |   |                   |  |
|  |  services/                |   |  - i18n translations      |   |                   |  |
|  |    api, sse, session      |   |                           |   |                   |  |
|  |    task, config, llm      |   |                           |   |                   |  |
|  +-----|---------------------+   +-----|---------------------+   +------|-----------+  |
|        |  REST + SSE                   |  REST + SSE                    |  REST       |  |
+========|===============================|================================|=============+
         |                               |                                |
+========|===============================|================================|=============+
|        v                               v                                v              |
|                            API GATEWAY (Hono HTTP Server :7878)                        |
|                                                                                        |
|  Auth Middleware (Basic Auth / Token) ── CORS ── Error Handler                         |
|                                                                                        |
|  +--Routes------------------------------------------------------------------+          |
|  |  /config     /session      /task        /goal       /plan                |          |
|  |  /provider   /executor     /channel     /control    /panel               |          |
|  |  /auth       /mcp          /skill       /permission /coding              |          |
|  |  /project    /question     /file        /pty        /export              |          |
|  +-------------------------------------------------------------------------|          |
|                                                                                        |
|  +--SSE Event Stream-----------+    +--WebSocket (opt-in)---+                          |
|  |  GET /task/{id}/events      |    |  Real-time bidirect.  |                          |
|  |  task.heartbeat             |    |  PTY terminal         |                          |
|  |  message.part.delta         |    +------------------------+                          |
|  |  reasoning.delta            |                                                       |
|  |  executor.progress/output   |                                                       |
|  +-----------------------------+                                                       |
+========================================================================================+
         |                |                |                |
+========|================|================|================|============================+
|        v                v                v                v                             |
|                              CORE ENGINE LAYER                                         |
|                                                                                        |
|  +-- Session Manager -------+  +-- Orchestrator (Task Engine) --------------------+    |
|  |  session/index.ts        |  |  orchestrator/service.ts                         |    |
|  |  - CRUD sessions         |  |                                                  |    |
|  |  - Message V2 (parts)    |  |  Task State Machine:                             |    |
|  |  - Prompt pipeline       |  |  queued -> spec -> goal_decompose -> plan        |    |
|  |  - Session compaction    |  |         -> execute -> evaluate -> deliver         |    |
|  |  - Summary generation    |  |                                                  |    |
|  |  - Revert capability     |  |  Modules:                                        |    |
|  +--------------------------+  |    pipeline.ts    - Task queue processing         |    |
|                                |    runtime.ts     - Execution runtime             |    |
|  +-- Control Plane ----------+ |    strategy.ts    - Retry/replan decisions        |    |
|  |  control/message.ts      | |    persist.ts     - State transitions             |    |
|  |  - Panel requests        | |    checks.ts      - Goal verification             |    |
|  |  - Structured output     | |    interaction.ts  - User interactions            |    |
|  |  - Timeline tracking     | |    memory-bridge.ts - Learning integration        |    |
|  +--------------------------+ |    publisher.ts    - Delivery publishing           |    |
|                                |    git.ts         - Git operations                |    |
|  +-- Agent System ----------+ |    agent-stream.ts - Agent message streaming      |    |
|  |  agent/agent.ts          | +---------------------------------------------------+    |
|  |  - Agent configs         |                                                          |
|  |  - Permission profiles   |  +-- Provider System ---------------------------------+  |
|  |  - Prompt construction   |  |  provider/provider.ts                              |  |
|  |  - Mode: primary/sub     |  |                                                    |  |
|  +--------------------------+  |  Supported Providers:                               |  |
|                                |  Anthropic | OpenAI | Azure | Google | Bedrock      |  |
|  +-- Memory & Learning -----+ |  Groq | Mistral | DeepSeek | GitHub Copilot        |  |
|  |  memory/index.ts         | |  Fireworks | Together | Cerebras | XAI              |  |
|  |  - Facts, lessons,       | |  alibaba-cn | alibaba-coding-plan-cn | moonshotai  |  |
|  |    episodes, profiles    | |                                                    |  |
|  |  - FTS5 search           | |  Features:                                         |  |
|  |  - Scratchpad            | |  - OAuth + API Key auth                            |  |
|  |  - Task plan memory      | |  - Model catalog (models.dev)                      |  |
|  |  - Prompt injection      | |  - Provider-specific transforms                    |  |
|  +--------------------------+ |  - Structured output support                        |  |
|                                |  - Streaming + tool calls                          |  |
|                                +----------------------------------------------------+  |
|                                                                                        |
|  +-- Tool Registry (70+ tools) ---------------------------------------------------+   |
|  |  bash | edit | read | write | glob | grep | ls | apply_patch                   |   |
|  |  webfetch | websearch | codesearch | lsp                                       |   |
|  |  memory | preference | task | plan | skill | spec | panel                      |   |
|  |  todo | question | batch | schedule | analytics                                |   |
|  +---------------------------------------------------------------------------------+   |
|                                                                                        |
|  +-- Executor Adapters -------+  +-- Evaluator --------+  +-- Delivery -----------+   |
|  |  - opencode (default)      |  |  - Goal checking    |  |  - Git branch/PR     |   |
|  |  - codex (Copilot WS)      |  |  - Quality scoring  |  |  - Patch generation  |   |
|  |  - claude-code             |  |  - Retry decisions   |  |  - Report publishing |   |
|  +----------------------------+  +---------------------+  +------------------------+   |
+========================================================================================+
         |                                    |
+========|====================================|==========================================+
|        v                                    v                                          |
|                           INFRASTRUCTURE LAYER                                         |
|                                                                                        |
|  +-- Storage (SQLite + Drizzle ORM) -----------------------------------------------+  |
|  |  Tables:                                                                         |  |
|  |  session | message | part | todo | permission                                    |  |
|  |  orchestrator_task | _run | _plan_version | _goal | _milestone                   |  |
|  |  orchestrator_spec_snapshot | _spec_item | _evaluation | _delivery               |  |
|  |  orchestrator_artifact | _execution_session | _interaction_request               |  |
|  |  control | control_timeline | memory | scratchpad | task_plan                     |  |
|  |  protocol | project | workbench | share | cron | event | task_queue              |  |
|  +------------------------------------------------------------------------------+   |  |
|                                                                                        |
|  +-- Event Bus ---------+  +-- Config System --------+  +-- Plugin System --------+   |
|  |  bus/index.ts         |  |  config/config.ts       |  |  plugin/index.ts        |   |
|  |  - Typed events       |  |  Priority chain:        |  |  - Built-in auth        |   |
|  |  - Pub/sub pattern    |  |  remote > global > proj |  |    (Copilot, Codex,     |   |
|  |  - GlobalBus (IPC)    |  |  > .opencorvus > inline |  |     Anthropic, GitLab)  |   |
|  +-----------------------+  |  > managed              |  |  - External npm/local   |   |
|                              +-----------------------+   |  - Hook system          |   |
|  +-- Skill System -------+  +-- MCP Integration -----+  +-----------------------+    |
|  |  skill/skill.ts       |  |  mcp/index.ts          |                               |
|  |  - SKILL.md format    |  |  - HTTP/SSE/stdio      |                               |
|  |  - Marketplace        |  |  - Tool integration     |                               |
|  |  - Per-platform       |  |  - Resource reading     |                               |
|  +------------------------+  +------------------------+                                |
|                                                                                        |
|  +-- Auth Storage --------+  +-- Channel Runtime -----+  +-- Scheduler -----------+   |
|  |  ~/.opencorvus/auth.json|  |  channel/supervisor.ts |  |  scheduler/            |   |
|  |  OAuth / API Key /      |  |  channel-runtime/      |  |  - Cron jobs           |   |
|  |  WellKnown              |  |  - Slack, Discord,     |  |  - Event scheduling    |   |
|  |  Permissions: 0o600     |  |    Telegram, Teams...  |  |  - Task queue          |   |
|  +-------------------------+  +------------------------+  +------------------------+   |
+========================================================================================+
```

## Data Flow

```
  User Input (Overlay / VSCode / Channel Bot)
       |
       v
  API Gateway (REST / SSE)
       |
       +---> Control Plane (panel requests, structured output)
       |         |
       |         v
       |     Session Manager (prompt pipeline)
       |         |
       |         v
       |     Provider System (model resolution, LLM call)
       |
       +---> Orchestrator (task lifecycle)
                 |
                 +---> Spec Agent (PRD generation)
                 +---> Goal Decomposer (requirement breakdown)
                 +---> Planner Agent (execution plan)
                 +---> Executor (code execution via session)
                 +---> Evaluator (goal verification)
                 +---> Delivery (PR / branch / report)
                 |
                 v
            SSE Event Stream ---> Client UI (real-time updates)
```

## VSCode Extension Architecture (Future)

```
+--VSCode Extension Host-----------------------------------------------------+
|                                                                             |
|  +--Extension Entry (extension.ts)---+                                      |
|  |  activate() / deactivate()        |                                      |
|  +-----------------------------------+                                      |
|                                                                             |
|  +--UI Components--------------------+  +--Editor Integration-----------+   |
|  |  WebView Panel (reuse overlay     |  |  CodeLens Provider            |   |
|  |    components via iframe or       |  |  - Show agent actions inline  |   |
|  |    Solid.js web build)            |  |                               |   |
|  |                                   |  |  Diagnostic Provider          |   |
|  |  Sidebar Panel                    |  |  - Show evaluation results    |   |
|  |  - Task list                      |  |                               |   |
|  |  - Agent status                   |  |  Diff Editor Integration      |   |
|  |  - Quick actions                  |  |  - Review delivery patches    |   |
|  |                                   |  |                               |   |
|  |  Status Bar Item                  |  |  Inline Completion            |   |
|  |  - Connection status              |  |  - Suggest from memory/plan   |   |
|  |  - Current model                  |  +-------------------------------+   |
|  |  - Task progress                  |                                      |
|  +-----------------------------------+  +--Terminal Integration---------+   |
|                                         |  Terminal Profile Provider    |   |
|  +--Command Palette------------------+  |  - Embedded opencorvus CLI   |   |
|  |  opencorvus.createTask            |  |                               |   |
|  |  opencorvus.switchModel           |  |  PTY Integration             |   |
|  |  opencorvus.viewBoard             |  |  - Live executor output      |   |
|  |  opencorvus.openSettings          |  +-------------------------------+   |
|  +-----------------------------------+                                      |
|                                                                             |
|  +--Service Layer (reuse SDK)--------+  +--Event Bridge-----------------+   |
|  |  import { OpenCorvusSDK }         |  |  SSE → VSCode EventEmitter   |   |
|  |    from '@opencorvus/sdk'         |  |  Workspace events → API      |   |
|  |                                   |  |  File change → notification  |   |
|  |  REST API client                  |  +-------------------------------+   |
|  |  SSE event consumer               |                                      |
|  |  Auth token management            |                                      |
|  +-----------------------------------+                                      |
+-----------------------------------------------------------------------------+
       |
       | REST + SSE (same protocol as Overlay)
       v
  OpenCorvus Core Server (:7878)
```

## Package Dependency Graph

```
packages/
  opencorvus ────────> util          (shared utilities)
       |                 ^
       |                 |
       +──> plugin ──────+            (plugin infrastructure)
       |
       +──> sdk                       (client SDK, used by extensions)
       |
       +──> channel-config            (channel schemas)
       |         |
       +──> channel-runtime ──────+   (channel handlers)
       |                          |
  overlay ──> (REST/SSE) ──> opencorvus
       |
  script ──> opencorvus              (build tooling)
```

## Key Design Decisions

1. **Protocol-first**: REST + SSE as the universal interface — any UI (Overlay, VSCode, CLI) connects identically
2. **Compiled binary**: `bun build --compile` produces single executable with embedded UI assets
3. **SQLite + Drizzle**: Single-file database, no external dependencies, event sourcing via protocol table
4. **Plugin architecture**: Auth providers, tools, and hooks are pluggable
5. **Multi-executor**: Tasks can run on opencode, codex, or claude-code engines
6. **Config cascade**: remote → global → project → .opencorvus → inline → managed (enterprise)
