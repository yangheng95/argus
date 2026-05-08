# Theme — VS Code Passthrough（业界对齐）

> 落盘日期：2026-05-07
> 分支：`claude/ui-design-discipline-overhaul-2026-05-07`

## §0 问题（用户原话）

> 改了几个小时，vscode theme 为什么还是混入了 dark 主题的颜色？

R1/R2 改动只修了 **data-theme 切换时序、cascade 选择器对称、boot 链路单源、scrollbar/typography 等卫生**，全是 *容器* 修复。**真正的色值层一直没动**：`cascade/vscode-dark.css` 是为 VS Code Default Dark+ 写的硬编码 `#1e1e1e / #252526 / #cccccc`，与用户在 VS Code 里实际选的 Dark 主题（One Dark Pro #282c34、Dracula #282a36、Monokai 等）色值不一致 —— 视觉上就是"我应用的 dark 调色板上叠了一层异色 dark"。

## §1 业界做法（VS Code Webview 主题对齐标准）

VS Code 在 webview 中**自动注入** `--vscode-*` CSS 变量，并跟随用户切换 active color theme **实时更新**。webview 端只需消费这些变量，不应该重新维护一套硬编码 palette。参考：
- VS Code Webview API: `https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content`
- VS Code Theme Color reference: `https://code.visualstudio.com/api/references/theme-color`

VS Code 同时给 body 加了 `vscode-light` / `vscode-dark` / `vscode-high-contrast` class，但**色值的真实来源是 `--vscode-*` 变量**，不是 class。

我们的现状：
- `panel.ts:32-37` 把 `ColorThemeKind` 4 值映射到 overlay 主题 2 值（light / vscode-dark） — **这一层是对的**，决定 overlay 容器 class 是 light 派还是 dark 派
- `cascade/vscode-dark.css` palette 全部是硬编码 hex/rgba — **这一层是错的**，应该全部改 `var(--vscode-*)` 引用

业界做法的本质：**容器选择器决定 typography/spacing/layout 等结构性差异；色值完全交给 host 注入的变量穿透**。

## §2 方案

### 2.1 cascade/vscode-dark.css — 完全隔离（用户原话："不要耦合"）

每个 palette token 改成纯 `var(--vscode-*)` 或从它派生的 `color-mix()`。

**禁止**：
- 任何硬编码 hex（`#xxxxxx`）
- 任何 `rgb()` / `rgba()` 字面量
- 任何 `var(--vscode-*, hexFallback)` —— fallback 也是耦合
- 任何引用 `cascade/dark.css` / `cascade/light.css` 的 token

**允许**：
- `var(--vscode-*)` 引用（VSCode webview 环境注入）
- `color-mix(in srgb, var(--vscode-*) X%, transparent)` 派生 dim/wash/glow 系列
- `color-mix(in srgb, black/white X%, transparent)` —— black/white 是 CSS keyword，不是色值，用于结构性遮罩 / 高光（与主题无关，业界标准做法）
- `inset` / `transparent` / `none` 等 CSS keyword

如果在 Tauri / 浏览器（无 VSCode webview）下意外激活了 `data-theme="vscode-dark"`，token 解析为空 —— 这是设计意图：vscode-dark **只对 VSCode webview 有意义**，没有 fallback 兜底意味着误用立刻肉眼可见，不会静默退化成"dark 主题异色版"。

token 映射表（90 项）：

