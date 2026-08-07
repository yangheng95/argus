# OpenCorvus Dashboard Phase 02 需求基线

Date: 2026-07-24

Status: Phase 02 需求定稿；供 Stage 3 产品需求文档（Product Requirements Document，PRD）直接引用。本文件不是 PRD、设计稿、实现 schema、fixture、测试、截图或生产 Overlay 修改。

Scope: 桌面端单页 Dashboard；唯一页面模型是全局跨项目只读首页。不包含 mobile、tablet 或多端响应式交付。

## Recall

| 项目             | 本阶段要求与已消费证据                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户原始要求     | 基于已验收 Phase 01 调研和指定仓库调用点，只在本需求文档及两级 specs 索引中定稿 Dashboard Phase 02 需求基线；必须覆盖 scope、信息架构、交互、数据、状态、可访问性、优先级、来源追踪、Stage 3 输入、验收和未达成项。                                                                                                                                                                                                                                                         |
| 十项验收合同     | `REQ-1` 至 `REQ-10`：三文件完整性；全局跨项目单一模型；首屏模块与详情职责；只读交互；唯一 canonical demo snapshot；分域状态；桌面与可访问性；仓库 traceability；唯一优先级及 Stage 3 输入；当前执行的工作区和文档验证。                                                                                                                                                                                                                                                     |
| 阶段硬约束       | 只允许创建或修改 `specs/records/2026-07/2026-07-23-opencorvus-dashboard-requirements.md`、`specs/records/2026-07/README.md`、`specs/README.md`。不得创建 PRD、设计、HTML、React、测试代码、fixture、截图、preview 或其他 artifact；不得修改 Overlay/生产代码；不得暂存、提交、worktree、merge、fetch、pull、push 或处理外部并发改动。                                                                                                                                       |
| 已读事实输入     | Phase 01 `2026-07-23-opencorvus-dashboard-market-research.md`；`specs/README.md`；`specs/records/2026-07/README.md`；`specs/current/architecture/07-panel.md`；Work Ledger、Board、Mailbox、Changes、Browser Preview、Agent activity、设计 token 和 Node browser test 的实际实现/测试路径。                                                                                                                                                                                 |
| 持久化协作输入   | 已消费任务给出的 Stage 1、Explorer、Intent、Requirements、Architect 与 Workload 合同；Phase 01 记录保留其 `deep_research`、`frontend_research` 与 Explorer session/artifact provenance，本阶段不重做无边界市场调查。                                                                                                                                                                                                                                                        |
| 全仓调用点复核   | 当前执行通过全仓搜索和文件读取复核 Work Ledger selection、Task/Mission/Chat identity、Goal/acceptance、Mailbox attention/evidence、Changes、task-scoped Browser Preview、agent/session/tool activity、design-language tokens、既有单元/源测试和 Node-launched browser fixture。名称仅用于定位，事实以实际类型、函数、route、store、测试和架构记录为准。                                                                                                                     |
| 工作区证据时间线 | Orchestrator 在 Task 恢复后、首次实质调度前执行的 `git status --short` 为 exit code 0 且空输出，这是 Phase 02 的执行前基线。进入 Build 子执行后，工作区出现外部并发改动：Overlay 三个文件、environment-heading spec、Phase 01 market-research 及两个共享 specs 索引；这些后出现的路径不得倒写为 Orchestrator 基线。Phase 02 自身只负责 requirements 新文件，以及两个共享索引中登记 Phase 02 requirements 链接的当前未提交增量；不修改、恢复、解释、清理或暂存其他并发内容。 |
| 当前 HEAD 边界   | 当前 HEAD 为 `ab4521ed7dc6917927611da2aecd0f569e1c883d`（`dsw-33987 correct agent model column allocation`）。该提交发生于并发工作流且与本 Goal 无关，不属于 Phase 02 成果，不得由本阶段恢复、解释或归因。                                                                                                                                                                                                                                                                  |
| 桌面边界         | reference viewport 固定为 `1440×960`；最小目标尺寸固定为 `1280×800`。桌面高密度 OpenCorvus 视觉语言是后续设计约束，不授权移动端、平板端或竞品像素复制。                                                                                                                                                                                                                                                                                                                     |
| 独立 Agent 边界  | 当前执行不得再委托子 Agent；需求装配、交叉审查和验证由本 Build 在本目标内完成。                                                                                                                                                                                                                                                                                                                                                                                             |

## 1. 问题定义与非目标

### 1.1 问题定义

OpenCorvus 已有 Work Ledger、Conversation、Environment、Mailbox、Review、Browser Preview 与 Task Board/Right Dock 等真实详情表面，但跨项目监督者缺少一个在进入详情前即可完成以下判断的全局只读首页：

1. 哪些 Mission、Task、Chat 或 Session 当前需要关注；
2. 应恢复哪个对象及其 project/Mission 语境；
3. 最近有哪些可追溯的执行、验收、Changes、Mailbox 或 Preview 证据；
4. 应进入哪个既有详情所有者继续查看或操作；
5. 当没有 canonical source 时，哪些信息确实为空或不可用，而不是被无来源指标填充。

Dashboard 的职责是**扫描、定位、恢复上下文、核验证据并打开既有详情表面**，而不是成为第二个工作流、数据源或操作台。

### 1.2 明确非目标

- 不建立 project/Mission 局部 Dashboard；project 与 Mission 仅作为对象语境和筛选字段。
- 不建立团队管理、成员绩效、项目健康度、owner/team、服务等级协议（Service-Level Agreement，SLA）、预测、成本、token、延迟、成功率、生产力或其他无 provenance 的关键绩效指标（Key Performance Indicator，KPI）。
- 不嵌入完整 Work Ledger、Conversation transcript/Composer、Environment、Mailbox、Review/diff editor、Browser runtime、Files、Screenshots、Settings、Automations、worktree 或 Git mutation。
- 不创建新工作流引擎、Router、生产 Dashboard API/store、通用 status enum、Task Run、execution liveness 或 active-agent totals。
- 不允许创建、编辑、发送、审批、标记已读、归档、删除、提交、推送、停止执行、启动 Browser 或其他持久化生产操作。
- 不把 fixture 契约实现为 TypeScript、Zod、JSON schema 或测试 fixture；本阶段只规定需求级语义。
- 不交付 mobile、tablet、响应式多端、竞品像素级复制、真实 preview、截图或视觉验收。

