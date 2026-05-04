# Overlay Flat-Redesign Plan

> 目标：消除"扁平不彻底 / 边框噪点 / icon 杂乱"三宗罪。
> 范围：`packages/overlay/src/styles/**` + 字符化 icon 调用点（4 个 .tsx + 1 个 .ts）。
> 不在范围：业务逻辑、组件树结构、i18n、tauri 集成、storybook 样式。
> 原则：单源（rule 8）、抽象（rule 9）、删旧不留兼容（rule 16）、批改批验（feedback_batch_verify）。

---

## 一、根因诊断（带物证）

### 1.1 圆角散乱 → 11 个并存值

`design-language.css` 已声明 5 个语义 radius：

| token | 值 | 当前用途 |
|---|---|---|
| `--oc-radius-none` | 0 | header.css 借作 min-width |
| `--oc-radius-panel` | 0 | 仅 header.css 一处用 |
| `--oc-radius-control` | 4px | 占多数控件 |
| `--oc-radius-card` | 8px | **全仓零调用点** |
| `--oc-radius-pill` | 999px | pill/dot |

cascade/dark.css + light.css + vscode-dark.css 又**各自重复声明**：
- `--radius: 12px` （cascade/dark.css:59 / light.css:59 / vscode-dark.css:64）
- `--radius-lg: 18px`
- `--panel-radius: 10px`

surfaces 层硬编码（部分清单）：
- `agent-card.css`：6px / 4px / 2px / 50%
- `agent-workflow.css`：7px / 999px / 8px / 10px
- `composer.css`：`var(--radius)` / `var(--oc-radius-control)` / `var(--oc-radius-pill)` / `var(--panel-radius)` 同文件 4 种
- `card.css`：`calc(var(--radius) * 0.6)`
- `markdown.css`：`calc(var(--radius) * 0.5)` / `* 0.6`
- `settings.css`：`calc(var(--radius) * 0.6)` / `* 0.7`
- `inspector.css`：`calc(var(--radius) / 2)`
- `titlebar.css`：3px / 5px / 6px / 7px / 14px
- `composer.css:255`（drag-over）：`calc(20px * scale)`

**结论**：同一屏从 0/2/3/4/5/6/7/8/10/12/14/18/pill 全谱出现。这是 rule 8（双源）+ rule 9（必须抽象）的复合违规——已经定义的 `--oc-radius-card: 8px` 全仓零调用就是死 token。

### 1.2 边框噪点 → 1px 网格塞满每一层

主要罪犯（按视觉权重）：

1. **panel 自描边**：`.workspace { border: 1px solid var(--border); border-radius: var(--panel-radius); box-shadow: var(--shadow) }` (workspace.css:87-97) — 已经有 `--surface` 跟 `--bg` 的明度差，又描边又投影是双源。
2. **titlebar 三重分隔**：上 border + 下 border + `::after` 渐变线（titlebar.css:11-28）。三选一即可。
3. **workspace-tab 垂直切割**：`border-right: 1px solid var(--border)` 把每个 tab 切成一格（workspace.css:132）。扁平 tab 应只在 active 项画 2px accent 下划线。
4. **section 卡片 + 内 head + active state 三层重描**：
   - `.section { border: 1px solid var(--border); border-radius: 5px; background: --surface-inset }` (inspector.css:307)
   - `.section[data-phase-state="active"] { border-color + linear-gradient + inset box-shadow + 22px 外投影 }` (inspector.css:378-386)
   - 同一卡片同时承担 phase 高亮、容器边界、内部分隔三种语义。
5. **executor-menu / menubar-panel / brand-guide-card** 各自带 1px border + box-shadow lg + 圆角，三套不同尺寸。
6. **composer 内部**：textarea wrap、icon col、send button 各自带 border。

### 1.3 字符化 / 内联 icon → 5 个调用点 + 多套 SVG 来源

字符化 close（`>×<` / `>x<`）：

