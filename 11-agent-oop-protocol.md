Agent 统一架构实施规范

1. 目标
建立全局统一的 agent 抽象层，满足以下约束：

统一身份、能力声明、system prompt 管理、输入输出协议、通信白名单、审计邮箱。
所有 workflow stage agents 必须继承统一抽象。
任何新增 agent 若不符合该抽象，不允许进入主干。
不改变现有 EngineService、Decision Log、workflow_state、SessionPrompt、AgentRuntime 的真值源地位。
不引入 fallback、兼容层、双源设计、中心化消息总线、硬编码状态机。
2. 范围
2.1 第一阶段强制纳管的 agent
orchestrator
requirements
architect
planner
design-analyst
intent-analysis
delivery
2.2 第二阶段适配的 agent
build
general
explore
title
compaction
summary
2.3 非目标
不在第一阶段改写整个 session prompt 子系统。
不把 build 快路径删除或伪装成 workflow stage。
不新增中心化 broker。
不把邮箱设计成异步队列系统。
3. 核心原则
OOP 只用于统一抽象与协议边界，不用于制造层层空继承。
Orchestrator 是唯一决策者，负责决定何时调用哪个 stage agent。
Sub-agent 是 agent，不是随手可调的工具函数。
通信必须显式、可审计、可校验。
Prompt 必须单源管理。
状态只用于观测和审计，不允许成为硬编码流程分支的驱动器。
LLM 负责决策，基础设施只做校验、装配、审计、持久化。
4. 抽象层次
4.1 AgentBase
所有 agent 的顶层抽象类。

职责：

提供统一身份信息
提供统一 contract
提供统一 prompt 解析入口
提供统一 inbox 和 outbox 记录入口
提供统一 receive 和 dispatch 行为
提供统一白名单校验
提供统一输入输出 schema 校验
提供统一审计事件写入
统一属性：

agentId
displayName
description
kind
contract
promptDescriptor
inbox
outbox
统一接口：

receive
dispatch
canReceiveFrom
canSendTo
resolveSystemPrompt
execute
summarizeInput
summarizeOutput
说明：

receive 和 dispatch 是最终对外协议入口。
execute 是子类实现的核心逻辑。
任何 agent 不允许直接访问别的 agent 的 execute、inbox、outbox。
任何外部代码不允许绕过 receive 直接操作 agent 内部逻辑。
4.2 StageAgent
用于 workflow stage agents 的抽象子类。

适用对象：

requirements
architect
planner
design-analyst
intent-analysis
delivery
orchestrator
职责：

统一 AgentRuntime 调用骨架
统一 model 解析
统一 tools 过滤与 toolGuard
统一 structured output 收口
统一 skills 注入
StageAgent 的 execute 过程固定为：

校验输入 schema
解析 model
解析 system prompt
构造运行上下文
组装 tools
调用 AgentRuntime
收集 structured output
校验输出 schema
写出 outbox 审计记录
返回结果
4.3 SessionAgent
用于 session/prompt family 的抽象子类。

适用对象：

build
general
explore
title
compaction
summary
职责：

统一 SessionPrompt.prompt 或等价 session 交互骨架
保留当前权限、session、message part 语义
不要求第一阶段与 StageAgent 完全同构
说明：

SessionAgent 也继承 AgentBase，但实现路径不同。
这样满足统一 OOP 边界，同时不破坏现有 session 子系统。
5. 能力契约
定义 AgentContract，作为每个 agent 的单一能力真值源。

必填字段：

agentId
displayName
description
inputSchema
outputSchema
toolFamilies
receiveWhitelist
sendWhitelist
promptMode
promptFile
configKey
editableInPanel
说明：

inputSchema 和 outputSchema 是唯一协议边界。
不允许在 contract 之外再定义一份平行输入输出契约。
receiveWhitelist 和 sendWhitelist 是通信边界。
promptMode 只允许两种：
static-core
dynamic-context
6. Prompt 设计
这是必须严格按现状设计的部分，不能幻想所有 agent 都只有纯 txt prompt。

