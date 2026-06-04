# 02 — 数据面

> 对应代码：`src/engine/engine.sql.ts` · `src/session/session.sql.ts` · `src/trace/` ·
> `src/bus/` · `src/decision-log/` · `src/storage/` · `src/workspace/workspace.sql.ts` ·
> `src/control/control.sql.ts`

## engine 域（13 张表）

所有表定义在 `src/engine/engine.sql.ts`，命名前缀 `engine_`（历史文档里的
`orchestrator_*` 已全部重命名为 `engine_*`）。Phase 6 把 5 张过程表（`engine_run` /
`engine_goal_run` / `engine_acceptance` / `engine_evaluation` / `engine_goal_snapshot`）合并
为单一 `engine_artifact`，按 `kind` 区分语义。

### 顶层与规格
| 表 | 关键字段 / 状态 |
|---|---|
| `engine_task` | status ∈ {queued, active, completed, failed, cancelled}; priority ∈ {critical, high, normal, low}; kind ∈ {workflow, build}; `session_id` 指向 root session |
| `engine_spec_snapshot` | 规格快照（requirements 输出） |
| `engine_spec_item` | 规格明细项 |

### 计划与目标
| 表 | 关键字段 / 状态 |
|---|---|
| `engine_plan_version` | status ∈ {active, superseded} |
| `engine_milestone` | status ∈ {pending, active, passed, failed} |
| `engine_goal` | priority ∈ {blocking, advisory}；**无** `status` 列（live 派生自 `engine/describe.ts::goalStatusByID`，2026-05-05 Phase E 退役）；**无** `workspace_dir` / `workspace_branch` / `workspace_base_ref` / `retry_count` / `cascade_state`（Phase B+E 2026-05-05 退役，单一来源迁到 `engine_artifact[kind="goal_run_attempt"].payload`，通过 `engine/store.ts:findGoalLatestWorkspace` / `getGoalRetryCount` 读取） |
| `engine_requirement` | 需求追溯记录（`requirements` agent 写入） |
| `engine_plan_node` | 计划步骤 |

### 执行与交付（artifact-centric）
| 表 | 关键字段 / 状态 |
|---|---|
| `engine_artifact` | **统一过程表**，`kind` 决定语义；替代旧的 `engine_run` / `engine_goal_run` / `engine_acceptance` / `engine_evaluation` / `engine_goal_snapshot`。完整 `EngineArtifactKind` 取值（见 `engine.sql.ts:97`）：`run` · `goal_run_attempt` · `acceptance` · `verification-evidence` · `evaluation` · `verdict` · `patch` · `changed_file` · `diff` · `log` · `report` · `image` · `link` · `git_ref` · `pr` · `integrity_attempt` · `prosecutor_attempt` · `acceptance_evidence_manifest` · `acceptance_surface_manifest` · `acceptance_specialist_review` · `acceptance_review_threw` · `browser_preview_target` · `browser_preview_evidence` · `orchestrator-stream-error` |
| `engine_progress_snapshot` | 进度快照（旧名 `orchestrator_progress_snapshot` 已重命名） |
| `engine_executor_session` | 执行器会话绑定 |

### 交互与绑定
| 表 | 关键字段 / 状态 |
|---|---|
| `engine_interaction_request` | type ∈ {permission, question}; status ∈ {pending, …} |
| `engine_channel_binding` | 外部 channel（platform/channel/thread） ↔ task 绑定；`ChannelIngress` 查询入口 |

> 实际 `sqliteTable` 注册见 `engine.sql.ts`：EngineSpecSnapshotTable、EngineSpecItemTable、EngineTaskTable、EnginePlanVersionTable、EngineMilestoneTable、EngineGoalTable、EngineRequirementTable、EnginePlanNodeTable、EngineInteractionRequestTable、EngineArtifactTable、EngineProgressSnapshotTable、EngineExecutorSessionTable、EngineChannelBindingTable（共 13 个）。

**唯一写入者**：`task-api/index.ts` 和 `engine/persist.ts` / `engine/state.ts` / `engine/store.ts`。禁止其他模块直接写 `engine_*` 表。

## session 域（5 表）

`src/session/session.sql.ts`：

