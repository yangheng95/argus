我需要复刻网页：<https://www.tradingview.com/markets/world-economy/>，

这是一个多阶段任务。目标是在保留 TradingView 页面信息架构、模块结构、布局密度和交互语义的前提下，像素级复刻 TradingView 的品牌视觉，并严格使用 AInvest 设计系统实现一个生产可合入页面，尤其要优先使用 `ainvest-ui-components` 及项目中已安装的 `@ainvest/*` 组件。

# 警告： 你必修优先使用ui-showcase 展示的组件，除非无法找到合适的组件

## 注意：这是个自适应全宽页面，不要使用固定宽度的布局方案。字体大小要跟页面协调

禁止手写 primitive、禁止用截图/图片冒充真实实现、禁止只做到“形式上使用了组件”。组件复用必须同时满足：

- 使用了真实 AInvest 组件。
- 组件选择符合具体使用场景。
- 组件 props、交互语义、可访问性、hover/focus/active 状态符合 AInvest 组件规范和页面需求。
- 样式不得绕过组件规范私自覆盖成另一套视觉体系。

你需要基于 OpenCorvus 的 Frontend Design 和 Frontend Research 等 Agent 编排两个 task。

## 阶段 1：目标网页资源抽取 + 设计方案 + 模块实现

### 1.1 目标网页资源与 PRD 抽取

必须获取目标网页资源和详细 PRD，并输出可追溯证据，而不是主观描述。

必须使用 OpenCorvus task-scoped backend browser evidence runner 对目标页面每个 region 做截图、DOM、样式、交互证据采集，并将证据与实现文件建立映射。

### 1.2 设计方案

必须在实现前输出模块级设计方案，说明每个 region：

- 目标截图/DOM 证据来源
- 信息结构
- 布局尺寸
- 使用的 AInvest 组件
- 为什么选择该组件
- 哪些交互状态需要实现
- 哪些颜色/token 需要使用
- 是否存在组件库缺口
- 如果存在组件库缺口，必须说明证据和降级策略，不得直接手写 primitive

### 1.3 模块实现

根据获取的资源和 PRD，逐个组件复刻页面细节，采用 AInvest 组件实现。

实现要求：

- 必须是真实 AInvest 组件复用，而不是重新造 primitive。
- 每个组件不得降级为图片、占位、静态截图、SVG 模拟等非真实实现形式。
- 地图路径、数据可视化路径等确有业务必要的图形资源可以使用 SVG/path，但必须数据驱动，并且样式来自 token。
- 所有用户可见颜色必须来自 `src/styles/variables-v1.css` 的 `--atom-*` token 或项目已有语义类。
- 不得建立 `--tv-*`、`--tradingview-*`、`--world-economy-*` 之外的平行 token 体系；如果使用页面级语义变量，必须全部映射到 `--atom-*` token，不得写 raw color。
- 不得出现 raw hex/rgb/hsl、`text-[#...]`、`bg-white`、`border-[#...]` 等用户可见硬编码颜色。

## 阶段 2：逐模块检查、修复、二次验收

必须使用 OpenCorvus task-scoped backend browser evidence runner 对每个 region 做 Reference vs Implementation 单独对比。不能只跑 typecheck。

每个 region 必须检查：

- 布局尺寸
- 字体 / 字重 / 行高
- 间距 / 边框 / 圆角
- 颜色 / 背景
- 是否无 raw hex/rgb/hsl
- 是否无自建 token 体系
- 表格密度
- table/heatmap color 是否符合 AInvest token 与组件规范
- 图表比例
- 地图比例，地图使用echarts实现时必须检查地图元素尺寸、tooltip 行为、交互热点行为是否符合目标页面
- tooltip/hover/focus 行为
- 卡片 hover 状态
- 卡片内部内容样式，包括标题、描述、作者、时间、标签、统计信息、按钮、图标、缩略图
- 移动端布局
- 键盘可访问性和 focus-visible
- 使用的 AInvest 组件是否真实复用
- 使用的 AInvest 组件是否符合场景约束
- 图标是否来自 `@ainvest/icons`
- 链接、按钮、tag、pill、tab 是否按语义选择正确组件