| overlay token | VS Code 变量 | 备注 |
|---|---|---|
| `--bg` | `--vscode-editor-background` | 编辑器主底 |
| `--surface` | `--vscode-sideBar-background` | 侧边栏底 |
| `--surface-hover` | `--vscode-list-hoverBackground` | hover 态 |
| `--surface-inset` | `--vscode-input-background` | 输入框底 |
| `--surface-strong` | `--vscode-titleBar-activeBackground` | 标题栏底 |
| `--rail-surface` | `--vscode-sideBar-background` | 同 surface |
| `--chat-canvas` | `--vscode-editor-background` | 聊天画布 = 编辑器底 |
| `--inspector-surface` | `--vscode-sideBar-background` | inspector 同侧栏 |
| `--panel-body-bg` | `--vscode-panel-background` | 面板底 |
| `--chrome` | `--vscode-titleBar-activeBackground` | titlebar 调 |
| `--border` | `--vscode-panel-border` | 主分隔线 |
| `--border-hover` | `--vscode-focusBorder` | 焦点边框 |
| `--border-strong` | `--vscode-input-border` | 输入边框 |
| `--text` | `--vscode-foreground` | 主文 |
| `--text-strong` | `--vscode-editor-foreground` | 强调文 |
| `--text-soft` | `--vscode-descriptionForeground` | 软文 |
| `--text-muted` | `--vscode-disabledForeground` | 禁文 |
| `--text-on-accent` | `--vscode-button-foreground` | accent 上的文 |
| `--accent` | `--vscode-button-background` | 主 accent |
| `--accent-hover` | `--vscode-button-hoverBackground` | accent hover |
| `--accent-dim` | `color-mix(in srgb, var(--accent) 14%, transparent)` | 派生 |
| `--accent-ring` | `color-mix(in srgb, var(--accent) 30%, transparent)` | 派生 |
| `--accent-glow` | `color-mix(in srgb, var(--accent) 24%, transparent)` | 派生 |
| `--accent-shadow` | `0 10px 26px color-mix(in srgb, var(--accent) 28%, transparent)` | 派生 |
| `--accent-start/mid/end/gradient/gradient-hover` | `var(--accent)` / `var(--accent-hover)` | 简化为单色 accent |
| `--hover-accent-border` | `color-mix(in srgb, var(--accent) 36%, transparent)` | 派生 |
| `--hover-accent-wash` | `color-mix(in srgb, var(--accent) 10%, transparent)` | 派生 |
| `--hover-accent-shadow` | `0 18px 40px color-mix(in srgb, black 50%, transparent)` | 固定 |
| `--info` | `--vscode-charts-blue` | 信息蓝 |
| `--info-dim` | `color-mix(in srgb, var(--info) 12%, transparent)` | 派生 |
| `--good` | `--vscode-charts-green` | 通过绿 |
| `--good-dim` | `color-mix(in srgb, var(--good) 14%, transparent)` | 派生 |
| `--warn` | `--vscode-charts-yellow` | 警告黄 |
| `--warn-dim` | `color-mix(in srgb, var(--warn) 15%, transparent)` | 派生 |
| `--bad` | `--vscode-charts-red` | 失败红 |
| `--bad-dim` | `color-mix(in srgb, var(--bad) 14%, transparent)` | 派生 |
| `--scrollbar-thumb` | `--vscode-scrollbarSlider-background` | 滚动条 |
| `--scrollbar-thumb-hover` | `--vscode-scrollbarSlider-hoverBackground` | 滚动条 hover |
| `--session-scrollbar-track` | `color-mix(in srgb, var(--text) 4%, transparent)` | 派生 |
| `--subtle-1..5` | 5 级 `color-mix(in srgb, var(--accent) X%, transparent)` 阶梯 | 派生 |
| `--shadow / --shadow-md / --shadow-lg` | `inset 0 1px 0 color-mix(in srgb, white 4-5%, transparent)` | 固定（不是色而是高光） |
| `--dialog-bg` | `var(--vscode-editor-background)` | 对话框底 |
| `--dialog-backdrop` / `--ui-scrim` | `color-mix(in srgb, black 60%, transparent)` | 固定遮罩 |
| `--ui-shadow-tone` | `color-mix(in srgb, black 32%, transparent)` | 固定 |
| `--ui-highlight-tone` | `color-mix(in srgb, white 4%, transparent)` | 固定 |
| `--ui-glass-tint` | `color-mix(in srgb, white 3%, transparent)` | 固定 |
| `--executor-menu-bg/shadow/row-hover-bg` | 同对应 surface/shadow 派生 | |
| `--task-bar-bg/border-color/backdrop-filter` | 同 surface/border | |
| `--menu-panel-bg` | `var(--vscode-menu-background)` | 菜单底 |
| `--divider-soft` | `color-mix(in srgb, var(--border) 60%, transparent)` | 派生 |
| `--panel-fill / --card-fill / *-hover` | 同 surface/inset/hover | |
| `--guide-card-border/bg/shadow` | `var(--accent)` 派生 + `var(--bg)` | |
| `--color-scheme` | 直接 `color-scheme: dark` | |

### 2.2 cascade/dark.css + light.css — 保持现状

Tauri standalone 和浏览器没有 `--vscode-*` 变量，必须保留固定 palette。仅 `vscode-dark.css` 走 var() 路线。

### 2.3 panel.ts — 不改

`VSCODE_THEME_KIND_TO_OVERLAY_THEME` 映射保留：决定 overlay 用哪一派 cascade（light vs vscode-dark）。具体色值由 var() 穿透 —— 用户在 VSCode 里换主题，body 上的 `--vscode-*` 自动更新，cascade/vscode-dark.css 引用立刻反映。**不需要 host:theme 消息传任何色值**。

但 host:theme 消息仍需保留，用于 light↔dark **类别**切换（用户从 Light+ 切到 Default Dark+ 时 ColorThemeKind 改变）。

### 2.4 守卫 — 新增 1 个

`packages/overlay/test/flat-redesign-vscode-theme-passthrough.test.ts`：
- 扫 `cascade/vscode-dark.css`，断言：
  - 不含 `#[0-9a-fA-F]{3,8}` hex 字面量（注释除外）
  - 不含 `rgb(/rgba(/hsl(` 字面量（color-mix() 是允许的派生形式）
  - 主底色 token (`--bg`/`--text`/`--accent`/`--good`/`--bad`/`--warn`) 必须是 `var(--vscode-*` 形式（fallback 允许）
- 扫 `cascade/dark.css` + `light.css`，断言：
  - **不**含 `var(--vscode-*` —— 这两个文件是 Tauri/浏览器主题，禁止依赖 webview 变量

### 2.5 theme-symmetry 守卫 — 不改

token *名称集合* 仍然三家对称（dark/light/vscode-dark 同名 token），守卫继续 pass。变的只是 vscode-dark 一家的*值*。

## §3 自验

```pwsh
cd packages/overlay
bun test test/flat-redesign-theme-symmetry.test.ts test/flat-redesign-vscode-theme-passthrough.test.ts
```

期望：30 (theme-symmetry) + N (vscode-passthrough) 全 pass / 0 fail。

## §4 一次性提交

单 commit，body 强调"色值层修正，容器层早已修过"，附 §2.1 映射表的关键 6 个 token，引用本 spec。

## §5 工作量与风险

- 重写 `cascade/vscode-dark.css` ~110 行
- 新增守卫 ~50 行
- 总文件改动：2
- 风险：用户在 VSCode 里实际看到的色值此后**完全跟着 VS Code 主题**走 —— 这正是用户想要的"对齐业界"
- 不可见的回归点：如果某个 `--vscode-*` 变量在某些 VS Code 版本没注入，fallback 是 Default Dark+ 的硬编码值，跟之前完全一样，无视觉退化
