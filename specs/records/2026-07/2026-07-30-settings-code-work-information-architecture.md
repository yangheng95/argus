# Settings Code / Work Information Architecture

## Recall

### 用户原始要求

- 先审计现有 Settings，识别没有反映 Code / Work 双线叙述和层级错误的根因。
- 合并独立 Claude 审计意见后，开始自动化改造与功能测试。
- 改造必须体现用户面对的 Code / Work 产品双线，而不是继续暴露内部 `chat` 运行时命名。

### 验收指标

- Settings 导航以所有者与产品边界组织，Code 与 Work 成为同级一级页面。
- Code / Work 页面分别固定到内部 `chat` / `work` capability assignment，不再在 Tool、Skill、MCP 三张资源页内重复切换产品。
- Skill Library 与 MCP Connections 只负责共享资源清单；固定 Tool 只在 Code / Work 页面只读呈现。
- Mission Cards 与 Scheduled 归入 Missions & Automation；Agent Squads 只保留 Market 与 Installed。
- Agent Squad 的 Skill、MCP、Tool 不再作为三张顶层 Settings 页面；Installed Squad 详情继续作为 package capability 的单一检查入口。
- Installed Agent Squads 建立真正的二级设置结构：左侧选择一个 Squad，右侧以 Overview、Agents & Capabilities、Configuration、Package Details 分页展示和配置该 manifest `id` 对应的单一 package。
- Settings 搜索可直接命中 Code、Work 及其能力关键词。
- Agent Models 死入口和其专用数据加载层被删除；模型选择仍由 Composer 的单一来源负责。
- 通过 Overlay typecheck、build、非 UI 文档健康检查，并在隔离真实页面完成导航、搜索、Code/Work、资源库与 Agent Squad 的人工交互和截图复核。

### 硬约束

- 不新增、修改或运行 UI 自动化测试；当前任务触及到的旧 Settings UI 源码断言、浏览器测试和专用 fixture 直接删除。
- UI 验收只走真实页面交互和人工查看截图，不生成可重复的断言脚本、fixture 或 baseline。
- Code 的持久化标识继续使用后端唯一 `chat` contract；UI 不新增第二个映射字段或兼容 alias。
- 不在前端伪造尚未落地的 `product_pillars` 后端筛选合同。
- 不恢复 Agent Models 设置；模型由 Composer 按 turn 选择。
- 不触碰并行中的 Composer mention 代码、测试和方案改动。

### 已读取资料

