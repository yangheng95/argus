# Overlay UI/UX 大规模重构 — 方案落盘

10 轮无人值守自监督迭代。每轮 = 并行 Explore → 汇总 → 实施 → vite build → commit + push。

## 第 1 轮 探索结果汇总（截至两份返回）

### 视觉/样式（Agent A）

CSS 体量：styles.css 11756 行 + styles/card.css 1830 行（13586 行总）。变量系统完整（颜色/间距/字号），但 PermissionsPanel 等 Panel **大量绕过 token 硬编码 px/颜色**。

P1 修复：
- `styles.css:10130-10225` PermissionsPanel 全量硬编码 → 改 `--ui-gap-*` / `--ui-font-*` / `--good/--warn/--bad`。
- Permission 按钮对比度低（18% 背景 + 50% 边框 + 纯彩色文字）→ 提升到 28% 背景 + 高亮文字。

P2/P3：
- `styles.css:5882-5900` DeliveryCard 硬编码 rgba 边框 → `--good-dim/--good`。
- `styles.css:3507-3545` FileViewPanel 蓝色径向梯度无 light 主题适配。
- `styles.css:3550` CodeSpan `var(--accent, #4a9eff)` 备用值在 vscode-dark 主题对比度差。
- `styles.css:9756` RequirementsPanel req-id 48px 固定宽超长 ID 截断不可控。
- `styles.css:10114` ArchitectPanel arch-generating spinner 隐藏时空白。
- `card.css:235-236` Light 主题 `.card__round` 对比度仅 2.5:1（低于 WCAG AA）。
- `card.css:620-622` Tool 卡虚拟滚动条无样式。
- vscode-dark 主题缺 `card.css` 的覆盖块。
- delivery-card 无 light 主题适配。
- 中文 i18n 长文本无 ellipsis 防护，可能撑破布局。
- 多数 Panel 缺 `:focus-visible` 样式。

Token 整理：
- 弃用 `--surface-1/2`，统一 `--subtle-1~5`。
- 弃用 `#e8e8e8` 硬编码 → `--text-strong`。
- 统一 `--good`（去掉 `#5fad56` / `#5ac8a8` / `#34c759` 三种绿）。
- 统一 `--warn`（去掉 `#d4a72c` / `#f0b429` / `#ff9f0a`）。
- 明确定义 `--accent-info`。

### 信息架构与显示完整性（Agent B）

事件→渲染缺口：
| 事件 | 后端发出 | 前端 | 缺口 |
|---|---|---|---|
| `usage.updated` | executor/managed.ts:527 | ❌ 完全丢弃 | token/cost 无显示 |
| `session.error` | managed.ts:554 等 4 处 | ⚠️ 仅 status badge，错误内容不显示 | 错误 reason 隐藏 |
| `approval.request` | managed.ts:501 | ⚠️ 标 kind 但无 UI 气泡 | 用户无法响应批准请求 |
| `input.request` | managed.ts:514 | ⚠️ 同上 | 等待态不可见 |
| `permission.asked/replied` | executor/opencode.ts:260,267 | ⚠️ 无气泡 | 同上 |
| `run.progress.progressType` | 多处 executor | ⚠️ events.ts 过滤丢弃 | tool 执行 stdout/exit_code 失踪 |

Top 10 信息缺失：
1. **TokensPanel 不存在** — token/cost/model 后端有数据，前端 store 不接。
2. Session 错误消息未气泡化 — 仅红 X，错误文本不显示。
3. CardHeader 无 duration（已有 `info.time` 数据未用）。
4. Approval/Permission 气泡缺失 → 用户无法批准。
5. Model name 徽章缺失。
6. 卡片内无 "thinking…" / "processing…" 文本，仅 spinner。
7. TopBar 不显示 git branch/worktree（boardStore.vcs 未渲染）。
8. Tool 执行无 stdout/progress streaming 反馈。
9. 多 Panel 无空态消息（MemoryPanel/TracePanel）。
10. SSE 断开时仅顶栏小徽章，无消息流 banner。

冗余：TaskProgressBar 与 ConnectionBadge 重复；server heartbeat SSE 流量可优化。

### 修复优先级（汇总两份）
P0（必做）:
- routing `usage.updated` → store → CardHeader 显示 token + cost
- approval/permission/input → 新增 InteractionBubble 组件
- PermissionsPanel CSS 整改（去硬编码）

P1:
- CardHeader 读 `info.time.completed` 显示 duration
- TopBar 补 git branch
- DeliveryCard / FileViewPanel light 主题适配
- 错误消息气泡（包含 reason 全文）
- Permission 按钮对比度修复

P2:
- 统一颜色/间距 token；删除三种绿/警告
- 各 Panel 补空态文案
- "thinking…" 文本提示
- card.css 补 vscode-dark 主题
- 中文 i18n ellipsis 防护
- :focus-visible 全量补齐

待 Agent C/D 返回后追加交互/Panel 故障部分，再开始实施。
