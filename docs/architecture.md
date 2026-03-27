# OpenCorvus Architecture

## 1. System Architecture Overview

```mermaid
graph TB
    subgraph CLIENT["Client Layer"]
        direction LR
        OV["<b>Overlay UI</b><br/>Solid.js + Tauri Desktop<br/><i>components / stores / services</i>"]
        VS["<b>VSCode Extension</b><br/>WebView + Native Panel<br/><i>Future</i>"]
        CB["<b>Channel Bots</b><br/>Slack / Discord / Telegram<br/>Teams / Feishu / DingTalk"]
    end

    subgraph API["API Gateway — Hono HTTP :7878"]
        direction LR
        MW["Auth Middleware<br/>CORS / Error Handler"]
        ROUTES["REST Routes<br/>/config /session /task /goal /plan<br/>/provider /executor /channel /control<br/>/auth /mcp /skill /permission"]
        SSE["SSE Event Stream<br/>GET /task/{id}/events<br/>message.part.delta<br/>reasoning.delta"]
        WS["WebSocket<br/>PTY terminal"]
    end

    subgraph CORE["Core Engine Layer"]
        SM["<b>Session Manager</b><br/>CRUD / Message V2<br/>Prompt Pipeline<br/>Compaction / Revert"]
        ORC["<b>Orchestrator</b><br/>Task State Machine<br/>Pipeline / Runtime<br/>Strategy / Checks"]
        CP["<b>Control Plane</b><br/>Panel Requests<br/>Structured Output"]
        AG["<b>Agent System</b><br/>Configs / Permissions<br/>Prompt Construction"]
        MEM["<b>Memory</b><br/>Facts / Lessons<br/>FTS5 Search<br/>Scratchpad"]
        PROV["<b>Provider System</b><br/>15+ LLM Providers<br/>OAuth + API Key<br/>Streaming + Tools"]
        TOOLS["<b>Tool Registry</b><br/>70+ Tools:<br/>bash / edit / read / write<br/>glob / grep / webfetch / ..."]
        EXEC["<b>Executors</b><br/>opencode / codex<br/>claude-code"]
        EVAL["<b>Evaluator</b><br/>Goal Checking<br/>Quality Scoring"]
        DEL["<b>Delivery</b><br/>Git Branch / PR<br/>Patch / Report"]
    end

    subgraph INFRA["Infrastructure Layer"]
        DB["<b>SQLite + Drizzle ORM</b><br/>25+ tables: session / message / part<br/>orchestrator_* / memory / protocol"]
        BUS["<b>Event Bus</b><br/>Typed Pub/Sub<br/>GlobalBus IPC"]
        CFG["<b>Config System</b><br/>remote → global → project<br/>→ .opencorvus → managed"]
        PLG["<b>Plugin System</b><br/>Copilot / Codex / Anthropic<br/>External npm / local"]
        SKL["<b>Skills</b><br/>SKILL.md format<br/>Marketplace"]
        MCP["<b>MCP</b><br/>HTTP / SSE / stdio<br/>Tool Integration"]
        AUTH["<b>Auth Storage</b><br/>~/.opencorvus/auth.json<br/>OAuth / API Key"]
        SCHED["<b>Scheduler</b><br/>Cron / Event<br/>Task Queue"]
    end

    OV -->|REST + SSE| API
    VS -->|REST + SSE| API
    CB -->|REST| API

    API --> CORE
    CORE --> INFRA

    style CLIENT fill:#1a2332,stroke:#58a6ff,color:#e6edf3
    style API fill:#1a2332,stroke:#3fb950,color:#e6edf3
    style CORE fill:#1a2332,stroke:#bc8cff,color:#e6edf3
    style INFRA fill:#1a2332,stroke:#d29922,color:#e6edf3
    style OV fill:#21262d,stroke:#58a6ff,color:#e6edf3
    style VS fill:#21262d,stroke:#bc8cff,color:#e6edf3
    style CB fill:#21262d,stroke:#3fb950,color:#e6edf3
```

## 2. Data Flow

