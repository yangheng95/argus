# OpenCorvus Dashboard 市场调研

Date: 2026-07-24

Status: Phase 01 研究归档；仅作为下一阶段需求整理的事实与候选输入，不是需求定稿、产品需求文档（Product Requirements Document，PRD）、设计稿或实现方案。

Scope: 桌面端 OpenCorvus Dashboard；不包含 mobile、tablet 或响应式多端交付。

## Recall

| 项目                   | 本阶段要求与证据                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户原始要求           | 按完整 Mission 流程先完成“Phase 01: OpenCorvus Dashboard 市场调研”，研究当前 OpenCorvus 产品语义、信息架构、设计语言、数据来源、技术与测试边界，并研究 3–5 个成熟竞品；本阶段只产出研究报告及索引，不进入需求定稿、PRD、HTML、React coding、test、fixture 或截图。                                                                                                                                                                                   |
| 阶段验收               | 精确创建 `specs/records/2026-07/2026-07-23-opencorvus-dashboard-market-research.md`，并在 `specs/records/2026-07/README.md`、`specs/README.md` 添加正确相对链接；报告必须包含完整 Recall、研究方法、OpenCorvus 审计、逐数据域调用点表、竞品证据矩阵、静态 React 原型机会/风险/反模式、下一阶段候选输入、证据局限与未达成项。                                                                                                                         |
| 硬约束                 | 只能修改上述三个文件；不得修改 `packages/overlay`，不得创建 `prototypes/opencorvus-dashboard/`，不得创建需求、PRD、HTML、React、test、fixture 或截图；不得编造数字；不得提交、amend、merge、fetch、pull、push 或执行任何远端操作；成果物保持未提交。桌面端是唯一研究范围。                                                                                                                                                                           |
| 工作区边界             | 本轮开始执行 `git status --short`，结果为空；对三个许可文件执行定向 `git diff`，结果同样为空。因此本轮开始时没有可观察到的预存工作区改动。本阶段仍遵守“不覆盖、不清理、不暂存未知改动”的边界，最终以结束状态和精确路径 diff 复核实际改动范围。                                                                                                                                                                                                       |
| 已读规则与索引         | `AGENTS.md`、`CLAUDE.md`、`specs/README.md`、`specs/records/2026-07/README.md`、任务审计副本 `.opencorvus/.r/t/Ph/qIC3zX/intent/request.md`。                                                                                                                                                                                                                                                                                                        |
| 已读当前实现           | `package.json`、`packages/overlay/package.json`、`packages/overlay/src/main.tsx`、`components/App.tsx`、`WorkLedger.tsx`、`TaskDirBar.tsx`、`RightDock.tsx`、`Board.tsx`、`MailboxPanel.tsx`、`store/board.ts`、`store/conversation-agents.ts`、`services/work-ledger.ts`、`services/mailbox.ts`、`services/browser-preview.ts`、`services/diff.ts`、设计 token 与 Overlay browser fixture。                                                         |
| 已读近期决策           | 包括 `2026-07-23-retire-execution-liveness-and-task-run.md`、`2026-07-23-settings-menu-skill-hub-and-work-status-semantics.md`、`2026-07-23-environment-summary-git-actions-and-resource-groups.md`、`2026-07-21-review-split-diff-and-change-total-convergence.md`、`2026-07-20-chat-browser-preview-task-binding.md`，并通过七月索引覆盖 Work Ledger、Environment、Mission、Goals、Mailbox、Settings、Review、Browser Preview 与视觉证据相关记录。 |
| 全仓 grep / 调用点范围 | 搜索范围覆盖 Task、Mission、Chat、Goal、session、Work Ledger、project directory、Git changes、Mailbox、agent/tool activity、Browser Preview 的 Overlay 组件、store、service、服务端 route、Engine/workbench projection、SDK 类型与测试 fixture。结果显示没有独立 Dashboard 生产数据层；现有事实由 Work Ledger、Task Board/conversation、Mailbox、VCS/diff、Browser Preview artifact 与 agent session/message 投影共同提供。                          |
| Deep Research 反馈     | artifact `art_f8fc01310001LP43HydMB8i9JI`，session `ses_07043f4edffemammuiABDjDSA7`。官方来源覆盖 Codex cloud/app、GitHub Copilot coding agent、Devin、Linear 与 LangSmith；核心共识是以工作对象和可追溯证据为中心，不把产品特有指标或状态直接翻译为 OpenCorvus 语义。                                                                                                                                                                               |
| Frontend Research 反馈 | artifact `art_f8fde4242001Sizb6D2TVSV1JN`，session `ses_07027b048ffelHSgCZqa8uKUGJ`，持久化 bundle 位于 `.opencorvus/.r/t/Ph/qIC3zX/fr/FY/5ZjtYm/`。建议的桌面概览由 active work/attention、project or Mission context、execution evidence 与可选的证据化 observability summary 组成；所有状态与指标必须有 canonical provenance。                                                                                                                    |
| Explorer 反馈          | `ses_07039ef58ffe6NdpzzKcK5kn8v` 确认 Overlay 是“Work Ledger 全局导航 + Conversation 主工作面 + Environment/Right Dock 任务上下文工具面”；`ses_0703f3cb2ffe3PErt1ZgxrW50U` 穷举数据调用点并确认 Dashboard fixture 应是生产投影的静态快照；`ses_070314332ffe3AD5t6CSx0zNAY` 审计 specs、原型目录与 workspace，虽经历一次模型流错误但最终产出审计结论。                                                                                                |
| Intent 反馈            | session `ses_070297d4dffeDpeNsXc99g5VG1` 将本阶段限定为研究与仓库审计，并明确后续静态原型只使用一处类型化 canonical fixture，不修改生产 Overlay。                                                                                                                                                                                                                                                                                                    |
| 独立研究边界           | 本次最终落盘不再委托子 Agent；复用上述已持久化研究与 Explorer 结果，并由当前 Build 对关键代码路径、索引风格和验证命令进行复核。                                                                                                                                                                                                                                                                                                                      |