6.1 统一规则
每个 agent 都必须通过抽象类接口 resolveSystemPrompt 获取 system prompt。
所有可编辑的静态 prompt 都必须来自 txt 文件。
配置面板只编辑 txt 对应的静态核心内容，不直接编辑运行时上下文拼接代码。
Prompt 的唯一来源顺序为：
config.agent.<key>.prompt
默认 txt 文件
stage skills 追加内容
6.2 两种 prompt 模式
static-core
适用于：

requirements
architect
planner
design-analyst
intent-analysis
delivery
规则：

默认 prompt 存在 txt 文件中
panel 可视化编辑
保存后写入 config override
运行时由抽象类统一解析
dynamic-context
适用于：

orchestrator
规则：

静态核心说明可以放 txt
运行时上下文必须继续由代码拼装
例如 task 状态、workflow_state、decision log、trigger 描述仍由代码注入
panel 只允许编辑静态前缀，不允许覆盖动态上下文构造逻辑
这点和现状完全一致，见 agent.ts:255-257, agent.ts:622, prompt-catalog.ts:7-15。

1. 通信协议
7.1 总原则
禁止 EventBus
禁止 pub/sub
禁止 message broker
禁止中心化基础设施转发
允许 Orchestrator 作为中心决策 agent
不允许 agent 自由形成不受控的网状自治系统
7.2 为什么这样设计
仓库原则已经规定 Orchestrator 是唯一决策者。
如果把“禁止中心化通信机制”理解成“禁止 Orchestrator 作为中枢”，那会直接推翻现有架构，见 01-agents.md:8-12, 99-principles.md:6-18。

因此，这里的正确解释是：

禁止中心化通信基础设施
不禁止中心化决策 agent
7.3 V1 拓扑
V1 只允许星型拓扑：

system_entry -> orchestrator
orchestrator <-> requirements
orchestrator <-> architect
orchestrator <-> planner
orchestrator <-> design-analyst
orchestrator <-> intent-analysis
orchestrator <-> delivery
V1 禁止：

requirements 直接给 planner 发消息
architect 直接调 delivery
build/general/explore 直接进入 stage mesh
原因：

先保证单一决策边界
先保证协议落地
再考虑是否开放更细的直连链路
7.4 白名单
每个 agent 都维护：

receiveWhitelist
sendWhitelist
通信成立条件：

目标 agent 在发送方的 sendWhitelist 中
发送方在目标 agent 的 receiveWhitelist 中
任一不满足：

立即抛出 AgentProtocolError
禁止 fallback
禁止静默跳过
8. 邮箱模型
邮箱必须有，但不能设计成异步队列系统，否则会和现有同步执行骨架冲突。

8.1 正确定义
inbox 和 outbox 是协议审计容器，不是调度器。

用途：

记录接收到的消息
记录发送出去的消息
记录校验状态
记录执行结果
供 panel 和审计系统展示
不负责：

异步重试
自动重放
消费队列
任务调度
8.2 消息结构
MailboxMessage 必须包含：

id
traceId
fromAgentId
toAgentId
boxKind
payload
validationStatus
executionStatus
createdAt
updatedAt
error
8.3 状态定义
只允许观测性状态，不允许作为硬编码流程驱动：

received
validated
rejected
running
succeeded
failed
delivered
重要说明：

这些状态只用于审计和 UI 展示
不允许在代码里写成 if status == X then call Y 这种状态机
真正的下一步仍由 Orchestrator 的 LLM 决策
8.4 需求分析师示例
inbox 记录用户请求或 orchestrator 投递的需求分析任务
outbox 记录 requirements 结果，包括：
requirements 列表
goals
traceability
decisions
goalMetricSpecs
globalMetricSpecs
如果你一定要有“后续行动计划”，那它应该出现在结构化输出里，而不是变成独立流程控制状态。

1. 执行控制
9.1 决策层
只有 Orchestrator 负责下一步调用谁
Stage agents 只负责完成自己的智能任务
Stage agents 内部不允许再发起流程编排
9.2 基础设施层
基础设施只允许做这些事：

schema 校验
prompt 解析
tools 过滤
whitelist 校验
审计记录
调用 runtime
结果持久化
基础设施不允许做这些事：

自动下一步路由
关键词匹配决定调用哪个 agent
固定 pipeline 编排
失败自动回退到别的 agent
按状态机硬编码推进流程
9.3 LLM 决策与规则边界
“执行流程必须通过 LLM 智能决策来控制” 不能被理解成基础设施完全无约束。
正确含义是：

