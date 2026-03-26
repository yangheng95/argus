# Phase 4: 接线完成 + 清理方案

## 现状诊断

### 已完成
- main.tsx 分布式挂载 10 个 Solid 组件到独立 DOM 容器
- app.js 已完全移除，所有逻辑已迁移到 TypeScript services/stores
- Vite + solid-js 构建链路完整
- 消息流、任务看板、聊天输入、窗口控制等核心功能正常

### 遗留问题

| # | 问题 | 严重程度 | 类别 |
|---|------|---------|------|
| 1 | sidebar 按钮（刷新/折叠/新建）无事件监听 | 高 | 断线 |
| 2 | App.tsx 是从未激活的空壳骨架 | 中 | 死代码 |
| 3 | 15+ 组件已定义但从未 import/mount | 中 | 死代码 |
| 4 | Config 对话框 tabs 由 legacy.ts DOM 操作渲染，Solid 替代组件已写好但未挂载 | 中 | 未接线 |
| 5 | InteractionPanel.tsx 与 interactions.ts 双重实现共存 | 低 | 冗余 |
| 6 | index.html 中 ~110 个 orphaned DOM ID | 低 | 垃圾 |

## 架构决策

### 决策 1: 保留分布式挂载策略
main.tsx 的分布式挂载（每个组件 render 到独立 DOM 容器）是正确的工作方式。
**删除 App.tsx** — 单根组件方案增加复杂度无收益，且 index.html 本身提供了布局骨架。

### 决策 2: 挂载 Config 对话框的 Solid 面板
Config 对话框有 7 个 tab，每个 tab 在 index.html 中有 `<div id="xxxBody">` 容器。
legacy.ts 通过 DOM 操作渲染这些 tab 的内容。Solid 替代组件已经写好（MemoryPanel、PreferencesPanel、PromptCatalog、ChannelsPanel、SkillMarketPanel）。

**方案**: 在 main.tsx 中将 Solid 面板 render 到对应容器，替代 legacy.ts 的 DOM 渲染。
Budget 和 About tab 保持静态 HTML（无需动态组件）。

### 决策 3: Interaction 实现统一
Board.tsx 已内联 InteractionsList 展示交互列表。
interactions.ts 是 DOM 桥接层，通过 window.renderInteractions 渲染到 #goalsBody。
InteractionPanel.tsx 是自动解决交互的 Solid 组件。

**方案**: 保留 Board.tsx 的内联展示 + interactions.ts 桥接（已工作）。
挂载 InteractionPanel 作为自动解决层（auto-resolve, cooldown, unattended mode）。
两者不冲突 — Board 展示，InteractionPanel 执行自动解决。

## 执行计划

### Step 1: 修复 Sidebar 断线
在 main.tsx 中为三个 sidebar 按钮添加事件监听：
- `btnRefreshTasks` → loadTasks()
- `btnSidebarToggle` → 切换 sidebar collapsed 状态
- `btnCreateTask` → createTask()

### Step 2: 挂载 Config 对话框 Solid 面板
在 main.tsx 中 render 以下组件到对应容器：
- PromptCatalog → #promptBody
- ChannelsPanel → #channelConfigBody（需要去除 public URL 静态 HTML，改由组件渲染）
- SkillMarketPanel → #extensionsBody
- MemoryPanel → #memoryBody
- PreferencesPanel → #preferenceBody