### Recall 状态证据

- **开始状态**：`git status --short` 无输出。
- **开始时许可文件差异**：`git diff -- specs/records/2026-07/2026-07-23-opencorvus-dashboard-market-research.md specs/records/2026-07/README.md specs/README.md` 无输出。
- **边界解释**：上述结果只证明命令执行时 tracked 工作树没有可见差异；本报告不据此推断历史上从未存在其他改动。结束状态出现了本轮未触碰的并发改动，验证章节按路径区分本阶段三个许可文件与外部改动。

## 1. 研究问题

1. OpenCorvus 当前哪些产品表面已经承担“概览、定位、上下文恢复、证据查看”职责，Dashboard 应如何避免重复？
2. Task、Mission、Chat、Goal、session、Mailbox、目录、Git changes、agent/tool activity、Browser Preview 的 canonical 来源与深链边界是什么？
3. 2026 年成熟 AI coding workspace、developer orchestration/control plane、agent operations/observability 与 project command center 如何组织首页或 overview？
4. 哪些市场模式适合桌面静态 React 原型，哪些会引入第二套状态、指标或工作流语义？
5. 下一阶段需求整理前仍需决定哪些产品问题？

## 2. 方法与证据等级

### 2.1 方法

- **仓库事实调查**：从 `main.tsx` 装配关系向下追踪组件、store、service，再向后端 route、Engine/workbench projection、SDK 与测试 fixture 追踪；命名仅用于定位，不单独作为因果或语义证据。
- **历史决策调查**：读取七月 specs 索引和与 Dashboard 数据/表面重叠的近期记录，确认已经建立的单一来源、已退休概念与禁止重复的交互表面。
- **市场调查**：优先使用产品官方公告与官方文档，记录页面、URL、访问日期、可观察事实、明确分离的推断、可借鉴项、拒绝项与证据缺口。
- **交叉验证**：只有仓库代码/测试与持久化研究一致的结论才作为下一阶段的高置信输入；竞品事实不能替代 OpenCorvus 数据契约。

### 2.2 证据等级

| 等级                | 定义                                                         | 本报告用途                                                               |
| ------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| A：仓库直接证据     | 当前生产代码、服务端 route/schema、SDK、测试与已落盘架构决策 | 判断 OpenCorvus canonical source、已有表面、可模拟字段与禁止的平行来源。 |
| B：官方一手产品证据 | 官方公告、官方产品文档、官方概念文档                         | 描述竞品公开能力与页面结构。                                             |
| C：交叉产品推断     | 从多个 A/B 证据归纳的模式                                    | 仅作为机会或风险，不表述为现有产品事实。                                 |
| D：未验证缺口       | 缺少 live UI、截图、权限态、真实数据契约或可执行深链证据     | 明确列入待决策或未达成项，不以占位数字或虚构交互填补。                   |

### 2.3 事实、推断、建议与缺口的阅读契约

| 类型 | 本报告中的定义                                                                                                               | 可否直接作为下一阶段定稿依据                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 事实 | 可回指到当前仓库代码、route、schema、测试、已落盘架构记录或竞品官方页面的可观察陈述。                                        | 只能作为约束或输入；涉及产品取舍时仍需 Phase 02 决策。 |
| 推断 | 从一个或多个事实归纳出的跨表面或跨产品解释，例如“对象优先比匿名指标更适合 OpenCorvus”。                                      | 不可直接定稿，必须在需求阶段验证适用范围。             |
| 建议 | 基于事实和推断提出的候选方向，例如保留 overview-to-detail、默认省略无 provenance 指标。                                      | 仅是非绑定输入，不是需求、PRD 或设计决定。             |
| 缺口 | 当前证据不能回答的问题，包括 canonical status 汇总、统一 deep-link target、owner/team、真实 metric contract 和精确视觉几何。 | 不可用假数据、竞品标签或静态原型便利性代替。           |

本报告的 OpenCorvus 现状表与调用点矩阵以**事实**为主；“Dashboard 边界”“可模拟/禁止来源”为**建议**；竞品矩阵分别在列中隔离**观察事实、推断、借鉴/拒绝建议、证据缺口**；第 8 节全部为非定稿建议与待决策缺口。

