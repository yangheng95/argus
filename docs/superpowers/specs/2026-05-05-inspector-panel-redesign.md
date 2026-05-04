# Inspector Panel Redesign

**Date:** 2026-05-05
**Scope:** `packages/overlay/src` — right panel (`.sections` column) only
**Reference:** Nova AI sidebar screenshot (Nova-AI-sidebar-2026-05-04.png)

---

## Goal

统一右侧面板的设计语言。当前各组件各自为政（tab 容器 + 不同 section 样式 + 不同 chrome）。
目标：单一滚动列 + 统一 section/row 模式 + 全部走现有 CSS token。

---

## Design Decisions

| 问题 | 决定 |
|------|------|
| 改造范围 | 仅 `.sections` 右侧面板，不动 Board 中心区 |
| 结构 | 移除 Workflow / Inspector / Preview 三 tab，改为单一滚动 section 列 |
| 展开行为 | 行点击驱动中间 Board 聚焦，右侧面板内不展开内联详情 |
| 视觉方向 | 结构化（B）：rounded 行背景 + left-border active + pill badge |

---

## Shell Layout

```
.sections (flex column, width: --ui-sections-width)
├── .inspector-panel-header (40px fixed)
│   ├── task title (text-strong, ellipsis)
│   └── status badge (pill, semantic color)
└── .sections-stack (flex:1, overflow-y: auto, gap: 6px, padding: 8px)
    ├── InspectorSection (Goals)          ← default expanded
    ├── <hr class="inspector-divider">
    ├── InspectorSection (Changes)        ← default expanded (≤8 rows)
    ├── <hr class="inspector-divider">
    ├── InspectorSection (Evaluation)     ← default: collapsed if all-pass, else expanded
    ├── <hr class="inspector-divider">
    ├── InspectorSection (Architect)      ← default collapsed
    ├── <hr class="inspector-divider">
    └── InspectorSection (Preview)        ← rendered only when delivery exists
```

**移除：** `.sections-tab-body` 三个 tab，原 `sections-header` 上的 tab strip。

**保留：** `.sections` 和 `.sections-stack` 的 CSS 外壳（宽度、背景、overflow），只改内部渲染结构。

---

## InspectorSection 组件

新建 `src/components/InspectorSection.tsx`（Solid.js 组件）。

### Props

```ts
interface InspectorSectionProps {
  title: string
  badge?: string               // pill 右侧内容，e.g. "2 / 4", "3 files", "1 warn"
  badgeTone?: 'neutral' | 'warn' | 'bad' | 'good'  // pill 颜色
  defaultExpanded?: boolean    // 默认展开状态
  children: JSX.Element
}
```

### DOM Structure

```html
<div class="inspector-section">
  <!-- Header: 28px, clickable, toggles expanded -->
  <button class="inspector-section__header" aria-expanded="true/false">
    <span class="inspector-section__title">Goals</span>
    <div class="inspector-section__header-right">
      <span class="inspector-section__badge" data-tone="neutral">2 / 4</span>
      <span class="inspector-section__chevron">▾/▸</span>
    </div>
  </button>
  <!-- Body: collapses via max-height transition -->
  <div class="inspector-section__body" data-expanded="true/false">
    <!-- rows -->
  </div>
</div>
```

### Collapse Animation

Use `grid-template-rows` collapse so content height drives the animation without a magic `max-height` cap:

```css
.inspector-section__body {
  display: grid;
  overflow: hidden;
  transition: grid-template-rows var(--ui-duration-slow) var(--ui-timing-standard);
}
.inspector-section__body[data-expanded="false"] {
  grid-template-rows: 0fr;
}
.inspector-section__body[data-expanded="true"] {
  grid-template-rows: 1fr;
}
/* inner wrapper required for grid-template-rows trick */
.inspector-section__body > .inspector-section__body-inner {
  min-height: 0;
}
```

---

## InspectorRow 组件

新建 `src/components/InspectorRow.tsx`。

### Props

```ts
interface InspectorRowProps {
  status: 'done' | 'running' | 'warn' | 'fail' | 'pending'
  label: string
  meta?: string                // right-side text e.g. "2m14s", "+128", "pass"
  metaTone?: 'good' | 'warn' | 'bad' | 'muted'
  active?: boolean             // left-border + accent-dim background
  onClick?: () => void         // drives Board focus
  prefix?: '+' | '~' | '−'   // for Changes rows (overrides status dot)
  categoryTag?: string         // for Architect rows e.g. "auth", "api"
}
```

### DOM Structure

```html
<button class="inspector-row" data-status="done" data-active="false" onclick="...">
  <!-- Status dot OR prefix symbol OR category tag -->
  <span class="inspector-row__dot" data-status="done"></span>
  <!-- OR -->
  <span class="inspector-row__prefix" data-change="+">+</span>
  <!-- OR -->
  <span class="inspector-row__tag">auth</span>

  <span class="inspector-row__label">Goal 1 — 登录页</span>
  <span class="inspector-row__meta" data-tone="good">done</span>
</button>
```

---

## CSS Token Mapping

### Status Dot Colors

| Status | Token |
|--------|-------|
| done / pass | `var(--good)` |
| running / active | `var(--oc-stage-executor)` (`#e68c32`) |
| warn | `var(--warn)` |
| fail / error | `var(--bad)` |
| pending | `var(--text-muted)` + `opacity: var(--ui-opacity-faint)` on entire row |

### Active Row

