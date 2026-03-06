# OpenCorvus Headless V1 实施计划

## Summary

- 目标：把 `packages/opencorvus` 重建为一个 `headless + API + Slack` 的 coding orchestrator，V1 只支持 `opencode` 作为执行器，不保留现有 TUI/GUI/overlay/bot-loop 兼容。
- 备份策略：先对**整个仓库当前状态**做一次完整 git 备份，再开始重建；新主线允许破坏式重构，旧实现只存在于备份分支和 tag。
- 设计原则：`opencorvus` 只保留一个产品目录；产品协议以 `task / plan_version / run / interaction_request / delivery / evaluation` 为中心，`session/message` 降为 `opencode executor` 的内部实现细节。

Status companion:

- Current implementation and drift check live in `specs/headless-v1-status.md`.
- `plan.md` remains the target architecture and scope document.

## Implementation Changes

### 1. 先做备份与切线

- 在当前工作区直接创建备份分支：`backup/opencorvus-pre-headless-20260306`。
- 在该分支提交**整个仓库当前状态**，包含当前已修改和未跟踪文件，提交信息固定为 `backup: pre-headless-opencorvus rewrite snapshot`。
- 在该提交上打注释 tag：`backup-opencorvus-pre-headless-20260306`。
- 从该备份点切出实施分支：`feature/opencorvus-headless-v1`。
- 后续所有重构都只发生在 `feature/opencorvus-headless-v1`；备份分支和 tag 不再修改。

### 2. 重置 `packages/opencorvus` 的产品边界

- 把 `packages/opencorvus` 定义为新产品主目录，只保留以下主模块：`app`、`kernel`、`orchestrator`、`executor`、`evaluator`、`channel`。
- 现有 `TUI / GUI / overlay / desktop automation / bot task_report loop` 不迁入 V1 主线；实现时直接从主入口和构建链中剥离，视为备份分支遗留能力。
- `packages/bot` 不再作为 V1 主实现；Slack 入口重建到 `packages/opencorvus/src/channel/slack`。`packages/bot` 只作为过渡期冻结代码，不继续演进。
- `opencorvus` 新 CLI 只保留 3 个入口：
  - `opencorvus serve`：启动 HTTP API + SSE
  - `opencorvus worker`：启动调度与执行循环
  - `opencorvus slack`：启动 Slack gateway
- `ACP`、旧 `run`、旧 TUI 命令不进入 V1 主链路；后续如需恢复，再作为附加适配层回接。

### 3. 建立新的 orchestrator 内核

- 新增持久化对象并作为唯一真相源：
  - `task`
  - `plan_version`
  - `goal`
  - `run`
  - `interaction_request`
  - `artifact`
  - `delivery`
  - `evaluation`
  - `progress_snapshot`
  - `channel_binding`
- 新增 Drizzle schema，表名固定使用 snake_case：
  - `task`
  - `plan_version`
  - `goal`
  - `run`
  - `interaction_request`
  - `artifact`
  - `delivery`
  - `evaluation`
  - `progress_snapshot`
  - `channel_binding`
- 强制状态机：
  - `task`: `queued -> planning -> running -> evaluating -> completed|failed|blocked|cancelled`
  - `run`: `queued -> accepted -> running -> blocked|completed|failed|aborted`
  - `interaction_request`: `pending -> answered|rejected|expired`
- 强制不变量：
  - 一个 task 同时最多一个 active run
  - 一个 task 同时最多一个 active `plan_version`
  - `completed` 只能在全部 blocking goals 通过后进入
  - `blocked` 必须绑定 `blocking_reason` 和 `interaction_request`
- 内部服务拆成 5 个明确组件：
  - `TaskService`：创建任务、绑定来源、初始化预算
  - `PlannerService`：生成 `plan_version` 和 `goal`
  - `RunService`：派发、恢复、取消 run
  - `DeliveryService`：把 executor 原始输出归一化成 `artifact/delivery`
  - `EvaluationService`：执行 checks、判定 pass/fail/replan