## 3. OpenCorvus 现状审计

### 3.1 产品信息架构（Information Architecture，IA）

| 表面                  | 当前事实                                                                                                                                                             | Dashboard 边界                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Work Ledger           | `App.tsx` 左侧栏唯一工作导航，`main.tsx` 注入 `WorkLedger`；`services/work-ledger.ts` 定义 Project、Mission、Task、Chat 行及分页接口。                               | Dashboard 可复用其对象身份、标题、目录、时间、状态与 pending interaction 摘要，但不应再实现第二个可编辑 Work Ledger。 |
| Conversation / Chat   | 中央主工作面，负责真实消息、工具调用、Agent session、Composer 与任务/会话切换后的上下文。                                                                            | Dashboard 只提供返回现有 Conversation 的对象级入口，不嵌入完整 transcript、Composer 或 tool console。                 |
| Mission / Task / Goal | Mission、Task、Chat 从 Work Ledger 恢复；Task Board 提供 requirements、architecture、goals、interactions、acceptance 与 evidence。                                   | Dashboard 可呈现紧凑的父子关系、最近状态和 attention，但详细 Goal/acceptance 编辑与审阅留在现有 Board/Right Dock。    |
| Environment           | `TaskDirBar.ProjectRuntimeStatusPanel` 是 chat-header-owned Popover，聚合 Goals、Requirements、Architecture、Worktrees、Browser、Review、Files、Screenshots 与 VCS。 | Dashboard 不复制 Environment 的完整资源管理和 Git mutation；最多提供目录/VCS/可用资源摘要并深链到该表面。             |
| Right Dock            | `RIGHT_DOCK_CATALOG` 定义 Requirements、Architecture、Goals、Files、Review、Browser、Screenshots 与 File；`main.tsx` 维持这些 panel 的真实内容。                     | Dashboard 的 evidence action 应打开现有 panel，而不是复制 Browser、Review、Files 或 Screenshots 内容。                |
| Mailbox               | 左侧栏与 Work Ledger 互斥显示；按项目目录分组，支持 attention、read、delete 与 Open Task。                                                                           | Dashboard 可展示 attention queue 的摘要/最近项，但 Mailbox 是消息内容、选择和批量操作的唯一表面。                     |
| Settings              | 独立配置表面；近期决策已把 Skill 统一为一个 Settings 域。                                                                                                            | Dashboard 不承载 Provider、Skill、MCP、模型或 Expert Squad 配置工作流。                                               |
| Browser Preview       | task-scoped target/evidence route 与 EngineArtifact 是 URL、viewport、capture 与诊断的唯一来源。                                                                     | Dashboard 仅显示是否有可用 preview/evidence 以及打开动作；不得从消息文本或 shell 输出猜 URL。                         |
| Changes / Review      | `services/diff.ts` 的 ChangeGroup/per-file projection 同时服务 Review 与 Environment totals。                                                                        | Dashboard 可显示有来源的文件/增删摘要和打开 Review；不得另算 Git change totals 或创建第二套 diff cache。              |
| Agent activity        | Conversation hydrate 的 `agentView`、`store/conversation-agents.ts` 与真实 message/tool parts提供 session、agent、stage、status、时间和定位目标。                    | Dashboard 可列最近证据化 activity；不得从卡片文案、颜色或“最后活动”猜执行状态。                                       |

### 3.2 设计语言审计

- 当前 Overlay 技术栈是 **Solid.js**，不是 React；组件层使用 Kobalte 等成熟 primitives，图标使用统一 Icon registry。
- `design-language.css` 是结构 token 单一来源，包含 radius、字体权重、按钮/控件/导航密度、motion、z-index、opacity、字体层级、rail/workbench/Environment/Right Dock 几何和 agent stage 色。
- 视觉基调是桌面高密度、低噪声、对象/证据优先：14px body、紧凑 navigation row、28px 文本按钮、32px 控件、有限圆角、短动效、语义化 hover/selected wash。
- 状态必须复用 canonical status icon/label 语义；近期记录已明确拒绝用多个相似圆点同时表达 lifecycle、queued 与 pending interaction。
- 后续 React 原型可以翻译 token 与布局节奏，但不能复制生产 Solid component 实现，也不能创建与 Overlay token 并行的第二套“生产设计系统”。原型 token 只能是静态展示适配层。

### 3.3 可用数据语义审计

- **对象身份优先**：Project directory、Mission ID/session ID、Task ID、Goal ID/Goal run identity、Chat session ID、tool call/message/evidence ID 是恢复上下文的基础。
- **状态分域**：Task lifecycle、Mission task stats/interruptible、Chat active/idle/terminal、Mailbox category/attention/read、Agent activity pending/completed/error/skipped、Browser Preview target status、Git/VCS state不能压成一个通用 `active` 字段。
- **时间与顺序**：Work Ledger 使用 created/started/updated；Mailbox 使用 orderKey/createdAt；Conversation/Agent activity使用 timeline order key 与 observed time。静态 fixture 必须保留来源字段，不通过数组顺序冒充时间事实。
- **证据链接**：Mailbox `evidenceRefs`、Goal evidence changed files/commit refs、Browser Preview evidence ID、Conversation rendered card target、Review diff target 都是 typed target，而不是普通 URL 字符串。
- **聚合数字限制**：只有定义、来源实体、scope、time range、aggregation、unit 与 drill-down records 完整时，才可以显示指标；本阶段未发现适合首屏的通用成功率、生产力、成本、token、latency 或 forecast 契约。