| 文件 | 行 | 选择器 |
|---|---|---|
| `main.tsx` | 1483 | `.recent-dir-remove` |
| `components/AgentSessionReplyBox.tsx` | 81 | `.card__agent-reply-error-dismiss` |
| `components/TaskList.tsx` | 600 | task-remove |
| `components/WorkspacePanel.tsx` | 94 | `.workspace-close` |
| `index.html` | 400 | `.config-close-btn`（已是 SVG，是少数一致） |

`section-head::before` 用 `▸` U+25B8（inspector.css:292）作 chevron。其它地方用 SVG。
`SECTION_ICONS` 是一份 innerHTML 字符串字典（Board.tsx:306）。
`board-intro__cta-icon` 用 `📁` emoji（BoardIntro.tsx:54）。
`status-icon` 是受规范的 SVG（titlebar.css:767-819）——这套是好的。

**结论**：没有 `<Icon>` primitive，icon 来源 ≥ 4 套：(a) 字符 close、(b) emoji、(c) inline innerHTML 字符串、(d) JSX SVG。stroke / 视觉重量必然不齐。

### 1.4 字重失控 → 177 处 ≥ 600

按文件分布（grep `font-weight: (600|700|bold)`）：

| 文件 | 计数 |
|---|---|
| inspector.css | 48 |
| card.css | 21 |
| settings.css | 23 |
| messages.css | 11 |
| conversation.css | 10 |
| composer.css | 9 |
| markdown.css | 8（含 1 处 `bold` 字符串）|
| 其它 12 个 surface | 47 |
| **合计** | **177** |

`markdown.css:366` 写 `font-weight: bold`（字符串），其余都是数字——**已存在双源**。
`board-intro__cta-action:180` 写 `font-weight: 650`（独此一家），又一种。
2026-05-03 的 `feedback_overlay_typography` 反馈未收敛。

---

## 二、目标设计（单源）

### 2.1 圆角语义收敛到 4 个 token

```css
/* tokens/design-language.css */
--oc-radius-none: 0;       /* panel 边界、平面分隔 */
--oc-radius-soft: 4px;     /* 控件、卡片、菜单、tab、composer wrap、所有"中等几何" */
--oc-radius-large: 10px;   /* dialog / 浮层根容器 */
--oc-radius-pill: 999px;   /* 状态点、徽章、accent stripe、浮层箭头点 */
```

**淘汰**：`--oc-radius-panel`、`--oc-radius-card`、`--radius`、`--radius-lg`、`--panel-radius`、所有 `calc(* 0.5/0.6/0.7)`、所有硬编码 px。

**映射规则**（落到每个调用点的决策）：

| 旧值 | 新值 |
|---|---|
| `var(--oc-radius-panel)` / `0` 表层意图 | `--oc-radius-none` |
| `var(--oc-radius-control)` / `var(--radius)` / `var(--panel-radius)` / `2-8px` 硬编码 | `--oc-radius-soft` |
| `var(--radius-lg)` / 10-18px / executor-menu 10px / brand-guide-card 14px | `--oc-radius-large` |
| `var(--oc-radius-pill)` / 999px / 50% 圆点 | `--oc-radius-pill` |
| `calc(--radius * 0.5)` 之类派生 | `--oc-radius-soft`（统一不缩放） |

### 2.2 边框规则三条铁律

**铁律 A — surface 层差替代 border**：同一 panel 内、容器自身**禁用** `border` 描边；改用 `--surface` ↔ `--surface-inset` ↔ `--surface-strong` 三阶明度 + `--bg` 作底。

**铁律 B — border 仅出现在跨上下文边界**：
- `titlebar ↔ panel-body`：保留 1px bottom，删 top + `::after` 渐变线。
- `composer ↔ conversation`：保留 1px top。
- 浮层（menu / dialog / popover）：保留 1px 全包，因为漂浮在 body 之上。
- 所有"卡片描边"（section、agent-card、criteria-group、delivery-panel 等）一律删 `border`，靠 `--surface-inset` 与父容器 `--surface` 的对比建立边界。

