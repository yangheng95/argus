# M14 · GUI 视觉设计规范

**优先级**：P0 · 阶段 0
**依赖**：无（横切关注点，被所有含 UI 的模块引用）
**负责范围**：全局视觉语言、色彩系统、字体层级、间距系统、组件样式、动效标准、主题

> **阶段 0 必须交付**：设计语言定义、色彩系统（亮色 + 暗色）、字体层级、间距系统、核心组件样式（按钮/输入框/卡片/表格/代码块/图表容器）、基础动效规范。
> **阶段 1 可推迟**：自定义主题能力、品牌色可配、高对比度无障碍模式。

---

## 1. 设计语言方向

**克制的专业工具美学**——介于 Apple 的精致简洁与 Bloomberg Terminal 的信息密度之间。

核心气质：
- **安静**：大面积留白，低饱和度配色，信息不抢夺注意力
- **专业**：数据对齐精确，数字等宽排列，表格/图表视觉可信
- **高效**：操作路径短，关键信息一眼可见，不需要装饰性元素
- **克制**：不使用渐变、阴影堆叠、圆角过大的元素；装饰让位于内容

**参考基准**：
- Apple Human Interface Guidelines 的间距系统和字体层级
- Linear 的交互密度和信息布局
- Figma 的面板分割和工具栏设计
- Bloomberg Terminal 的数据表格密度（仅表格区域）

---

## 2. 色彩系统

### 2.1 语义色彩变量

所有颜色通过 CSS 变量定义，组件只引用变量名，不硬编码色值。

```css
:root {
  /* ── 背景层级 ────────────────────────────────── */
  --bg-base:        #FFFFFF;      /* 主背景（对话区、输出区） */
  --bg-subtle:      #F8F9FA;      /* 次级背景（侧边栏、代码块背景） */
  --bg-muted:       #F1F3F5;      /* 弱背景（hover 状态、选中行） */
  --bg-overlay:     #FFFFFF;      /* 浮层背景（弹窗、下拉菜单） */

  /* ── 前景/文字 ──────────────────────────────── */
  --fg-default:     #1A1A1A;      /* 主文字 */
  --fg-muted:       #6B7280;      /* 次级文字（时间戳、来源标签） */
  --fg-subtle:      #9CA3AF;      /* 弱文字（占位符、禁用态） */
  --fg-on-accent:   #FFFFFF;      /* 强调色上的文字 */

  /* ── 边框 ───────────────────────────────────── */
  --border-default: #E5E7EB;      /* 默认边框 */
  --border-muted:   #F1F3F5;      /* 弱边框（面板分割线） */

  /* ── 强调色 ─────────────────────────────────── */
  --accent:         #2563EB;      /* 主强调色（发送按钮、链接、选中态） */
  --accent-hover:   #1D4ED8;      /* 强调色 hover */
  --accent-subtle:  #EFF6FF;      /* 强调色浅底（选中会话背景） */

  /* ── 语义色 ─────────────────────────────────── */
  --success:        #059669;      /* 成功（工具调用完成） */
  --warning:        #D97706;      /* 警告（超时、Mock 模式标识） */
  --error:          #DC2626;      /* 错误（执行失败、网络错误） */
  --info:           #2563EB;      /* 信息提示 */

  /* ── 金融专用 ───────────────────────────────── */
  --fin-up:         #DC2626;      /* 涨（A股惯例：红涨） */
  --fin-down:       #059669;      /* 跌（A股惯例：绿跌） */
  --fin-flat:       #6B7280;      /* 平 */
}
```

### 2.2 暗色主题