- `specs/current/architecture/17-code-work-agent-platform.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-29-composer-model-single-source-repair.md`
- `packages/overlay/src/store/dialog.ts`
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/components/settings/ConversationCapabilityPanel.tsx`
- `packages/overlay/src/components/settings/ExpertSquadCapabilityPanel.tsx`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/components/settings/AgentModelsPanel.tsx`
- `packages/overlay/src/components/settings/SkillMarketPanel.tsx`
- `packages/overlay/src/services/conversation-capability.ts`
- `packages/overlay/src/services/config-dialog-control.ts`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`

### 全仓 grep 结果

| 契约 / 路由 | 全部生产调用点 | 处理 |
| --- | --- | --- |
| `ConfigDialogTab` / `CONFIG_SECTIONS` | `store/dialog.ts` 定义；`ConfigDialogHost.tsx` 渲染；`config-dialog-control.ts` 校验；`CommandPalette.tsx` 构造命令 | 在 registry 中用 `code` / `work` 替换顶层 `tool` 与重复 capability 路由；消费者继续读取同一 registry |
| `ConversationCapabilityPanel` | 仅 `ConfigDialogHost.tsx` | 改成由页面显式传入固定 experience，一次渲染 Tools、Skills、MCP 三个区块 |
| `ExpertSquadCapabilityPanel` | 仅 `ConfigDialogHost.tsx` | 删除顶层路由、组件及只为其存在的 scope helper |
| `ExpertSquadSkillConfigurationPanel` / `ExpertSquadMcpConfigurationPanel` / `ExpertSquadToolConfigurationPanel` | 导出于 `SkillMarketPanel.tsx`，生产代码仅由待删除的 `ExpertSquadCapabilityPanel.tsx` 引用 | 删除无生产消费者的导出实现，保留 Installed Squad 详情已经拥有的 package capability 信息 |
| `AgentModelsPanel` / `agent-models-data` | 无生产入口；仅旧 UI 测试与 fixture 引用 | 删除死代码、专用 i18n 和专用 UI 测试/fixture；不创建替代 Settings 模型源 |
| `mission-skill` | `ConfigDialogHost.tsx` 的唯一 Settings 入口；Mission Composer/service 另有真实业务调用 | 只调整 Settings 分组，不改变 Mission Skill service 与 Composer 合同 |
| `chat` / `work` experience | `services/conversation-capability.ts` 与 `ConversationCapabilityPanel.tsx` | 保持服务合同；Code 页面固定投影 `chat`，Work 页面固定投影 `work` |

### 独立 agent 反馈

- Claude 审计确认根因是“按资源类型组织”压过“按产品所有者组织”，并同意 Code / Work 必须成为同级页面、Mission 必须从 Agent Squads 中移出、搜索和 scope 表达需要修正。
- 合并时拒绝四项与现有单一来源冲突的建议：不恢复 Code/Work 模型设置；不把 Work 默认 Skill 的取消选择描述为不可恢复；不把所有共享设置复制进 Code/Work；不只把 Chat 文案重命名为 Code。
- 第二轮独立审查发现配置归属文案误写为 project、快速切换 Squad 时配置请求可能乱序覆盖、失败重载可能保留旧快照、旧 capability 分支仍有不可达实现，以及重复 DOM ID 和布尔控件缺少可访问名称。实施已逐项修正：配置明确为按精确 manifest `id` 持有的 user-global 值；请求以 scope 与 Squad 身份隔离并丢弃过期结果；加载前清空旧快照；删除旧分支；外层面板单独拥有 ID；Switch 使用字段 label。

## 根因与替换设计

现状不是单纯的命名问题。导航先建立 Tool、Skill、MCP 三个资源页，每个页面再维护一个本地 Chat/Work 选择；结果是产品身份被降到二级临时状态，同一项目的 Code/Work 配置被分散到三处，且 Skill/MCP 的资源生命周期与产品 assignment 混在同一页面。Agent Squads 又把 package capability 拆成三张顶层页，并错误纳入 Mission Cards，形成第二套资源优先层级。

替换后的唯一层级：

1. Application：General、Appearance、Network。
2. Product：Code、Work。
3. Missions & Automation：Mission Cards、Scheduled。
4. Agent Squads：Market、Installed。
5. Shared Resources：Providers、Skill Library、MCP Connections、Channels。
6. Context：Memory。
7. Data：Archive。
8. About 保持正常导航流的末项。

Code / Work 页面是 capability assignment 所有者；Skill Library / MCP Connections 是项目共享资源生命周期所有者；Installed Squad 是 package capability 检查入口，并编辑由精确 manifest `id` 持有的 user-global configuration。Installed 页面采用 master-detail：一级 Settings 只选择 Market / Installed，Installed 内部再选择精确 Squad，并在二级标签页呈现 Overview、Agents & Capabilities、Configuration、Package Details。二级选中状态只负责当前页面呈现，不改变 `prompt_profile.active`；实际激活仍由既有 project/session 动作显式完成。三类职责不再叠放。

## 实施步骤

1. 更新 Settings registry、图标、分组、搜索关键词和面板映射。
2. 重构 Conversation capability 页面，移除本地 experience 状态并按固定产品页面统一呈现 Tools、Skills、MCP。
3. 把 Installed Squad 的长平面详情重组为 master-detail 二级设置页，让 Overview、Agents & Capabilities、Configuration、Package Details 各自拥有明确内容边界。
4. 删除三张 Squad capability 顶层页、死 Agent Models 表面及专用 UI 测试债。
5. 更新中英文层级、作用域和所有权文案，清理无消费者样式。
6. 执行 typecheck、build、i18n / 文档健康等非 UI 检查。
7. 启动隔离 Overlay 页面，人工操作 Settings 搜索、Code、Work、资源库和 Agent Squad 二级页面，并逐张查看截图。
8. 二次审查 diff、确认并行改动未被纳入后，以 `dsw-33987` 前缀提交并推送 `myhexin/v0.0.25beta`。

## 验收记录

### 自动化检查

- `cd packages/overlay && bun run typecheck`：通过。
- `cd packages/overlay && bun run check:i18n`：通过，面板中英文键完整。
- `cd packages/overlay && bun run build`：通过；Vite 仅保留第三方 `"use client"` 与既有 chunk size 警告。
- `bun run typecheck`：通过，Turbo 8 / 8 个实际配置了 typecheck 的 package 完成。
- `bun run docs:check`：通过，311 个 API operation、24 个 group 与生成文档一致。
- `bun run api:routes-check`：通过，33 个 route 文件的 6 类规则与 inventory 一致。
- `bun test packages/opencorvus/test/conversation/capability-session-loop.test.ts packages/overlay/test/expert-squad-lifecycle-service.test.ts packages/opencorvus/test/expert-squad/configuration.test.ts packages/opencorvus/test/server/expert-squad-routes.test.ts`：19 项非 UI 正向契约全部通过，覆盖 Code/Work assignment 隔离、Work presentation Skill、MCP 精确归属、按 manifest `id` 读取和更新 user-global configuration，以及 Squad catalog / activation 生命周期。
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`：22 项全部通过。
- `git diff --check`：通过。
- 当前任务触及到的旧 Settings UI 浏览器测试、源码字符串断言与专用 fixture 已按仓库禁令删除，未运行、未改写成新 UI 测试。