**铁律 C — active/hover 状态用 accent stripe，不用 border-color 切换**：
- `.section[data-phase-state="active"]` 删 `border-color: --accent` + `box-shadow`，改为 `border-left: 2px solid --accent`（inspector.css:475 的 `delivery-panel::before` 已是这种范式，对齐到 section）。
- `.workspace-tab[data-active]` 保留 `border-bottom: 2px solid --accent`，删 `border-right` 分隔线。
- `.titlebar-menubar-trigger:hover` 删 border-color 翻转，只留 background。

### 2.3 Icon 抽 primitive

新文件 `packages/overlay/src/components/Icon.tsx`：

```tsx
import type { JSX } from "solid-js";

const ICONS = {
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  chevron: <path d="M5 4l5 4-5 4" />,
  plus: <path d="M8 3v10M3 8h10" />,
  // ... search/menu/send/file/folder/globe/at/online-dot ...
} as const;

export type IconName = keyof typeof ICONS;

export function Icon(props: { name: IconName; size?: number; class?: string }): JSX.Element {
  const size = () => props.size ?? 16;
  return (
    <svg
      width={size()} height={size()} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round"
      class={props.class} aria-hidden="true"
    >{ICONS[props.name]}</svg>
  );
}
```

**统一规则**：viewBox 16×16、stroke 1.5、currentColor 继承、line-cap/join round。所有 icon 只能从这里取。

**淘汰**：
- `>×</button>` × 4 处 → `<Icon name="close" />`
- `▸` chevron pseudo → `<Icon name="chevron" />` 或 SVG mask
- `📁` emoji → `<Icon name="folder" />`
- `SECTION_ICONS` innerHTML 字典 → 改 `<Icon name={...} />`
- `status-icon` SVG（已合规）→ 迁入 `Icon.tsx` 的 `online`/`busy`/`fail` 名

### 2.4 字重双轨

```css
/* cascade/typography.css */
--ui-font-weight-body: 400;
--ui-font-weight-strong: 600;  /* 唯一允许的"强调"档 */
```

**规则**：
- 全仓字重只能取 400 或 600。
- 删除：`font-weight: 700`、`font-weight: bold`、`font-weight: 650`。
- 删除：作"伪小标题"用的 `font-weight: 600`——下沉到 `font-size` + `text-muted` + `letter-spacing: 0.08em` + `text-transform: uppercase` 的 kicker 风格（参考 `brand-guide-kicker` titlebar.css:362）。
- BoardIntro 的伪 H4 段（`board-intro__mode-label` / `__agent-name`）改 weight 500 + 配色拉开层级。

---

## 三、落地步骤（执行顺序）

> 每步独立可 commit + push（rule 33）。每步落盘后跑 typecheck（feedback_batch_verify），全步走完再做视觉对比 benchmark（rule 25/26：必须真实视觉呈现）。

### Step 1 — token 收敛 [基础，其它步依赖此]

**改 `tokens/design-language.css`**：
- 用 §2.1 的 4 token 定义替换现有 5 个 radius token + 移除 cascade 三主题里的 `--radius / --radius-lg / --panel-radius` 声明。

**改 `cascade/dark.css` / `light.css` / `vscode-dark.css`**：
- 删行 59-66 的 `--radius / --radius-lg / --panel-radius / --ui-titlebar-height` 中只删前三个；`--ui-titlebar-height` 等保留。

**改 `cascade/typography.css`**：
- 加 `--ui-font-weight-body: 400; --ui-font-weight-strong: 600;` 两个 token。

**Test**：
- 写 `packages/overlay/test/styles/radius-token-coverage.test.ts`：扫描 `src/styles/**/*.css`，断言除 `tokens/design-language.css` 之外不允许出现 `border-radius:` 后跟非 `var(--oc-radius-*)` 的值（白名单：`0`、`50%`、`inherit`）。
- 写同款 `font-weight-token-coverage.test.ts`：除 typography token 文件外不允许 `font-weight: \d+`，必须走 `var(--ui-font-weight-*)`。
- 这两个测试是 rule 36 的"接口契约式"防回归。

### Step 2 — 全仓 radius 替换 [机械替换，按 §2.1 映射]

调用点（grep `border-radius:`，已得 80+ 处，部分清单）：