业务路由和下一步选择由 LLM 决策
协议校验、安全边界、白名单、输入输出 schema、prompt 解析由基础设施强制执行
10. 注册表
定义 AgentRegistry，作为单一注册入口。

职责：

注册所有 AgentContract
注册所有 agent 类
提供 capability snapshot
提供 panel 展示数据
提供 receive 与 dispatch 的目标查找
提供白名单校验
不负责：

消息转发队列
异步重试
broker 行为
注意：

Registry 是元数据与定位中心，不是通信总线。
真正的调用仍然是显式的 agent.receive 或 dispatch。
11. 数据持久化
11.1 不采用 mailbox queue 表设计
不使用“把 inbox/outbox 设计成待消费 FIFO 队列”的方案。
原因是它与当前同步执行模型不一致，也会引入崩溃恢复、重复消费、幂等等额外复杂度。

11.2 采用审计表设计
新增两类持久化对象：

agent_message_audit
agent_run_audit
agent_message_audit 记录收件箱和发件箱快照。
agent_run_audit 记录单次 agent 执行。

11.3 建议字段
agent_message_audit：

id
trace_id
agent_id
box_kind
from_agent_id
to_agent_id
payload_json
validation_status
execution_status
error
time_created
time_updated
agent_run_audit：

id
trace_id
task_id
session_id
agent_id
trigger_kind
input_summary
output_summary
tool_call_count
status
error
time_started
time_completed
12. 文件布局
建议新增以下目录：

packages/opencorvus/src/agent/core/agent-base.ts
packages/opencorvus/src/agent/core/stage-agent.ts
packages/opencorvus/src/agent/core/session-agent.ts
packages/opencorvus/src/agent/core/contract.ts
packages/opencorvus/src/agent/core/registry.ts
packages/opencorvus/src/agent/core/mailbox.ts
packages/opencorvus/src/agent/core/prompt-resolver.ts
packages/opencorvus/src/agent/core/audit.ts
保留原有功能目录：

requirements
architect
planner
design-analyst
intent-analysis
delivery
orchestrator
迁移方式：

每个 agent 目录保留自己的输入输出类型和业务逻辑
只把共性骨架抽到 core
13. 落地顺序
第一阶段
引入 AgentBase、StageAgent、AgentContract、AgentRegistry
抽 requirements、architect、intent-analysis 三个最标准的 stage agent
保持外部行为不变
通过适配器让 orchestrator tools 继续工作
第二阶段
抽 planner、design-analyst、delivery
统一 prompt 解析
接入 panel prompt catalog
第三阶段
改造 orchestrator 为 StageAgent 子类
但保留 dynamic-context prompt 机制
保留现有 tool-based 调度模式
第四阶段
为 build、general、explore 建立 SessionAgent 抽象
不强行并入 stage mesh
只统一身份、prompt、contract、审计接口
第五阶段
接入审计表和 panel mailbox 可视化
展示 inbox/outbox 历史
展示白名单和 capability snapshot
14. 禁止项
禁止任何 agent 直接调用另一个 agent 的 execute
禁止任何 agent 读取另一个 agent 的 inbox 或 outbox
禁止消息总线
禁止关键词匹配路由
禁止固定 pipeline
禁止 fallback prompt
禁止一份 prompt 两个来源
禁止一份 contract 两个 schema 来源
禁止把邮箱当任务队列
禁止把 UI 状态字段当流程状态机
15. 对“需要 OOP 模式吗”的最终回答
需要。
但需要的是“严格的统一抽象 OOP”，不是“所有 agent 全部类化、彼此点对点乱连”的伪 OOP。

更准确地说：

需要 OOP 来统一 agent 抽象、prompt 管理、协议边界、白名单和审计邮箱。
不需要用 OOP 去推翻当前 Orchestrator 单一决策架构。
不应该把“禁止中心化通信机制”误解成“禁止 Orchestrator 作为中心决策 agent”。
真正可实施的方案是：
OOP 抽象统一
Orchestrator 决策统一
通信协议显式化
邮箱审计化
Prompt 单源化
Session 与 Stage 分层治理