| 表 | 作用 |
|---|---|
| `session` | 会话树节点；关键列：`kind`、`goal_id`、`parent_id`、`directory`、`permission`、`metadata` |
| `message` | 消息 |
| `part` | 消息分片（tool call / text / reasoning / …） |
| `todo` | session 内 todo |
| `permission` | 权限请求（project 级全量规则集） |

**SessionKind**（固定在 creation time，见 `session.sql.ts:50-65`，按代码出现顺序）：
`root` · `orchestrator` · `assistant` · `gateway` · `intent-analysis` · `requirements` ·
`frontend-design` · `goal` · `architect` · `integrity` · `acceptance` · `executor` · `build` ·
`evaluator` · `system` —— **共 15 种**。

> 历史版本本文档曾写"16 种"且把 `planner` 列入，那是抄旧 `planner/` 包时代的草稿。
> Planning tool role 已随 the removed planning package 整目录删除（见 [01-agents.md](01-agents.md)），
> `planner` 不再是合法的 SessionKind。`goal` kind 仍保留——用于 historical task rows
> 与早于 `requirements` / `frontend-design` 拆分前的 catch-all。

**去掉的字段 / 索引**（旧文档还在提，代码已清理）：
- ~~`session.channel_key`~~ — Gateway 单例概念删除
- ~~`session_gateway_singleton_idx`~~ — partial unique index 已删

`kind='gateway'` 的 SessionKind **保留**——`src/gateway/` 目录仍在，承担"SDK gateway 客户端会话"职责（见 [03-control.md](03-control.md)）；只是不再有 per-channel 单例。

新增的字段 `goal_id`：当 session 归属某个 goal（`executor` / `build` / `evaluator` session）时写入，overlay 据此把消息嵌在 goal 卡片下。`planner` kind 已删除，此处不再列入。

## 控制 / 工作区

| 表 | 文件 | 作用 |
|---|---|---|
| `workspace` | `workspace/workspace.sql.ts` | 多工作区代理元数据（路径、状态） |
| `control_account` | `control/control.sql.ts` | 外部控制账号（email + url） |
| `control_message` | `control/control.sql.ts` | 外部控制消息 timeline |
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
  ↓ AgentTrace.recordLLMRequest / recordHelperLLMCall / recordAgentReport
  ├─ 追加 JSON 一行到 <Instance.directory>/.opencorvus/trace/<sessionID>.jsonl
  │  以及 _task-<taskID>.jsonl（taskID rollup）和 _index.jsonl（manifest）
  └─ Bus.publish — overlay SSE 消费者实时拿到
```

**自动埋点**：`session/llm.ts`（`LLM.stream` 入口）+ `agent/agent.ts`（`Agent.generate`
helper）+ `agent/runner.ts`（`runAgentSession`）+ `orchestrator/agent.ts`（`Orchestrator.processTask`
wake）。Agent 代码不手工调 trace；命名空间是 `AgentTrace`，不是历史文档里的 `Trace.event()`。

## Bus — 全局事件总线（横切）

**代码**：`src/bus/bus-event.ts` · `src/bus/global.ts` · `src/bus/index.ts`

- 类型安全的 event 定义（`BusEvent.define(name, zodSchema)`）
- `Bus.publish()` 全局发布
- SSE 消费者订阅 → overlay 实时刷新
- Trace 双写的第二条路径

事件清单定义在 `engine/model.ts` 的 `Event.*` namespace（task 状态、goal 状态、interaction、config 变更、agent.updated、task.message 等）。

## Decision Log（重申）

- 全局共享 append-only 表
- Requirements 种子 → Architect 写契约 → Build/Executor 读上下文
  > **已废弃历史记录**：早期设计曾引入 Planner/Executor 两个阶段；Planner 已于后续重构删除，
  > 现为 Orchestrator + 专职 sub-agent 模型（Requirements → Architect → Build/Executor）。
  > Planner 不再是合法 SessionKind（见本文件 §session 域）。
- **传 WHY 不只 WHAT**

## 相关文档

- [01-agents.md](01-agents.md) — 哪些 agent 读写哪些表
- [03-control.md](03-control.md) — Trace/Bus 如何流向 overlay