- `cascade/base.css:129,149,155` → soft / pill / pill
- `cascade/typography.css:51,60` → pill / pill
- `primitives/tabs.css:42` → none
- `primitives/button.css:5` → soft
- `surfaces/agent-card.css:52,74,122,132,142,203` → soft / pill / soft / soft / soft / soft
- `surfaces/agent-workflow.css:55,65,86,184,379,423,449` → soft / pill / soft / large / pill / pill / soft
- `surfaces/board.css:115` → pill
- `surfaces/btn.css:20,76` → pill / soft
- `surfaces/card.css:1264` → soft
- `surfaces/changes.css:52,105,116` → soft / soft / soft
- `surfaces/cmdk.css:39,136` → large / soft
- `surfaces/composer.css:172,471,488,675,744,772` → soft / soft / pill / pill / pill / soft
- `surfaces/conn-banner.css:21,71` → pill / pill
- `surfaces/conversation.css:183,211,236,368,416,509,565,572,826,867,1063` → 全部按映射
- `surfaces/dialog.css:39` → large
- `surfaces/empty-state.css:36,50,68` → soft / pill / soft
- `surfaces/field.css:34,58,135` → soft / soft / soft
- `surfaces/header.css:15,34,45` → none / 0 / 0
- `surfaces/inspector.css:231,495,613,770,792,833,949,1077,1246,1271,1492,1540,1611,1746,1898,1986,2046,2492,2524,2630,2698,2721` → 全部按映射（多数 pill 与 soft）
- `surfaces/markdown.css:63,104,403` → soft / soft / soft（calc 系数全删）
- `surfaces/messages.css:38,94,128,338,358,569,645,675,719` → 按映射
- `surfaces/ndjson-log.css:24,66,90,112` → soft / soft / pill / soft
- `surfaces/settings.css:36,77,134,158,...` → 按映射
- `surfaces/sidebar.css:44,55,308,319,416,574,585,610,670,704,729` → 按映射
- `surfaces/titlebar.css:206,239,267,276,313,407,478,509,533,556,599,628,673,728` → 按映射
- `surfaces/workspace.css:15,74,93,372,424,442,489` → 按映射

**Test**：Step 1 写的 `radius-token-coverage.test.ts` 跑通即可。

### Step 3 — border 删表 [按 §2.2 三铁律]

逐文件改写（保留浮层、删卡片描边）：

- **workspace.css**：
  - 删 `.workspace { border + box-shadow }`（line 92, 95）
  - 删 `.workspace-header { border-bottom }`（line 103）→ 改用 `--surface-strong` 与 panel-body 的 `--bg` 形成对比
  - 删 `.workspace-tab { border-right }`（line 132）；保留 `data-active` 的 `border-bottom: 2px solid --accent`
  - 删 `.workspace-close { border }`（line 172） → 纯 hover background

- **titlebar.css**：
  - 删 `::after` 渐变线（line 20-28）
  - 改 `.titlebar { border: 0; border-bottom: 1px solid var(--border) }`（line 12-15）
  - 删 `.titlebar-menubar-trigger:hover { border-color }`（line 489）
  - 删 `.titlebar-status-chip { border }` → 用 `--subtle-3` 背景区分（line 672）

- **inspector.css**（section 系列）：
  - 删 `.section { border: 1px solid var(--border) }`（line 308）
  - 删 `.section:last-child { border-bottom }`（line 316）
  - 改 active 状态：删 `border-color` + 外 `box-shadow`，加 `border-left: 2px solid --accent`（替换 line 379-386）
  - 删 `.eval-error / .criteria-group / .delivery-panel` 残余 border（多数已是 `border: 0`，确认即可）

- **composer.css**：
  - 保留 `.chat-input { border-top }` 作为铁律 B 的"composer↔conversation"边界
  - 删 `.chat-icon-col` 周边 inset border
  - `.executor-chip { border }` 改成只在 hover/active 显示，resting 用 `--subtle-3` 背景

- **agent-card.css / card.css / changes.css / messages.css / settings.css / sidebar.css**：
  - 全仓查找"卡片自描边" pattern：`.{card-name} { border: ...solid var(--border) }`，统一改成 `--surface-inset` 背景。
  - 例外：dialog / popover / cmdk 浮层保留外层 border。