### 3.4 技术与测试参考

| 方面            | 证据                                                                                                                                 | 研究判断                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 根依赖          | 根 `package.json` devDependencies 包含 `react` / `react-dom` `19.2.7`，并包含 Vite。                                                 | 后续 React 19 静态原型有可复用版本依据，但这不代表原型目录自动属于 root workspace。                                                                                               |
| Workspace       | 根 workspace 仅匹配 `packages/*` 与 `packages/sdk/js`。                                                                              | `prototypes/opencorvus-dashboard/` 可作为独立 React app root，但必须有明确自身应用边界；当前 workspace 不会自动管理它。是否纳入 root workspace 是下一阶段显式决策，不能静默假设。 |
| Overlay package | `packages/overlay/package.json` 使用 Solid.js、Kobalte、Vite、Playwright，并以 Node 启动 browser runner。                            | 原型应借鉴视觉与交互约束，不复制生产包结构，也不能把 React 原型误称为 Overlay 技术迁移。                                                                                          |
| 类型与服务      | Overlay service 类型、后端 Zod/schema、SDK generated types 和 route 定义共同约束真实字段。                                           | 后续 canonical fixture 类型应从这些现有语义精简投影，不引入 Dashboard-only production model。                                                                                     |
| 单元/源测试     | Work Ledger、status mapping、diff groups、Mailbox、Browser Preview、architecture guards 等已有覆盖。                                 | 下一阶段如进入 coding/test，应为原型自身交互写测试，同时保持“静态 fixture，不连接生产后端”的明确边界。                                                                            |
| Browser fixture | `work-ledger-fixture.ts`、`right-dock-fixture.ts` 展示真实选择、board hydrate、Mailbox idle、Browser target 与 Right Dock 打开契约。 | fixture 可以作为字段与交互证据，但本阶段不得复制或新建 fixture；后续也应避免把 fixture 形状升级为生产真相。                                                                       |

## 4. 全仓数据来源与调用点矩阵

下表是下一阶段可用的研究输入，不授权直接连接生产接口。静态原型仍应只有一处类型化 fixture，并将每一字段映射回既有生产语义。

