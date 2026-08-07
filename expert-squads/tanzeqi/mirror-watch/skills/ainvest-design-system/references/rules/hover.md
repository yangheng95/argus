# Hover — AInvest Design System

> 本文件是 hover 状态的**总规范**，规定各组件类型在 hover 下的反馈行为，用于提升用户触感与操作确认感。单个组件若在自身规范文档中有特殊说明，以该组件文档为准；未特别说明的，一律遵循本文件。

---

## 1. 适用范围

- **仅适用于 Web 端（桌面端）**。移动端无 hover 状态，所有 hover 反馈在触摸设备上不生效，触摸交互请遵循各组件自身的 tap / active 规范。
- 覆盖对象：文字、卡片、列表/选项、按钮、Tab/标签、图标、图片等所有可交互组件。

---

## 2. 通用原则

### 2.1 是否应用 Hover 的前置判断（强制）

在决定一个模块 / 卡片 / 内容是否需要 hover 样式前，MUST 先按以下顺序判断：

#### 2.1.1 默认无交互

- 内容区或卡片**默认无交互**，MUST NOT 无差别地给所有模块加 hover 态。
- 只有当该模块或内容**涉及真实的交互行为**（点击跳转、打开详情、展开/收起、切换选中、触发弹层、播放、分享等）时，才应为其添加 hover 态。
- 判断准则：若该区域点击后**没有任何行为发生**，则它 MUST NOT 呈现 hover 反馈（包括变色、变背景、光标变 `pointer` 等），以避免对用户发出错误的"可点击"信号（参见 `perceptual-ux-heuristics.md`）。
- Hover 样式一律参照本文件 §3 各组件类型 Hover 规范中的样式罗列，不得自行创造新的 hover 视觉反馈。

#### 2.1.2 组件内部 Hover 优先

- 若某个模块使用的是设计系统中**已有的组件**，并且该组件在自身规范文档中**已经定义了 hover 样式**，则 MUST **优先使用组件内部已定义的 hover 展现样式**，不得以本文件的通用 hover 规则覆盖组件自身定义。
- 仅当组件自身规范文档**未定义 hover 样式**，或该模块是在组件之外自行组合/自定义的内容时，才回落到本文件 §3 的通用规则。
- 优先级链：**组件自身规范 > 本文件（hover.md）通用规则 > 其它规则文档**。

---

### 2.2 光标规则（强制）

| 对象 | 光标样式 |
|------|---------|
| 所有可点击对象（含选中态切换、跳转、触发操作） | `pointer`（小手） |
| 不可点击对象 | `default`（默认箭头） |

- 可点击对象 MUST 在 hover 时将 `cursor` 设置为 `pointer`。
- 静态内容 MUST NOT 使用 `pointer`，否则会造成错误的可操作性信号（参见 `perceptual-ux-heuristics.md`）。

### 2.3 颜色 Token（强制）

- Hover 状态的颜色叠加一律使用设计系统 Token，不得手写 hex。
- 非按钮类交互面：`color.interaction.hover`（默认）、`color.interaction.active`（更强的反馈）。
- 按钮类：使用按钮自身的状态 Token（见 `button.md`）。

### 2.4 深浅模式（强制）

- **图片类 hover 蒙层不区分深浅模式**，固定叠加 `#000, 10%`（由 `color.interaction.active` 保证在两种模式下视觉一致）。
- 其他所有类型的 hover 颜色 MUST 通过 Token 映射自动适配深浅模式，不得为深色模式单独写死色值。

### 2.5 过渡动画（强制）

所有 hover 状态切换必须使用平滑过渡，不得硬切换。

| 属性 | 推荐值 |
|------|--------|
| `transition-duration` | **150ms** |
| `transition-timing-function` | **ease-out** |
| 作用属性 | `background-color`、`color`、`border-color`、`box-shadow`、`opacity`、`transform` 等 hover 实际变化的属性 |