## 2. 核心用户与 Jobs-to-be-Done

### 2.1 核心用户

主要用户是同时监督多个 project 中多个 Mission、Task、Chat 与 Agent Session 的开发者或技术负责人。其工作重点是跨对象识别 attention、恢复上下文、核验证据，并进入现有详情表面，而不是进行团队绩效分析。

### 2.2 Jobs-to-be-Done（JTBD，待办任务）

1. 当我打开 OpenCorvus 时，我要在一个全局首页快速识别失败、排队、等待明确交互、Mailbox attention 或待核验证据的对象，以决定先看哪里。
2. 当我从多个 project 或 Mission 切换回来时，我要通过稳定 identity 恢复 Task、Mission 或 Chat 的上下文，并进入既有 Conversation/Work Ledger 表面。
3. 当 Agent、Goal 或验收产生结果时，我要看到来源 session、tool/message、changed files、Mailbox evidence 或 Browser Preview evidence，而不是只相信摘要文案。
4. 当我发现 Changes、Goal/acceptance、Mailbox 或 Browser Preview 入口时，我要打开其现有详情所有者，而不是在 Dashboard 内执行操作。
5. 当来源缺失或不可解析时，我要看到明确的 empty/unavailable，不要看到推断、占位 KPI 或由数组位置伪造的“最近”。

## 3. 单一 scope 决策

### 3.1 定稿模型

Dashboard 只有一个页面模型：**全局跨项目只读首页**。

- 页面从所有已注册/可见 project 的 canonical snapshot 投影 Mission、Task、Chat、Session、attention 和 evidence 摘要。
- project directory、project display name、Mission identity 只作为对象语境、分组和 canonical 筛选字段。
- 选中对象只改变 Dashboard 的本地展示上下文；打开 typed target 才向既有详情所有者发出导航意图。
- 同一页面在没有任何选择时仍可扫描全局；选中 project/Mission 不会切换成第二个局部 Dashboard，也不会改变模块顺序和职责。

### 3.2 被拒绝的替代模型

| 替代模型                    | 裁决 | 原因                                                                            |
| --------------------------- | ---- | ------------------------------------------------------------------------------- |
| 每个 project 一个 Dashboard | 拒绝 | 与跨项目监督 JTBD 冲突，并复制 Work Ledger 的 project 分组与上下文恢复职责。    |
| 每个 Mission 一个 Dashboard | 拒绝 | Mission 已是对象语境；局部模型会复制 Task Board/Conversation/Goals 的详情职责。 |
| 全局 + 局部两层 Dashboard   | 拒绝 | 形成第二页面模型和双源信息架构；筛选已足够表达语境。                            |
| 团队绩效/项目健康控制台     | 拒绝 | 当前没有 owner/team/health/velocity 的 canonical contract。                     |
| 可执行工作流或操作台        | 拒绝 | Dashboard 必须只读；所有生产 mutation 留在既有 owner。                          |

## 4. 首屏信息架构与所有权边界

### 4.1 固定模块顺序

以下顺序在 `1440×960` reference viewport 和 `1280×800` 最小目标尺寸上保持一致，不允许 Stage 3 调换层级：

1. **全局语境与 Demo Snapshot 标识**
2. **Work & Attention**
3. **Recent Evidence**
4. **Changes**
5. **Mailbox**
6. **Browser Preview Availability**

### 4.2 逐模块包含/不包含

| 顺序 | 模块                          | 目的                                                     | 必须包含                                                                                                                                                             | 明确不包含                                                                                          | 完整详情/操作所有者                                                     |
| ---- | ----------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | 全局语境与 Demo Snapshot 标识 | 说明全局跨项目范围、筛选上下文和数据性质                 | 页面标题；“Demo snapshot / 非实时运营数据”显著声明；project/Mission canonical 筛选；snapshot capturedAt；筛选清除                                                    | project health、owner/team、真实在线状态、第二个局部 Dashboard                                      | Work Ledger 拥有真实 project/Mission 对象；Dashboard 仅持有本地筛选状态 |
| 2    | Work & Attention              | 扫描需要关注或恢复的工作对象                             | Mission/Task/Chat tagged-union 行；project/Mission 语境；canonical status presentation；queued；pending interaction count；selected/hover/focus；typed object target | 创建、重命名、归档、停止、启动、审批、完整 Work Ledger action rail                                  | Work Ledger + Conversation；Goal 详情归 Task Board/Goals                |
| 3    | Recent Evidence               | 核验最近 session/agent/tool/message/Goal acceptance 证据 | exact session/agent/message/tool/evidence identity；domain outcome；observed timestamp/orderKey；简短 source-backed summary；typed target                            | 完整 transcript、Composer、Shell/tool console、按文案推断 outcome                                   | Conversation、Goal/Acceptance、对应 evidence panel                      |
| 4    | Changes                       | 显示有来源的改动规模和进入 Review 的入口                 | 单一 per-file projection 聚合的 files/additions/deletions；有限文件行；Goal/acceptance scope；Review target                                                          | 完整 diff、编辑器、提交/推送、第二套 diff cache、从 group metadata 重算另一套 totals                | Review/Changes；Environment 复用同一 summary                            |
| 5    | Mailbox                       | 显示 durable attention/evidence 摘要                     | attention、category、subject 摘要、Task/Goal/session refs、evidenceRefs、createdAt/orderKey、read state 的只读呈现；Open Mailbox/Open Task target                    | 标记已读、read-all、archive/restore/delete、完整 body、把 unread 等同 failed                        | 左侧 Mailbox；Task navigation 归 Work Ledger/Conversation               |
| 6    | Browser Preview Availability  | 告知选中/关联 Task 是否存在 canonical preview/evidence   | ready/missing/corrupt/unavailable 的可读文案；Task+directory scope；canonical URL 仅在 target 提供时呈现；viewport/evidence availability；Browser target             | iframe、WebView/runtime、启动 Browser、解析 shell/message URL、query override、session-local signal | task-scoped Browser Preview panel 和后端 EngineArtifact target/evidence |

