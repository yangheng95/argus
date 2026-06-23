我需要复刻网页：<https://www.tradingview.com/markets/world-economy/>

这是一个多阶段前端实现任务。目标不是复刻 TradingView 的品牌视觉，而是在保留 TradingView 页面信息架构、模块顺序、布局密度、响应式行为和交互语义的前提下，使用 AInvest 设计系统、AInvest tokens 和 AInvest 组件实现一个生产可合入页面。

核心原则：

- TradingView 是信息结构、模块组织、密度、交互语义和响应式行为的 reference。
- AInvest 是视觉系统、组件 primitive、颜色 token、图标和交互状态的唯一来源。
- 不要求复刻 TradingView 的品牌色、字体、控件皮肤或视觉风格。
- 禁止用图片、截图、静态 SVG 或占位内容冒充真实页面实现。
- 禁止 fallback/兜底逻辑。如果组件库缺口阻塞实现，必须标记为 `[阻塞]`，说明证据、影响范围和需要补齐的组件能力，不得私自手写 primitive 绕过。

如果当前目录不存在模板文件夹，则需要将 `nova-vibecoding-template` 文件夹中的代码复制到当前项目中

## 模板准备

如果当前目录不存在模板文件夹，则需要将 `nova-vibecoding-template` 文件夹中的代码复制到当前项目中

## 必须先读取并遵守

- `AGENTS.md`
- `ainvest-ui-components` skill
- `ainvest-icons` skill
- `ui-showcase` 中展示的 AInvest 组件用法
- 项目中已有 `@ainvest/*` 组件用法
- 当前与 `world-economy` 路由相关的回测/设计/问题记录；如果路径不明确，必须先在仓库中 grep `world-economy`

## 页面范围

目标页面为 TradingView World Economy 页面。

实现前必须先枚举页面 regions。每个 region 至少包含：

- region 名称
- 目标页面对应区域截图
- DOM/样式证据
- 信息结构
- 布局密度
- 响应式行为
- 交互状态
- 实现文件映射

后续设计、实现、验收都必须按 region 进行。

## 阶段 1：Reference Evidence 和需求反推

必须使用 OpenCorvus task-scoped backend browser evidence runner 对目标页面采集证据。

每个 region 必须采集：

- Reference 截图
- DOM 结构
- 关键样式
- hover/focus/active 交互证据
- 移动端截图或响应式证据
- 如果有表格、heatmap、地图、tooltip、横向滚动区域，必须单独采集交互证据

输出一份 evidence-derived PRD。这里的 PRD 指“基于 reference 页面证据反推的实现需求”，不是 TradingView 内部产品文档。

PRD 必须包含：

- region 列表
- region 信息结构
- region 布局和密度要求
- region 交互要求
- region 响应式要求
- region 对应实现文件计划
- 不确定项和 `[阻塞]` 项

## 阶段 2：模块级设计方案

实现前必须输出模块级设计方案。每个 region 必须说明：

- 使用的 reference 证据路径
- 信息结构
- 布局策略
- 是否需要固定列宽、最大宽度或断点；如需要，必须来自 reference 证据或 AInvest 布局规范
- 使用哪些 AInvest 组件
- 为什么选择这些组件
- 对应的 props、交互语义和可访问性要求
- 使用哪些 `--atom-*` token 或项目已有语义类
- 是否需要页面级语义变量
- 是否存在组件库缺口

页面是响应式全宽页面，但不禁止有证据支持的 max-width、表格列宽、卡片最小宽度、grid track 或断点规则。禁止的是无证据的固定宽度硬编码。

## 阶段 3：实现要求

必须优先使用 `ainvest-ui-components` 和项目中已安装的 `@ainvest/*` 组件。

组件复用必须同时满足：

- 使用真实 AInvest 组件
- 组件选择符合场景语义
- props、交互语义、可访问性、hover/focus/active 状态符合 AInvest 规范和页面需求
- 样式不得绕过组件规范覆盖成另一套视觉体系

场景约束：

| 场景                      | 必须优先使用                                    |
| ------------------------- | ----------------------------------------------- |
| 普通操作按钮              | `@ainvest/button`                               |
| 跳转链接                  | `@ainvest/link`                                 |
| 看起来像按钮但语义是跳转  | `@ainvest/link` 或组件库支持的 link button 模式 |
| 看起来像按钮但语义是操作  | `@ainvest/button`                               |
| tag / chip / label / pill | `@ainvest/tag` 或组件库对应 tag/pill 组件       |
| tabs                      | `@ainvest/pill-tabs` 或 `@ainvest/segment-tabs` |
| FAQ / Accordion           | `@ainvest/collapse`                             |
| Tooltip                   | `@ainvest/tooltip`                              |
| Table / Heatmap 类表格    | 优先使用 `@ainvest/table`                       |
| Search                    | `@ainvest/search-input`                         |
| Carousel / 横向滚动卡片   | `@ainvest/carousel`                             |
| 通用图标                  | `@ainvest/icons`                                |

禁止：

- 手写 button/link/tag/tab primitive
- 用 `div/span` 模拟可交互组件
- 用 `Button` 伪装普通跳转
- 用 `Link` 伪装非跳转操作
- 表面 import AInvest 组件，但核心交互、hover、focus、尺寸、颜色全部自写覆盖
- 用截图、图片或静态 SVG 冒充真实 UI

允许：

- 页面特定布局容器
- 数据驱动地图 path
- 数据驱动图表形状
- 图标库不存在且有业务必要的图形资源

SVG/path 只能用于业务数据图形，例如地图、图表、可视化路径。不得用 SVG/path 模拟 AInvest 已有 UI primitive。