**Test**：
- `packages/overlay/test/styles/border-policy.test.ts`：扫 surface 文件，断言每个文件中 `border:.*solid` 的出现次数不超过预设白名单（titlebar=1、composer=1、dialog/cmdk/menubar=各 1 浮层）。
- 每改一个 surface 文件 → 跑 `bun typecheck`（不动 .ts 源所以应空 diff），跑 storybook 视觉快照（如果有 chromatic 流水线）。

### Step 4 — Icon primitive [新组件 + 5 个调用点替换]

1. 新建 `packages/overlay/src/components/Icon.tsx`（§2.3 模板）。
2. 决定 icon set 来源：建议**直接内联 SVG**（不引第三方库，避免 bun bundle 增大），因为 overlay 当前只用 ~15 个 icon。把 `status-icon` 现有 SVG 路径迁过来作底子。
3. 调用点替换：
   - `main.tsx:1483` recent-dir-remove → 这是 innerHTML 模板字符串拼接，需要改成 SolidJS 渲染（不改的话 Icon 拿不到 currentColor 继承），可能要把这段改写为 `<For>`。
   - `components/AgentSessionReplyBox.tsx:81` → `<Icon name="close" />`
   - `components/TaskList.tsx:600` → `<Icon name="close" />`
   - `components/WorkspacePanel.tsx:94` → `<Icon name="close" />`
   - `components/Board.tsx:306` `SECTION_ICONS.delivery` innerHTML → `<Icon name="delivery" />`，`SECTION_ICONS` 字典整体废弃
   - `components/BoardIntro.tsx:54` `📁` emoji → `<Icon name="folder" />`
   - `inspector.css:292` `.section-head::before { content: "▸" }` → 改成在 JSX 里渲 `<Icon name="chevron" class="section-caret" />`，CSS 转动用 `[open] .section-caret { transform: rotate(90deg) }`
   - `surfaces/titlebar.css` 现有 `status-icon` SVG 改为 `<Icon name=... />` 调用，删 SVG 散写

**Test**：
- `packages/overlay/test/components/Icon.test.tsx`：渲染每个 icon，断言 `viewBox="0 0 16 16"`、`stroke="currentColor"`、`stroke-width="1.5"`，断言所有 named icon 都能渲。
- `packages/overlay/test/styles/no-character-icons.test.ts`：grep `src/components/**/*.tsx` 与 `main.tsx`，禁止出现裸 `>×<` `>x<` `▸` `📁` 字面量（白名单零项）。
- 改完跑 `bun run --conditions=browser ...` 启动 overlay，肉眼对照 dark/light/vscode-dark 三主题截图。

### Step 5 — 字重收敛 [177 处机械修正]

- `cascade/typography.css` 在 `:root` 加 `--ui-font-weight-body: 400; --ui-font-weight-strong: 600;`
- 全仓 sed-style 替换：
  - `font-weight: 700` → `font-weight: var(--ui-font-weight-strong)`
  - `font-weight: 600` → `font-weight: var(--ui-font-weight-strong)`
  - `font-weight: 650` (board.css:180) → `var(--ui-font-weight-strong)`
  - `font-weight: bold` (markdown.css:366) → `var(--ui-font-weight-strong)`
  - `font-weight: 500` 保留（板凳值，目前只有少数处）
- BoardIntro 改写：`board-intro__mode-label` / `__agent-name` 改成
  ```css
  font-weight: var(--ui-font-weight-strong);
  font-size: var(--ui-font-meta);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  ```
- 然后审视：每个 panel 内允许出现 ≤ 1 处 strong（panel 的真标题）。card 内 ≤ 1 处。grep `font-weight.*strong` 做最终密度检查。

**Test**：
- Step 1 的 `font-weight-token-coverage.test.ts` 跑通（禁裸数字）。
- 新增 `font-weight-density.test.ts`：扫每个 surface 文件，断言 `var(--ui-font-weight-strong)` 出现次数 ≤ 阈值（settings 例外因为是 form-heavy，单独白名单）。