```css
[data-theme="dark"] {
  --bg-base:        #0F0F0F;
  --bg-subtle:      #1A1A1A;
  --bg-muted:       #262626;
  --bg-overlay:     #1A1A1A;

  --fg-default:     #E5E7EB;
  --fg-muted:       #9CA3AF;
  --fg-subtle:      #6B7280;
  --fg-on-accent:   #FFFFFF;

  --border-default: #333333;
  --border-muted:   #262626;

  --accent:         #3B82F6;
  --accent-hover:   #60A5FA;
  --accent-subtle:  #1E3A5F;

  --success:        #10B981;
  --warning:        #F59E0B;
  --error:          #EF4444;

  --fin-up:         #EF4444;
  --fin-down:       #10B981;
  --fin-flat:       #9CA3AF;
}
```

### 2.3 色彩使用规则

- 主内容区域只用 `--bg-base` + `--fg-default`，不引入额外背景色
- 强调色（`--accent`）在整个视口中同时可见的面积不超过 5%
- 金融涨跌色仅用于价格变动、涨跌幅，不用于其他语义
- 禁止使用纯黑 `#000000` 作为文字色（亮色模式下最深为 `#1A1A1A`）

---

## 3. 字体系统

### 3.1 字体栈

```css
:root {
  --font-sans:  'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono:  'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
  --font-cn:    'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
}

body {
  font-family: var(--font-sans), var(--font-cn);
}

code, pre, .code-block {
  font-family: var(--font-mono);
}
```

### 3.2 字体层级

| 层级 | 用途 | 大小 | 行高 | 字重 |
|---|---|---|---|---|
| Display | 无（不使用） | — | — | — |
| H1 | 页面级标题（极少使用） | 24px | 32px | 600 |
| H2 | 面板标题 | 18px | 24px | 600 |
| H3 | 区块标题（图表标题、表格标题） | 15px | 20px | 600 |
| Body | 对话文字、正文 | 14px | 22px | 400 |
| Body Small | 来源标签、时间戳、免责声明 | 12px | 18px | 400 |
| Caption | 工具调用状态、辅助提示 | 11px | 16px | 400 |
| Mono Body | 代码块内文字 | 13px | 20px | 400 |
| Mono Small | 终端输出、执行结果 | 12px | 18px | 400 |

### 3.3 中文排版规则

- 中英文之间自动加入 0.25em 间距（CSS `text-autospace` 或 JavaScript post-process）
- 中文段落不首行缩进（对话 UI 中缩进浪费空间）
- 数字一律使用等宽字体（`font-variant-numeric: tabular-nums`），保证表格列对齐

---

## 4. 间距系统

采用 4px 基准网格，所有间距为 4 的倍数。

| Token | 值 | 用途 |
|---|---|---|
| `--space-1` | 4px | 图标与文字间距、紧凑内边距 |
| `--space-2` | 8px | 行内元素间距、Badge 内边距 |
| `--space-3` | 12px | 小组件内边距（按钮、输入框） |
| `--space-4` | 16px | 块级元素间距（ContentBlock 之间） |
| `--space-5` | 20px | 面板内边距 |
| `--space-6` | 24px | 区块分组间距（Disclaimer 与主内容） |
| `--space-8` | 32px | 面板间距、主要分隔 |

**间距使用规则**：
- 同类元素之间用 `--space-4`（如连续 ContentBlock）
- 不同类元素之间用 `--space-6`（如图表与免责声明）
- 面板边缘用 `--space-5`
- 不允许出现非 4 倍数的自定义间距值

---

## 5. 核心组件样式

### 5.1 按钮

| 变体 | 背景 | 文字 | 边框 | 用途 |
|---|---|---|---|---|
| Primary | `--accent` | `--fg-on-accent` | 无 | 发送按钮 |
| Secondary | transparent | `--fg-default` | `--border-default` | 复制、导出 |
| Ghost | transparent | `--fg-muted` | 无 | 工具栏图标按钮 |
| Danger | transparent | `--error` | `--error` | 删除会话 |

**通用规则**：
- 圆角：6px（全局统一，不使用 full-round）
- 高度：32px（默认）/ 28px（紧凑，用于代码块内按钮）
- hover 过渡：`transition: all 120ms ease`
- 禁用态：`opacity: 0.5; cursor: not-allowed`