```css
.inspector-row[data-active="true"] {
  background: var(--accent-dim);          /* rgba(accent, 0.14) */
  border-left: 2px solid var(--accent);
  padding-left: calc(6px - 2px);          /* compensate border width */
  color: var(--text-strong);
}
```

### Row Interaction

```css
.inspector-row {
  transition: background var(--ui-duration-fast) var(--ui-timing-standard);
}
.inspector-row:hover:not([data-active="true"]) {
  background: var(--surface-hover);
}
```

### Section Header

```css
.inspector-section__header {
  font-size: var(--ui-font-meta);
  font-weight: var(--ui-font-weight-medium);
  color: var(--text-soft);
  transition: background var(--ui-duration-fast) var(--ui-timing-standard);
}
.inspector-section__header:hover {
  background: var(--surface-hover);
}
```

### Badge Tones

```css
.inspector-section__badge[data-tone="neutral"] {
  background: color-mix(in srgb, var(--border) 60%, transparent);
  color: var(--text-muted);
}
.inspector-section__badge[data-tone="warn"] {
  background: var(--warn-dim);
  color: var(--warn);
}
.inspector-section__badge[data-tone="bad"] {
  background: var(--bad-dim);
  color: var(--bad);
}
.inspector-section__badge[data-tone="good"] {
  background: var(--good-dim);
  color: var(--good);
}
```

### Divider

```css
.inspector-divider {
  border: none;
  height: 1px;
  background: var(--divider-soft);
  margin: 0 4px;
}
```

---

## Section Content Specs

### ① Goals

- **Data:** `boardStore.goals[]`
- **Badge:** `"{done count} / {total}"`, tone: neutral (all done → good)
- **Default:** expanded
- **Row:** status dot + goal title (ellipsis) + status badge (done/running+elapsed/pending/failed)
- **Click:** `boardStore.focusGoal(id)` → Board scrolls to goal card
- **Running rows:** show elapsed time (live-updating, 1s interval)

### ② Changes

- **Data:** reuse `ChangesPanel` data logic
- **Badge:** `"{n} files"`, tone: neutral
- **Default:** expanded if ≤ 8 files; if > 8, show first 6 + "查看全部 N 个文件" row at bottom
- **Row:** prefix symbol (`+`/`~`/`−`) + filename (monospace, ellipsis) + `±N` diff count
- **Click:** open `DiffPreviewPanel` (existing behavior, unchanged)
- **Prefix colors:** `+` → `--accent`, `~` → `--warn`, `−` → `--bad`

### ③ Evaluation

- **Data:** `EvaluationCriteriaPanel` data logic
- **Badge:** all pass → `"✓"` (good tone); else `"{warn} warn"` or `"{fail} fail"` (worst tone wins)
- **Default:** collapsed if all pass; expanded if any warn/fail
- **Row:** status dot + criterion name + pass/warn/fail badge
- **Click:** `boardStore.focusCriteria(id)`

### ④ Architect

- **Data:** `ArchitectPanel` decisions list
- **Badge:** `"{n} decisions"`, tone: neutral
- **Default:** collapsed
- **Row:** category tag (2-4 char, `--oc-stage-architect` color) + one-line decision summary
- **Click:** `boardStore.focusArchitectDecision(id)`

### ⑤ Preview

- **Condition:** only rendered when `boardStore.delivery?.previewUrl` exists
- **Badge:** truncated URL or `"localhost:{PORT}"` (clickable → opens in system browser)
- **Default:** expanded, iframe 120px fixed height
- **Internal:** reuse `FrontendPreviewPanel` logic; replace outer wrapper only
- **No drag resize** — keep right panel chrome simple; full-screen via ↗ external link

---

## Files to Create / Modify

### Create

| File | Purpose |
|------|---------|
| `src/components/InspectorSection.tsx` | Collapsible section shell |
| `src/components/InspectorRow.tsx` | Unified row primitive |
| `src/styles/surfaces/inspector-panel.css` | All new inspector CSS |

### Modify

| File | Change |
|------|--------|
| `src/styles/surfaces/inspector.css` | Remove tab-body rules; keep `.sections` / `.sections-stack` shell |
| `src/components/Board.tsx` | Remove old section rendering in `.sections`; replace with new `InspectorSection` tree |
| `src/components/AgentWorkflowPanel.tsx` | Retire from right panel — stage timeline (planner/executor/evaluator) is no longer surfaced here; users see it by clicking a Goal row → Board shows full conversation + stages |
| `src/components/WorkspacePanel.tsx` | Keep as-is (lives in center area, not right panel) |
| `src/components/FrontendPreviewPanel.tsx` | Keep internal logic; outer wrapper replaced |

### Retire (delete after migration)

- `src/styles/surfaces/agent-workflow.css` (if only used by right panel)
- Tab-related CSS in `inspector.css` (`.sections-tab-body`, `.sections-tabs`)

---

## Out of Scope

- Board center panel, left sidebar, composer — not touched
- WorkspacePanel (diff / file viewer) — not touched, lives in center pane
- Theme colors — existing tokens used as-is, no new palette entries
- Responsive / mobile — existing breakpoints unchanged

---

## Implementation Notes

- `boardStore.focusGoal(id)`, `boardStore.focusCriteria(id)`, `boardStore.focusArchitectDecision(id)` are **new methods** to add to boardStore during implementation. Each should set an `activeFocusId` signal that the Board uses to scroll + highlight the target card.
- Verify `boardStore.goals[]` actual field path before implementation (grep `boardStore` usages).
- Verify `agent-workflow.css` has no consumers outside the right panel before deleting.

## Open Questions

*None — all resolved in brainstorming session.*