### Step 6 — 视觉对比 benchmark [真实视觉呈现，rule 25/26]

1. 写 `packages/overlay/script/iter-shots/flat-redesign-2026-05-04/` 目录脚本：
   - 起 overlay（`bun --preload @opentui/solid/preload --conditions=browser`）+ puppeteer 抓 dark / light / vscode-dark 三主题各 3 状态截图（idle / 任务中 / dialog 打开）。
   - 改造前先抓 9 张 baseline，改造完抓 9 张 after。
2. 同框对比脚本生成 markdown report 列入 `specs/overlay-flat-redesign/iter-results.md`。
3. **禁** `--no-browser`（feedback_no_headless_benchmark）。
4. 自检通过后必须自起项目+对比图（feedback_double_review_deliverable），不能只看 typecheck 通过就交付。

### Step 7 — 死 token / 死代码清理（rule 17）

- 删 `--oc-radius-card`（确认 step 2 后零调用）
- 删 `--oc-radius-panel`（确认 step 2 后零调用）
- 删 `--radius / --radius-lg / --panel-radius` 的所有声明（cascade 三文件）
- 删 `SECTION_ICONS` 字典（Board.tsx + 其使用方）
- 删 `inspector.css:292` 的 chevron pseudo 规则
- 删 cascade/dark.css / light.css / vscode-dark.css 里因 typography 收敛后失效的 weight 声明（如 board.css 的 `font-weight: 650`）

---

## 四、风险与回退

| 风险 | 概率 | 缓解 |
|---|---|---|
| 删 `.section` 描边后 phase-state="active" 不显著 | 中 | left-stripe + background tint 已在 delivery-panel 验证有效；step 6 视觉对比兜底 |
| Icon primitive 字体继承导致 stroke 看起来偏粗 | 低 | viewBox 16 + stroke-width 1.5 是 Lucide 等主流库的默认值；step 4 测试 |
| Step 2 机械替换误改 `border-radius: 0` 这种"刻意 0" | 低 | 测试白名单允许 `0` / `50%`；遇到边界 case 走 `--oc-radius-none` |
| `main.tsx:1483` 的 innerHTML 模板字符串重写工作量超预期 | 中 | 备选：保留该处 SVG inline，但走 Icon.tsx 同款 viewBox / stroke 规格；test 加显式豁免 |
| benchmark 截图发现未预见的 surface 出现 border 缺失观感丢失 | 中 | 每个 surface 文件改完单独 commit + push（rule 33），出问题快速 git revert 单 commit |

---

## 五、不做什么（明确范围）

- **不**引第三方 icon 库（避免 bundle 增大）
- **不**改组件结构 / 行为 / 数据流（这是纯样式 + icon primitive）
- **不**做 storybook 重排（如果存在 storybook story 渲染异常，单独 issue）
- **不**碰 markdown 渲染（hljs syntax 颜色等"刻意保留 hex"的 metadata，design-language.css 已有注释说明这是预期行为）
- **不**保留任何过渡 token（rule 7 / 16 ：禁双源、禁兼容）

---

## 六、验收

- [ ] Step 1-2 完成：`radius-token-coverage.test.ts` + `font-weight-token-coverage.test.ts` 双绿
- [ ] Step 3 完成：`border-policy.test.ts` 绿；视觉对比无 panel 边界丢失
- [ ] Step 4 完成：`Icon.test.tsx` + `no-character-icons.test.ts` 双绿；overlay 启动后所有 close/chevron/folder icon 视觉一致
- [ ] Step 5 完成：`font-weight-density.test.ts` 绿；BoardIntro 视觉不再"通篇粗体"
- [ ] Step 6 完成：dark/light/vscode-dark × 3 状态共 9 张 after 截图对比 baseline 无回归，"扁平不彻底 / 边框噪点 / icon 杂乱"三项肉眼可判定改善
- [ ] Step 7 完成：`grep --oc-radius-card` / `--radius:` / `SECTION_ICONS` 全 0 hit
- [ ] 每步 commit + push 不绕 hook，typecheck / api:routes-check / docs:check 全绿
- [ ] 二次 review（rule 24）：自己起 overlay 完整跑一遍三主题，确认与本方案描述一致