| 数据域                   | 生产代码 / API / store / service / test 证据                                                                                                                              | 后续原型可模拟                                                                                                                                | 禁止建立的平行来源                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Project / directory      | `WorkLedgerProjectRow`；`services/workspace.ts`；`services/project-directory.ts`；`boardStore.selectedSource.directory`；Work Ledger project browser tests                | 稳定 project key、显示名称、canonical directory、pinned、created/updated、打开现有项目上下文的 target                                         | Dashboard 自建“项目”数据库；把 directory 等同于用户语义项目数量；根据目录名猜 owner、health 或组织                |
| Work Ledger              | `components/WorkLedger.tsx`；`services/work-ledger.ts`；`server/routes/work-ledger.ts`；`work-ledger/projection.ts`；`project-ledger-group-browser.test.ts`               | Project/Mission/Task/Chat 分组、标题、更新时间、选中对象、pending interaction、pagination snapshot                                            | 第二个可编辑任务列表、第二套排序/归档/队列事实、从卡片展示文本反推状态                                            |
| Task                     | `store/board.ts::loadTasks/loadBoard`；`GET /global/tasks`；`GET /task/:taskID/board`；`GET /task/:taskID/conversation`；Engine model；task browser fixtures              | Task ID、标题、描述、目录、priority、lifecycle status、created/started/updated、Mission parent、pending interactions、typed detail target     | Dashboard-only Task status；把 `run`/“live”重新引入为当前执行容器；无来源的完成率或预计完成时间                   |
| Mission                  | `services/mission.ts`；Work Ledger Mission row；`server/routes/mission.ts`；Mission/Chat handoff records/tests                                                            | Mission ID、session ID、标题、目录、时间、task stats、interruptible、child Task references                                                    | 单独 Mission workflow engine；把 competitor project health 或 PR 状态翻译成 Mission 状态                          |
| Chat / Conversation      | `services/coding-assistant.ts`、`services/conversation.ts`、`store/messages.ts`；session/task conversation routes；conversation hydrate tests                             | Chat session ID、标题、目录、active/idle/terminal、最近可显示活动、打开 Conversation target                                                   | 在 Dashboard 内复制完整 Chat/Composer；从 assistant prose 解析 URL、status 或 change count                        |
| Goal / acceptance        | `boardStore.board.goals`；`components/Board.tsx`/`GoalGroup.tsx`；`workbench/board.ts`；goal-run acceptance/diff routes；goal/acceptance tests                            | Goal ID、title、order/retry label、canonical goal status/result、evidence refs、changed files summary、review target                          | 第二套 Goal progress 算法；把当前 agent activity 当 Goal `running` 真相；虚构验收得分                             |
| Session / agent activity | conversation hydrate `agentView`；`store/conversation-agents.ts`；`ConversationAgentRail.tsx`；session conversation route；agent rail tests                               | session ID、agent ID、stage、parent session、Goal link、pending/completed/error/skipped、observed time、display summary、rendered card target | 以 DOM 卡片顺序或颜色推断执行状态；全局“active agents”计数；无 exact session/tool identity 的活动行               |
| Tool / message evidence  | persisted conversation message parts、tool-call parts、tree-writer rendered target、task conversation routes/tests                                                        | activity kind、observable result summary、message/tool call ID、顺序、打开对应 card/log/evidence 的 target                                    | 隐藏 tool console 副本；把 shell stdout 当 Browser Preview 或验收证据；按关键词分类成成功/失败                    |
| Mailbox                  | `services/mailbox.ts`；`MailboxPanel.tsx`；`engine/mailbox.ts`；`server/routes/mailbox.ts`；Mailbox browser tests                                                         | category、attention、subject/body 摘要、source agent/squad、Task/Goal/session refs、evidenceRefs、created/read state、project grouping        | 第二个通知持久层；自造 overdue/priority；把 unread 等同于 blocked 或 failed                                       |
| VCS / Git changes        | `boardStore.vcs`；`services/meta.ts`；`services/diff.ts::currentChangeGroups/summarizeChangeGroups`；`GET /vcs`、`GET /vcs/diff`、goal-run diff；Review/Environment tests | branch、clean/dirty、ahead/behind（仅 fixture 明确提供时）、files/additions/deletions、changed file rows、Review target                       | Dashboard 自算 totals；从 group metadata 与 per-file stats取两套答案；无来源的 velocity、savings 或 productivity  |
| Environment / resources  | `TaskDirBar.ProjectRuntimeStatusPanel`；`RIGHT_DOCK_ENVIRONMENT_TOOL_CATALOG`；worktree/file/browser services；Environment specs/tests                                    | 目录、VCS、Worktree、Requirements、Architecture、Goals 与可用工具入口的紧凑摘要                                                               | 复制 Environment 的 commit/push、worktree 删除、branch switch 或资源管理；第二份工具 catalog                      |
| Browser Preview          | `services/browser-preview.ts`；`server/routes/browser-preview.ts`；SDK generated types；`BrowserPreviewPanel.tsx`；task binding/browser tests                             | target status、URL（仅 canonical target）、viewport list、evidence ID、capture/diagnostic availability、打开 Browser target                   | message/shell URL parser、session-local URL signal、iframe/query override、Dashboard 自建 preview target          |
| Observability metric     | 当前无通用 Dashboard metric contract；LangSmith 仅提供市场建模参照                                                                                                        | 仅在 fixture 同时给出 definition、source、scope、time range、aggregation、unit 与 drill-down records 时模拟单个指标                           | active agents、success rate、tasks completed、cost、token、latency、error rate、forecast、health score 等装饰数字 |

### 4.1 状态与深链的保守结论

- Work Ledger 已有对象级选择函数：Task → `selectTask`，Chat → `selectCodingAssistantSession`，Mission → `openMissionSession`；这些是当前最强的 overview-to-detail 证据。
- Right Dock 通过现有 panel identity 打开 Requirements、Architecture、Goals、Files、Review、Browser、Screenshots 与 File，不需要 Dashboard 新建页面路由。
- Mailbox 已能用 Task ID + directory 打开 Task；其 evidenceRefs 尚不能假定全部有统一 Dashboard 导航协议。
- Browser Preview 只能以 Task + directory 解析 canonical target。没有 Task scope 时应显示 unavailable/empty，而不是猜测 URL。
- 具体 Dashboard route/selection adapter 尚未设计；下一阶段必须决定是复用函数级 selection contract、定义静态原型内部 target union，还是仅演示不可执行的 affordance。当前报告不定稿。

## 5. 竞品证据矩阵

访问日期统一为 **2026-07-24**。事实来自官方页面；“推断”是本研究的跨产品解释，不是来源原文。