发现不一致、丑陋、不合理、不可访问、未复用组件、组件场景错误、接口幻觉、双源样式时，必须回到对应 region 的源材料和实现文件继续修复，然后重新截图验证。

如果无法交付，必须明确说明：

- 未达成项
- 影响范围
- 已验证证据
- 失败原因
- 后续修复建议

禁止包装成“基本完成”。

## 硬性约束

### 1. 视觉相似为第一目标，不可妥协

必须先读取并遵守：

- `AGENTS.md`
- `ainvest-ui-components` skill
- `ainvest-icons` skill
- 项目中已有 `@ainvest/*` 组件用法
- 当前回测文档中指出的 `world-economy` 路由问题

视觉复刻必须以目标页面真实截图和 DOM 证据为准，不得凭主观经验补 UI。

### 2. 禁止视觉双源

禁止：

- 自建 `--tv-*`
- 自建 `--tradingview-*`
- 散落的临时 token
- raw hex/rgb/hsl
- `text-[#...]`
- `bg-white`
- `border-[#...]`
- 用户可见硬编码颜色
- 在组件外层用大量 CSS 覆盖 AInvest 组件，使其失去原组件规范

所有颜色、背景、边框、文字层级必须来自：

- `src/styles/variables-v1.css` 的 `--atom-*` token
- 项目已封装语义类
- 页面级语义变量，但这些变量必须映射到 `--atom-*` token

如果确有业务色阶需求，例如地图、heatmap、图表：

- 必须先查已有 token。
- 必须优先使用 `--atom-color-transparent-*`、`--atom-color-visualization-*`、`--atom-color-price-*`、`--atom-color-status-*` 等已有 token。
- 无法复用时，必须在方案中说明证据和原因。
- 不得临时散落硬编码颜色。

### 3. 必须复用 AInvest 成熟组件，并且组件选择必须符合场景

组件复用不是只看 import，而是看“语义 + 场景 + 交互 + 样式规范”是否正确。

必须遵守以下场景约束：

| 场景                      | 必须优先使用                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------- |
| 普通操作按钮              | `@ainvest/button`                                                                  |
| 跳转链接                  | `@ainvest/link`                                                                    |
| 看起来像按钮但语义是跳转  | 使用 `@ainvest/link` 或组件库支持的 link button 模式，不得用普通 `Button` 伪装跳转 |
| 看起来像按钮但语义是操作  | 使用 `@ainvest/button`，不得用 `Link` 伪装操作                                     |
| tag / chip / label / pill | 优先使用 `@ainvest/tag` 或组件库对应 tag/pill 组件，不得用手写 `span` 拼样式       |
| tabs                      | `@ainvest/pill-tabs` 或 `@ainvest/segment-tabs`                                    |
| FAQ / Accordion           | `@ainvest/collapse`                                                                |
| Tooltip                   | `@ainvest/tooltip`，且必须确认 hover 与 focus 的可达性                             |
| Table / Heatmap 类表格    | 优先使用 `@ainvest/table`                                                          |
| Search                    | `@ainvest/search-input`                                                            |
| Carousel / 横向滚动卡片   | `@ainvest/carousel`，同时保证键盘可访问                                            |
| 通用图标                  | `@ainvest/icons`                                                                   |

禁止：

- 手写通用 inline SVG。
- 手写 button/link/tag/tab primitive。
- 用 `div/span` 模拟可交互组件。
- 用 `Button` 包普通跳转但没有正确链接语义。
- 用 `Link` 做非跳转操作。
- 表面 import 了 AInvest 组件，但核心交互、hover、focus、尺寸、颜色全部自写覆盖。

仅允许：

- 图标库不存在且有业务必要的图形资源。
- 数据驱动地图 path。
- 图表数据形状。
- 页面特定布局容器。