### 4.3 详情表面职责不得漂移

- **Work Ledger**：唯一跨项目对象列表、真实选择和对象生命周期操作表面。
- **Conversation**：唯一完整用户/Agent/tool/message transcript、Composer 与 session 上下文表面。
- **Environment**：唯一目录、VCS（Version Control System，版本控制系统）、worktree 和资源快捷入口聚合；Dashboard 不执行 mutation。
- **Mailbox**：唯一 durable message body、read/acknowledgement 和列表操作表面。
- **Review**：唯一完整 changed-file/diff 浏览与验收改动表面。
- **Browser Preview**：唯一 target 解析、WebView/runtime、截图/evidence 和 viewport 详情表面。

## 5. 稳定功能需求

Stage 3 必须原样引用下列 ID。ID 不因文案调整、排序或实现拆分而重编号。

| ID           | 需求                                                                                                                                                                                           | 对应上游合同  | 下游验收角色                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------- |
| DASH-REQ-001 | Dashboard 必须是唯一全局跨项目只读首页，project/Mission 仅作语境和筛选，且不得出现局部第二模型。                                                                                               | REQ-2         | PRD scope、路由/页面模型、全局扫描验收                |
| DASH-REQ-002 | 核心用户和 JTBD 必须围绕识别 attention、恢复对象上下文、核验证据、进入既有详情表面。                                                                                                           | REQ-2         | 内容策略、任务流和导航验收                            |
| DASH-REQ-003 | 首屏必须按“全局语境与 demo 标识 → Work & Attention → Recent Evidence → Changes → Mailbox → Browser Preview Availability”固定排序。                                                             | REQ-3         | 页面结构和两种桌面尺寸截图验收                        |
| DASH-REQ-004 | 每个模块必须只投影摘要与入口，并保持 Work Ledger、Conversation、Environment、Mailbox、Review、Browser Preview 的完整职责。                                                                     | REQ-3         | 信息架构、所有权和禁止重复表面验收                    |
| DASH-REQ-005 | Dashboard 交互必须只改变本地选择、canonical 字段筛选、有限展开、hover/focus 或 typed-target 反馈，不得产生生产 mutation。                                                                      | REQ-4         | 交互测试、键盘测试和 mutation absence 验收            |
| DASH-REQ-006 | 所有可打开动作必须使用需求规定的 typed target union，并携带足以恢复 owner、identity、directory/task scope 的字段。                                                                             | REQ-4, REQ-5  | 导航 adapter 与 target exhaustive handling 验收       |
| DASH-REQ-007 | 静态演示必须只有一个显著标记的 canonical `Dashboard Demo Snapshot` root，且所有显示字段映射到现有域语义。                                                                                      | REQ-5         | fixture 单一来源和 demo 声明验收                      |
| DASH-REQ-008 | snapshot 必须使用 tagged unions、typed references、来源 timestamp 和显式稳定排序键；不得以数组位置表达时间或身份。                                                                             | REQ-5         | 数据 contract、排序和 identity 验收                   |
| DASH-REQ-009 | Task lifecycle、queued、pending interaction、Mailbox attention/read、agent outcome、Changes 与 Preview availability 必须使用分域 presentation mapping，不得压成通用 active/health/红黄绿状态。 | REQ-5, REQ-6  | 状态映射和非压平验收                                  |
| DASH-REQ-010 | 状态矩阵必须覆盖 empty、unavailable、attention、failed、selected、hover、focus，并明确 queued 与 pending interaction 的不同文本和操作语义。                                                    | REQ-6         | 状态/视觉/键盘场景验收                                |
| DASH-REQ-011 | 桌面验收必须固定 `1440×960` reference viewport 和 `1280×800` 最小目标尺寸，不增加 mobile/tablet scope。                                                                                        | REQ-7         | task-scoped preview 与两尺寸截图验收                  |
| DASH-REQ-012 | 页面必须满足语义 landmarks/标题/列表/按钮/披露、完整键盘路径、可见 focus、非纯颜色反馈、WCAG 2.2 AA 对比和 reduced-motion。                                                                    | REQ-7         | accessibility、keyboard、focus、contrast、motion 验收 |
| DASH-REQ-013 | 每个 Dashboard 域必须回指仓库 canonical source、静态 projection、详情 owner 与禁止的新平行来源。                                                                                               | REQ-8         | requirement-to-source 审计和实现 review 验收          |
| DASH-REQ-014 | Stage 3 及后续实现必须生成真实 task-scoped preview，以 Node 启动 Playwright，复核两种桌面尺寸截图、键盘/focus/state，并提供对应单元或端到端（End-to-End，E2E）测试。                           | REQ-9         | PRD 验收计划和后续真实证据验收                        |
| DASH-REQ-015 | Phase 02 只交付本需求文档和两级索引的未提交改动，并记录当前执行的开始/结束状态、`git diff --check` 与 historical docs links 测试。                                                             | REQ-1, REQ-10 | 阶段边界、三文件 ownership 和文档健康验收             |

## 6. 数据边界与唯一 canonical demo snapshot

### 6.1 需求级 root contract

静态演示只有一个 `Dashboard Demo Snapshot` root。名称仅用于需求沟通，不是实现类型名。该 root 必须具备：

- 一个稳定 `snapshotID`；
- `capturedAt` 和 snapshot 级稳定 `orderKey`；
- 显著且不可关闭的 `dataDeclaration = demo_snapshot` 语义，页面可读文案明确“演示快照，不代表实时运营数据”；
- `contexts`、`workItems`、`attentionItems`、`evidenceItems`、`changeSummaries`、`mailboxItems`、`previewAvailabilities` 七个域集合；
- 所有跨集合关系都使用 typed reference，不通过标题、数组 index、路径片段或展示文案关联；
- 不含 production write client、Application Programming Interface（API，应用程序编程接口）adapter、store、router、metric aggregation 或 mutation callback。

### 6.2 Tagged union 与 identity