```mermaid
flowchart TD
    INPUT["User Input<br/><i>Overlay / VSCode / Channel Bot</i>"] --> GW["API Gateway<br/><i>REST / SSE</i>"]
    GW --> CP["Control Plane<br/><i>panel requests</i>"]
    GW --> ORC["Orchestrator<br/><i>task lifecycle</i>"]

    CP --> SM["Session Manager<br/><i>prompt pipeline</i>"]
    SM --> PROV["Provider System<br/><i>model resolution → LLM call</i>"]

    ORC --> SPEC["Spec Agent<br/><i>PRD generation</i>"]
    ORC --> GOAL["Goal Decomposer<br/><i>requirement breakdown</i>"]
    ORC --> PLAN["Planner Agent<br/><i>execution plan</i>"]
    ORC --> EXEC["Executor<br/><i>code execution</i>"]
    ORC --> EVAL["Evaluator<br/><i>goal verification</i>"]
    ORC --> DEL["Delivery<br/><i>PR / branch / report</i>"]

    PROV --> SSE["SSE Event Stream"]
    DEL --> SSE
    SSE --> UI["Client UI<br/><i>real-time updates</i>"]

    style INPUT fill:#21262d,stroke:#58a6ff,color:#e6edf3
    style GW fill:#21262d,stroke:#3fb950,color:#e6edf3
    style CP fill:#21262d,stroke:#39d2c0,color:#e6edf3
    style ORC fill:#21262d,stroke:#d29922,color:#e6edf3
    style SSE fill:#21262d,stroke:#3fb950,color:#e6edf3
    style UI fill:#21262d,stroke:#58a6ff,color:#e6edf3
```

## 3. Orchestrator — Task State Machine

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> spec_generating
    spec_generating --> goal_decomposing
    goal_decomposing --> planning
    planning --> planned
    planned --> running
    running --> blocked : needs user input
    blocked --> running : user responds
    running --> evaluating
    evaluating --> delivering : goals met
    evaluating --> planning : replan needed
    delivering --> completed
    running --> failed
    delivering --> failed
    [*] --> cancelled

    note right of spec_generating : Spec Agent generates PRD
    note right of goal_decomposing : LLM classifies + clusters requirements
    note right of planning : Planner Agent (8 tools, quality scoring)
    note right of running : opencode / codex / claude-code
    note right of evaluating : Goal checking + quality threshold
    note right of delivering : Git branch / PR / patch
```

### Orchestrator Modules

| Module | File | Description |
|--------|------|-------------|
| Pipeline | `pipeline.ts` | Task queue processing |
| Runtime | `runtime.ts` | Execution runtime |
| Strategy | `strategy.ts` | Retry / replan decisions |
| Persist | `persist.ts` | State transitions |
| Checks | `checks.ts` | Goal verification |
| Interaction | `interaction.ts` | User interactions |
| Memory Bridge | `memory-bridge.ts` | Learning integration |
| Publisher | `publisher.ts` | Delivery publishing |
| Git | `git.ts` | Git operations |
| Agent Stream | `agent-stream.ts` | Agent message streaming |

## 4. Provider System

```mermaid
graph LR
    subgraph Providers["Supported LLM Providers"]
        A[Anthropic]
        B[OpenAI]
        C[Azure]
        D[Google]
        E[Bedrock]
        F[GitHub Copilot]
        G[Groq]
        H[Mistral]
        I[DeepSeek]
        J[XAI]
        K[alibaba-cn]
        L[Fireworks]
        M[Together]
        N[Cerebras]
    end

    CFG["Config<br/>model: provider/model-id"] --> RESOLVE["Provider.defaultModel()"]
    RESOLVE --> GET["Provider.getModel()"]
    GET --> LANG["Provider.getLanguage()"]
    LANG --> LLM["LLM API Call<br/><i>streaming + tool calls</i>"]

    style Providers fill:#1a2332,stroke:#bc8cff,color:#e6edf3
```

### Model Resolution Priority

```
input.model → agent.model → Provider.defaultModel() → Config.get().model
```

### Config Update Flow (UI Model Switch)

```mermaid
sequenceDiagram
    participant UI as Overlay UI
    participant API as PATCH /config
    participant CFG as Config.update()
    participant PRV as Provider.reset()
    participant LLM as Next LLM Call

    UI->>API: { model: "github-copilot/gemini-3-flash-preview" }
    API->>CFG: Write .opencorvus/opencorvus.jsonc
    CFG->>CFG: state.reset() + global.reset()
    API->>PRV: Clear cached providers
    Note over LLM: Next request picks up new model
    LLM->>PRV: Provider.defaultModel() → reads fresh config