- 默认：`transition: all 150ms ease-out;`（或精确到具体属性）。
- 组件自身规范文档若明确规定不同时长/缓动（如 carousel 要求"瞬时变化不使用 opacity 过渡"），以组件文档为准。

### 2.6 嵌套 Hover 规则（强制）

当 hover 存在嵌套关系时（外层容器可 hover，内部子项也可 hover）：

- Hover 内部子项时，**外层 hover 保持不消失**，子项的 hover 反馈在外层 hover 的基础上**叠加呈现**。
- 叠加方式：外层应用 `color.interaction.hover`（≈ #000, 5%），子项在其之上再叠加自己的 hover Token（例如子项自身的 `color.interaction.hover`，或标签/图片类所需的 `color.interaction.active` ≈ #000, 10%）。
- 目的：让用户同时感知到"我正处在这张可点击卡片里"与"我此刻命中的是卡片内的某个具体可操作项"，两级层级都被明确反馈。
- 鼠标移出子项、仍在外层区域时，只保留外层 hover。

**示例（参考新闻卡片）：**
- Hover 卡片空白区 → 整张卡片叠加 `color.interaction.hover`
- Hover 卡片内的 TSLA 股票标签 → 卡片保持 hover 底色，TSLA 标签在其上再叠加 `color.interaction.active`
- Hover 卡片内的分享图标 → 卡片保持 hover 底色，图标按钮叠加自身 hover 背景
- Hover 嵌套子卡片（如卡片内再嵌的新闻子卡片） → 外层 hover 底色保留，子卡片再单独呈现 hover 样式

---

## 3. 组件类型 Hover 规范

### 3.1 文字类

**通用：光标变 `pointer`；文字底部增加下划线 或 文字变色。**

| 场景 | Hover 样式 |
|------|-----------|
| 一级文字（如标题，颜色 = `color.text.primary`），可点击跳转 | 文字颜色保持 `color.text.primary`，**增加下划线** |
| 二级文字（颜色 = `color.text.secondary`），可点击跳转 | 文字颜色升一档为 `color.text.primary`（可与下划线组合，具体由组件文档决定） |
| 链接类文字 | 参见 `link.md` 的完整色阶规则 |

- 下划线颜色 MUST 与文字颜色一致。
- MUST NOT 同时使用"变色 + 变背景色" 两种反馈（会与卡片/列表 hover 混淆）。

---

### 3.2 卡片类

**通用：光标变 `pointer`；通过卡片样式变化传递反馈。**

| 卡片形态 | Normal | Hover |
|---------|--------|-------|
| **描边卡片** | 仅描边，无填充 | **描边变为填充色**（`color.interaction.hover` 作为填充） |
| **填充卡片** | 已有填充背景 | 在原填充上叠加 `color.interaction.hover`（等效 `#000, 5%`） |
| **无容器卡片**（如新闻流、短视频卡片） | 无容器、无内边距 | **内容位置及样式不变**，hover 区域向外扩展：**上下各 8px、左右各 12px**（不是四边等距）。扩展区域填充 `color.interaction.hover`，圆角 **6px**（参见 `references/tokens/radius.md` §2.3 强调类 — Hover 态底色）。<br>• 实现上：用绝对定位/伪元素扩展命中区，**禁止用 `padding` 实现**（会推挤内容、改变上下条目间距）。 |

#### 嵌套卡片（卡片内含可点击子元素）

| 场景 | 行为 |
|------|------|
| 卡片整体**不可点击** | 整张卡片 hover 无反馈；仅内部可点击子项按自身规则 hover |
| 卡片整体**可点击** | 整张卡片 hover 使用上表规则；hover 内部子项时**外层 hover 继续保持**，子项 hover **叠加**在外层之上（见 §2.6） |

---

### 3.3 列表 / 选项类

**通用：光标变 `pointer`；行/项增加底色。**

| 场景 | Hover 样式 |
|------|-----------|
| 列表行（Table、List） | 整行背景叠加 `color.interaction.hover` |
| 下拉菜单项（Dropdown / Select） | 菜单项整行叠加 `color.interaction.hover` |