以下为概念级 tagged union；Stage 3 可以调整字段排版，但不得改变身份和来源语义：

| Union                 | 成员                                                                             | 必需 identity / scope                                                                                                                      | 可投影来源语义                                                                             |
| --------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `ContextRef`          | project、Mission                                                                 | project：`projectID + directory`；Mission：`missionID + sessionID + directory`                                                             | Work Ledger project/Mission rows；Mission projection                                       |
| `WorkItem`            | Mission、Task、Chat                                                              | Mission：`missionID + sessionID + directory`；Task：`taskID + directory`，可带 `missionID/missionSessionID`；Chat：`sessionID + directory` | Work Ledger discriminated union                                                            |
| `AttentionItem`       | pending interaction、Mailbox attention、failed evidence                          | 必须有来源 domain、exact source ID、关联 Task/Mission/Session ref、count 或 evidence ref                                                   | Work Ledger pendingInteractions；Board interactions；Mailbox attention；Goal/agent outcome |
| `EvidenceItem`        | Goal acceptance、agent session、tool/message、Mailbox evidence、Browser evidence | exact `goalID/goalRunID`、`sessionID`、`messageID/toolCallID`、`mailboxItemID/evidenceRef` 或 `previewEvidenceID`                          | Board goals/evidence；Conversation agent view/message parts；Mailbox；Browser evidence     |
| `PreviewAvailability` | ready、missing、corrupt、unavailable                                             | `taskID + directory`；ready/corrupt 可带 persisted target/evidence identity                                                                | task-scoped Browser Preview target/evidence                                                |

禁止加入通用 `Entity`、通用 `Status` 或字符串 URL target 来绕过这些 union。

### 6.3 时间与稳定排序

- 每行必须保留其来源时间：Work Ledger `created/started/updated`；Mailbox `createdAt + orderKey`；Agent/session/message `observed time + orderKey`；Goal/evidence 使用其持久时间/顺序；Browser target 使用 persisted update/evidence time。
- 每个排序视图必须声明 `(primaryTimestamp, domainOrderKey, stableIdentity)` 三段键；相同时间以 domain orderKey，再以稳定 identity 排序。
- `started = null` 的 queued Task 不得补 `capturedAt` 或 `Date.now()`；其可读文案为“Queued / 尚未开始”。
- 数组位置、Document Object Model（DOM，文档对象模型）顺序、标题字母序和颜色都不得成为“最近”“失败优先”或 identity 的隐式来源。

### 6.4 分域 status presentation mapping

| 域                       | 允许的 canonical 输入                             | Dashboard presentation                                                             | 禁止压平                                              |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Task lifecycle           | queued、active、completed、failed、cancelled      | 原 lifecycle label/icon；queued 明确“等待调度/尚未开始”                            | 不映射为 generic active、health 或 Agent running      |
| Task pending interaction | nonnegative count + pending interaction identity  | “需要输入 · N”；独立 attention affordance                                          | 不把 queued 当 pending，也不把 pending 当 Task failed |
| Mission                  | taskStats、interruptible、pendingInteractions     | 保留 failed/active/queued/completed/cancelled 及 `settled/total`；interaction 单列 | 不发明 Mission health 或统一进度百分比                |
| Chat                     | active、idle、terminal                            | Chat-specific label；只表示 Session activity                                       | 不映射为 Task lifecycle                               |
| Mailbox                  | category、attention、readAt/archivedAt            | category label；attention 与 read 独立呈现                                         | unread 不等于 attention、blocked 或 failed            |
| Agent activity           | pending、running、idle、completed、error、skipped | Agent outcome label + exact session identity                                       | 不汇总“active agents”，不把 error 改写为 Task failed  |
| Changes                  | empty/non-empty + files/additions/deletions       | “No changes”或 canonical summary                                                   | 不产生 clean/healthy 总状态，不从两套 totals 取值     |
| Browser Preview          | ready、missing、corrupt、unavailable              | Available、No saved preview、Preview evidence corrupt、Select a Task               | 不从 URL 文本猜 ready，不启动 Browser                 |

### 6.5 Read-only target union

每个打开动作必须属于以下一个成员，并只表达导航/定位意图：

| Target member       | 必需字段                                            | 目标 owner                 | Demo observable feedback                           |
| ------------------- | --------------------------------------------------- | -------------------------- | -------------------------------------------------- |
| `work-item`         | `kind + identity + directory`                       | Work Ledger / Conversation | 显示“Would open Task/Mission/Chat …”并高亮对应对象 |
| `conversation-card` | `sessionID + messageID/renderedCardID + directory`  | Conversation               | 显示目标 session/card identity                     |
| `goal`              | `taskID + goalID + directory`                       | Goals                      | 显示目标 Goal identity                             |
| `acceptance`        | `taskID + goalID/goalRunID + directory`             | Acceptance/Review          | 显示 evidence/attempt identity                     |
| `changes`           | `taskID + directory + optional goalRunID/filePath`  | Review/Changes             | 显示 scope/file target                             |
| `mailbox`           | `mailboxItemID + taskID + directory`                | Mailbox                    | 显示 Mailbox item/Task target                      |
| `browser-preview`   | `taskID + directory + optional targetID/evidenceID` | Browser Preview            | 显示 canonical preview/evidence identity           |

target union 不得包含 create、edit、send、acknowledge、delete、commit、push、cancel、stop、launch-browser 等 action type。

## 7. 只读交互矩阵