## 颜色与 token

所有用户可见颜色必须来自：

- `src/styles/variables-v1.css` 的 `--atom-*` token
- 项目已封装语义类
- 页面级语义变量，但页面级变量必须全部映射到 `--atom-*` token

禁止：

- raw hex/rgb/hsl
- `text-[#...]`
- `bg-white`
- `border-[#...]`
- 自建 `--tv-*`
- 自建 `--tradingview-*`
- 散落的临时 token

页面级语义变量只允许使用 `--world-economy-*` 命名，并且必须集中定义、全部映射到 `--atom-*` token，不得映射到 raw color。

如果地图、heatmap、图表确有业务色阶需求：

- 必须先查已有 token
- 优先使用 `--atom-color-transparent-*`、`--atom-color-visualization-*`、`--atom-color-price-*`、`--atom-color-status-*`
- 无法复用时，必须标记为 `[阻塞]` 或在设计方案中说明需要新增 token，不得在 JSX/CSS 中散落 raw color

## 架构要求

架构遵循：

`View -> Hook/Store -> Model`

如果接入真实接口，则遵循：

`View -> Hook/Store -> Service -> Model`

要求：

- View 不直接 fetch
- View 不直接拼接口
- View 不直接写后端响应转换逻辑
- 如果页面是静态克隆，本地 data/model 模块是唯一数据源
- 未发现真实接口时，必须在 handoff 中明确：“未发现/未接入真实接口，不得手搓幻觉 API”
- 如果仓库已有接口协议，必须 grep route/service/model 定义后再接入，不得凭空设计接口

## i18n 要求

所有用户可见字符串必须按项目 i18n 现状处理。

必须先 grep：

- `t(`
- `locale`
- `i18n`
- 现有页面字符串处理方式

如果项目已接入 i18n，新字符串必须进入翻译体系。

如果该页面当前没有 i18n 基础，必须在 handoff 中说明：

- 当前现状
- 未接入范围
- 后续接入点

不得只传 `locale` 但完全不用，也不得伪装成已完成多语言。

## 地图和大规模 SVG 可访问性

地图或大规模 SVG 必须控制焦点顺序。

要求：

- 禁止让全量国家 path 都进入键盘 tab 顺序
- 如果地图包含超过 50 个 path，默认作为整体图形呈现
- 只有关键国家、可交互 hotspot 或摘要列表可以进入 tab 顺序
- 完整地图必须提供 `title` / `desc` / `aria-describedby` 或等价文本摘要
- Tooltip 必须对 hover 可达
- 对进入 tab 顺序的 hotspot，tooltip 也必须对 keyboard focus 可达
- 不要求每一个非 focusable path 都具备独立 keyboard tooltip

可参考 `InflationMap` 模式：完整 SVG 可以 `aria-hidden`，交互通过有限 hotspot button 或摘要列表暴露。

## 阶段 4：逐 region 验收

每个 region 必须做 Reference vs Implementation 对比，不能只跑 typecheck/build。

每个 region 必须检查：

- 布局尺寸
- 字体 / 字重 / 行高
- 间距 / 边框 / 圆角
- 颜色 / 背景
- 是否无 raw hex/rgb/hsl
- 是否无非法自建 token
- 表格密度
- table/heatmap color 是否符合 AInvest token 与组件规范
- 图表比例
- 地图比例
- tooltip/hover/focus 行为
- 卡片 hover 状态
- 卡片内部标题、描述、作者、时间、标签、统计信息、按钮、图标、缩略图
- 移动端布局
- keyboard 可访问性和 focus-visible
- AInvest 组件是否真实复用
- AInvest 组件选择是否符合场景语义
- 图标是否来自 `@ainvest/icons`
- 链接、按钮、tag、pill、tab 是否按语义选择正确组件

发现不一致、不可访问、组件场景错误、接口幻觉、双源样式或未复用 AInvest 组件时，必须回到对应 region 的 source evidence 和实现文件修复，然后重新截图验证。

## 卡片验收

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
- 点击区域语义
- 卡片内多个链接是否存在嵌套交互冲突
- 移动端卡片密度

不得只检查静态截图，必须检查 hover/focus 状态。

## Table / Heatmap 验收

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
- 是否存在非法自建色阶
- 移动端横向滚动和可访问性

## 测试与扫描

必须补充与改动匹配的测试。

至少包括：

- 组件语义或渲染测试
- 关键 region 行为测试
- token/raw color 扫描
- 如果修改路由或数据层，必须覆盖对应接口/路由/数据模块
- 如果涉及地图可访问性，必须测试非关键 path 不进入 tab 顺序，hotspot 可 focus

raw color/token 扫描范围必须至少覆盖本次新增和修改文件，以及该页面直接引用的样式文件。不要把第三方依赖或无关历史文件作为本次失败依据，但必须在最终报告中说明扫描范围。

## 最终交付

最终必须输出：

- 实现文件列表
- 每个 region 的 AInvest 组件使用表
- 每个 region 的场景约束检查结果
- 每个 region 的视觉差异结论
- hover/focus/keyboard 验证结果
- table/heatmap color 规范验证结果
- raw color/token 双源扫描结果
- 测试命令和结果
- 未完成项和风险
- 后续建议

如果存在以下情况，必须用 `[未达成]` 或 `[阻塞]` 明确标记，不得包装成“基本完成”：

- 组件库没有对应组件
- 使用了临时 CSS 覆盖
- 使用了页面级语义变量
- 地图/图表存在不可完全复刻的行为
- i18n 未完全接入
- 某些 hover/focus 状态无法通过工具验证
- 某些 region 未完成二次截图验证