### 5.2 输入框

```css
.input-bar {
  background: var(--bg-base);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 22px;
  max-height: 160px;
  overflow-y: auto;
  transition: border-color 120ms ease;
}
.input-bar:focus {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-subtle);
}
```

### 5.3 消息气泡

| 角色 | 背景 | 对齐 | 最大宽度 |
|---|---|---|---|
| User | `--bg-muted` | 右 | 80% |
| Assistant | transparent（左栏无背景） | 左 | 100% |

- 用户消息有圆角卡片背景
- 助手消息无卡片背景，直接渲染文字（减少视觉噪音）
- 消息间距：`--space-4`

### 5.4 代码块

```css
.code-block {
  background: var(--bg-subtle);
  border: 1px solid var(--border-muted);
  border-radius: 6px;
  overflow: hidden;
}
.code-block__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: var(--bg-muted);
  border-bottom: 1px solid var(--border-muted);
  font-size: 12px;
  color: var(--fg-muted);
}
.code-block__body {
  padding: 12px 16px;
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 20px;
}
```

- Header 区：左侧显示语言标签，右侧放复制 + 运行按钮
- ≤20 行自适应高度，>20 行固定 380px 内部滚动
- 语法高亮主题：亮色用 GitHub Light，暗色用 GitHub Dark

### 5.5 数据表格

```css
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.data-table th {
  position: sticky;
  top: 0;
  background: var(--bg-subtle);
  padding: 8px 12px;
  text-align: left;
  font-weight: 600;
  border-bottom: 2px solid var(--border-default);
  cursor: pointer;
  user-select: none;
}
.data-table td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-muted);
}
.data-table tr:hover td {
  background: var(--bg-muted);
}
```

- 数字列右对齐
- 百分比列颜色：正值 `--fin-up`，负值 `--fin-down`
- 表头排序指示器：▲ / ▼ 小三角

### 5.6 图表容器

```css
.chart-container {
  background: var(--bg-base);
  border: 1px solid var(--border-muted);
  border-radius: 6px;
  padding: 16px;
  min-height: 300px;
}
```

- Plotly 图表配色与全局色彩系统对齐（通过 `plotly_template` 配置）
- Plotly toolbar 默认隐藏，hover 时显示
- 图表下方紧跟 SourceTag

### 5.7 ToolCallBadge

```css
.tool-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 16px;
  border: 1px solid var(--border-default);
}
.tool-badge--pending { color: var(--fg-muted); }
.tool-badge--done    { color: var(--success); border-color: var(--success); }
.tool-badge--error   { color: var(--error); border-color: var(--error); }
```

### 5.8 免责声明

```css
.disclaimer {
  margin-top: var(--space-6);
  padding: var(--space-3) var(--space-4);
  font-size: 11px;
  line-height: 16px;
  color: var(--fg-subtle);
  border-left: 2px solid var(--border-muted);
}
```

---

## 6. 动效规范

### 6.1 基础原则

- **快速**：所有 UI 过渡 ≤ 200ms，用户不应感知到"等待动画播完"
- **有意义**：只在状态变化时使用动效（出现/消失/切换），不做纯装饰动画
- **可关闭**：尊重 `prefers-reduced-motion`，关闭所有非必要动效

### 6.2 过渡参数

| 场景 | 时长 | 缓动函数 |
|---|---|---|
| 按钮 hover / focus | 120ms | `ease` |
| 面板展开/收起 | 200ms | `ease-out` |
| 消息出现 | 150ms | `ease-out` |
| 弹窗出现 | 200ms | `ease-out` |
| 流式文字光标闪烁 | 1000ms | `step-end`（CSS animation） |

### 6.3 流式输出动效

- 文字 delta：无动效，直接追加（requestAnimationFrame 批量更新）
- 结构化块（代码/图表/表格）出现时：`opacity 0→1 + translateY 8px→0`，150ms ease-out
- ToolCallBadge 状态变化：颜色渐变 120ms

