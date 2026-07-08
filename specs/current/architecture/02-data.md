# 02 — 数据面

> 对应代码：`src/engine/engine.sql.ts` · `src/session/session.sql.ts` · `src/trace/` ·
> `src/bus/` · `src/decision-log/` · `src/storage/` · `src/workspace/workspace.sql.ts` ·
> `src/control/control.sql.ts`

## engine 域（13 张表）

所有表定义在 `src/engine/engine.sql.ts`，命名前缀 `engine_`（历史文档里的
`orchestrator_*` 已全部重命名为 `engine_*`）。旧的多张过程表已合并为单一
`engine_artifact`，按 `kind` 区分语义。

### 顶层与规格

| 表                     | 关键字段 / 状态                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine_task`          | status ∈ {queued, active, completed, failed, cancelled}; priority ∈ {critical, high, normal, low}; kind ∈ {workflow, build}; `session_id` 指向 root session |
| `engine_spec_snapshot` | 规格快照（requirements 输出）                                                                                                                               |
| `engine_spec_item`     | 规格明细项                                                                                                                                                  |

### 计划与目标

| 表                    | 关键字段 / 状态                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine_plan_version` | status ∈ {active, superseded}                                                                                                                                                                                                                                                                                                                                                                     |
| `engine_milestone`    | status ∈ {pending, active, passed, failed}                                                                                                                                                                                                                                                                                                                                                        |
| `engine_goal`         | priority ∈ {blocking, advisory}；**无** `status` 列（live 派生自 `engine/describe.ts::goalStatusByID`，旧 goal 状态列已退役）；**无** `workspace_dir` / `workspace_branch` / `workspace_base_ref` / `retry_count` / `cascade_state`（这些过程字段的单一来源已迁到 `engine_artifact[kind="goal_run_attempt"].payload`，通过 `engine/store.ts:findGoalLatestWorkspace` / `getGoalRetryCount` 读取） |
| `engine_requirement`  | 需求追溯记录（`requirements` agent 写入）                                                                                                                                                                                                                                                                                                                                                         |
| `engine_plan_node`    | 计划步骤                                                                                                                                                                                                                                                                                                                                                                                          |

### 执行与交付（artifact-centric）