---

## 七、补充：调用点穷举（rule 35 强制要求）

`packages/overlay/script/check-flat-redesign-coverage.ts`（落盘后写）跑一次输出三份清单：

1. `radius-callsites.json`：所有 `border-radius:` 出现位置 + 当前值 + 映射到的新 token
2. `border-callsites.json`：所有 `border:.*solid` / `border-{top,bottom,left,right}:` 出现位置 + 是否保留 + 理由
3. `icon-callsites.json`：所有 `>×<` / `>x<` / `▸` / `📁` / innerHTML icon 字符串字面量

这三份清单是 step 2 / step 3 / step 4 的**输入**，不允许凭印象改。

---

## 八、Codex 审查 / 用户审查反馈

落盘版本：v1（2026-05-04）。任何审查反馈必须显式在此节追加修订 stamp，禁静默重写（rule 35）。

### v1 → v2 修订（2026-05-04 自审反馈）

**触发**：Step 1 准备启动时复盘 grep 结果，发现 §1.1 的 token 清单不全。

**新增需要废止的派生 token / 字面量**：

| 多漏 token / 字面量 | 出现位置 | 处理 |
|---|---|---|
| `--card-radius: 12px` | card.css:20 声明，:109/:1153/:1579 调用 | 废，全部改 `--oc-radius-soft` |
| `--section-corner: var(--radius)` | workspace.css:489 声明，field.css:168/:177、settings.css:952/:1076/:1103/:1212 调用 | 废 token，调用点改 `--oc-radius-soft` |
| `--oc-button-radius: var(--oc-radius-control)` | button.css:5 声明、:19 调用 | 内部别名废，直接 `--oc-radius-soft` |
| `--oc-titlebar-status-radius: calc(10px * scale)` | design-language.css:26 声明、titlebar.css:728 调用 | 废，改 `--oc-radius-large` |
| `999px` 字面量 | inline-pill.css:40 | 改 `--oc-radius-pill` |
| `calc(999px * scale)` | agent-workflow.css:65/:267, card.css:420/:817/:866/:914/:1368/:1610/:1641 | scale 999 是无意义计算（999*scale ≈ 999），改 `--oc-radius-pill` |

**Step 1 范围扩大**：原 plan 说"5 个 radius token + 3 个 cascade 重声明"，实际是**8 个 token + 1 套字面量** 全部要废。

**总调用点**：325 处（不是 80+）。Step 2 工作量按文件批 commit 拆，每个 surface 文件单独 commit + push（rule 33），typecheck 不会因 CSS 影响所以不阻塞。

**Step 1+2+7-radius 必须原子化**（不再分提交）：rule 8（禁双源）+ rule 16（禁兼容）。原 plan 的"Step 1 替换 token 定义、Step 2 替换 callsites、Step 7 删旧 token"分三步是双源态，违规。修订为：

- Step 1：design-language.css 加 4 新 radius token（none/soft/large/pill）+ 2 字重 token（body/strong），**同 commit** 删所有旧 token（panel/card/control 在 design-language；radius/radius-lg/panel-radius 在 cascade × 3；card-radius 在 card.css；section-corner 在 workspace.css；oc-button-radius 在 button.css；oc-titlebar-status-radius 在 design-language），**同 commit** 替换 325 处 radius callsite，**同 commit** 写 radius-token-coverage.test.ts + font-weight-token-coverage.test.ts。
- Step 2 撤销（已并入 Step 1）。
- Step 7 仍然存在但只清理 SECTION_ICONS / chevron pseudo / step 5 后的 weight 残留。

**新 Step 编号**：原 7 步压成 6 步：
1. radius+weight token + 全 callsite 替换 + 2 测试（原 1+2+7-radius）
2. border 删表 + border-policy 测试（原 3）
3. Icon primitive + 调用点替换 + 2 测试（原 4）
4. 字重 callsite 替换 + density 测试（原 5）
5. 视觉对比 benchmark（原 6）
6. SECTION_ICONS / chevron pseudo / dead code 清理（原 7 残余）
