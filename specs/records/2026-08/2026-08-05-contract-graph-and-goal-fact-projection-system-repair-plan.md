# ContractGraph 与 Goal 事实投影系统修复方案

日期：2026-08-05  
状态：已完成并发布到 `git-cc/v0.0.30beta`
范围：Architect ContractGraph、Delivery Slice revision、dispatch lineage、review Artifact、Workbench Board、Overlay Goal 面板、相关 Prompt、文档和非 UI 契约测试

## Recall

### 用户原始要求

1. 调查两个任务为什么停滞或失败，不能把最后一个 `aborted`、`failed` 或 tool error 当作根因。
2. 根治 ContractGraph 问题，禁止再次引入 hard gate、admission rule、状态机式流程控制、关键词语义校验或固定 retry 路线。
3. 解释为什么所有 Goal 会同时显示正在进行、随后又同时显示失败。
4. 设计系统性修复方案；实施过程中必须有一个独立 Agent 只读复审，持续复审到确认审计范围内没有残留问题。

### 验收指标

1. Host 只约束数据形态、精确引用和不可变历史，不判断 Goal ownership、规划完备性、严重度、修复工具或下一步流程。
2. Goal revision 可以 append-only 修订；历史 Goal、ContractGraph、dispatch lineage、Session 和 completion decision 永不被覆盖或重写。
3. `goal_ids` / `delivery_slice_revision_ids` 只表示精确 work/evidence subjects。空数组始终表示 zero-Slice，绝不推断 Task-wide 或全部当前 Goal。
4. Task、Session、workflow node 和整体 review 的状态不再广播成每个 Goal 的独立生命周期状态。
5. 复数 `goal_ids` 加单一整体 verdict 只表示 review scope，不等于每个 Goal 分别获得同一个 verdict。本轮不发明新的 per-Slice verdict 协议。
6. Goal 面板只展示可溯源的当前 revision、显式关联事实和 Completion Decision 明确记录的 acceptance；不从共享 Session 或整体 verdict 合成“全部进行中/全部失败”。
7. ContractGraph 不再包含基于路径关键词、字符串长度、consumer 数量或固定 repair tool 的语义裁决。
8. 不修改数据库 DDL（Data Definition Language，数据定义语言）或既有 Review Artifact payload，不增加 migration、兼容 reader、fallback 或自动 reset。
9. 非 UI（User Interface，用户界面）行为以正向契约测试验证；UI 只通过真实页面、人工交互和截图复核，禁止新增、修改或运行 UI 自动化测试。
10. 独立 Reviewer 在每个实现阶段后只读检查 diff、测试证据和真实消息流；发现残留即退回主实现者修正，直至明确报告审计范围内无剩余 actionable finding。

### 硬约束

- `specs/` 是方案与架构记录的唯一来源。
- 禁止 gate、状态机、关键词匹配规则、fallback、双源和旧行为兼容。
- Goal 是 versioned Delivery Slice；Task 独占业务 lifecycle。
- Agent 和 review Artifact 是事实生产者，不拥有 Task 或 Goal lifecycle。
- Artifact、Goal revision 和 dispatch lineage 保持不可变；新事实只能追加。
- 现存数据库不得在调查、实现或测试中自动重建；需要真实用户数据库 reset 时必须另行获得明确授权。
- 独立 Reviewer 只读，不得修改文件，不得再委托子 Agent。

### 已读取的落盘资料