| 交互                  | 触发                                           | 可观察反馈                                                                                       | 键盘行为                                                        | Target / owner                                     | Mutation 边界                                                                       |
| --------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 对象选择              | 单击 Work & Attention 行                       | 仅一个 selected 行；关联 Evidence/Changes/Mailbox/Preview 摘要按 typed refs 聚焦；全局列表仍存在 | Tab 到行；Enter/Space 选择；Escape 清除选择并回到全局           | Dashboard 本地 selection；真实对象仍归 Work Ledger | 不调用 `selectTask`、`selectCodingAssistantSession` 或 `openMissionSession`         |
| canonical 字段筛选    | project/Mission/status-domain 筛选控件         | 可见筛选 token、结果计数和清除动作；只使用 snapshot 已有字段                                     | Tab；Enter/Space 打开/选择；Escape 关闭弹层；清除后焦点回触发器 | Dashboard 本地 filter                              | 不保存筛选到生产配置，不生成新分类                                                  |
| 有限展开              | Evidence、Changes 或 Mailbox 摘要的 disclosure | 同一卡片内显示有限额外行；`aria-expanded` 与指示符同步                                           | Tab 到 disclosure；Enter/Space 切换；Escape 收起当前展开        | Dashboard presentation；完整内容仍归详情 owner     | 不加载完整 transcript/body/diff，不标记 Mailbox read                                |
| Hover                 | 指针进入可交互行/target                        | 与 selected 不混淆的轻量 wash/文本/图标反馈；可出现非交互 tooltip                                | 无键盘依赖；同等信息必须通过 focus 可得                         | 当前 row/target                                    | 不预取、不导航、不改变持久状态                                                      |
| Focus                 | Tab/Shift+Tab 进入交互元素                     | 明确 focus-visible ring；状态文本和 accessible name 可读                                         | 完整顺序遵循页面模块顺序；Shift+Tab 可逆                        | 当前 control                                       | focus 不触发选择、打开或 mutation                                                   |
| Typed target 打开反馈 | 激活显式 “Open …” 按钮                         | 静态 demo 显示非持久 toast/inline notice，包含 target kind、identity、owner；不假装真实导航成功  | Tab；Enter/Space 激活；Escape 可关闭反馈                        | target union 指定 owner                            | 不调用生产导航 adapter，不写 Task/Mission/Chat/Goal/Mailbox/Git/Environment/Preview |
| 清除选择/筛选         | “Clear”按钮或适用时 Escape                     | 恢复全局 snapshot；焦点返回产生上下文的控件                                                      | Enter/Space；Escape 只处理当前局部上下文                        | Dashboard 本地 state                               | 不重置生产 Work Ledger selection                                                    |

所有行必须以真实 button/disclosure/list semantics 实现，禁止只用 hover-only `div` 模拟操作。

## 8. 状态矩阵

| Observable state    | 适用模块                                     | 内容与文本                                                                       | 视觉/语义反馈                                               | 可操作性                                                  |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| empty               | Work & Attention、Evidence、Changes、Mailbox | “No matching work/evidence/changes/mailbox items in this demo snapshot”          | empty heading + 原因；不放 `0%`、虚构 KPI 或 skeleton       | 可清除筛选；无虚假 target                                 |
| unavailable         | Browser Preview、缺 scope 的域               | “Select a Task to inspect preview availability”或“No canonical source available” | unavailable icon + 文本；与 error 区分                      | 仅可选择对象/清除筛选；不可 launch                        |
| attention           | pending interaction、Mailbox                 | pending：“Needs input · N”；Mailbox：“Attention”且 read 状态另列                 | icon + label + count，不能只靠黄色                          | 可本地选择或打开 typed target feedback；不可回答/标记已读 |
| failed              | Task、Goal/acceptance evidence、Agent        | 保留所属域：Task failed、Acceptance failed、Agent error                          | 域 label + icon + 简短 evidence summary；不能只靠红色       | 可打开相应 owner target；不可 retry/stop                  |
| queued              | Task/Mission task stats                      | “Queued / 尚未开始”；`started` 缺失保持缺失                                      | 独立 queued icon/label                                      | 可查看对象；不可 “start now”                              |
| pending interaction | Work & Attention                             | 明确请求语义、非零 count 和 Task identity                                        | 独立 attention affordance；不复用 queued 点                 | 可打开 Task/interaction target feedback；不可作答         |
| selected            | 所有可选择对象行                             | 一个本地 selected identity，关联模块聚焦                                         | `aria-selected` 或等价单选语义 + selected wash + 文本上下文 | 再次选择保持；Escape/Clear 清除                           |
| hover               | 所有 pointer target                          | 与 focus 同等的名称/摘要可发现性                                                 | 轻量 hover wash；不覆盖 selected/focus                      | 不触发动作                                                |
| focus               | 所有 interactive controls                    | accessible name、状态、owner 可读                                                | 可见 focus ring，优先级高于 hover                           | Enter/Space 执行声明动作；Escape 按矩阵关闭/清除          |
| Preview ready       | Browser Preview                              | canonical URL label、viewport/evidence availability                              | “Available” + source-backed detail                          | 仅 typed target feedback                                  |
| Preview missing     | Browser Preview                              | “No saved preview for this Task”                                                 | empty，不使用错误色                                         | 无 launch；可打开 owner 说明反馈                          |
| Preview corrupt     | Browser Preview                              | “Saved preview target or evidence is corrupt”                                    | error text + icon                                           | 可反馈 owner；不 fallback URL                             |

缺少 canonical source 时只能选择 empty 或 unavailable。不得用“预计”“似乎”“可能 active”、占位趋势或由竞品文案推断的状态填补。

## 9. 桌面视觉与可访问性基线

### 9.1 桌面尺寸与密度

- `1440×960` 是唯一 reference viewport；Stage 3 视觉层级、首屏模块完整性和信息密度以此验收。
- `1280×800` 是最小目标尺寸；六个模块仍须可进入、主标题/筛选/核心 attention 可见，横向不得依赖页面级滚动。
- 不增加 mobile/tablet breakpoint 或截图；桌面范围内允许内容区自然滚动，但固定模块顺序不可改变。
- 视觉语言遵循 `packages/overlay/src/styles/tokens/design-language.css`：14px body、15px title、20px heading、26px compact navigation row、28px text button、32px control/icon button、有限 radius、80/120/200ms motion、hover/selected wash 和 canonical focus ring。
- Stage 3 只翻译这些 token/节奏到原型展示层，不复制生产 Solid/Kobalte 实现，也不创建第二套“生产设计系统”。

### 9.2 语义与键盘

