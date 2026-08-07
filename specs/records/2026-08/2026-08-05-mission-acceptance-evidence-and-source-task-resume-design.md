# Mission 验收证据与源 Task Resume 系统设计

Status: 根因调查、设计、产品实现、正向验证与二次复审完成。
Date: 2026-08-05

## Recall

### 用户原始要求

- Mission 要负责验收 Task。
- Mission 要根据 report 和 Artifact 深挖 Task 未完成的部分。
- Mission 应在合理范围内有限度地派发新 Task，并能通过发送消息重启原 Task。
- 当前原 Task 无法 resume 是系统性缺陷，需要深入调查影响面、设计方案并复审。

### 验收指标

1. Mission 不能把 Task 的 `completed`、final summary、Artifact 名称或 reviewer verdict 当成 Mission acceptance；它必须完整读取可归属的 canonical Artifact 内容并逐项对照 Mission acceptance。
2. 缺口仍属于原 Task 的固定 Expert Squad、可变资源和 evidence lifecycle 时，Mission 必须向同一 Task 发送一条真实可见、带精确证据引用的修复消息，并恢复同一 Task identity 的执行。
3. 普通终态对话消息仍只产生对话回复，不得隐式擦除 terminal truth；Mission 的验收修复必须是独立、显式、可审计的语义动作。
4. Resume 保留原 Task ID（Identifier，标识符）、root Session、固定 `promptProfile`、selected workflow、历史 dispatch lineage、历史 Completion Decision 和 Task Artifact catalog；新的完成产生新的 terminal occurrence 与 Completion Decision。
5. Mission 只能操作同一 Mission lineage 中的源 Task，并必须绑定它实际审查的 exact terminal lifecycle reference；并发变化返回 typed conflict，不能覆盖更新后的事实。
6. 用户或 operator 明确取消的 Task 不由 Mission 自动恢复。Mission 必须报告 cancellation authority blocker，由 operator 决定 Retry/Replan。
7. 新 Task 只用于原 Mission contract 已证明的独立 accepted closure、不同固定 Squad、真实跨 Task evidence/authority 边界或用户明确要求的独立 lifecycle；修复、补证、复测和复审本身不是新 Task。
8. 不增加 Host workflow gate、retry counter、状态机、关键词 verdict 路由、fallback、兼容入口、隐藏消息、合成消息或第二 acceptance source。

### 硬约束

- Large Language Model（LLM，大语言模型）继续自然判断 acceptance gap、修复负责人和是否存在真正的 Task closure boundary；Host 只验证 identity、provenance、完整内容和并发一致性。
- 普通 `send_task_message` 的 terminal conversation-only 语义必须保留，不能重新引入 2026-08-04 的 stale operator wake 自动重开事故。
- 所有 LLM 调用继续流式执行。
- Database（DB，数据库）结构不增加 migration 或兼容 reader；若实现确需结构变化，只修改当前完整 Data Definition Language（DDL，数据定义语言）并使用 fresh database 验证。
- 非 User Interface（UI，用户界面）行为使用正向契约测试；不新增、修改或运行 UI 自动化测试。
- 不覆盖当前工作区的 Expert Squad、Artifact、Overlay 和 spec 在途改动；不创建 worktree。

### 已读取资料

- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/records/2026-08/2026-08-01-dispatch-occurrence-process-recovery-root-repair.md`
- `specs/records/2026-08/2026-08-02-same-task-repair-first-orchestration.md`
- `specs/records/2026-08/2026-08-02-mission-task-delivery-closure-granularity.md`
- `specs/records/2026-08/2026-08-03-task-activity-and-mission-completion-semantics.md`
- `specs/records/2026-08/2026-08-04-task-resume-occurrence-and-overlay-recovery.md`
- `specs/records/2026-08/2026-08-04-terminal-task-stale-operator-wake-reopen-incident.md`
- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`
- `specs/records/2026-08/2026-08-05-contract-graph-and-goal-fact-projection-system-repair-plan.md`
- `packages/opencorvus/src/prompt/core/mission-core.txt`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/engine/{queue,task-intent-open,queued-task-ingress,terminal-task-conversation-runner,terminal-lifecycle-reference,completion-decision}.ts`
- `packages/opencorvus/src/orchestrator/{agent,tools,terminal-conversation-authority}.ts`
- `packages/plugin/src/artifact-catalog.ts`

外部检索仅用 Temporal 官方文档复核 durable execution 的通用 message/continuation 区分；它不构成本项目设计权威。最终设计由 OpenCorvus 当前代码、durable event、Artifact 和历史事故约束决定。

### 全仓搜索结果

- Mission 唯一 Task mutation surface 是 `panel`；Mission 当前拥有 `create_task`、`query_task`、`query_task_artifacts` 和 `send_task_message`，没有 Retry/Replan 或专用 resume action。
- `panel.query_task` 明确只返回 bounded status summary，不返回 Session graph、Artifact 内容或完整 completion evidence。
- `panel.query_task_artifacts` 返回完整 cursor membership 和 exact locator，但 `ArtifactCatalogEntry` 只有 metadata；没有 payload/body。
- `artifact_read` 只能读取“当前 Task”的 Artifact。Mission Session 不是源 Task Session，因此不能用它读取 Mission child Task 的报告正文。
- `requireMissionArtifactSourceAuthority` 已能严格证明 source Task 属于同一 project、同一 Mission lineage 且已经 terminal，并同时接受 completed 与 failed source；它可以成为 Mission read/resume 的单一 provenance owner。
- `send_task_message` 最终调用 `EngineService.handleTaskMessage`，为 terminal Task 持久化普通 message ingress；`dispatchTaskLoop` 随后调用 `deliverTerminalTaskIngress`。
- `deliverTerminalTaskIngress` 创建 `TerminalConversationAuthority`；Orchestrator prompt 与 tool wrapper 明确要求 conversation-only、禁止 dispatch 和 lifecycle mutation。
- 真正重开 terminal Task 的唯一实现是 operator-only Retry/Replan：`openTaskForOperatorIntentInTransaction` + `persistQueuedTaskIntentInTransaction`。
- Mission core 第 257–260 行附近却宣称向 inactive unaccepted Task 发送 follow-up 会让 Task 回到 running。该陈述与 executable tool contract 相反。
- commit `44bd55ffe0` 正确修复了 ordinary message 自动重开 terminal Task 的事故；commit `6e74b57de6` 后来只改 Mission prompt，错误假设现有 message path 能 resume，没有补 executable authority。
- `mission.child_task_result` wake 已包含 exact `terminalLifecycleReference`，completed Task 还包含 exact `completionDecisionArtifactID`；缺失的是 Mission 完整读取 Artifact 与基于该 occurrence 发起验收修复的动作。

### 独立 Agent 反馈

用户没有要求多 Agent 或并行审计；依据当前协作约束未启动子 Agent。本记录的“复审”由主 Agent在完成初稿后，从事故回归、权限、并发、证据完整性和禁止 gate 五个方向重新审查。

## 一、因果链

### 1. 可观察现象

Mission 收到 child Task terminal wake 后，可以看到 Task status、summary、一个 Completion Decision ID 和 Artifact 目录项。若它发现交付不完整，当前 prompt 要求它给原 Task 发送 follow-up；实际调用只得到一次 terminal conversation answer，Task 仍保持 terminal，不能继续 Build、Test 或 Reviewer lineage。

### 2. 直接触发点

`panel.send_task_message` 没有执行 authority。terminal Task 的消息被 `deliverTerminalTaskIngress` 强制投影为 conversation-only Turn，所有 dispatch 和 lifecycle tools 都被拒绝。它不能、也不应该隐式 resume。

### 3. 深层设计原因

控制面把两个不同语义错误地挤在一个工具名下面，但在 executable contract 中只实现了其中一个：

1. 向 terminal Task 继续对话，保留 terminal truth；
2. Mission 基于验收证据，向同一 Task 发出可执行修复委托并打开新的 execution occurrence。

2026-08-04 的修复正确保留了第一个语义，却没有为第二个语义建立显式 authority。之后 Mission prompt 直接声称普通消息具备第二种能力，形成 prompt-over-runtime contract drift。

同时，Mission 的 Artifact 工具只实现了 discovery，没有实现 read。Mission 因此无法完成“完整读取 report/Artifact → 对照 acceptance → 形成精确 gap”这条链，只能信任 summary、label、type 或其他 Agent verdict。这是 acceptance authority 与 evidence capability 不对称。

### 4. 为什么已有路径没有根治

- operator Retry/Replan 能重开 Task，但它表达的是 operator lifecycle intent，不是 Mission 的 evidence-backed acceptance repair；把它开放给 Mission 会丢失真实 actor、精确 evidence 与可见修复消息语义。
- ordinary terminal conversation runner 刻意禁止执行；放宽它会重新制造 stale/pre-completion 普通消息自动重开的已确认事故。
- 创建新 correction Task 能继续工作，但会把原 Task 的 mutable-resource owner、固定 Squad workflow、Artifact catalog、Session lineage 和历史 completion occurrence 分裂到另一个 lifecycle，扩大重复修改与并发冲突。
- `query_task_artifacts` 的完整 cursor 只证明目录 membership 完整，不证明 Mission 阅读了正文，更不证明某个 acceptance claim 成立。

## 二、系统性影响面

| Surface | 当前影响 | 设计要求 |
| --- | --- | --- |
| Mission acceptance | 可能把 status、summary、label 或整体 verdict 当作完成证据，也可能因看不到正文而错误拒绝 | 先读取 exact Completion Decision，再完整读取其 deliverable/evidence locators 与相关 canonical report/review Artifacts |
| completed Task | Mission 发现缺口后只能聊天，不能执行修复 | 显式 resume 同一 Task，旧 Completion Decision 保留为历史，新 occurrence 重新完成 |
| failed Task | Artifact 可被后续 Task import，但源 Task 无 Mission resume authority | 当缺口仍在原 Task authority 内时 resume 原 Task；真正跨 closure 才创建新 Task |
| cancelled Task | 取消可能来自用户、Mission、删除或 archive authority | 不允许 Mission 自动覆盖 cancellation；返回明确 operator-authority blocker |
| ordinary follow-up | 历史上曾错误清除 terminal truth | 保持 conversation-only，并以 exact terminal lifecycle reference 结算消息 |
| queue/recovery | message、operator intent、coordination request 已有不同 ingress 与 recovery 语义 | 新增一种精确 Mission acceptance-resume ingress；不能复用普通 message 或猜测文本 |
| Task identity | 新 Task repair 会分裂 profile、workflow、worktree 与 evidence history | resume 保持 Task ID、root Session、profile、workflow binding 和原 lineage |
| reviewer freshness | 修复后旧 review 仍描述旧产品 revision | 原 Task Orchestrator继续受影响 reviewer 的既有 lineage，产生晚于修复的 fresh evidence |
| cross-Task handoff | failed/completed source 已可作为 terminal Artifact source | 保留现有 import；只有真正独立 downstream closure 使用 cross-Task import |
| Application Programming Interface（API，应用程序编程接口）与 Software Development Kit（SDK，软件开发工具包） | Panel schema、OpenAPI 与生成类型目前没有 read/resume contract | 更新 canonical schema 后重新生成，不手改生成物 |
| Mission durable state | `frontier.md` 可记 locator，但当前没有 complete-read 或 resume receipt | 记录 read locator、gap、resume receipt 与下一次需要复核的 terminal occurrence，不新增 Host workflow state |

影响不是 Base、Advanced 或某个 reviewer 的局部问题。任何 Mission-created Task、任何 Expert Squad、任何 completed/failed terminal occurrence，只要 Mission-level acceptance 比 Task 自己的 Completion Decision 更严格，都会进入这条断链。

## 三、单一根治方案

### A. 增加 Mission-owned exact Artifact read

在 `panel` 增加 Mission-only action：

```text
read_task_artifact(
  taskID,
  locator,
  byte_offset?,
  max_bytes?,
  delivery?
)
```

- 参数和返回值直接复用平台现有 `ArtifactReadInputSchema` 与 verified read result，不复制第二套 reader。
- 执行前调用 `requireMissionArtifactSourceAuthority`，只允许同 project、同 Mission lineage、terminal source Task。
- Engine Artifact、Task Artifact resource、digest、chunk 和 materialized-file 语义全部继续由 `readTaskArtifact` 单一实现拥有。
- Panel read result 使用与 `artifact_read` 相同的 verified byte-window metadata；`agent/artifact-read-facts.ts` 从当前 Mission physical Turn 的真实 panel tool parts 汇总 complete-read coverage，使后续 resume 的 `evidence_locators` 只能引用本 Turn 已完整读取的内容。
- Mission 必须按 byte range 完整覆盖正文；`catalog_complete=false`、provider error、metadata truncation、digest mismatch 或未完整读取都作为未知证据公开，不能被写成 accepted variance。
- 该 action 只提供事实，不接受、resume、dispatch 或创建 Task。

### B. 增加显式 `resume_task`，而不是重载普通消息

在 Mission `panel` capability 增加：

```text
resume_task(
  taskID,
  terminal_lifecycle_reference,
  text,
  evidence_locators
)
```

语义是“一次原子化的 Mission acceptance repair 委托”：

1. `taskID` 必须属于当前 Mission lineage。
2. `terminal_lifecycle_reference` 必须等于 Mission 已审查的 current completed/failed occurrence；不一致返回 typed occurrence conflict，要求 Mission重新 query/read。
3. `evidence_locators` 必须是该 Task 的 exact locators；Host 只验证 identity 与可读完整性，不解析 verdict 或决定修复路线。
4. `text` 作为真实可见的 Mission-authored Task-root 消息持久化，说明未满足的 Mission acceptance、对应 report/Artifact locator、实际观察与期望结果。Artifact body 不复制进消息。
5. 同一个 DB transaction 写入可见 message identity、Task queued projection、Mission acceptance-resume ingress、exact prior terminal reference 和 wake audit fact；任一写入失败则整个动作失败，不能出现“消息已显示但 Task 未 resume”或相反状态。
6. 事务成功后使用现有 root Session wake queue 启动同一 Task；返回 exact `task_id`、`message_id`、`wake_id`、prior terminal reference 和 `wake_status`。
7. 重复提交相同 tool-call identity 返回同一个 receipt；不同 tool call 针对已变化 occurrence 返回 typed conflict，不靠时间窗口或文本去重。

实现层把 `openTaskForOperatorIntentInTransaction` 抽象为 participant-aware continuation open primitive。它只负责清除当前 terminal projection、保留历史 event/Artifact、写入新的 queued projection；operator Retry/Replan 与 Mission acceptance resume 使用各自的真实 intent schema，不能 alias，也不能互相 fallback。

### C. 新 ingress 与 Orchestrator authority

`QueuedTaskIngressSchema` 增加显式 `mission_acceptance_resume`：

- exact Mission ID 与 Mission Session ID；
- visible Task-root message ID；
- reviewed terminal lifecycle reference；
- exact evidence locators；
- real panel tool call/message/part provenance；
- enqueue time 与 process evidence。

它进入普通 nonterminal Orchestrator execution Turn，不进入 `TerminalConversationAuthority`。Wake provenance 明确告诉 Orchestrator：这是 Mission 对上一 terminal occurrence 的 acceptance gap，不是 operator Retry/Replan，也不指定某个 worker或 verdict。Orchestrator 必须先读取当前 Task message与自身 Artifact catalog，再自然决定：

- 继续 exact Build/final-delivery owner 修复产品；
- 继续受影响 Test/Visual/Integrity lineage复审最新产品；
- 补齐缺失的 mandatory node evidence；
- 或在真实外部 authority blocker 下再次 terminal，并提供可核验解释。

Host 不根据 artifact type、finding severity、message keyword 或 terminal status 自动选择 Agent。

### D. Mission reconciliation 改为 evidence-first

`mission-core.txt` 的每次 terminal reconciliation 固定为以下事实顺序，但不变成 Host workflow：

1. `query_task` 取得 exact Task 与 current terminal summary。
2. `query_task_artifacts` 遍历全部 cursor，确认 catalog completeness。
3. completed Task 先读取 wake 指向的 exact Completion Decision，得到本 occurrence 声明的 deliverable/evidence locators。
4. 完整读取这些 locators，并按 stage acceptance 需要读取 canonical implementation/test/review reports；failed Task 从 current/historical catalog 中读取已产生的 canonical evidence与 failure facts。
5. 按每条 Mission `Done when` 写出 `accepted | gap | unknown` 的自然语言判断和 exact locator；这只是 Mission state 记录，不新增产品状态枚举。
6. accepted 时解锁真正 dependent consumer；gap 仍在原 Task authority 内时，completed/failed source 使用 `resume_task`；running source 才使用普通 `send_task_message`。
7. cancelled source、不同 Squad、外部 authority 或真正独立 closure 按现有边界处理。新 Task request 必须引用已接受的 predecessor Artifact imports，不能成为修复原 Task 的默认出口。

“有限度”由真实 closure boundary 与验收证据决定，不由 Host task quota、重试次数、固定 phase count 或 gate 决定。Mission 不为同一 gap 重复发送消息：它先读取 `tasks.md`、当前 Task activity 与上一条 resume receipt，自然判断是否已有负责执行的 occurrence。

### E. Completion 与历史事实

- 旧 terminal event 和旧 Completion Decision 永久保留；resume 不修改它们。
- current acceptance 只读取 resume 后最新 terminal occurrence 的 exact Completion Decision。
- Mission child-result wake继续携带 exact terminal reference与对应 Completion Decision ID；同一 Task 因 resume 再次 terminal 时产生新的 wake。
- Artifact catalog 的 current/historical revision 语义保持单一；Mission 可以比较修复前后 reports/reviews，但最终 acceptance 引用最新适用 evidence。
- Goal/Delivery Slice acceptance 仍只由 Task Completion Decision 明确记录；Mission-level acceptance 留在 Mission contract/state，不反向合成 Goal lifecycle。

## 四、实施调用点

| 文件/模块 | 修改责任 |
| --- | --- |
| `panel/capability.ts` | 增加 Mission-only `read_task_artifact` 与 `resume_task` schemas；普通 actor action set 不扩权 |
| `tool/panel.ts` | 复用 Mission lineage authority、verified Artifact reader 和 typed resume service；返回 bounded structured receipts |
| `agent/artifact-read-facts.ts` | 识别 Mission panel read 的标准 byte-window facts，使完整读取证据继续由一个 coverage 实现判断 |
| `task-api/index.ts` | 建立原子 Mission resume service与 exact read wrapper；保留普通 message和operator intent入口 |
| `engine/task-intent-open.ts` | 抽象 participant-aware continuation open primitive；operator与Mission保持不同 typed intents |
| `engine/queued-task-ingress.ts` | 增加 `mission_acceptance_resume` provenance，更新 stable serialization/validation |
| `engine/queue.ts` | 让新 ingress 走同 Task nonterminal execution；普通 terminal message继续走 conversation runner |
| `orchestrator/event.ts`、`orchestrator/agent.ts` | 投影真实 Mission resume message、prior terminal occurrence与evidence refs，不加入路线指令 |
| `orchestrator/tools.ts` | 保持 terminal conversation refusal；resume 后按普通 active Task tool authority执行 |
| `prompt/core/mission-core.txt` | 删除“send_task_message 会重开”的错误陈述，加入 complete-read acceptance与显式 resume选择 |
| `mission state` guidance | 在现有四文件中记录 locator、gap和receipt；不增加第五文件或 Host state |
| API/SDK/docs | 重新生成 action schemas/types并同步英中参考，不保留旧 schema兼容分支 |
| architecture | 更新 Agents、Control、Panel 与 Agent facts/Turns 的 participant、evidence、occurrence和conversation边界 |

若实现触及 current architecture，必须在同一提交中使 `01-agents.md`、`03-control.md`、`07-panel.md` 与 `15-agent-facts-and-turns.md` 保持同一语义。

## 五、正向验证矩阵

| Contract | 正向结果 |
| --- | --- |
| Mission Artifact read | 同 Mission terminal child Task 的 exact locator按完整 byte ranges返回与 stored SHA-256（Secure Hash Algorithm 256-bit，安全哈希算法）一致的正文 |
| Completed source resume | exact completed occurrence + evidence + visible Mission message产生同 Task queued receipt；Task ID、root Session、profile与workflow binding完全保持 |
| Failed source resume | exact failed occurrence产生同 Task queued receipt，历史failure event与Artifacts仍可精确读取 |
| Ordinary terminal conversation | 普通 operator message产生可见 assistant answer，并返回原 terminal lifecycle reference作为settled occurrence |
| Cancel authority | cancelled Task resume请求返回包含 cancellation actor/source/event 的 typed operator-authority response |
| Concurrent occurrence change | stale terminal reference返回 current terminal occurrence conflict与重新读取所需identity |
| Mission lineage | 同一 Mission child source成功读取/resume；错误 Mission identity返回完整 typed provenance error |
| Wake durability | process interruption后同一 resume wake、message与Task identity恢复并完成一次真实Orchestrator Turn |
| Repair closure | Build或final-delivery owner继续原lineage完成修复，受影响 reviewer继续原lineage产生fresh evidence，最新Completion Decision引用这些证据 |
| Mission reconciliation | 真实 Mission从terminal wake读取Completion Decision和reports，记录gap，resume同Task，再次收到terminal wake并完成最终acceptance |
| API/SDK parity | canonical schema、OpenAPI与generated SDK完整表达read/resume输入输出 |
| Documentation | historical links、product docs single source与document health全部通过 |

所有测试验证当前完整正向输出或明确 typed error contract。不得编写“旧行为不存在”“未创建新 Task”或字符串缺失类负向断言；同 Task repair通过返回的 exact source Task identity、resume receipt与后续 completion evidence证明。

真实消息流验收必须使用 fresh database 启动一个真实 Mission和child Task，保留完整 tool result、Mission message、Task wake、Orchestrator/worker Session、Artifact read与第二次 terminal wake。该过程不落成 UI 自动化测试；若实现改动可见 UI，再通过真实页面和人工截图复核消息 participant与Task activity呈现。

## 六、反向复审

### 被否决的方案

1. **让所有 terminal `send_task_message` 自动重开。** 这会直接恢复 stale operator wake 事故，使普通问答和早到消息成为 lifecycle authority。
2. **把 Mission 加入 operator Retry/Replan whitelist。** 这会伪造 actor，且没有可见 acceptance-gap message、reviewed occurrence和evidence provenance。
3. **所有 gap 创建 correction Task。** 这会制造双 owner、跨 worktree/Session/Artifact 分裂和不必要的 cross-Task import。
4. **Host 解析 report verdict 自动重开或派 Build。** 这是关键词/字段驱动的 workflow gate，且无法处理报告语义、冲突证据和不同 Squad contract。
5. **增加 retry count、repair state或ready flag。** 这些字段形成第二生命周期与状态机，掩盖 Mission evidence判断和Task ownership缺口。
6. **只改 Mission prompt。** 当前事故正是 prompt 声称存在、tool contract 不支持；继续只改 prompt 无法交付。
7. **只增加 Artifact read。** Mission 可以确认缺口但仍不能让owner修复，断链依旧存在。
8. **只增加 resume。** Mission 仍会基于summary/metadata猜测，可能错误重开或错误接受。

### 复审发现与修订

- 初稿若重载 `send_task_message`，会违反已确认的 ordinary conversation lifecycle边界；修订为显式 `resume_task`，但该 action 必须同时持久化真实可见消息。
- 初稿若只用 `taskID` resume，会在 Mission读取后、operator操作前发生 lost update；修订为必须携带 exact terminal lifecycle reference。
- 初稿若允许 cancelled source，会覆盖明确用户 authority；修订为 cancelled 返回typed authority response，Mission不自动恢复。
- 初稿若只列举 Artifact metadata，不能证明report被读取；修订为复用完整 verified reader和byte coverage。
- 初稿若让resume新建workflow occurrence，会破坏fixed package graph；修订为同Task Orchestrator基于既有binding继续exact affected lineages，新的只是Task terminal occurrence。
- 初稿若要求固定“一次repair”，会变成retry counter；修订为Mission从当前evidence/activity/receipt自然判断，Host不保存次数策略。
- 初稿若把Mission gap变成Goal acceptance，会制造第二acceptance source；修订为Goal仍只读取Task Completion Decision，Mission acceptance只属于Mission contract/state。

### 复审结论

方案在以下条件下可实施：Artifact body read与resume必须同时交付；普通 terminal conversation contract不得放宽；resume必须是同Mission、exact occurrence、visible message、atomic receipt；取消authority不得被Mission覆盖；Orchestrator继续由LLM根据真实证据选择原lineage repair/re-review。任何删减其中一项都会重新产生假验收、不可恢复或隐式重开中的至少一种系统性故障。

## 七、实施顺序

1. 先提交并推送本设计与索引，作为实施单一来源。
2. 实现并验证 Mission exact Artifact read。
3. 实现 participant-aware continuation primitive 与原子 `resume_task`。
4. 接通 queued ingress、wake provenance、Orchestrator continuation和process recovery。
5. 收敛 Mission prompt、architecture、API、SDK和公开文档。
6. 运行focused positive contracts、typecheck、API route check、docs check与fresh-database真实消息流。
7. 从普通终态对话事故、并发occurrence、cancel authority、evidence completeness和same-Task reviewer freshness重新做全量复审。

## 八、实施结果与二次复审

实施完成以下单一路径：

- Mission Panel 新增 `read_task_artifact`，复用 `readTaskArtifact` 的 digest、byte window、materialized-file 与 attachment 语义；`artifact-read-facts` 将相同 Turn 中该 action 的 completed ToolPart 纳入同一 complete-read coverage 审计。
- Mission Panel 新增 `resume_task`。Task API 在 root Session serialized wake 中校验同 Mission lineage、exact current terminal occurrence、completed/failed lifecycle 和当前 Turn 的 source-Task complete-read locators。
- 可见 `author="mission"` Task-root message、Task queued projection、`mission_acceptance_resume` ingress、`task.message.recorded` event 与 `mission_acceptance_resume_receipt` 在同一数据库事务提交；随后 queue 只消费已持久化的 wake。
- participant-aware continuation open primitive 由 operator Retry/Replan 与 Mission acceptance resume 共同复用，但两者保持独立 typed ingress、actor 与 provenance。
- Orchestrator wake 只投影真实 Mission message、reviewed occurrence 和 evidence locators；修复 owner、fresh review 和 terminal outcome 继续由 Large Language Model 根据当前 Task facts 决定。
- ordinary terminal `send_task_message` 与 `TerminalConversationAuthority` 未放宽；cancelled source 返回 cancellation authority fact，不进入 reopen transaction。
- canonical Panel schema 已重新生成 OpenAPI（OpenAPI Specification，开放应用程序编程接口规范）与 Software Development Kit（SDK，软件开发工具包）类型。

二次复审额外修正了两个实现风险：

1. 初版直接在 Panel call 中提交 resume，仍可能与 root Session lifecycle writer 竞态。最终实现沿用 root Session serialized wake owner，在其内部原子提交 message/reopen/ingress/receipt，再投递 persisted wake。
2. 初版 Panel read 返回内部 `{chunk, attachment}` wrapper，会与现有 `artifact_read` complete-read fact 结构分叉。最终 Panel output 与 `artifact_read` 一样输出 canonical chunk，binary attachment 只走标准 Tool attachment transport。

正向契约覆盖 completed 与 failed source 的同 Task reopen、Mission participant message、旧 terminal event 保留、durable ingress/receipt、idempotent tool-call replay、exact Artifact body read，以及 Panel complete-read Turn facts。当前实现没有新增数据库 migration、Host workflow gate、retry counter、关键词路由、隐藏消息、合成消息或第二 Artifact reader。