- V1 planner 不是独立 agent runtime；它是 orchestrator 内部服务，复用现有 provider/model 基础设施生成结构化 plan 和 goals。
- V1 failure classification 固定为：
  - `transient`
  - `environment`
  - `input`
  - `permission`
  - `evaluation`
  - `strategy`
  - `budget`
  - `unknown`
- V1 retry policy 固定为：
  - `transient`：同 plan 内重试
  - `input`/`permission`：转 `blocked`
  - `strategy`：新建 `plan_version`
  - `evaluation`：先同 plan 重试一次，再触发 replan
  - `budget`：直接失败
- V1 budget 维度固定为：
  - `max_runs_per_task`
  - `max_replans_per_task`
  - `max_evaluations_per_task`
  - `max_wall_time_ms`

### 4. 公开 API 与事件协议

- 对外 HTTP API 固定为：
  - `POST /task`
  - `GET /task/:id`
  - `GET /task/:id/progress`
  - `GET /task/:id/events`
  - `GET /task/:id/runs`
  - `GET /run/:id`
  - `GET /run/:id/delivery`
  - `GET /run/:id/artifacts`
  - `GET /run/:id/evaluations`
  - `GET /task/:id/interactions`
  - `POST /interaction/:id/reply`
  - `POST /interaction/:id/reject`
  - `POST /task/:id/cancel`
- `POST /task` 请求体固定包含：
  - `project`
  - `source`
  - `title`
  - `request`
  - `priority`
  - `channel_binding?`
  - `budget?`
- `POST /task` 必须在 2 秒内返回 `task_id`，不等待执行结束。
- `GET /task/:id/events` 使用 SSE，事件最小集合固定为：
  - `task.created`
  - `task.status`
  - `task.blocked`
  - `plan.created`
  - `plan.activated`
  - `run.created`
  - `run.started`
  - `run.status`
  - `run.blocked`
  - `run.completed`
  - `run.failed`
  - `interaction.requested`
  - `interaction.resolved`
  - `delivery.ready`
  - `evaluation.completed`
  - `goal.passed`
  - `goal.failed`
  - `task.completed`
  - `task.failed`
- 每个事件固定带：
  - `event_id`
  - `task_id`
  - `run_id?`
  - `type`
  - `timestamp`
  - `summary`
  - `payload`

### 5. 实现 `opencode` 执行器

- V1 只实现一个 executor：`opencode_executor`。
- 适配器契约固定为：
  - `submit`
  - `resume`
  - `status`
  - `abort`
  - `events`
  - `delivery`
  - `capabilities`
- `opencode_executor` 的内部映射固定为：
  - `run.executor_ref.session_id` <- opencode `session.id`
  - `run.executor_ref.task_id` <- `session.prompt_async` 返回的 queue `taskID`
- 执行流固定为：
  - 创建 workspace
  - 创建或复用 opencode session
  - 注入 planner 产出的 plan 和 constraints
  - 用 `prompt_async` 启动
  - 订阅 SSE 和状态接口
  - 遇到 permission/question 时转成 `interaction_request`
  - run 完成后读取 session messages、diff、file status、trace，构造 `delivery`
- `task.report` 不再作为系统协议；如保留，仅用于兼容备份分支，不进入新主线。

### 6. 实现 evaluator 与 delivery normalizer

- Delivery normalizer 固定从这些来源构造产物：
  - session assistant message
  - tool outputs
  - `session.diff`
  - `file.status`
  - `file.read`
  - HTML trace
- V1 `artifact.kind` 固定为：
  - `patch`
  - `changed_file`
  - `log`
  - `report`
  - `image`
  - `diff`
  - `html_trace`
  - `link`
- V1 evaluator 顺序固定为：
  1. `build`
  2. `test`
  3. `lint`
  4. `verify_cmd`
  5. `artifact` checks
  6. `visual` checks
  7. `judge` fallback