- `specs/current/architecture/99-principles.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-08/2026-08-01-goal-control-plane-delivery-slice-rearchitecture.md`
- `specs/records/2026-08/2026-08-03-task-activity-and-mission-completion-semantics.md`
- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`

### 全仓搜索与真实数据证据

搜索覆盖 `Goal status`、`DeliverySliceProgress`、`goal_ids`、`delivery_slice_revision_ids`、`changes_requested`、`accepted_delivery_slice_revision_ids`、`integrity_review`、`workflow occurrence`、`validation_findings` 和 `repair_tools`。

截图对应 Task `tsk_fcd3c6833001UC3o1RLQ8T46JR` 的只读数据库证据：

- Workload、Implementation、Test 和 System Integrity dispatch 均绑定全部五个 Goal revision。
- Integrity Artifact `art_fcd7b4b0e001Z3o55FadzEakiV` 的 `goal_ids` 是全部五个 Goal，整体 `verdict` 为 `needs_correction`。
- `workbench/board.ts` 将包含当前 Goal 的共享 dispatch Session 投影为该 Goal 的 activity；还把空 subject list 当作 Task-wide 并应用于所有 Goal。
- 同一文件把复数 scope 上的整体 review verdict 映射为每个 Goal 的 `changes_requested`。
- `overlay/components/Board.tsx` 只统计 `accepted/settled`，因此显示 `0/5`；`GoalGroup` 与 `goal-state.ts` 把 `changes_requested` 渲染为红叉。
- `orchestrator-core.txt` 明确空 `goal_ids` 是 zero-Slice selection；`workbench/board.ts` 与现存 `workbench/board.test.ts` 却把空数组解释为 Task-wide。历史方案内部也同时存在这两种相反语义。

### 独立 Agent 既有反馈

前两轮独立审计形成以下共识：

- `verification_owns_feature_paths` 是关键词语义规则，不应升级为 blocker，应删除。
- `severity + repair_tools` 会把 Host observation 变成严重度和修复路线权威。
- Workload Reviewer 不应成为第二个 ContractGraph author 或冻结图否决者。
- 不应新增 finalizer、ready flag、blocker-clear、frontier admission、mandatory continuation 或第二个 Architect workflow node。
- Architect 若需要完整草稿视图，只能获得中性只读事实，不能获得 pass/fail 或下一动作。

本方案完成后必须重新交给一个未参与实现的独立 Reviewer 审计，既有反馈不能替代最终复审。

### 2026-08-05 隔离实施补充 Recall

- 用户明确要求使用新 git worktree 实施，并使用临时数据库测试；不得把现存运行库需要结构 reset 错当成实现阻塞。
- 实施 worktree 为 `D:\myhexin-local\opencorvus-worktrees\contract-graph-goal-facts`，分支为 `codex/contract-graph-goal-facts`。
- 所有非 UI 测试、真实页面验收和 benchmark 都使用由测试夹具或隔离 runtime root 创建的 fresh database；不得读取、修改或 reset `C:\Users\hengu\AppData\Local\opencorvus\data\opencorvus.db*`。
- 删除 `validation_findings` 是明确的 Artifact payload 结构断点。旧运行库不属于本 worktree 的读写或测试输入；后续部署旧库时仍须遵守 current-DDL/new-database 规则，不能恢复兼容 reader、migration 或隐式 reset。

### 2026-08-05 验收闭环与 Mission 并发补充 Recall

#### 用户追加要求

1. 调查真实数据库中“Task completed”与全部 Goal `changes_requested` 并存的终态错判，解释为什么修复后没有独立复审。
2. 解释 Mission 为什么倾向把规模可观的交付压进一个 Task，以及执行面为什么看起来没有并发。
3. 根治执行闭环：任务分解粒度合理、独立工作能够并发、产品 finding 必须修复且修复后必须由原独立责任方重新审查，不能只发现问题或因内部流程矛盾卡死。
4. 修复 Debug Info 的 Goal 文件/提交归属和恢复性 `ContextOverflowError` 过程证据丢失。
5. 与多个独立 Agent 协作实施并做最终只读复审。

#### 新增验收指标

1. Mission 按“可独立验收结果 + 明确资源所有权 + 真实证据依赖”形成 Task；同一 Squad 可以拥有多个真正独立的 Task。不得按 Agent 角色、文件、Goal 数量或追求并发机械拆分，也不得因“同一 Squad”把所有交付面机械合并。
2. 每个 ready Task closure 和每个 Task 内 ready workflow frontier 均在容量允许时并行；共享可变资源或真实证据依赖才形成顺序。
3. blocking product finding 先由 Build closure 修复；修复完成后，所有受影响的 Test、Visual、System Integrity 和 Interface Integrity 责任方通过各自原 lineage 的 continuation 并行复审最新产品证据。它们不产生第二个 workflow node occurrence，但必须产生修复后的 append-only evidence occurrence。
4. `complete_task` 仍由 Orchestrator 作语义判断，不增加 Host review gate；Orchestrator 的 pre-completion audit 必须比较产品证据 revision/时间与独立 review occurrence，早于最新修复的接受或拒绝证据都不能证明当前产品完成。
5. Task Board 保留 Session 当前状态，同时另行投影 append-only 过程 incident；恢复后的 `terminal/completed` 不得抹去同 Session 先前的 `ContextOverflowError`。
6. Goal 文件、diff 和 commit 统计从唯一 Task 级 `build_host_observation` Artifact 经 `session_id -> dispatch_lineage.child_session_id -> delivery_slice_revision_ids` 精确归属，并按 Goal `ownedPaths` 计算文件集合；禁止恢复不存在的 `goal.evidence` 双源字段。

#### 真实数据库证据

只读检查 `C:\Users\hengu\AppData\Local\opencorvus\data\opencorvus.db`，`PRAGMA integrity_check=ok`。当前数据已复现系统性问题：

- `tsk_fcd95bbff001jmm1gHuMztAV07` 已 completed，Completion Decision 声称接受 6/6 current Goal，却引用 `needs_correction` Integrity Review；最后一次 Implementation 晚于该 Review，之后独立复审数为 0。
- `tsk_fcd3c7761001WM21rcnRgJiVp9` 已 completed，最新 Integrity Review 仍为 `needs_correction`，修复后的独立复审数为 0。
- `tsk_fcd2dd6a2001ehI0zd2dy2GZb1` 的真实 Session frontier 最大并发宽度为 4，证明底层执行器并非完全串行；但 Implementation 只有一个 package node，修复期只能反复 continuation 同一 owner。
- 十个 Mission Task 的 request 多次明确写入“完整闭环”“不要拆 Mission 子 Task”；这不是用户原始交付事实，而是 `mission-core.txt` 的“一 Task 默认/同 Squad 必须合并”策略被 Mission 放大到请求中。
- 至少三个 error=null 的 completed Task 与最新 rejected review 同时存在，说明该故障不是单个 Orchestrator 偶发判断。

#### 三个独立只读 Agent 的共识

- 数据库/验收审计：`task_completion_decision` 当前只保存 Orchestrator 的决定与 exact locator，不解释 review freshness；正确修复属于 Prompt 与真实 evidence reasoning，不应增加 Host completion lock。
- Mission/并发审计：初始调查和 reviewer frontier 有真实并发；缺失的是 Task 级交付拆分和 remediation 后 reviewer continuation。根因是 Mission 强制大 Task、Advanced 单 Implementation occurrence、以及修复后禁止重跑独立责任方三者叠加。
- 可观测性审计：Debug formatter 读取 schema 中不存在的 `goal.evidence`；真实 Build 证据在 `build_host_observation`。`session.error` 与 Assistant `failureOccurrence` 已 append-only 持久化，丢失发生在只读取 latest Session status 的 Board/Debug 投影。

这些 Agent 均只读、未修改文件、未运行 UI 自动化测试、未继续委托子 Agent。

## 一、根因模型

### 1. ContractGraph 把语义判断下沉到了 Host

当前 validator 根据路径关键词、summary 长度、consumer 数量、coverage 数量等启发式产生 `blocker/concern`，并携带 `repair_tools`。这些字段看似只是 observation，实际上已经替 LLM（Large Language Model，大语言模型）决定了严重度和修复路线。

结果是 Architect 在冻结前无法自然理解完整事实，冻结后 Orchestrator 又被结构化 finding 引导到固定修复路径；系统反复拆 gate 后仍会从 validator 和 Prompt 中长回 gate。

### 2. Goal revision 的未来追加被错误等同于历史篡改

`workflow-occurrence.ts` 看到已有 dispatch lineage 或 completion decision 后，拒绝任何 Goal add/modify/remove。实际上 append-only 新 revision 不会修改旧 revision 或旧 lineage。该限制冻结的是未来表达能力，不是历史完整性。

当前 reader 还会把旧 ContractGraph 中的 fidelity Goal refs静默映射为current revision；这会把“旧图引用旧revision”的历史事实伪装成“旧图已经描述新revision”。任何修订都必须同时删除这种读时改写。

### 3. Board 把 evidence subject 当成 execution owner

`goal_ids` 表示 Session 或 Artifact 涉及哪些 Delivery Slice revision。它不证明每个 Slice 都有独立执行实例，也不证明每个 Slice 的工作同时开始、同时结束或同时失败。

Board 当前却从共享 Session 派生每个 Goal 的 `in_progress`，从 Task workflow node coverage 派生每个 Goal 的进度，从整体 review verdict 派生每个 Goal 的 `changes_requested`。这与“Task 独占 lifecycle”直接冲突。

### 4. Review scope 与 per-Slice judgment 被压成一个字段组合

`IntegrityReviewArtifact` 使用复数 `goal_ids` 表示审计范围，同时只有一个整体 `verdict`。Board 将“该 review 看过五个 Goal，整体需要修正”解释成“五个 Goal 分别失败”。Scope 不是 judgment，这是当前全体红叉的直接数据建模原因。

## 二、目标事实模型

### 1. Task 与 Session

- Task 保留唯一业务 lifecycle。
- Session 保留自己的物理运行和 terminal observation。
- Workflow coverage 保持 Task/workflow occurrence 级事实，不复制到每个 Goal。

### 2. Goal / Delivery Slice

Goal 只保存 stable logical identity、immutable revision、objective、kind、priority、owned paths、acceptance specs、exact RequirementSet / ContractGraph refs 与 `supersede_of` revision lineage。

Goal 不拥有 running、failed、retry、attempt、workspace、worker 或 workflow-node lifecycle。

### 3. Subject association

- 非空 `goal_ids`：精确表示该 Session/Artifact 声明涉及的 revision subjects。
- 空 `goal_ids`：精确表示 zero-Slice；不推断当前或历史 Goal。
- Task-wide scope 由 Task identity 和 work scope 自身表达，不通过空 Goal 列表制造隐式 all-selection。
- Subject association 可以显示为“关联活动/证据”，不能自动形成 Goal lifecycle verdict。

### 4. Review 与 acceptance

Review scope与review-wide judgment是两个事实面。Task Completion Decision 中 `accepted_delivery_slice_revision_ids` 是 Goal terminal acceptance 的唯一事实来源。Task失败或整体review `needs_correction`不反推所有Goal失败。本轮没有真实per-Slice judgment producer，因此不增加相应facet或payload字段。

### 5. Goal Board 投影

删除一个混合的 `progress.state`，拆成互不冒充的只读 facets：

- `revision`：logical ID、revision ID、prior revision ID；
- `activity`：显式选中该 revision 的 active Session IDs 和 evidence Artifact IDs；
- `reviewAssociations`：显式把该revision列入scope的review locators及其整体judgment，仅作为关联证据；
- `acceptance`：当前 terminal Task Completion Decision 是否明确接受该 revision；
- `contract`：objective、kind、paths、acceptance specs。

顶部计数只统计当前 terminal decision 明确接受的 current revisions。Activity、review finding 和 Task failure 使用各自图标/文本，不再压成红叉生命周期状态。

## 三、系统改动面

### Phase A — 删除 ContractGraph Host 语义裁决

主要文件：`architect/output-tools.ts`、`architect/contract-graph.ts`、`architect/fidelity.ts`、`architect/agent.ts`、`orchestrator/architect-stage.ts`、`engine/architect-contract-graph-artifact.ts`、`engine/persist.ts`、`tool/panel.ts`。

删除：

- `verification_owns_feature_paths` 与 `isVerificationOwnedPath`；
- summary 长度、consumer 数量、render/document 路径等语义分类；
- `blocker/concern` severity；
- `repair_tools` 和固定 `manage_task action=fail_task` 路线；
- `architectValidationIssues()` 等按 severity 聚合接口；
- `validation_findings` 作为 ContractGraph Artifact 的第二裁决面。

保留 Zod 数据形态、contract kind 与 typed IR（Intermediate Representation，中间表示）一致性、exact Goal/RequirementSet/evidence locator 引用、ID 唯一性、removal partition、current/historical identity，以及带中性 structural conflicts 的不可物化 Candidate Artifact。Structural conflict 不附 severity、repair tool 或 lifecycle action。

### Phase B — 恢复 append-only Goal 修订

主要文件：`engine/workflow-occurrence.ts`、`engine/persist.ts`、`orchestrator/delivery-slice-contract-tools.ts`、`engine/store.ts`。

- 删除 `goal_mutation` 对 workflow occurrence 的冻结。
- add/modify/remove 始终追加 revision/projection，不更新历史 row。
- 旧 dispatch lineage 保持绑定旧 revision；新 projection 指向新 current revision。
- Goal birth ContractGraph locator永久表示该revision出生时的provenance，不随current revision变化。
- GoalGraph current projection中的ContractGraph locator只表示创建该projection的精确Architect graph；Orchestrator直接追加Goal revision而没有新Architect graph时，projection必须如实携带“current revisions + selected prior graph”关系，不能宣称prior graph已描述新revision。
- 删除`store.ts`中把旧ContractGraph/fidelity Goal refs映射为current revision的读时改写；所有消费者读取graph原始exact refs，并在需要时另外读取current projection membership。
- Tool description 只描述追加事实能力，删除 first occurrence、frozen、必须 continuation、必须新 Task 等流程叙事。
- Structural re-entry 只是 LLM 可选能力，不触发自动 retry 或固定 continuation。

保留 Goal、GoalGraphProjection、ArchitectContractGraph 的数据库不可变 trigger，dispatch lineage 当时使用的精确 revision IDs，以及 completion decision 历史证据。

### Phase C — 提供 Architect 中性草稿事实

主要文件：`architect/output-tools.ts`、`agent/dispatch-adapter-contract.ts`、`architect/agent.ts`、`prompt/core/architect-core.txt`、`pipeline/goal-contract.schema.ts`。

- `formatGoalSnapshot()` 返回 objective、kind、owned paths、acceptance IDs/source IDs/scorer types，而不是局部摘要。
- 增加只读 `view_architect_draft`，返回 Goals、contracts、coverage、assembly owners、removals 的 canonical 当前值。
- 工具不得运行 validator、保存 inspect 状态、返回 ready/pass/fail/blocker、推荐工具或成为 persistence 前置条件。
- Prompt 解释 `feature/integration/verification` 的交付物 ownership 语义，但不规定固定 tool-call 顺序或最终检查清单。
- Goal kind 由要求和真实代码职责决定，不由标题、阶段或路径关键词决定。

### Phase D — 拆除 Goal lifecycle 合成投影

主要文件：`workbench/delivery-slice-progress.ts`、`workbench/board.ts`、`engine/model.ts`、`status/task-status-snapshot.ts`、`tool/panel.ts`、Overlay Board/GoalGroup/TaskProgressBar/TaskDirBar、`utils/goal-state.ts`、`utils/transcript.ts`、locale 与相关样式。

- 删除 `DeliverySliceProgressState` 的 `not_started/in_progress/in_review/changes_requested/accepted/settled` 生命周期合成。
- 空 subject list 不再匹配任何 Goal。
- shared Session 只进入显式 subject association，不生成 Goal running state。
- workflow total/completed 从 Goal 卡移回 Task/workflow 展示面。
- overall review verdict 不进入 per-Goal judgment。
- Task status snapshot 不再统计 Goal `active/failed`；只汇总明确 accepted current revisions、关联 evidence 和显式 per-Slice facts。
- Overlay 使用新的 facets 展示，不再把 `changes_requested` 映射为每个 Goal 的红叉。

该 Phase 是 UI 变更，实施者必须启动真实页面、查看截图并人工修正；禁止创建或运行 UI 自动化测试。

### Phase E — Review scope 与 Goal acceptance 投影分离

主要文件：`integrity/review-artifact.ts`、`visual-qa/persist.ts`、`fact-check/*`、`workbench/board.ts`、`status/task-status-snapshot.ts`及相关consumer。

- `goal_ids` 保留为精确 review scope。
- 整体 `verdict` 保留为 review-wide judgment，不再具备 per-Slice UI 语义。
- Goal详情可列出review scope association及整体judgment locator，但它不改变Goal acceptance。
- Goal acceptance只读取当前terminal Task Completion Decision的`accepted_delivery_slice_revision_ids`。
- 不增加 accepted flag、ready flag、review gate 或自动修复动作。

本Phase不改变Integrity、Visual或Fact Check Artifact payload schema，因此不会制造旧Artifact严格解析失败，也不需要数据库reset。

### Phase F — Prompt 与 Expert Squad 去状态机化

主要文件：Orchestrator/Architect Core Prompt、`orchestrator/dispatch-agent-tool.ts`及其description契约测试、Advanced Orchestrator/Solution Architect/Workload Reviewer/Integrity overlays、Advanced manifest 和 generated payload。

- 删除 Advanced overlay 中重复的 ready frontier、terminal-success admission、mandatory retry、phase closure 分支和禁止重跑算法。
- 保留 immutable workflow node occurrence，但明确修复后的 Test/Visual/Integrity 通过各自原 dispatch lineage continuation 复审最新产品证据；它们不能由 Build 自测替代，也不创建第二个 node occurrence。
- Pre-completion audit 比较最新产品修复证据与每项必需独立审查 occurrence；只读取“最后一个 verdict”或“node 曾 terminal-success”都不足以证明修复后的产品已被接受。
- Workload 只提供规模、遗漏、成本、耦合和并行风险事实，不重新判定 Goal kind/path legality。
- Integrity 可以报告任何观察到的事实，但不自动修改 ContractGraph、Goal 或 Task。
- Orchestrator 自然选择是否继续某个 Agent、追加修订、继续实现或结束 Task；Host 不建立相应状态字段或路由表。
- 删除dispatch tool中“错误subjects不可修复、必须fail Phase、禁止其他修正路径”等固定失败路线；保留exact subjects和zero-Slice的中性事实描述。
- manifest DAG（Directed Acyclic Graph，有向无环图）不增加第二个 Architect 节点，不以 Workload verdict 作为 Implementation admission。

修改 Advanced 作者源时必须更新 package version、重新生成 payload并验证完全一致；不得自动覆盖既有项目已安装 package。

### Phase G — 架构文档收敛

同步修改 `99-principles.md`、`01-agents.md`、`02-data.md`、`03-control.md`、`07-panel.md`、`07-panel-reactivity.md`、`15-agent-facts-and-turns.md` 和 Expert Squad authoring Skill/SDK 文档。

同时收敛 Mission 粒度：删除“同一 Squad 必须合成一个巨大 Task”和“workload/独立验收边界永远不能成为 split evidence”的绝对规则。Task 边界由可独立接受的结果、资源所有权和真实依赖决定；同一 Squad 只表示 capability owner 相同，不表示 lifecycle、目录、环境或交付边界相同。

删除所有“空 subjects 是 Task-wide”“Goal workflow progress”“Task/global review 自动成为 Goal status”的陈述。唯一当前语义是 zero-Slice、显式 subject association、Task-only lifecycle 和显式 acceptance。

### Phase H — Requirement 与公开投影收敛

主要文件：

- `workbench/board.ts`中的Requirement聚合；
- Requirements面板与Task status snapshot；
- Task/Mission status routes及schema描述；
- OpenAPI（OpenAPI Specification，开放应用程序接口规范）生成物；
- JavaScript SDK（Software Development Kit，软件开发工具包）生成类型；
- 英中API reference与route/status契约测试。

Requirement不能从Session、workflow或整体review获得failed状态。Requirement acceptance只从当前terminal Completion Decision明确接受的current Slice及其acceptance-spec source映射得到；其他Requirement返回完整neutral/unassessed facts。公开`TaskBoardGoal`与`TaskStatusGoalDetail`从混合`progress`改为revision/activity/reviewAssociations/acceptance facets后，必须同步所有route、OpenAPI、SDK、API docs和non-UI contract consumers，不保留旧字段兼容分支。

## 四、正向非 UI 验证矩阵

禁止通过“旧行为不发生”形式写负向测试；以下均验证新的完整正向输出。

| 层次                | 正向契约                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Goal revision       | 已有 dispatch 后追加 superseding Goal revision；旧 lineage仍解析到旧 revision，新 projection解析到新 revision                                                                        |
| Goal removal        | removal产生下一 immutable projection，旧 ContractGraph和旧 Goal仍可精确读取                                                                                                          |
| Zero-Slice          | 空subject dispatch编译出完整Task/workflow facts；每个Goal返回其精确revision、空activity association、空review association和当前acceptance facts                                      |
| Exact subjects      | 一个Session选择两个Goal时，两张卡的activity facet精确列出同一个Session ID，并各自返回独立acceptance值                                                                                |
| Review scope        | 一个包含五个`goal_ids`的整体`needs_correction` review保留完整scope和整体verdict；五个Goal的reviewAssociations分别精确引用该Artifact，acceptance均来自Completion Decision             |
| Completion          | terminal completion decision明确接受三个current revisions时，Goal汇总精确显示`3/5`及三个accepted locator                                                                             |
| Revision change     | acceptance引用旧revision时，新current revision显示其独立未接受facts，同时旧acceptance历史仍可读                                                                                      |
| Exact graph history | 旧ContractGraph中的Goal/fidelity refs始终解析为原revision；current projection另行返回当前membership与selected prior graph locator                                                    |
| Architect draft     | 中性draft tool返回完整canonical collector facts，修改后返回新的完整事实集合                                                                                                          |
| ContractGraph       | valid graph持久化精确contracts/provenance；结构冲突Candidate返回`candidate/projection/conflicts`完整中性schema                                                                       |
| Workload            | workload Artifact引用精确Goal revisions，并完整返回sizing、inventory、omission和verification-cost facts                                                                              |
| Status snapshot     | Task snapshot完整返回Task lifecycle、accepted current revision集合、Goal activity/review associations和Requirement acceptance facts                                                  |
| Public API          | Task/Mission status routes、OpenAPI、JavaScript SDK和英中API reference精确表达同一facets schema                                                                                      |
| Package parity      | Advanced authoring source、manifest projection和generated payload完全一致                                                                                                            |
| Repair re-review    | 初始独立 review 返回 blocking finding，Build continuation 产生修复证据；受影响 reviewer/test 原 lineage 并发 continuation 并发布修复后 evidence，Completion Decision只引用该最新证据 |
| Mission granularity | 一个结果含两个可独立验收、资源不重叠且无证据依赖的 closure 时，Mission authoring prompt形成两个 ready Task；共享 mutable resource 的 closure 保持同一 Task或显式依赖                 |
| Process incidents   | Session 先持久化 `ContextOverflowError` occurrence、后恢复为 terminal completed；Board同时返回 current completed status与完整 incident occurrence                                    |
| Goal Build evidence | 两个显式 Slice dispatch各产生 Build observation；每个 Goal只得到自己 lineage 和 owned path 对应的 diff/commit/observation locator                                                    |
| Docs                | current architecture、monthly index、root index和document-health检查全部通过                                                                                                         |

重点替换 `workbench/delivery-slice-progress.test.ts` 与 `workbench/board.test.ts` 中固化旧生命周期、empty-means-Task-wide和整体 verdict广播的用例，并补 focused Goal revision、Review payload、Architect draft、task-status snapshot、panel和package generation正向测试。

不得新增、修改或运行 `packages/overlay/test/**`、Playwright tests、DOM/TSX/CSS/文案断言、snapshot、pixel diff或截图 baseline。实施中若触及相关路径并发现现存 UI 自动化测试，按项目规则删除相应过期测试及仅为其服务的 fixture/config，不修补、不运行。

## 五、真实运行与人工 UI 验收

使用隔离的新数据库和真实 Mission/Task，构造以下事实序列：

1. Architect创建五个 Goal。
2. Task-wide Requirements/Architect Session使用 zero-Slice subjects。
3. 一个 Build Session显式关联五个 Goal。
4. 整体 Integrity Review覆盖五个 Goal并给出 `needs_correction`，但不发布 per-Slice judgment。
5. Task Completion Decision接受其中三个 current revisions。
6. 另一个 Advanced Task先由独立 reviewer 产生 blocking finding，再由 Build closure修复，随后原 Test/Visual/System Integrity/Interface Integrity lineage并发 continuation并产生晚于修复的复审证据。
7. 一个 Session先产生可恢复的 `ContextOverflowError`，随后成功 terminal completed；Debug Info同时显示过程 incident和最终状态。

人工检查真实页面并截图：zero-Slice Session对应的Goal均显示完整空activity association；shared Build在五张卡上显示同一关联Session而不冒充Goal lifecycle；整体review显示为review association；顶部显示`3/5`；Task生命周期仍在Task面正确显示；Goal详情可追溯到精确Session、Artifact、review和completion decision locator。

截图只作为当次人工验收证据保存到 `specs/artifacts/`，不形成自动化测试或baseline。

## 六、独立 Agent 复审协议

### 2026-08-05 Goal 独立事实人工视觉验收

- 真实页面连接隔离 runtime root：`D:\myhexin-local\opencorvus-worktrees\contract-graph-goal-facts\.tmp\goal-facts-runtime`；数据库为该目录下 fresh `opencorvus.db`，未读取、修改或 reset 用户现存运行库。
- 隔离 Task `tsk_fcf6cb06c001xCq2ZHXCIba3dT` 包含五个 current Goal revision；一个整体 Visual Review 显式关联五个 Goal，Completion Decision 只接受前三个 revision。
- 真实页面右侧 Goals 面板显示 `3/5`：G1-G3 为绿色 `Accepted`，G4-G5 为中性 `Not accepted`。没有 Goal 被共享 review 合成为 failed，也没有 running、blocked、pending 或红叉生命周期状态。
- 人工查看截图：`specs/artifacts/2026-08-05-goal-independent-facts-visual-qa.png`。该文件只保存本次交互证据，不是 fixture、baseline 或 UI 自动化测试。

### Reviewer 身份与边界

- 主 Agent负责实施；一个独立 Reviewer Agent只读审查。
- Reviewer不得修改文件、不得运行 UI自动化测试、不得再委托任何 Agent。
- Reviewer必须读取本方案Recall、当前diff、相关架构记录、真实测试输出、真实消息流和人工截图。

### 2026-08-05 最终独立复审结论

- 独立 Reviewer 明确结论：`审计范围内无 actionable residual finding`。
- Phase A–H 相关非 UI 契约 `127/127` 通过；文档、routes、OpenAPI `82/82` 通过；Advanced package parity `5/5` 通过；`git diff --check` 通过。
- 精确搜索确认 retired Goal progress/lifecycle、公有 Goal lifecycle states、empty-subject scope broadcast、ContractGraph gate/repair route、Board `historicalGoals` 死查询和新增负向断言均为零。
- Reviewer 使用隔离数据库复核五个 Goal、五个 review associations 与只接受 G1–G3 的 Completion Decision，并人工查看 `3/5` 截图：G1–G3 为 `Accepted`，G4–G5 为 `Not accepted`，不存在全体 running、failed 或红叉。
- 两个任务范围内发现的旧 Browser UI 自动化测试已按项目规则删除；本次没有运行任何 UI 自动化测试。

### 每阶段复审循环

每完成一个 Phase：

1. 主 Agent提供该 Phase 的精确diff、正向测试命令与结果、未触及范围。
2. Reviewer检查 gate/severity admission/mandatory retry/状态路由、关键词语义判断、Task/Session/review到Goal lifecycle广播、empty-as-all、第二active state、compatibility/fallback、历史ContractGraph ref读时重写、Requirement广播、公开API/SDK遗漏、负向测试、UI自动化测试和遗漏消费者。
3. Reviewer按文件/行号输出 findings；主 Agent逐项修复。
4. 使用同一 Reviewer再次审查新的完整diff，不只复查局部补丁。
5. 循环直到 Reviewer明确写出：审计范围内无 actionable residual finding，并列出实际核对的文件、命令、Artifact和截图。

### 最终复审

所有 Phase完成后，Reviewer重新从根因链开始独立审计，不沿用阶段结论：ContractGraph是否只剩事实和引用；Goal revision是否可追加且历史可重放；Board是否完全没有Goal lifecycle合成；Review scope与per-Slice judgment是否彻底分离；Prompt/manifest是否没有换皮状态机；fresh Task是否不再出现全体同时运行/失败；文档是否只保留一个当前语义。

只有完成这一轮只读复审并取得明确的无残留结论，才能把实现报告为完成。Reviewer结论是交付复核证据，不进入产品Host逻辑，不形成产品gate。

### 2026-08-05 验收闭环与并发修复实施记录

- 只读数据库复核确认：至少三个 `error=null` 的 completed Task 与最新 rejected/needs_correction review 并存；底层 Session 执行曾达到四路并发，断裂发生在 Mission Task 粒度与修复后 reviewer 不再 continuation，而不是 executor 缺少并发能力。
- Mission 已按独立可验收结果、可变资源所有权和真实证据依赖划分 Task；同一 Squad 不再成为强制合并理由，ready closures 必须同时派发。
- Core/Advanced Orchestrator 已要求 Build 修复后继续所有受影响的原 Test/Visual/Interface Integrity/System Integrity lineage；continuation 复用原 Session、workflow node、occurrence 和 Slice subjects，并在完成前以晚于修复的最新独立结果为判断证据。
- Board Goal contribution 只从显式 Slice lineage 的 child Session、至少一个命中 `owned_paths` 的 Build observation 投影；`.` 明确表示项目根责任面。不存在 owned diff 的 observation 不再广播 commit、diff、Session 或 Artifact locator。
- append-only `session.error` 已投影为独立 `processIncidents`，Debug Info 将过程 incident 与最终 terminal status 分栏呈现。
- 独立 Reviewer 首轮发现 observation 元数据仍可能跨 Goal 广播；修复后复审确认 blocking 清零。Reviewer随后提出 `owned_paths='.'` 的根路径语义建议，本轮已同步根治并加入正向覆盖。
- 聚焦验证通过：60 个调度/Prompt/Board/package 正向契约测试、一个真实 same-Task continuation 测试、OpenCorvus 与 Overlay typecheck、`docs:check`、`api:routes-check`、historical docs links；根路径补充后 Board 7/7、16 assertions 再次通过。
- 真实页面人工复核显示 Visual、Test、Interface Integrity、System Integrity 四张 reviewer 卡片同时工作，右侧七个 Goal 仍为 running；页面布局、状态语义和并发呈现无视觉错位。该交互截图仅作为本次人工证据，没有形成 UI 自动化测试或 baseline。

## 七、提交与发布顺序

1. 先提交本方案和索引，建立可追踪基线。
2. 每个独立 Phase形成以 `dsw-33987` 开头的提交并推送 `git-cc/v0.0.30beta`；不混入现存用户文件。
3. 每阶段独立复审完成后再进入下一 Phase；Reviewer不产生代码提交。
4. 最终运行focused tests、typecheck、API route check、docs check、package parity和真实页面人工验收。
5. 主 Agent做最终diff review，独立Reviewer再做全量只读review。
6. 推送主分支事实源；不保留临时分支、未合并worktree或未推送实现。

## 八、明确不在本修复中做的事

- 不增加Goal status表、attempt表、workflow step状态或active pointer。
- 不增加planner-valid、frontier-ready、review-approved、blocker-cleared等字段。
- 不用Task failure覆盖Goal状态。
- 不从finding文本、文件路径、title、slug或命名模式推断ownership或per-Slice verdict。
- 不开放历史Artifact或Goal row原地修改。
- 不新增数据库migration、兼容层或自动reset。
- 不改变Advanced workflow DAG来制造新的review admission顺序。
- 不把 Goal 变成 executor、workflow node、Task 或并发调度单位；真正独立的执行闭包由 Mission Task 表达，Task 内只使用 package 已声明的 workflow frontier。
- 不把独立Reviewer的复审协议实现成产品运行时gate。