- 页面必须有 `main` landmark；顶部语境可用 `header`；六个模块使用有序 heading hierarchy，页面一个 `h1`，模块为 `h2`，卡片内部不跳级。
- 工作项/evidence/mailbox 行使用语义 list/listitem 或 table（若列关系确实存在）；动作使用 button/link-like target primitive；有限展开使用 disclosure button + controlled region。
- Tab 顺序严格遵循模块顺序和模块内视觉顺序；Shift+Tab 可完整逆向；无 keyboard trap。
- Enter/Space 激活选择、筛选选项、disclosure 和 typed target；Escape 依次关闭当前 popup/disclosure feedback 或清除当前 Dashboard 本地上下文，不影响生产状态。
- 最小指针/键盘 target 为 `32×32 CSS px`；紧凑列表行可为 26px 视觉高度，但其中可操作命中区必须达到最小目标尺寸且不重叠。

### 9.3 Focus、对比和 motion

- 每个可交互元素必须有清晰 `:focus-visible`，不得仅改变颜色或移除 outline 而无等价 ring。
- lifecycle、attention、failed、availability、selected 都必须同时使用文本/图标/形状或 count，不能只依赖颜色。
- 正文、控制、状态文本和 focus indicator 必须达到 Web Content Accessibility Guidelines（WCAG，网页内容无障碍指南）2.2 AA 对比要求；disabled/unavailable 文案仍需可读。
- `prefers-reduced-motion: reduce` 下，非必要 transform、drawer、pulse、shimmer 和自动过渡必须移除或使用 instant token；保留状态变化本身和 focus 可见性。
- typed-target feedback 应以可读 status/alert 语义宣布，但不得以持续动画吸引注意。

## 10. 优先级裁决（Must / Should / Won't）

每条 DASH-REQ 只有一个归类；本表即唯一裁决，不存在“可能/待定/考虑”。

| 优先级 | 需求 ID                                                                                                                                                                              | 裁决说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Must   | DASH-REQ-001, DASH-REQ-002, DASH-REQ-003, DASH-REQ-004, DASH-REQ-005, DASH-REQ-006, DASH-REQ-007, DASH-REQ-008, DASH-REQ-009, DASH-REQ-010, DASH-REQ-011, DASH-REQ-013, DASH-REQ-015 | 缺任一项即失去单一 scope、只读边界、canonical 数据契约、状态语义、来源追踪或阶段边界，Stage 3 PRD 无法直接消费。                                                                                                                                                                                                                                                                                                                                                        |
| Should | DASH-REQ-012, DASH-REQ-014                                                                                                                                                           | 语义/键盘/focus/对比/reduced-motion 全量要求与真实 preview/Playwright/测试证据是 Stage 3 及后续实现阶段必须执行的验收输入；Phase 02 文档层面完成其定义即满足本阶段，执行发生在后续阶段。                                                                                                                                                                                                                                                                                |
| Won't  | —（以下显式排除项）                                                                                                                                                                  | project/Mission 局部 Dashboard；团队/成员绩效与项目健康度；owner/team/SLA/forecast 字段；无 provenance KPI（active agents、success rate、cost、token、latency、velocity、health score 等）；Task Run 与 execution liveness 复活；生产 Dashboard API/store/第二 diff cache/第二通知层；嵌入式 transcript/Composer/editor/Browser runtime/Settings/Automations；mobile、tablet 与竞品像素复制；Phase 02 内的 PRD、设计稿、代码、fixture、测试、截图与 Git 提交/远端操作。 |

说明：Won't 行不是编号需求，而是对被拒绝能力的显式排除清单；任何后续阶段引入这些能力都必须先修订本基线。

## 11. Requirement-to-source traceability

调用点以当前执行读取的真实文件为证据；名称与展示文案不构成证据。

