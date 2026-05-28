# Mission 面板与默认 Panel 对齐 — 复用三栏原语，消除双源 chrome

> 日期：2026-05-29 · 触发：用户截图反馈 9 处 Mission 视觉背离 Panel
> 约束：CLAUDE.md rule 8（禁止双源）、rule 9（抽象复用）、rule 5（禁止过度工程）

## 1. 问题与根因

`components/Mission.tsx` + `styles/surfaces/mission.css` 另起炉灶重写了三栏布局、
列头、composer 包裹、会话卡片尺寸与目标条样式，没有复用默认 Panel 已有的共享原语：

- `services/pane.ts` —— 三栏可拖拽逻辑
- `.oc-surface-header`（surfaces/header.css）—— 统一列头（固定高度/背景/radius 0）
- 整宽挂载的 `ChatComposer`（`#solidChatComposer`，无 max-width 居中）
- Panel 的 surface token：`--rail-surface` / `--inspector-surface` / `--chat-canvas`

这是 rule 8/9 违规：同一套三栏 chrome 出现了两份平行实现。

**根因一句话**：Mission 应复用 Panel 的三栏机制 + 共享 chrome 原语；
列内内容（任务台账过滤 / 渠道面板）保持 Mission 专属。

## 2. 已核实事实

- `#chatGoalsStrip`（index.html:226）是死桩，从不被填充（conversation.css:357）。
  目标条 = `<Conversation>` 内部的 `<TaskProgressBar/>`（Conversation.tsx:390），
  Panel 与 Mission 同一组件 —— 差异完全来自 mission.css 的覆盖样式。
- `.pane-resizer`（workspace.css:256）是布局无关全局类，Mission 可直接复用。
- `pane.ts` 硬编码 Panel 元素 id（`panelBody`/`workspaceMain`/`leftPaneResizer`/
  `rightPaneResizer`）与 CSS 变量（`--ui-sidebar-width`/`--ui-sections-width`）。

## 3. 决策

### 3.1 泛化 `pane.ts`（issue #7 的架构核心）

引入 `PaneConfig`，把硬编码 id/变量改为参数：

```ts
export interface PaneConfig {
  bodyId: string;        // panelBody | missionBody
  centerId: string;      // workspaceMain | missionWorkbench
  leftHandleId: string;  // leftPaneResizer | missionLedgerResizer
  rightHandleId: string; // rightPaneResizer | missionChannelsResizer
  sidebarVar: string;    // --ui-sidebar-width | --ui-mission-ledger-width
  sectionsVar: string;   // --ui-sections-width | --ui-mission-channels-width
}
```

- 所有内部函数加 `config` 形参；`paneDrag` 携带启动时的 config。
- 导出 `PANEL_PANE_CONFIG` / `MISSION_PANE_CONFIG`。
- Panel 行为零回归：main.tsx 显式传 `PANEL_PANE_CONFIG`。

### 3.2 列宽持久化：Mission 独立（用户确认）

新增 settings `missionLedgerWidth` / `missionChannelsWidth`，与 Panel 互不影响。

### 3.3 目标条：与 Panel 完全一致（用户确认）

删除 mission.css 对 `.task-progress` 的覆盖，让其继承 Panel。

## 4. 9 点映射

| # | 修复 |
|---|------|
| 1/9 | ledger→`--rail-surface`，channels→`--inspector-surface`，workbench→`--chat-canvas` |
| 2 | 删 `.mission-conversation-kicker`，列头单行 |
| 3 | 三列头统一 `.oc-surface-header`（固定高度/背景/radius 0） |
| 4 | 删 `.mission-conversation .task-progress` 覆盖块 |
| 5 | 删 `.mission-conversation .chat-scroll` 覆盖块（卡片继承 Panel 布局） |
| 6 | composer 齐平挂载，去 `.chat-input { max-width }` |
| 7 | 泛化 pane.ts；mission-body grid→flex + `.pane-resizer`；独立列宽 |
| 8 | 列级 chrome `--oc-radius-soft`→`--oc-radius-none`；列内控件保留 |

## 5. 改动文件

`services/pane.ts`、`main.tsx`、`store/settings.ts`、`components/Mission.tsx`、
`styles/surfaces/mission.css`；测试 `test/pane-config.test.ts`（新）、
`test/mission-page-mode.test.ts`、`test/mission-html-entry.test.ts`、
`test/surface-header-primitive.test.ts`。

## 6. 验证

build:overlay → 进 Mission 页对照 Panel 逐项核对（列头一致、可拖拽且不串 Panel、
composer 整宽、卡片对齐、目标条一致、圆角/背景统一）→ 跑定向测试 → 二次 grep 自审。

## 7. 不做（rule 5）

- 不加列折叠按钮（仅拖拽）。
- 不改 ledger/渠道内容逻辑（只对齐 chrome）。
- 不动 TaskProgressBar 组件本体（仅删覆盖 CSS）。