| 产品                        | 页面 / URL                                                                                                                                                                                                                             | 观察事实（B 级）                                                                                                                                                          | 明确分离的推断（C 级）                                                                               | 借鉴 / 拒绝                                                                                                                                          | 证据缺口                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| OpenAI Codex app            | Introducing the Codex app — https://openai.com/index/introducing-the-codex-app/                                                                                                                                                        | 官方介绍以 project 组织多个 agent threads，支持并行工作、thread 内 review changes/diff、编辑器交接、隔离 worktree、Skills 与 automation review queue。                    | Dashboard 的首要对象可以是“工作项 + 最新证据 + review attention”，而不是 KPI 卡片。                  | **借鉴** project/thread 分组、进行中与待审阅队列、diff/evidence affordance。**拒绝**直接复制 worktree/automation 产品语义或品牌视觉。                | 公告不是完整状态/权限规范；未采集认证 live UI 与精确桌面几何。                                  |
| GitHub Copilot coding agent | Agent management — https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management ；Managing agent sessions — https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents | 官方文档描述集中 Agents 页面、session list/overview/log、progress、tool activity、steering、stop/archive、local continue、file changes 与 commit-to-session-log linkage。 | overview 到 session log/changes 的身份保持和 provenance 值得借鉴。                                   | **借鉴** session identity、最新 activity、review action、对象到证据的 deep link。**拒绝**把 PR、token usage、session length 当 OpenCorvus 默认指标。 | GitHub 特有 PR/Actions 权限与仓库模型不能直接映射；未验证所有 empty/error/permission states。   |
| Devin                       | First session — https://docs.devin.ai/get-started/first-run ；Session tools — https://docs.devin.ai/work-with-devin/devin-session-tools                                                                                                | 官方文档区分 Ask/Agent，并在 Progress 汇集 Shell、IDE、Browser 活动，允许检查或接管。                                                                                     | 多类执行证据应归属于同一 session/work object，而不是散落成独立全局指标。                             | **借鉴** typed activity convergence 与从 overview 进入工具证据。**拒绝**Ask/Agent mode、把完整 IDE/Shell/Browser 嵌入 Dashboard。                    | 文档未证明适合跨项目首页；未采集认证 UI、权限态与失败态。                                       |
| Linear Project Overview     | Project overview — https://linear.app/docs/project-overview ；Initiative and project updates — https://linear.app/docs/initiative-and-project-updates                                                                                  | 官方文档描述 Overview 组合 summary、properties、resources、documents、milestones、progress 与结构化 updates；更新历史可包含属性变化。                                     | Mission/project context 可以有紧凑属性、资源与最近 authored update，但字段必须来自 OpenCorvus 模型。 | **借鉴**单一语境摘要、resource links、最近 update、overview-to-detail。**拒绝**无来源 health、overdue、预测完成日期。                                | Linear 是项目管理语义；与 agent execution、evidence、session 的映射需 OpenCorvus 需求阶段确认。 |
| LangSmith                   | Dashboards — https://docs.langchain.com/langsmith/dashboards ；Observability concepts — https://docs.langchain.com/langsmith/observability-concepts                                                                                    | 官方文档将指标绑定 project/trace/run 或 dataset，并要求选择数据源、过滤、分组和 aggregation。                                                                             | “指标先有建模和 drill-down，再有图表”是必要约束；没有数据契约时宁可不渲染。                          | **借鉴** metric provenance、scope/time range、drill-down。**拒绝**把 trace count、error rate、latency、token、cost、feedback 当静态装饰。            | OpenCorvus 当前没有同构 trace analytics contract；本阶段无真实聚合数据与时间序列。              |

## 6. 跨产品模式判断

### 6.1 适合静态 React 原型的模式

1. **对象优先的工作与注意力区**：以 Mission、Task、Chat 或 session 为行/卡片主体，显示 canonical status、最近时间、父级语境与明确 evidence action。
2. **概览到详情，而非详情复制**：Dashboard 负责扫描、定位、恢复上下文；Conversation、Work Ledger、Environment、Mailbox、Review、Browser Preview 继续承载完整操作。
3. **项目 / Mission context 摘要**：标题、摘要、目录、相关 Goals/Tasks、资源入口、最近 update；owner、health、deadline 只在真实字段存在时出现。
4. **执行证据 feed**：按真实 agent/session/tool/message/evidence identity 展示近期 activity，并能指向 Conversation card、Changes、Browser Preview 或 Mailbox evidence。
5. **明确 empty/unavailable**：没有 canonical source 时显示“无可用数据/证据”，不以 mock KPI 填空。
6. **桌面高密度布局**：参考现有左 rail、中央 workbench、右 context/evidence 的信息节奏，但 Dashboard 是新概览画布，不复制现有三栏全功能工作台。

### 6.2 风险

- **表面重复**：把 Work Ledger、Mailbox、Conversation、Environment 或 Right Dock 再做一遍，造成双源操作和认知冲突。
- **状态翻译错误**：把 competitor 的 PR、health、overdue、Ask/Agent、active/inactive 直接映射到 OpenCorvus。
- **数据 slop**：使用没有生产来源、时间范围和 drill-down 的数字、百分比、趋势箭头、成本或成功率。
- **对象身份丢失**：overview item 只保留标题而不保留 Mission/Task/session/Goal/evidence identity，导致无法可靠恢复上下文。
- **fixture 膨胀成新模型**：为静态演示增加 production 不存在的 owner、team、SLA（Service-Level Agreement，服务级别协议）、forecast、health 字段。
- **技术边界混淆**：因原型使用 React 19 而误认为生产 Overlay 已迁移 React，或直接导入 Solid/Kobalte 生产组件。

### 6.3 明确反模式

