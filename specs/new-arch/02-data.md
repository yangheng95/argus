# 02 — 数据面

> 对应代码：`src/engine/orchestrator.sql.ts` · `src/session/session.sql.ts` · `src/trace/` ·
> `src/bus/` · `src/decision-log/` · `src/storage/`

## orchestrator 域（18 表）

所有表定义在 `src/engine/orchestrator.sql.ts`，命名前缀 `orchestrator_`。

### 顶层与规格
| 表 | 关键字段 / 状态 |
|---|---|
| `engine_task` | status ∈ {queued, active, completed, failed, cancelled}; priority ∈ {critical,high,normal,low}; executor ∈ {opencode, codex, claude-code}; kind ∈ {workflow, build} |
| `engine_spec_snapshot` | 规格快照（requirements 输出） |
| `engine_spec_item` | 规格明细项 |

### 计划与目标
| 表 | 关键字段 / 状态 |
|---|---|
| `engine_plan_version` | status ∈ {active, superseded} |
| `engine_milestone` | status ∈ {pending, active, passed, failed} |
| `engine_goal` | priority ∈ {blocking, advisory}; status ∈ {pending, running, passed, failed} |
| `engine_requirement` | 需求追溯记录 |
| `engine_goal_snapshot` | goal 快照 |
| `engine_plan_node` | 计划步骤 |

### 执行与交付
| 表 | 关键字段 / 状态 |
|---|---|
| `engine_run` | status ∈ {queued, accepted, running, blocked, completed, failed, aborted}; phase ∈ {plan, execute, evaluate, deliver, dispatch, retry} |
| `engine_goal_run` | goal × run 关联 |
| `engine_delivery` | 交付记录 |
| `engine_artifact` | 产物 |
| `engine_evaluation` | 评估结果 |
| `orchestrator_progress_snapshot` | 进度快照 |
| `engine_executor_session` | 执行器会话绑定 |

### 交互与绑定
| 表 | 关键字段 / 状态 |
|---|---|
| `engine_interaction_request` | type ∈ {permission, question}; status ∈ {pending, ...} |
| `engine_channel_binding` | 外部 channel ↔ task 绑定；ChannelIngress 查询入口 |

**唯一写入者**：`orchestrator/service.ts` 和 `orchestrator/store.ts`。
禁止其他模块直接写 orchestrator_* 表。

## session 域（5 表）

`src/session/session.sql.ts`：

| 表 | 作用 |
|---|---|
| `session` | 会话树节点；关键列：`kind` (gateway / agent / …)、`channel_key` |
| `message` | 消息 |
| `part` | 消息分片（tool call / text / …） |
| `todo` | session 内 todo |
| `permission` | 权限请求 |

**关键索引**：`session_gateway_singleton_idx` — partial unique on
`(kind='gateway', channel_key)`，保证 Gateway session 单例。

## 控制 / 工作区

| 表 | 文件 | 作用 |
|---|---|---|
| `workspace` | `workspace/workspace.sql.ts` | 多工作区代理元数据 |
| `control_account` | `control/control.sql.ts` | 外部控制账号（email + url） |
| `control_message` | `control/control.sql.ts` | 外部控制消息 |
| `project` | `project/project.sql.ts` | 项目根 |

## 辅助域

| 表 | 文件 | 作用 |
|---|---|---|
| `decision_log` | `decision-log/schema.ts` | **全局共享上下文**，append-only，所有 agent R/W |
| `workbench_task_note` | `workbench/workbench.sql.ts` | 面板 per-task 备注 |
| `workbench_brief_snapshot` | `workbench/workbench.sql.ts` | 面板简报快照 |
| `scratchpad` | `memory/scratchpad.sql.ts` | 短期暂存 |
| `memory_file` · `memory_chunk` · `memory_embedding` | `memory/memory.sql.ts` | 长期语义记忆 |
| `task_plan` | `memory/task-plan.sql.ts` | 任务计划记忆 |
| `quick_note` | `quicknote/quicknote.sql.ts` | quicknote |
| `session_share` | `share/share.sql.ts` | 分享 |
| `protocol_event` · `protocol_inbox` · `protocol_stream_chunk` | `protocol/protocol.sql.ts` | executor 协议事件 |
| `task_queue` · `cron_job` · `event_job` | `scheduler/*.sql.ts` | 调度器 |

## Trace — 统一 workflow 追踪（横切）

**代码**：`src/trace/index.ts`

替代旧的：
- `AgentTrace` — per-agent markdown dump
- env-gated `LLMTrace` — session 级 JSONL

**新设计**：
```
每个 workflow 事件（task/agent 边界、llm.step deltas、tool.call/result、phase 变化）
  ↓ Trace.event()
  ├─ 追加 JSON 一行到 <Instance.directory>/.opencorvus/trace/<taskID>.jsonl
  └─ Bus.publish — overlay SSE 消费者实时拿到
```

**自动埋点**：`session/llm.ts` 的 runtime hook 捕获每次 LLM 调用。
Agent 代码不需要手工调用 `Trace.event()`（仅 orchestration 加 task/phase 元事件）。

## Bus — 全局事件总线（横切）

**代码**：`src/bus/bus-event.ts` · `src/bus/global.ts`

- 类型安全的 event 定义（`BusEvent.define(name, zodSchema)`）
- `GlobalBus.publish()` 全局发布
- SSE 消费者订阅 → overlay 实时刷新
- Trace 双写的第二条路径

## Decision Log（重申）

- 全局共享 append-only 表
- Requirements 种子 → Architect 写契约 → Planner/Executor 读上下文
- **传 WHY 不只 WHAT**

## 相关文档

- [01-agents.md](01-agents.md) — 哪些 agent 读写哪些表
- [03-control.md](03-control.md) — Trace/Bus 如何流向 overlay