### 4. 卡片必须按规范实现 hover 和内部内容样式

所有卡片类模块必须逐项验收：

- 默认态背景
- hover 背景
- hover 边框
- hover 阴影
- hover 内部链接颜色
- hover 缩略图或 chart preview 行为
- 标题字号、字重、行高、截断
- 描述字号、字重、行高、截断
- meta 信息层级
- 作者、时间、来源、评论数、boost 数样式
- 图标尺寸、颜色、对齐方式
- 卡片圆角
- 卡片内边距
- 卡片间距
- 点击区域语义是否正确
- 卡片内多个链接是否存在嵌套交互冲突
- 移动端卡片密度是否合理

不得只检查静态截图；必须检查 hover/focus 状态。

### 5. Table / Heatmap 必须符合组件和 token 规范

Table/Heatmap 必须检查：

- 是否使用 `@ainvest/table`
- 表头高度
- 行高
- 列宽
- 对齐方式
- sticky 或横向滚动行为
- 单元格 padding
- 字体层级
- 分割线颜色
- hover 行状态
- heatmap 色阶来源
- 正负值颜色来源
- 是否存在 raw hex/rgb/hsl
- 是否存在自建色阶
- 移动端横向滚动和可访问说明

Heatmap 色阶必须来自已有 token 或明确的 token 映射，禁止在 JSX 或 CSS 中散落 raw color。

### 6. 架构必须符合 `View -> Hook/Store -> Service -> Model`

要求：

- View 不直接拼接口。
- View 不直接 fetch。
- View 不直接写后端响应转换逻辑。
- 如果页面是静态克隆，必须把本地数据模块作为唯一数据源。
- 必须在 handoff 文档中明确：“未发现/未接入真实接口，不得手搓幻觉 API”。
- 如果仓库已有接口协议，必须 grep 实际 route/service/model 定义后接入，不得凭空设计接口。

### 7. 所有用户可见字符串必须按项目 i18n 现状处理

要求：

- 先 grep 现有 `t()` / `locale` / `i18n` 用法。
- 如果项目已接入 i18n，新字符串必须进入翻译体系。
- 如果该页面当前没有 i18n 基础，必须在 handoff 中说明现状和后续接入点。
- 不能只传 `locale` 但完全不用，也不能伪装成已完成多语言。

### 8. 地图和大规模 SVG 必须控制焦点顺序

结合当前回测问题，必须重点处理 `GlobalIndustrialMap` 类实现：

- 禁止让全量国家 path 都进入键盘焦点顺序。
- 如果地图包含超过 50 个 path，默认应作为整体图形呈现。
- 只允许关键国家、可交互热点或摘要列表进入 tab 顺序。
- 必须提供 `title` / `desc` / `aria-describedby` 或等价文本摘要。
- Tooltip 信息必须对 hover 和 keyboard focus 都可达。
- 参考 `InflationMap` 的模式：完整 SVG 可以 aria-hidden，交互通过有限 hotspot button 暴露。

### 9. 验收必须是逐 region 的 Reference vs Implementation

每个 region 必须产出：

- Reference 截图
- Implementation 截图
- DOM/样式证据
- 组件复用证据
- 组件场景选择说明
- 差异列表
- 修复记录
- 二次截图验证结果

不能只输出 typecheck、build 成功。

### 10. 最终交付

最终必须输出：

- 实现文件列表
- 每个 region 的 AInvest 组件使用表
- 每个 region 的场景约束检查结果
- 每个 region 的视觉差异结论
- hover/focus/keyboard 验证结果
- table/heatmap color 规范验证结果
- raw color/token 双源扫描结果
- 未完成项和风险
- 后续建议

如果存在以下情况，必须明确标红说明，不得隐瞒：

- 组件库没有对应组件
- 使用了临时 CSS 覆盖
- 使用了页面级语义变量
- 地图/图表存在不可完全复刻的行为
- i18n 未完全接入
- 某些 hover/focus 状态无法通过工具验证
- 某些 region 未完成二次截图验证