- 首屏放置“Active agents”“Tasks completed”“Success rate”“Productivity”“Velocity”“Cost saved”“Token spend”“Latency”“Error rate”“Forecast”“Health score”等无来源指标。
- 用一套绿色/黄色/红色点覆盖 Task lifecycle、Mission stats、Chat status、Mailbox attention、Agent outcome 和 Browser Preview availability。
- 在 Dashboard 内嵌完整 Chat、Shell、Browser、Changes、Settings 或 Environment workflow。
- 从 assistant 文案、shell stdout、文件名关键词或标题推断 URL、状态、owner、优先级或成功失败。
- 为演示交互创建第二个 Router、Task store、analytics service、activity persistence 或 status enum，并声称未来可接生产。
- 把静态 fixture 中的任意数量宣称为真实 OpenCorvus 运营数据。

## 7. 静态 React 原型机会边界

### 7.1 目录与应用根判断

- `prototypes/opencorvus-dashboard/` 不与现有生产 package 路径重叠，作为**独立 React app root**在仓库组织上是可行候选。
- 根 `package.json` 已固定 React / React DOM 19.2.7 与 Vite 版本依据；但是 root workspaces 仅包含 `packages/*` 和 `packages/sdk/js`，所以该原型目录**当前不属于 workspace**。
- 下一阶段必须显式决定原型是：
  1. 独立 app，自带 `package.json` 与锁定脚本；或
  2. 修改 root workspace 纳入原型。
- 本阶段不推荐其中任一方案，也未创建目录。无论选择哪种，都不能修改 `packages/overlay`，不能连接真实后端，只能使用一处类型化 canonical fixture。

### 7.2 单一 fixture 的候选形态

下一阶段可考虑一个只读 `DashboardSnapshot`，其字段按既有域分组：

- `context`: project/Mission 标识、directory、summary、updatedAt；
- `workItems`: Mission/Task/Chat/session 的 tagged union；
- `attentionItems`: pending interaction、Mailbox attention、failed evidence 等 typed references；
- `activities`: agent/session/tool/message/evidence 事件；
- `resources`: Goals、Requirements、Architecture、Changes、Browser Preview 等 availability/target；
- `metrics`: 默认空；只有满足完整 provenance contract 才允许出现。

这只是数据组织候选，不是需求或接口定稿。字段名、cardinality、状态映射与 deep-link target 必须在 Phase 02 决策。

## 8. 下一阶段候选输入（非需求定稿）

### 8.1 候选核心用户

| 候选用户                                | 当前证据支持的需要                                                                  | 仍待验证                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 同时管理多个 Mission/Task/Chat 的开发者 | Work Ledger 已证明跨项目工作恢复、状态与 attention 扫描需求。                       | 是否需要跨项目默认首页、默认排序和过滤；哪些状态最重要。 |
| 审阅 Agent 结果的技术负责人             | Review、acceptance、Mailbox evidence 与 Browser Preview 已形成证据链。              | 是否需要团队/成员维度；审批权限和责任人模型当前无证据。  |
| 运行长 Mission 的操作者                 | Mission task stats、Agent session activity、Mailbox 和 evidence 支持进度/异常定位。 | 是否需要趋势、耗时或预测；当前不应假设。                 |

### 8.2 候选 Jobs-to-be-Done（JTBD，待办任务）

1. 当我打开 OpenCorvus 时，我想快速知道哪些工作正在进行、失败、等待我的输入或审阅，以便决定下一步。
2. 当我从多个项目切换回来时，我想从一个 overview 恢复 Mission/Task/Chat 的上下文，并进入原有详情表面。
3. 当 Agent 报告进展或完成时，我想查看其来源 session/tool/evidence，而不是只相信摘要文字。
4. 当一个 Task 有 Changes、Browser Preview、Goals 或 Mailbox evidence 时，我想一跳进入正确的现有工具面。
5. 当没有可靠指标或证据时，我想看到明确的空态，而不是虚构的健康分或效率数字。

### 8.3 候选模块

- **Current context**：当前 project/Mission、目录、摘要、最近更新时间与资源入口。
- **Work & attention**：进行中、queued、failed、pending interaction、awaiting review 的对象列表；状态词取决于 Phase 02 canonical mapping。
- **Recent execution evidence**：agent/session/tool/message/evidence feed。
- **Review & changes shortcuts**：有来源的 changed file summary、acceptance/evidence action。
- **Mailbox attention**：最近 attention items 的紧凑投影。
- **Browser Preview availability**：仅在 canonical target/evidence 存在时显示。
- **Optional metric region**：默认不纳入；只有后续发现完整生产 metric contract 才进入候选。

### 8.4 待决策问题