| 表                         | 关键字段 / 状态                                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine_artifact`          | **统一过程表**，`kind` 决定语义；替代旧的多表过程模型。`EngineArtifactKind` 的唯一真源是 `packages/opencorvus/src/engine/engine.sql.ts`，本文档禁止复制完整枚举。 |
| `engine_progress_snapshot` | 进度快照（旧名 `orchestrator_progress_snapshot` 已重命名）                                                                                                        |

### 交互与绑定

| 表                           | 关键字段 / 状态                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `engine_interaction_request` | type ∈ {permission, question}; status ∈ {pending, …}                            |
| `engine_channel_binding`     | 外部 channel（platform/channel/thread） ↔ task 绑定；`ChannelIngress` 查询入口 |

> 实际 `sqliteTable` 注册以 `packages/opencorvus/src/engine/engine.sql.ts` 的 `export const Engine*Table = sqliteTable(...)` 为唯一真源；本文档只描述表职责，不复制完整注册清单或数量。

**唯一写入者**：`engine_artifact` 的唯一直接表写入文件是
`engine/artifact.ts`。所有过程 / 证据 / preview / review / run /
goal-run artifact row 必须通过这个 writer 进入；生产源码中其他文件禁止直接
`insert` / `update` / `delete` `EngineArtifactTable`。`engine_progress_snapshot`
的唯一直接表写入文件是 `engine/progress.ts`；任务创建、任务状态更新、队列
claim、git note 和 operator note 都只能通过这个 writer 记录 progress row。
`engine_interaction_request` 的唯一直接表写入文件是
`engine/interaction-request.ts`；permission/question bridge、executor protocol
interaction request 和 operator protocol interaction resolution 都只能通过这个
writer 创建或解析 interaction row。`engine_channel_binding` 的唯一直接表写入文件
是 `engine/channel-binding.ts`；task creation 和 task cancellation / removal 只能通过
这个 writer 创建或删除 channel binding row。`engine_spec_snapshot` 的唯一直接表写入文件是
`engine/spec-snapshot.ts`；requirements 和 architect 阶段只能通过这个 writer 创建、
supersede 或更新 spec snapshot row。`engine_plan_version` 和 `engine_plan_node`
的唯一直接表写入文件是 `engine/persist.ts`；architect graph、operator add-goal
和 create-run active plan graph 只能通过这个 persistence writer 创建、supersede
或更新 plan graph row。`engine_goal` 的唯一直接表写入文件是 `engine/persist.ts`；
architect upsert、operator add/modify/delete/complete、active plan repoint 和 retry
attempt bookkeeping 只能通过这个 persistence writer 变更 goal row。`engine_task`
的唯一直接表写入文件是 `engine/task.ts`；task creation、metadata/touch、
budget/title edits、physical delete、queue reorder/claim、lifecycle state updates、
run bump 和 rewind cursor mutation 都只能通过这个 task writer 变更 task row。
`engine_requirement` 的唯一直接表写入文件是 `engine/persist.ts`；requirements
追溯记录只能通过这个 persistence writer 创建。
其他 `engine_*` 表的写入仍必须停留在已声明的 engine-owned writer/service 内，
禁止跨域模块直接写。

Metrics 域沿用 `engine_*` 表名承载评分流水，但写入边界归属 metrics store：
`engine_metric_spec`、`engine_metric_result` 和 `engine_iteration` 的唯一直接表写入文件
是 `metrics/store.ts`。任务、agent、engine 或 UI 层不得直接写这些 metrics 表。

## session 域（5 表）

`src/session/session.sql.ts`：

| 表           | 作用                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------- |
| `session`    | 会话树节点；关键列：`kind`、`goal_id`、`parent_id`、`directory`、`permission`、`metadata` |
| `message`    | 消息                                                                                      |
| `part`       | 消息分片（tool call / text / reasoning / …）                                              |
| `todo`       | session 内 todo                                                                           |
| `permission` | 权限请求（project 级全量规则集）                                                          |

**SessionKind**（固定在 creation time，见 `session.sql.ts` 的 `SESSION_KINDS`，按代码出现顺序）：
`root` · `orchestrator` · `assistant` · `mission` · `intent-analysis` · `requirements` ·
`frontend-design` · `goal` · `architect` · `goal-workload-analyst` · `integrity` ·
`fact-check` · `acceptance` · `executor` · `build` · `explore` · `deep-research` ·
`frontend-research` · `visual-qa` · `evaluator` · `system` —— **共 21 种**。

> 历史版本本文档曾写"16 种"且把 `planner` 列入，那是抄旧 `planner/` 包时代的草稿。
> Planning tool role 已随 the removed planning package 整目录删除（见 [01-agents.md](01-agents.md)），
> `planner` 不再是合法的 SessionKind。`goal` kind 仍保留——用于 historical task rows
> 与早于 `requirements` / `frontend-design` 拆分前的 catch-all。

**去掉的字段 / 索引**（旧文档还在提，代码已清理）：

- ~~`session.channel_key`~~ — Gateway 单例概念删除
- ~~`session_gateway_singleton_idx`~~ — partial unique index 已删

`gateway` 不再是 SessionKind；当前 gateway 是 control-plane HTTP surface / route（见 [03-control.md](03-control.md)），不通过独立 session kind 或旧 gateway 包承载。

新增的字段 `goal_id`：当 session 归属某个 goal（`executor` / `build` / `evaluator` session）时写入，overlay 据此把消息嵌在 goal 卡片下。`planner` kind 已删除，此处不再列入。

Session message 表按 Session writer 分层写入：`part` 的唯一直接表写入文件是
`session/index.ts`。Build、tool、server route、compaction 和 shell execution 只能通过
`Session.updatePart` / `Session.updatePartData` / `Session.persistMessage` 等 Session writer API
创建或修正 part row，不能直接写 `PartTable`。

## 控制 / 工作区

| 表                | 文件                         | 作用                             |
| ----------------- | ---------------------------- | -------------------------------- |
| `workspace`       | `workspace/workspace.sql.ts` | 多工作区代理元数据（路径、状态） |
| `control_account` | `control/control.sql.ts`     | 外部控制账号（email + url）      |
| `control_message` | `control/control.sql.ts`     | 外部控制消息 timeline            |
| `project`         | `project/project.sql.ts`     | 项目根                           |

Control 和轻量辅助域按领域 writer 分层写入：`control_message` 的唯一直接表写入文件是
`control/timeline.ts`，`decision_log` 的唯一直接表写入文件是
`decision-log/index.ts`，`quick_note` 的唯一直接表写入文件是
`quicknote/service.ts`。Project delete 可以编排项目级清理事务，但必须调用这些领域
writer API，不能直接删除其它领域表。

`project` 表的唯一直接表写入文件是 `project/project.ts`。Project delete 和
Project GC（Garbage Collection，垃圾回收）可以编排项目生命周期，但必须调用
`Project.deleteRows` 等项目领域 API，不能直接写 `ProjectTable`。

## Project Storage Namespace

`project.id` / `project_id` 是后端 storage namespace，不是用户可见项目数。
同一 canonical project worktree / common Git identity 必须收敛到一个后端
namespace；一个目录下的多个用户可见 Mission / task 通过现有 Mission/task 记录
表达，不能通过制造多个 `project_id` 行表达。

`Project.fromDirectory()` 与 exact-worktree convergence 是当前 namespace 入口。
重复 worktree 行只能收敛或显式报错；当历史 JSON/text 中存在
`/attachment/<projectID>/...` 这类嵌入式 namespace identity 时，不能盲改或复制
foreign attachment 来“修复”。Attachment bytes 的物理池在
`.opencorvus/r/b/a`，但语义 owner 来自记录里的 `project_id` / durable contract。

## 辅助域

| 表                                                            | 文件                         | 作用                                            |
| ------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| `decision_log`                                                | `decision-log/schema.ts`     | **全局共享上下文**，append-only，所有 agent R/W |
| `workbench_task_note`                                         | `workbench/workbench.sql.ts` | 面板 per-task 备注                              |
| `workbench_brief_snapshot`                                    | `workbench/workbench.sql.ts` | 面板简报快照                                    |
| `scratchpad`                                                  | `memory/scratchpad.sql.ts`   | 短期暂存                                        |
| `memory_file` · `memory_chunk` · `memory_embedding`           | `memory/memory.sql.ts`       | 长期语义记忆                                    |
| `task_plan`                                                   | `memory/task-plan.sql.ts`    | 任务计划记忆                                    |
| `quick_note`                                                  | `quicknote/quicknote.sql.ts` | quicknote                                       |
| `session_share`                                               | `share/share.sql.ts`         | 分享                                            |
| `protocol_event` · `protocol_inbox` · `protocol_stream_chunk` | `protocol/protocol.sql.ts`   | executor 协议事件                               |
| `task_queue` · `cron_job` · `event_job`                       | `scheduler/*.sql.ts`         | 调度器                                          |

Scheduler 表按 service 分层写入：`task_queue` 的唯一直接表写入文件是
`scheduler/task-queue-service.ts`；`cron_job` 的唯一直接表写入文件是
`scheduler/cron-service.ts`；`event_job` 的唯一直接表写入文件是
`scheduler/event-service.ts`。Tool、server route、engine 和 executor 层只能通过
scheduler service 创建、更新或删除 scheduler job / queue rows，不能直接写 scheduler 表。

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

## Build Input Evidence

Build 输入证据的 durable audit authority 是
`engine_artifact[kind="build_session_contract"].payload.input_evidence`。不要新增
平行的 `build_input_evidence` artifact，也不要从当前 task attachments、ambient
`Instance.project.id` 或 board/compaction 投影重新计算已创建 Build session 的输入
owner。

`input_evidence` 不是通用 Build 启动 gate。Fresh Build 可以只携带
`BuildEvidencePack` 进入 `BuildAgent.run`；真实 byte/project 校验发生在
AttachmentStore read/stage、SessionPrompt byte materialization 和明确的 storage
API 边界。只有调用方已经持有显式 manifest 时，`build_session_contract` 才写入
`input_evidence`；否则该字段为 `null`。

当前 contract 记录：

- manifest `version`、`project_id`、`task_id`、`goal_id?`、`goal_run_id?`、
  `session_id?`
- 每个 input entry 的 `role`、`project_id`、`sha`、`mime`、`size`、`filename?`
- provenance 字段如 `source_artifact_id?`、`source_decision_id?`、
  `source_task_id?`
- legacy byte address `legacy_attachment_url?`、future file ref
  `artifact_file_ref_id?`
- staged path `staged_rel_path?` 与 `sha_verified_at`

`filename` 是 display/provenance metadata，不是 byte identity。硬身份校验只能使用
project URL、`sha`、`mime`、`size` 和实际可读 bytes。

同一 Build session retry 在存在原 session
`build_session_contract.input_evidence` 时读取它，用于重建 staged references 和避免重新
附带 fresh model file parts。没有 `input_evidence` 的 legacy/通用 Build session 不因此
失败；它只跳过 manifest-bound staged-file repair。

后续长期文件 owner 是通用 `artifact_file_ref`，不是 attachment-only
`attachment_ref`。在该表实施前，GC 仍可对 legacy `/attachment/...` 嵌入引用做
harvest，但 Build contract-held evidence 已是显式 live-set 来源。

## 相关文档

- [01-agents.md](01-agents.md) — 哪些 agent 读写哪些表
- [03-control.md](03-control.md) — Trace/Bus 如何流向 overlay