Budget tab (#budgetConfigBody) 和 About tab (#aboutBody) 保持静态 HTML —
budget 由 legacy.ts renderBudget() 管理，about 是纯静态内容。

### Step 3: 挂载 InteractionPanel
在 main.tsx 中挂载 InteractionPanel，使其在有 pending interaction 时自动解决。

### Step 4: 删除死代码组件
确认删除以下从未被任何活路径 import 的组件：
- `App.tsx` — 空壳骨架，被 main.tsx 分布式挂载替代
- `Sidebar.tsx` — sidebar 是静态 HTML + TaskList，此组件从未使用
- `CodingMessages.tsx` — CodingTab.tsx 已覆盖此功能
- `ExecutorLog.tsx` — LogViewer.tsx 已覆盖
- `MetaPanel.tsx` — meta 渲染由 legacy.ts 处理
- `VersionBadge.tsx` — 版本信息由其他方式显示
- `AboutPanel.tsx` — about 是 index.html 中的静态内容
- `NdjsonLog.tsx` — LogViewer 已覆盖此功能

保留的组件：
- `ExecutorModelPanel.tsx` — 被 DOM controller 使用（engine chip caret）
- `RecentDirPanel.tsx` — 被 DOM controller 使用（recent directory dropdown）
- `SettingsPanel.tsx` — 作为 config 子面板的组织者（如果子面板直接挂载则也可删除）

### Step 5: 清理 legacy.ts
移除 legacy.ts 中被 Solid 组件替代的渲染函数：
- 移除 config tab 相关的 DOM 渲染代码（prompts、channels、extensions、memory、preferences）
- 保留仍在使用的函数：panelMessage、renderBudget、installLegacyGlobals 中仍需要的部分

### Step 6: 清理 index.html
- 移除 orphaned HTML 元素：chatEmpty、codingEmpty（被 Solid 组件替代）
- 移除 elapsed、btnTerminateRun（从未接线）
- Config 对话框 tab 容器中的静态占位内容（如 "Loading prompts..."）由 Solid 组件替代

### Step 7: 构建验证
- `bun run build:vite` 确认编译通过
- 检查 bundle size 变化
- 检查是否有 TypeScript 错误

## 验收标准
1. sidebar 刷新/折叠/新建按钮功能正常
2. config 对话框所有 tab 由 Solid 组件渲染
3. 无死代码组件残留
4. Vite 构建成功
5. 无 TypeScript 编译错误
6. InteractionPanel 自动解决功能激活

## 架构审计修复（补充）

### P0 修复

1. **Duplicate ID 消除** — 移除 index.html #solidBoardMount 内的 18 个静态 section
   HTML 元素（overviewSection/Body, specSection/Body/Badge, planSection/Body/Badge,
   goalsSection/Body/Badge, criteriaSection/Body/Badge, deliverySection/Body/Badge,
   evalBody, taskActionsBar）。这些 ID 与 Board.tsx 渲染的 ID 重复，导致
   getElementById 获取到被丢弃的孤立节点。

2. **InteractionPanel 挂载修复** — 从"相对于 #goalsBody 插入"改为使用独立挂载点
   `<div id="solidInteractionMount">`。旧方案在 Board 渲染前获取 goalsBody，
   获取的是被 innerHTML="" 清除的静态元素。

3. **interactions bridge 去耦** — 传入 `goalsBody: null` 禁用 DOM 注入渲染。
   移除 renderInteractions createEffect（InteractionPanel 已接管交互 UI 和自动解决，
   保留两者会导致双重 auto-resolve 竞态）。

### P1 修复

4. **53 个死 window 全局变量清除** — installLegacyGlobals() 从导出 62 个函数
   缩减为仅 9 个 load-bearing 全局变量（t, checkConnection, loadConversation,
   loadMeta, renderMeta, renderWorkspaceState, state, __legacyConv,
   __legacyHandleNonMessageEvent）。Bundle 从 281KB 降至 274KB。

### 剩余债务（P2，稳定可推迟）

- services/llm-inline.ts (305行) — 整个 LLM 配置表单仍是 vanilla DOM，无 Solid 组件
- services/tabs.ts — tab 切换绕过 Solid signal，直接操作 classList/hidden
- services/pane.ts — pane resize 状态存在 dataset 上而非 Solid store
- services/dialog.ts — 8 个 dialog 使用 native .showModal()
- Config 面板 double-fetch（onMount 重新 fetch，不读 appStore）
- 9 个 load-bearing window globals 仍是隐式耦合