1. Dashboard 是全局跨项目首页，还是选中 project/Mission 后的局部 overview？是否需要两层视图？
2. Work Ledger 与 Dashboard 的职责切分：Dashboard 是否只读，还是允许有限的打开/继续/审阅动作？
3. 哪些 Task、Mission、Chat 与 Agent statuses 是当前实现可长期依赖的 canonical presentation semantics？
4. “Awaiting review”在 OpenCorvus 中应由 Mailbox attention、acceptance evidence、pending interaction 还是专门字段表达？不能从 competitor 标签直接导入。
5. overview item 到 Work Ledger、Conversation、Environment、Goals、Mailbox、Review、Browser Preview 的统一 target union 如何定义？
6. fixture 的 timestamp、owner、attention、directory、git changes 与 evidence target 采用哪些确切类型？owner/team 当前是否完全省略？
7. 是否需要筛选、分组、搜索；若需要，只允许使用 canonical fixture 已拥有的字段。
8. static prototype 的 app root 是否加入 root workspace；如何保证 React 19 与现有 Bun/Vite 工具链单一版本来源？
9. 是否需要任何 aggregate metric；若回答为是，必须先定义 source、scope、time range、aggregation、unit 和 drill-down。
10. desktop reference viewport、信息密度与 visual acceptance region 需要在设计阶段明确；当前没有 reference screenshot 可做像素或区域 parity。

以上内容全部是 **Phase 02 输入**，不是需求、PRD、交互规格或验收定稿。

## 9. 研究结论

OpenCorvus Dashboard 最有价值的方向不是复制传统 SaaS 指标盘，而是建立一个**桌面端、对象优先、注意力优先、证据优先的 overview**：让用户扫描 Mission/Task/Chat/session，识别需要行动的工作，并以稳定 identity 回到 Work Ledger、Conversation、Environment、Mailbox、Review 与 Browser Preview。

最重要的产品约束是保持单一来源：

- Work Ledger 继续拥有跨项目工作对象；
- Task Board/conversation 继续拥有任务、Goal、session 与消息/工具事实；
- Mailbox 继续拥有 durable attention message；
- diff service/Goal evidence 继续拥有 Changes；
- task-scoped EngineArtifact 继续拥有 Browser Preview；
- Dashboard 只做静态投影、排序与入口，不创造第二套 production truth。

因此，下一阶段应先完成用户、scope、状态映射、target union 与 fixture contract 决策，再进入 PRD/设计。任何 KPI、趋势图或健康分都应默认排除，直到存在可追溯生产数据契约。

## 10. 证据局限与未达成项

- 未采集竞品认证 live UI 截图，因此不能确认精确网格、尺寸、视觉密度、hover/focus、空态、错误态和权限态；市场视觉结论仅到信息架构与公开交互模式层级。
- 没有 task-scoped reference screenshot，本阶段也被明确禁止创建截图；因此没有视觉 comparison evidence。
- Deep Research 与 Frontend Research 的官方来源是页面级事实，不是 OpenCorvus 状态映射授权。
- Explorer 的 repository 调查提供了广泛调用点，但部分历史模型仍包含已计划退休的 `Run` 概念；本报告依据 2026-07-23 架构决策，禁止把 Task Run 或 execution liveness 纳入 Dashboard 新模型。
- `ses_070314332ffe3AD5t6CSx0zNAY` 曾遇到一次模型服务中断后重试；最终审计文本存在且本次已用当前文件读取复核关键 workspace/spec 结论。
- 统一 deep-link adapter、canonical status summary、owner/team 字段、metric contract、fixture schema、模块优先级、布局与交互尚未定稿；它们属于 Phase 02 及后续阶段。
- 本阶段没有创建 `prototypes/opencorvus-dashboard/`、React 代码、PRD、HTML、test、fixture 或截图，也没有修改生产 Overlay；这些不是遗漏，而是本阶段明确非目标。
- 本阶段不提交、不 push；三个成果物保持工作区未提交状态。

## 11. Phase 01 验证记录

结束前必须执行并保留以下只读验证证据：

1. 三个精确文件存在；
2. `specs/records/2026-07/README.md` 使用同目录相对链接 `2026-07-23-opencorvus-dashboard-market-research.md`；
3. `specs/README.md` 使用根索引相对链接 `records/2026-07/2026-07-23-opencorvus-dashboard-market-research.md`；
4. `git diff --name-only` 只列出三个许可文件；
5. `git diff --check` 与文档健康/历史链接校验通过；
6. 结束 `git status --short` 保持成果物未提交，并且没有 commit、amend、merge、push 或远端操作。

### 11.1 结束状态与并发改动边界

结束 `git status --short` 显示以下 modified 路径：

- **本阶段修改**：`specs/README.md`、`specs/records/2026-07/2026-07-23-opencorvus-dashboard-market-research.md`、`specs/records/2026-07/README.md`；
- **本轮未修改、在执行期间并发出现**：`packages/overlay/src/styles/surfaces/conversation.css`、`packages/overlay/test/browser/task-dirbar-keyboard.test.ts`、`packages/overlay/test/task-cwd-row-layout.test.ts`、`specs/records/2026-07/2026-07-23-environment-heading-geometry-and-mission-presentation.md`。

本轮没有对第二组路径执行编辑、覆盖、清理、暂存或 Git 恢复操作。验收“只改三个许可文件”以本轮实际写入记录和三个许可路径的定向 diff 为准；全工作区 `git diff --name-only` 包含并发改动，因此不能把全工作区七条路径全部归因于本阶段。

最终命令结果由本轮 Build 终端证据记录；如果任何一项不满足，本阶段不得宣称完成。
