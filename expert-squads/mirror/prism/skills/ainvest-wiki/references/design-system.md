---
type: design-system
last-updated: 2026-07-07
canonical: ./DESIGN.md
---

# Design System — 设计系统入口

> 完整的设计 token 全部在 [`DESIGN.md`](./DESIGN.md)。**本文件不做镜像**，只放"什么时候看哪里"的索引。
> 交互行为（hover/click/focus/transition/modal/scroll 等）见 [`web-interactions.md`](./web-interactions.md)。

## 速记

- **设计系统代号**：AInvest Nova（`DESIGN.md` 的 `name` 字段）
- **当前版本**：alpha
- **覆盖范围**：颜色、字体、间距、圆角、阴影、组件

## 改 UI 之前先确认

| 你要改什么 | 看 DESIGN.md 的哪一段 |
|------------|----------------------|
| 颜色 | `colors` 段 → 选 atom token |
| 字号 | `typography.font-size-*` |
| 行高 | `typography.line-height-*` |
| 圆角 | `rounded.*` |
| 间距 | `spacing.*` |
| 阴影 | `shadow.*` |
| 按钮 | `components.button-*` |
| 卡片 | `components.card*` |
| 徽章 | `components.badge-up` / `badge-down` |
| 输入框 | `components.input` |
| 分段控件 | `components.segmented-control` |
| Tooltip / Toast | `components.tooltip` |
| 分割线 | `components.divider` |
| 滚动条 | `components.scrollbar*` |

## 一定要遵守的 Do / Don't

> 原文在 `DESIGN.md` 末尾"## Do's and Don'ts"。这里只列**最常踩雷**的：

- **Do** 用 atom color CSS 变量（`--atom-color-*`）走 Tailwind utility
- **Do** 用 `price-up` / `price-down` 显示价格变化 —— **不**用通用绿/红
- **Do** 用 `badge-up` / `badge-down` 展示内联价格变化
- **Do** 兼容 light + dark
- **Don't** 引入新颜色而不扩 token 系统
- **Don't** 给交互元素 `border-radius: 0`
- **Don't** 嵌套 button 变体（`button-primary.hover` 错；`button-primary-hover` 对）
- **Don't** 在 dark mode 用 shadow 提层
- **Don't** 把 NewYork / PTSerif 字体用 UI 上

## 跨产品 / 跨页面一致性

| 规则 | 来源 |
|------|------|
| 价格语义色（股票 vs 加密分开） | `DESIGN.md` `colors.price-*` |
| Navbar 高度 54px | `DESIGN.md` `spacing.navbar` |
| 主色 蓝 | `DESIGN.md` `colors.brand-primary` |
| 卡片 8px 圆角 + 24px padding | `DESIGN.md` `components.card` |
| 按钮 pill shape（`50%`） | `DESIGN.md` `components.button-*` |

## 改了 token 之后

- 改 `DESIGN.md` —— **不在本 wiki 镜像**
- 同时改 `variables-v1.css` 和 `tailwind.config.ts`（双轨 token 同步）
- 涉及 `price-up/price-down` 的改动，要同时通知 `markets.md`（文档一致性）