```

## 5. VSCode Extension Architecture (Future)

```mermaid
graph TB
    subgraph VSCode["VSCode Extension Host"]
        ENTRY["Extension Entry<br/><i>activate() / deactivate()</i>"]

        subgraph UI["UI Components"]
            WV["WebView Panel<br/><i>reuse overlay Solid.js</i>"]
            SB["Sidebar Panel<br/><i>task list / agent status</i>"]
            BAR["Status Bar<br/><i>connection / model / progress</i>"]
        end

        subgraph EDITOR["Editor Integration"]
            CL["CodeLens<br/><i>inline agent actions</i>"]
            DIAG["Diagnostics<br/><i>evaluation results</i>"]
            DIFF["Diff Editor<br/><i>review delivery patches</i>"]
            COMP["Inline Completion<br/><i>suggest from memory/plan</i>"]
        end

        subgraph CMD["Command Palette"]
            C1["opencorvus.createTask"]
            C2["opencorvus.switchModel"]
            C3["opencorvus.viewBoard"]
            C4["opencorvus.openSettings"]
        end

        subgraph TERM["Terminal"]
            TP["Terminal Profile Provider"]
            PTY["PTY Integration<br/><i>live executor output</i>"]
        end

        subgraph SVC["Service Layer"]
            SDK["OpenCorvusSDK<br/><i>from @opencorvus/sdk</i>"]
            BRIDGE["Event Bridge<br/><i>SSE → EventEmitter</i>"]
        end
    end

    SVC -->|"REST + SSE<br/>(same protocol as Overlay)"| SERVER["OpenCorvus Core :7878"]

    style VSCode fill:#1a2332,stroke:#bc8cff,color:#e6edf3
    style SERVER fill:#21262d,stroke:#3fb950,color:#e6edf3
```

## 6. Package Dependency Graph

```mermaid
graph TD
    OC["<b>opencorvus</b><br/><i>Core backend</i>"] --> UTIL["<b>util</b><br/><i>Shared utilities</i>"]
    OC --> PLG["<b>plugin</b><br/><i>Plugin infra</i>"]
    OC --> SDK2["<b>sdk</b><br/><i>Client SDK</i>"]
    OC --> CC["<b>channel-config</b><br/><i>Channel schemas</i>"]
    OC --> CR["<b>channel-runtime</b><br/><i>Channel handlers</i>"]
    PLG --> UTIL

    OV["<b>overlay</b><br/><i>Frontend UI</i>"] -->|"REST + SSE"| OC
    SC["<b>script</b><br/><i>Build tooling</i>"] --> OC

    style OC fill:#21262d,stroke:#58a6ff,color:#e6edf3
    style OV fill:#21262d,stroke:#3fb950,color:#e6edf3
    style UTIL fill:#21262d,stroke:#d29922,color:#e6edf3
```

## 7. Database Schema (25+ tables)

| Group | Tables |
|-------|--------|
| **Session** | `session`, `message`, `part`, `todo`, `permission` |
| **Orchestrator** | `orchestrator_task`, `_run`, `_plan_version`, `_goal`, `_milestone`, `_spec_snapshot`, `_spec_item`, `_evaluation`, `_delivery`, `_artifact`, `_execution_session`, `_interaction_request` |
| **Control** | `control`, `control_timeline` |
| **Memory** | `memory`, `scratchpad`, `task_plan` |
| **System** | `protocol`, `project`, `workbench`, `share`, `cron`, `event`, `task_queue` |

## 8. Key Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Protocol-first** | REST + SSE as universal interface — any UI connects identically |
| 2 | **Compiled binary** | `bun build --compile` → single executable with embedded UI assets |
| 3 | **SQLite + Drizzle** | Single-file DB, zero deps, event sourcing via protocol table |
| 4 | **Plugin architecture** | Auth, tools, hooks are pluggable (built-in + external npm/local) |
| 5 | **Multi-executor** | opencode / codex / claude-code via adapter pattern |
| 6 | **Config cascade** | remote → global → project → .opencorvus → inline → managed |

## 9. Config Priority Chain

```mermaid
graph LR
    R["Remote<br/>.well-known"] --> G["Global<br/>~/.config/opencorvus"]
    G --> C["Custom<br/>OPENCORVUS_CONFIG"]
    C --> P["Project<br/>opencorvus.json{,c}"]
    P --> D[".opencorvus/<br/>directory config"]
    D --> I["Inline<br/>ENV content"]
    I --> M["Managed<br/>Enterprise override"]

    style R fill:#21262d,stroke:#64748b,color:#e6edf3
    style M fill:#21262d,stroke:#f85149,color:#e6edf3
```

> **Low → High priority**: 每一层覆盖前一层。`.opencorvus/opencorvus.jsonc` 是 UI 配置的写入目标。