- MUST 使用**叠加（overlay）**方式，不得整块替换成纯色，以保证在 zebra 条纹、选中态等场景下仍能正确呈现层级（参见 `list-table-pattern.md`）。

---

### 3.4 按钮类

**通用：光标变 `pointer`；按按钮类型使用按钮自身的状态 Token（详见 `button.md`）。**

| 按钮类型 | Hover 样式（摘要） |
|---------|------------------|
| 一级按钮 - 蓝（Tier 1 Brand） | 背景叠加 `color.interaction.hover`（视觉上颜色加深） |
| 一级按钮 - 黑（Tier 1 Black） | 背景叠加 `color.interaction.hover`（视觉上颜色加深） |
| 二级按钮（Tier 2 Grey Fill） | 背景在灰底基础上叠加 `color.interaction.hover`（颜色加深） |
| 文字按钮（Text Button） | 背景增加底色 `color.interaction.hover` |
| 文字 + 图标按钮（如 `See all stocks ›`） | 文字增加下划线 |

- 按钮 hover 的完整颜色映射以 `button.md` 的状态表为准。

---

### 3.5 Tab / 标签类

> ⚠️ **组件优先原则（强制）**：以下表格是无专属 hover 契约组件的通用规则。Line Tabs / Pill Tabs / Segment Tabs 等组件**已在自身文档（`references/components/<tab>.md`）中定义 hover 行为**，按 §2.1.2 规定，组件文档为权威，下表条目与组件文档冲突时**一律以组件文档为准**。

#### Tab

| Tab 类型 | Normal | Hover |
|---------|--------|-------|
| **一级 Tab**（Line Tabs，如主导航 Summary / Options / News） | 无下划线（非选中态） | **文字颜色由 `color.text.primary` 变浅至 `color.text.secondary`；MUST NOT 加下划线（下划线是 active 态唯一信号）、MUST NOT 加背景。**<br>⚠️ 详见 `references/components/line-tabs.md` — 该组件文档为权威规范，覆盖本行通用规则。 |
| **二级 Tab**（Pill Tabs 深色填充） | 圆角标签 | **叠加灰色**（`color.interaction.hover`） |
| **模块 Tab**（Segment / Text Tabs） | 文字或轻底 | **hover 有灰底**（`color.interaction.hover`） |
| **分段器**（Segment Tabs，如 1D / 1M / 3M） | 无底色 | **加白色底色**（与选中态同色，即 `color.bg.primary` / 白色） |
| **文字分段器**（如 2020 Q1 / Q2 / Q3 / Q4） | 二级文字色 | **颜色变深**（升至 `color.text.primary`） |

#### 标签（Tag / Pill）

| 标签类型 | Normal | Hover |
|---------|--------|-------|
| **描边标签**（如 `TSLA +11.29%`） | 仅描边 | **描边变为填充色**（与"描边卡片"同规则，填充 `color.interaction.hover`） |
| **灰色标签**（如 `NVDA —`） | 已有灰色底 | **在底色基础上再叠加 `color.interaction.hover`** |
| **卡片上的标签**（如卡片内的股票 pill） | 标签自身底色 | **在标签原色基础上再叠加一层 `color.interaction.active`（等效 `#000, 10%`）**，以保证在已 hover 的卡片底上仍能被识别 |

---

### 3.6 图标类

**通用：光标变 `pointer`；hover 样式按图标所承担的角色确定。**

| 场景 | Hover 样式 |
|------|-----------|
| 图标作为按钮（无容器，纯图标点击） | 增加**矩形底色区域**，圆角 **6px**，底色为 `color.interaction.hover` |
| **可切换选中态的图标**（如收藏星标：描边 ☆ → 实心 ★） | Hover 态作为 normal 与 selected 的**中间预览态**。以描边星星为例：<br>• Normal：灰色描边 ☆<br>• **Hover：描边色变为选中色（如黄色描边）**，暗示"点击即收藏"<br>• Selected：黄色填充 ★<br>三者颜色语言一致，hover 作为"即将选中"的视觉预告 |
| **图标容器 + 投影**（圆形按钮、悬浮操作按钮） | Hover 时 **投影加重**：投影中 color 的不透明度 **+8**（如原先 12% → hover 变为 20%），其余投影参数（偏移、模糊半径）不变 |