- Web visual evaluation 在 V1 进入主设计，但只支持网页：
  - Playwright 截图
  - viewport 列表
  - baseline 或规则比对
  - 结果写入 `artifact` 和 `evaluation`
- `evaluation` 必须引用证据，不允许只写结论文本。

### 7. 实现 Slack 入口并入 `opencorvus`

- 新 Slack 实现在 `packages/opencorvus/src/channel/slack`，不再依赖 `packages/bot` 的 loop 协议。
- Slack 交互固定规则：
  - 新线程首条消息创建 `task`
  - 同线程后续消息若存在 pending `interaction_request`，则作为该 interaction 的回复
  - 同线程后续消息若 task 正在运行且无 pending interaction，则记录为 operator note，并触发 run resume
  - orchestrator 只在状态转移点推送摘要，不镜像所有 message deltas
- Slack 展示最小内容固定为：
  - task 创建确认
  - blocked 问题或审批
  - run 失败摘要
  - evaluation 失败摘要
  - 完成摘要 + artifacts
- `channel_binding` 以 `task_id + platform + channel + thread` 为主键语义。

### 8. SDK、生成物与切换

- 新 API 稳定后，重新生成 OpenAPI 和 `packages/sdk/js`。
- 根脚本调整为新的 headless 命令集，旧 `dev:bot` 从主文档移除。
- 文档更新只覆盖 V1 新主线：
  - headless API
  - worker
  - Slack gateway
- 旧 GUI/TUI/overlay 文档不迁移到新主线说明，只保留在备份分支。

## Public Interfaces

- 核心类型：
  - `Task`
  - `PlanVersion`
  - `Goal`
  - `Run`
  - `InteractionRequest`
  - `Artifact`
  - `Delivery`
  - `Evaluation`
  - `ProgressSnapshot`
  - `ChannelBinding`
- 核心服务接口：
  - `PlannerService.plan(task) -> plan_version + goals`
  - `RunService.dispatch(task_id)`
  - `DeliveryService.normalize(run_id)`
  - `EvaluationService.evaluate(run_id, delivery_id)`
  - `ChannelService.publish(event)`
- 执行器接口：
  - `ExecutorAdapter.submit/resume/status/abort/events/delivery/capabilities`

## Test Plan

- 单元测试：
  - task/run/interaction 状态机合法与非法转移
  - failure classification 与 retry policy
  - delivery normalizer 对 messages/diff/files 的归一化
  - evaluator 对 `build/test/lint/verify_cmd` 结果的持久化
- 集成测试：
  - `POST /task` 立即返回 `task_id`
  - worker 能从 queued task 走到 run completed/evaluating/completed
  - permission/question 能转成 `interaction_request`，回复后恢复 run
  - evaluation fail 会触发 retry 或 replan
  - cancel 会终止 active run 并结束 task
- Slack 端到端：
  - 新线程创建 task
  - blocked question 能在同线程回答并恢复
  - 完成时能返回摘要和 artifacts
  - run fail 和 evaluation fail 的线程消息正确
- 回归验收：
  - V1 不再依赖 `task_report`
  - V1 不再依赖 overlay/TUI 启动路径
  - OpenAPI 和 JS SDK 可生成并可调用新接口

## Assumptions

- 备份采用 `整个仓库快照 + 分支 + tag`，因为当前工作区已有跨包未提交改动。
- 新主线允许破坏式重建；旧 `opencorvus`、旧 `bot`、旧 GUI/TUI 能力只在备份分支保留。
- V1 只实现 `opencode` 执行器；`Codex/Claude/OpenClaw` 只保留 adapter contract，不在第一阶段落地。
- V1 用户入口固定为 `HTTP API + Slack`，Telegram 和其他通道延后。
- Slack 能力并入 `packages/opencorvus`，不继续把 `packages/bot` 当主实现。
- `packages/opencorvus` 仍是唯一产品目录；即使重构，不再拆出新的同级产品包。