| 数据/验证域                           | 仓库 canonical source（已复核）                                                                                                                                                                                                                                                         | Dashboard 静态投影                                                                                                          | 详情 owner                                       | 禁止的新平行来源                                                                                     | 支撑 DASH-REQ           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------- |
| Work Ledger selection 与对象行        | `packages/opencorvus/src/work-ledger/projection.ts`（`WorkLedgerRow` discriminated union、`pendingInteractionCounts`）；`packages/overlay/src/services/work-ledger.ts`；`packages/overlay/src/components/WorkLedger.tsx`                                                                | Mission/Task/Chat 行、标题、目录、created/started/updated、lifecycle/execution、pendingInteractions、taskStats、chat status | Work Ledger                                      | 第二可编辑工作列表；Dashboard 自建排序/归档/队列事实；从展示文本反推状态                             | 001–004, 007–009, 013   |
| Task/Mission/Chat identity 与打开语义 | `packages/overlay/src/services/task.ts::selectTask`；`services/coding-assistant.ts::selectCodingAssistantSession`；`packages/overlay/src/main.tsx::openMissionSession/selectWorkLedgerTask/openWorkLedgerChat/openWorkLedgerMission`                                                    | typed `work-item` target 所需的 kind+ID+directory（Mission 另含 sessionID）                                                 | Work Ledger / Conversation                       | Dashboard 直接调用生产 selection；字符串路由；无 directory 的对象引用                                | 005, 006, 008, 013      |
| Goal / acceptance                     | `packages/opencorvus/src/workbench/board.ts`；`specs/current/architecture/07-panel.md` TaskBoard contract（`goals[].evidence`、goalID/orderKey/status/priority、changed files、diff stats、checks、verdict）；`packages/overlay/src/components/Board.tsx`/`GoalGroup.tsx`               | Goal identity、canonical goal status/result、acceptance evidence 摘要、changed-files scope、`goal`/`acceptance` target      | Goals / Acceptance / Review                      | 第二套 Goal progress 算法；把 agent activity 当 Goal running 真相；虚构验收得分                      | 006, 008, 009, 013      |
| Mailbox attention / evidence          | `packages/overlay/src/services/mailbox.ts`（`MailboxItem`：category/attention/subject/evidenceRefs/taskID/goalID/sessionID/orderKey/createdAt/readAt）；`packages/opencorvus/src/engine/mailbox.ts`；`server/routes/mailbox.ts`；`MailboxPanel.tsx`                                     | attention/category/subject 摘要、typed refs、created/read 状态、`mailbox` target                                            | Mailbox                                          | 第二通知持久层；自造 overdue/priority；unread≙failed；Dashboard 内 acknowledgement                   | 004, 005, 009, 010, 013 |
| Changes / diff summary                | `packages/overlay/src/services/diff.ts::currentChangeGroups/summarizeChangeGroups`（唯一 per-file 聚合）；goal-run diff routes；`2026-07-21-review-split-diff-and-change-total-convergence.md`                                                                                          | files/additions/deletions summary、有限 changed-file 行、`changes` target                                                   | Review / Changes（Environment 复用同一 summary） | Dashboard 自算 totals；第二 diff cache；混用 group metadata 与 per-file stats 两套答案               | 004, 006, 009, 013      |
| task-scoped Browser Preview           | `packages/overlay/src/services/browser-preview.ts`（Task+directory 必填）；`server/routes/browser-preview.ts` 与 SDK target/evidence contract；`BrowserPreviewPanel.tsx`；`2026-07-20-chat-browser-preview-task-binding.md`                                                             | target status（ready/missing/corrupt）、canonical URL、viewports、evidence availability、`browser-preview` target           | Browser Preview                                  | message/shell URL 解析；session-local URL 信号；iframe/query override；Dashboard 自建 preview target | 006, 009, 010, 013      |
| Agent / session / tool activity       | `packages/overlay/src/store/conversation-agents.ts`；`packages/overlay/src/utils/agent-activity.ts`（`AgentActivityStatus = pending/running/idle/completed/error/skipped`）；conversation hydrate `agentView`；`ConversationAgentRail.tsx`；tree-writer rendered card target            | session/agent/stage/status、observed time、orderKey、display summary、`conversation-card` target                            | Conversation / Agent Rail                        | 以卡片顺序或颜色推断执行状态；全局 active-agent 计数；无 exact session/tool identity 的活动行        | 006, 008, 009, 013      |
| 设计语言 tokens                       | `packages/overlay/src/styles/tokens/design-language.css`（typography/density/radius/motion/z-index/opacity/wash/stage hues）                                                                                                                                                            | 原型展示层 token 翻译与密度节奏                                                                                             | Overlay design-language 单一来源                 | 第二套“生产设计系统”；复制生产 Solid/Kobalte 组件实现                                                | 011, 012, 013           |
| 既有测试与 browser preview 方法       | `bun test` 源测试（work-ledger、mailbox、diff、browser preview、architecture guards）；`node packages/overlay/test/browser-runner.mjs` Node-launched Playwright 模式；`project-ledger-group-browser.test.ts`、`task-dirbar-keyboard.test.ts` 的 viewport/screenshot/keyboard/focus 模式 | Stage 3 验收方法引用：Node 启动 Playwright、两种桌面尺寸截图、键盘/focus/state 断言、实现对应单元或 E2E 测试                | 各测试 owner 目录                                | 用手工描述或竞品截图代替真实测试证据；在 Phase 02 提前创建测试/截图                                  | 011, 012, 014, 015      |
| Phase 01 研究输入                     | `specs/records/2026-07/2026-07-23-opencorvus-dashboard-market-research.md`（reuse，不修改）                                                                                                                                                                                             | Recall、候选模块、反模式与市场证据引用                                                                                      | Phase 01 记录本身                                | 重做无边界市场调查；把竞品语义当 OpenCorvus 状态授权                                                 | 001–003, 009, 013       |
| specs 索引                            | `specs/records/2026-07/README.md`；`specs/README.md`（modify，单一登记来源）                                                                                                                                                                                                            | 本文档的两级相对链接登记                                                                                                    | specs 索引                                       | 第二索引、外部清单或不一致链接                                                                       | 015                     |

## 12. Stage 3 输入与后续验收要求

### 12.1 十项 acceptance-spec 显式覆盖

| Acceptance spec ID                        | 对应稳定需求与章节                   | 非歧义验收角色                                                                              |
| ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `acc-phase02-artifact-completeness`       | DASH-REQ-015；Recall、第 5、13–15 节 | 三文件、完整章节、稳定 ID、两级索引、无越界 artifact                                        |
| `acc-global-cross-project-scope`          | DASH-REQ-001–002；第 2–3 节          | 唯一全局跨项目首页、核心 JTBD、拒绝局部第二模型                                             |
| `acc-information-architecture-boundaries` | DASH-REQ-003–004；第 4 节            | 固定模块顺序、包含/不包含与六个详情 owner                                                   |
| `acc-readonly-interactions`               | DASH-REQ-005–006；第 6.5、7 节       | trigger、feedback、keyboard、owner 与 production mutation absence                           |
| `acc-canonical-fixture-contract`          | DASH-REQ-006–009；第 6 节            | 单一 root、tagged union、typed refs、时间排序、状态映射、target union、demo 声明            |
| `acc-domain-state-matrix`                 | DASH-REQ-009–010；第 6.4、8 节       | empty/unavailable/attention/failed/selected/hover/focus、queued 与 pending interaction 分离 |
| `acc-desktop-accessibility-baseline`      | DASH-REQ-011–012；第 9 节            | 两种桌面尺寸、语义结构、键盘、focus、非颜色反馈、对比与 reduced-motion                      |
| `acc-repository-traceability`             | DASH-REQ-013；第 11 节               | 每个指定域的 source、projection、owner、禁止平行来源与测试方法                              |
| `acc-priority-stage3-input`               | DASH-REQ-001–015；第 10、12 节       | 每个需求唯一优先级及后续真实 preview/screenshot/keyboard/test 输入                          |
| `acc-workspace-stage-boundary`            | DASH-REQ-015；Recall、第 13–15 节    | 当前运行开始/结束状态、三文件归因、未提交、diff/checker 真实结果                            |

### 12.2 Stage 3 PRD 必须直接消费