---

### 3.7 图片类

**通用：光标变 `pointer`；图片上增加 hover 蒙层。**

| 场景 | Hover 样式 |
|------|-----------|
| 可点击图片（封面图、缩略图、视频封面等） | 在图片上叠加一层 **`color.interaction.active`（等效 `#000, 10%`）** 的蒙层 |

- **深浅模式一致**：图片 hover 蒙层在浅色与深色模式下**完全相同**，都叠加 `#000, 10%`，不需区分。
- MUST NOT 使用缩放（`transform: scale`）或亮度变化作为图片 hover 的唯一反馈，以避免与卡片整体 hover 冲突（组件文档特殊说明除外）。

---

## 4. Do / Don't

| | 行为 | 理由 |
|---|------|------|
| ✅ DO | 仅对真正可点击 / 可交互的模块与卡片添加 hover 态 | 内容区默认无交互，避免发出错误的"可点击"信号 |
| ✅ DO | 使用已有组件时，优先采用组件自身规范文档中定义的 hover 样式 | 避免不同页面对同一组件出现不一致的 hover 反馈 |
| ✅ DO | 所有可点击元素 hover 时光标变 `pointer` | 桌面端可操作性的主要信号 |
| ✅ DO | 使用 Token（`color.interaction.hover` / `color.interaction.active`）而非手写 hex | 保证深浅模式一致、可维护 |
| ✅ DO | Hover 状态使用 `150ms ease-out` 过渡 | 平滑反馈，不生硬 |
| ✅ DO | 嵌套 hover 时，父级 hover 保持，子项 hover **叠加**在其上 | 同时反馈"在哪张卡里"与"命中哪个具体项" |
| ✅ DO | 图片 hover 蒙层深浅模式都用 `#000, 10%` | 保证图片在任何模式下都有一致的反馈强度 |
| ❌ DON'T | 给纯展示型内容区 / 卡片添加 hover 态 | 点击无行为的 hover 反馈会误导用户 |
| ❌ DON'T | 用本文件通用 hover 规则覆盖组件自身已定义的 hover 样式 | 组件规范优先级高于本文件，覆盖会导致体验分裂 |
| ❌ DON'T | 自行发明 hover 视觉（如新的底色、阴影、缩放） | 样式一律参照本文件 §3 罗列的组件类型 hover 规范 |
| ❌ DON'T | 对静态不可点击文字设置 `cursor: pointer` | 误导用户可点击性 |
| ❌ DON'T | 同时使用"文字变色 + 背景变色"两种反馈 | 反馈冗余，破坏层级 |
| ❌ DON'T | 替换纯色代替叠加（overlay） | 会破坏选中态、zebra、语义色 |
| ❌ DON'T | 为深色模式单独写死 hover 色值（图片蒙层除外） | 应通过 Token 自动适配 |
| ❌ DON'T | Hover 状态 0ms 硬切换 | 反馈生硬，缺乏触感 |
| ❌ DON'T | 在移动端实现 hover 效果 | 移动端无 hover；会因触摸 sticky 导致错误反馈 |

---

## 5. 相关文档

- `ainvest-design-system/references/rules/perceptual-ux-heuristics.md`
- `ainvest-design-system/references/components/button.md`
- `ainvest-design-system/references/components/link.md`
- `ainvest-design-system/references/rules/list-table-pattern.md`
- `ainvest-design-system/references/components/dropdown-menu.md`
- `ainvest-design-system/references/components/line-tabs.md`
- `ainvest-design-system/references/rules/card.md`
- `ainvest-design-system/references/tokens/color.md`
- `ainvest-design-system/references/tokens/shadow.md`