### 真实页面与人工视觉复核

- 使用独立临时 `OPENCORVUS_HOME` 启动真实 backend 与 Overlay 页面，确认 Settings 导航按 Application、Product、Missions & Automation、Agent Squads、Shared Resources、Context、Data 组织。
- Code 与 Work 均以独立一级页面呈现；真实 backend 数据确认 Work 分配 `work-presentations`，Code 不分配该 Skill；页面不再出现 Chat/Work 局部切换器。
- 搜索 `presentation` 只命中 Product / Work；Skill Library 与 MCP Connections 只展示共享资源生命周期，不再承担产品选择。
- 最终构建后重新检查 Skill Library：显式 `Install Skill` 动作可展开 Folder Path / Remote URL / Git Repository 安装表单；共享列表、拖放入口与 Reload 保持同一生命周期页面。MCP Connections 明确说明资源在当前项目创建、在 Code / Work 页面分配。
- Installed Agent Squads 的总览截图确认左侧单列 Squad 选择、右侧详情与生命周期动作分离；Overview 明确区分浏览、项目选择和有效选择。
- Agents & Capabilities 截图确认 12 个 Agent 以可展开列表呈现各自有效 Tools、Skills、MCP 投影。
- Configuration 截图确认内置 General 未声明字段时仍可进入二级页，并明确显示 `No configurable fields` 与 user-global / exact manifest ID 边界；声明字段的 package 继续通过同一 manifest `id` 的既有配置 route 原位加载与保存。
- Package Details 初次截图发现长 Agent 列表导致三张摘要卡等高拉伸；将 Projected agents 改为独占整行后重新构建和截图，Source、Declaration hash 与 Agent 列表恢复可扫描布局。
- 人工检查未发现重复标题栏、产品层级回退、原始 `chat` 内部错误泄漏或 Squad 浏览动作误改 active profile。
- 验收使用的隔离服务已正常停止，临时数据目录已移入系统废纸篓；未触碰运行中的用户 Overlay。