1. **内容结构**：第 4 节固定模块顺序与包含/不包含清单；第 3 节唯一 scope 与拒绝清单。
2. **交互**：第 7 节交互矩阵与第 6.5 节 target union；PRD 不得新增未列交互或 action type。
3. **数据**：第 6 节 snapshot root、tagged unions、typed references、时间/排序键与分域 status mapping；PRD 可细化字段命名，不得改变语义。
4. **视觉语言**：第 9.1 节桌面尺寸与 design-language token 翻译边界。
5. **可访问性**：第 9.2/9.3 节 landmarks、键盘、focus、非颜色反馈、对比与 reduced-motion 要求。
6. **优先级**：第 10 节 Must/Should/Won't 唯一归类及显式排除清单。

### 12.3 后续真实证据要求（本阶段未执行）

进入实现阶段后必须提供：

- 一个真实 task-scoped preview target（`browser_preview` 流程），不得以本地口头描述代替；
- 以 Node 启动的 Playwright 对 `1440×960` 与 `1280×800` 两种桌面尺寸截图并做视觉复核；
- 键盘路径、focus-visible、selected/empty/unavailable/attention/failed/queued/pending-interaction 状态的可执行断言；
- 与实现对应的单元或 E2E 测试（fixture 单一 root、排序键、状态映射、target union exhaustive 处理、无 mutation 调用面）；
- 上述证据均在其所属阶段生成并留存，不回填为 Phase 02 已完成。

## 13. Phase 02 验收标准

1. 仅三个获准文件存在本阶段改动：本文档、`specs/records/2026-07/README.md`、`specs/README.md`。
2. 本文档包含 Recall、问题与非目标、核心用户/JTBD、单一 scope、信息架构、稳定 DASH-REQ ID、数据边界、交互矩阵、状态矩阵、桌面与可访问性、优先级、来源追踪、Stage 3 输入、验收标准与未达成项。
3. `DASH-REQ-001` 至 `DASH-REQ-015` 唯一、无重复，且每条在第 10 节恰有一个优先级。
4. 两级索引以正确相对链接登记本文档：月度索引使用 `2026-07-23-opencorvus-dashboard-requirements.md`，根索引使用 `records/2026-07/2026-07-23-opencorvus-dashboard-requirements.md`。
5. 没有创建 PRD、设计稿、HTML、React、测试代码、fixture、截图、preview artifact 或修改 Overlay/生产代码。
6. 当前执行分别记录 Orchestrator 恢复后首次实质调度前的空工作区基线、Build 子执行期间出现的并发改动、收尾 `git status --short`、`git diff --check` 与 `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` 结果；外部并发改动和无关 HEAD 仅记录，不恢复、不解释、不暂存。
7. 无 Git commit、amend、merge、worktree、fetch、pull、push 或其他远端操作；三个成果物保持未提交。

## 14. Phase 02 验证记录

### 14.1 Orchestrator 执行前基线

Task 恢复后、首次实质调度前，Orchestrator 执行 `git status --short`，命令 exit code 0 且输出为空。该结果是本 Goal 的执行前工作区基线；不得用 Build 子执行开始后观察到的路径反向替换这一基线。

### 14.2 Build 子执行期间的并发变化与归因

Build 子执行开始至收尾期间，工作区出现了以下外部并发改动：

- Overlay 三个文件：`packages/overlay/src/styles/surfaces/conversation.css`、`packages/overlay/test/browser/task-dirbar-keyboard.test.ts`、`packages/overlay/test/task-cwd-row-layout.test.ts`；
- `specs/records/2026-07/2026-07-23-environment-heading-geometry-and-mission-presentation.md`；
- Phase 01 `specs/records/2026-07/2026-07-23-opencorvus-dashboard-market-research.md`；
- 两个共享索引 `specs/records/2026-07/README.md` 与 `specs/README.md` 中不属于 Phase 02 requirements 登记行的并发内容。

当前 HEAD `ab4521ed7dc6917927611da2aecd0f569e1c883d`（`dsw-33987 correct agent model column allocation`）同样来自与本 Goal 无关的并发工作流，不属于 Phase 02。Phase 02 的责任路径仅为 `specs/records/2026-07/2026-07-23-opencorvus-dashboard-requirements.md`，以及两个共享索引中登记该 requirements 文档的当前未提交增量；共享索引文件的其他 diff 不因此归属于 Phase 02。

### 14.3 收尾状态与命令证据

以下命令在本阶段收尾时真实执行，结果记录于交付说明并须满足第 13 节：

1. `git status --short`：以本次收尾命令的真实输出为准；该输出用于记录当时整个共享工作区，不用于把外部并发路径或无关 HEAD 归因给 Phase 02。Phase 02 责任仍限定为 requirements 新文件及两个索引中的 requirements 登记增量。
2. `git diff --check`：以本次收尾命令的真实 exit code 与输出为准。
3. `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`：以本次收尾重跑的真实通过/失败计数与耗时为准。
4. 定向 `git diff -- <三个获准文件>` 用于归因本阶段改动；全工作区 diff 含外部并发路径，不得全部归因于本阶段。

最终逐命令输出以本次 Build 终端交付证据为准；若任何一项不满足，本阶段不得宣称完成。

## 15. 未达成项与遗留边界

- 本阶段没有产出 PRD、页面设计、React/HTML 原型、fixture 代码、测试、真实 preview 或截图；这是阶段非目标而非遗漏，对应工作由 Stage 3 及后续阶段按第 12 节执行。
- `prototypes/opencorvus-dashboard/` 是否纳入 root workspace、fixture 的具体类型命名与文件组织属于实现阶段决策；其语义边界已由第 6 节固定。
- Build 子执行期间出现的外部并发改动包括 Overlay 三个文件、environment-heading spec、Phase 01 market-research 和共享索引中的其他内容；当前无关 HEAD 亦不属于本 Goal。本阶段不恢复、解释、清理、暂存或归因这些内容，只对 requirements 新文件及两个索引中的 Phase 02 requirements 登记增量负责。
- Mailbox `evidenceRefs` 的逐 ref 可导航性尚未有统一生产协议保证；Dashboard 需求已按“仅显示 + typed target 到 Mailbox/Task”收敛，Stage 3 不得假设每个 ref 可深链。
- historical docs links 测试覆盖文档链接健康；它不验证本文需求语义，需求层验收依赖第 13 节与 Stage 3 的 judge/heuristic 检查。