### 6.4 加载状态

- 流式输出中：末尾显示闪烁光标（`|`），`animation: blink 1s step-end infinite`
- 代码执行中：运行按钮显示旋转 spinner（16px，`--accent` 色）
- 工具调用中：ToolCallBadge 的图标旋转

---

## 7. 布局规范

### 7.1 全局布局

```
┌──────────┬──────────────────┬────────────────────────────┐
│ Sidebar  │  ChatPanel (左)  │  OutputPanel (右)           │
│ 240px    │  比例 5          │  比例 7                     │
│ 可折叠    │                  │                             │
│          │                  │                             │
└──────────┴──────────────────┴────────────────────────────┘
```

- Sidebar 宽度：240px，可折叠到 0（图标触发）
- 左右栏比例：默认 5:7，可拖拽，最小各 300px
- 分隔线：1px `--border-muted`，hover 时变粗为 3px `--accent`

### 7.2 响应式断点

| 断点 | 宽度 | 行为 |
|---|---|---|
| Desktop | ≥ 1024px | 完整三栏布局 |
| Tablet | 768–1023px | Sidebar 默认折叠，双栏布局 |
| Mobile | < 768px | 单栏，左右栏标签页切换 |

**阶段 0 仅支持 Desktop 断点**。Tablet/Mobile 在阶段 1 根据用户反馈决定是否实现。

---

## 8. 可访问性

- 所有交互元素可通过键盘操作（Tab 导航 + Enter 触发）
- 颜色对比度满足 WCAG 2.1 AA 标准（正文 ≥ 4.5:1，大文字 ≥ 3:1）
- 涨跌不仅靠颜色区分——同时使用 ▲/▼ 符号
- 图表有 `aria-label` 描述数据摘要
- `prefers-reduced-motion: reduce` 时关闭所有动效

---

## 9. Plotly 主题配置

为保证图表与全局视觉一致，定义 AimeCode 专用 Plotly template：

```typescript
// src/constants/plotly-theme.ts
export const AIMECODE_PLOTLY_TEMPLATE = {
  layout: {
    font: { family: 'Inter, PingFang SC, sans-serif', size: 12, color: 'var(--fg-default)' },
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    xaxis: {
      gridcolor: 'var(--border-muted)',
      linecolor: 'var(--border-default)',
      zerolinecolor: 'var(--border-default)',
    },
    yaxis: {
      gridcolor: 'var(--border-muted)',
      linecolor: 'var(--border-default)',
      side: 'right',     // 金融图表惯例：Y 轴在右
    },
    margin: { l: 8, r: 60, t: 36, b: 32 },
    legend: { orientation: 'h', y: 1.02, font: { size: 11 } },
    hovermode: 'x unified',
    hoverlabel: { bgcolor: 'var(--bg-overlay)', bordercolor: 'var(--border-default)' },
  },
  data: {
    candlestick: [{
      increasing: { line: { color: 'var(--fin-up)' } },
      decreasing: { line: { color: 'var(--fin-down)' } },
    }],
    scatter: [{
      line: { width: 2 },
      marker: { size: 5 },
    }],
  },
}
```

---

## 10. 验收标准

- [ ] 所有颜色通过 CSS 变量引用，组件中无硬编码色值
- [ ] 亮色/暗色主题切换后，所有组件颜色正确更新
- [ ] 字体大小严格遵循字体层级表，无自定义 font-size
- [ ] 间距值全部为 4px 倍数
- [ ] 按钮、输入框、代码块等核心组件样式与本规范一致
- [ ] 数据表格数字列等宽对齐，百分比用涨跌色标注
- [ ] 所有 UI 过渡 ≤ 200ms
- [ ] `prefers-reduced-motion: reduce` 下无动效
- [ ] Plotly 图表使用 AIMECODE_PLOTLY_TEMPLATE，与全局配色一致
- [ ] 文字颜色对比度满足 WCAG 2.1 AA（≥ 4.5:1）
