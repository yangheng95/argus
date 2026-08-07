我需要复刻网页：<https://www.tradingview.com/markets/world-economy/>

这是一个前端复刻任务（只发布一轮任务，禁止创建子任务和重复执行含architect之前的agent！）。目标是以 TradingView 目标页面为主导，尽可能高保真复刻其信息架构、模块结构、布局密度、视觉风格、颜色层级、字体节奏、交互语义和响应式行为，并实现为一个生产可合入页面。

## 模板准备

如果当前目录不存在模板文件夹，则需要将 `nova-vibecoding-template` 文件夹中的代码复制到当前项目中。

### 警告：模板存在很多问题，不要纠结绝对正确，你只需要确保视觉、交互和响应式行为符合 TradingView 目标页面证据即可

## 核心目标

- TradingView 是 reference source of truth。
- 视觉目标以 TradingView 真实截图、DOM、computed style 和交互证据为准。
- AInvest 组件可以作为实现 primitive 使用，但不得牺牲 TradingView 视觉还原度。
- 不允许用截图、图片、静态占位或伪实现冒充真实 UI。
- 不允许 fallback/兜底逻辑。如果某个要求无法实现，必须标记为 `[阻塞]`，说明证据、影响范围和根因。

## 优先级

当要求发生冲突时，按以下优先级处理：

1. TradingView 真实页面证据
2. 用户明确要求的复刻目标
3. 项目架构与代码规范
4. 可访问性与真实交互语义
5. AInvest 组件复用

AInvest 组件复用不能覆盖 TradingView 视觉目标。若某个 AInvest 组件无法在不破坏复刻目标的前提下使用，必须在设计方案中说明证据，并采用页面级真实实现，而不是强行套组件。

## 必须先读取

- `AGENTS.md`
- 项目中已有页面实现方式
- 项目路由、样式、token、i18n、测试约定
- 项目中已有 `@ainvest/*` 组件用法

必须先 grep：

- `ainvest`
- `i18n`
- `locale`
- `t(`
- 现有 route/service/model/view 定义

## 阶段 1：目标页面证据采集

必须使用 OpenCorvus task-scoped backend browser evidence runner 对 TradingView 页面采集证据。

先枚举页面 regions。每个 region 至少需要采集：

- reference 截图
- DOM 结构
- computed style
- 字体、字号、字重、行高
- 颜色、背景、边框、阴影
- 间距、圆角、宽度、高度、grid/table 布局
- hover/focus/active 状态
- 移动端和桌面端响应式行为
- 表格、heatmap、地图、tooltip、卡片、tab、链接、按钮等交互证据

输出 evidence-derived PRD。这里的 PRD 指“基于 TradingView 页面证据反推的实现需求”。

每个 region 必须包含：

- region 名称
- reference 证据路径
- 信息结构
- 布局结构
- 视觉规格
- 交互状态
- 响应式行为
- 实现文件映射
- 不确定项
- `[阻塞]` 项

## 阶段 2：视觉系统抽取

必须从 TradingView 证据中抽取页面级视觉系统。

需要输出：

- 字体层级
- 颜色层级
- 背景层级
- 边框层级
- 阴影层级
- 圆角规则
- 间距规则
- 表格密度
- 卡片密度
- 图表/地图色阶
- hover/focus/active 状态规则

所有 TradingView 视觉值必须集中管理，禁止散落在 JSX 或零散 CSS 中。

这些变量必须集中定义，并且每个变量都要能追溯到 TradingView 证据。

禁止：

- JSX 内散落 raw hex/rgb/hsl
- Tailwind arbitrary color，例如 `text-[#...]`
- 多处重复定义同一语义颜色
- 同一视觉语义存在多个来源
- AInvest token 与 TradingView token 混用导致双源视觉

## 阶段 3：模块级设计方案 （注意此阶段 Architect 需分解 > 20 goals）

实现前必须输出模块级设计方案。

每个 region 必须说明：

- reference 截图路径
- DOM/样式证据路径
- 信息结构
- 布局尺寸
- responsive breakpoint
- 使用的组件或页面级实现
- 是否使用 AInvest 组件
- 如果使用，如何保证不破坏 TradingView 视觉
- 如果不使用，为什么 AInvest 组件无法满足复刻目标
- 需要实现的 hover/focus/active 状态
- 需要实现的 keyboard 行为
- 颜色和 token 来源
- 测试与验收方式

## 阶段 4：实现要求

实现必须是真实页面，不得用截图冒充。

允许：

- 使用 AInvest 组件作为可访问 primitive
- 使用页面级 CSS 复刻 TradingView 视觉
- 使用数据驱动 SVG/path 实现地图或图表
- 使用页面级语义变量管理 TradingView 视觉 token
- 针对 TradingView 特定交互实现页面级组件

禁止：

- 用图片/截图/静态 SVG 冒充页面
- 用占位数据冒充真实结构
- 用 `div/span` 模拟交互但没有正确语义
- 只做静态截图相似，不实现 hover/focus/keyboard
- 引入双源 token
- 为了套 AInvest 组件牺牲 TradingView 视觉还原度
- 手写无证据的布局、颜色、尺寸或交互

## 架构要求

如果页面是静态克隆：

`View -> Hook/Store -> Model`

如果接入真实接口：

`View -> Hook/Store -> Service -> Model`

要求：

- View 不直接 fetch
- View 不直接拼接口
- View 不直接写后端响应转换逻辑
- 静态克隆时，本地 data/model 模块是唯一数据源
- 未发现真实接口时，必须在 handoff 中写明：“未发现/未接入真实接口，不得手搓幻觉 API”
- 如果仓库已有接口协议，必须 grep route/service/model 后再接入

## i18n 要求

所有用户可见字符串必须按项目现状处理。

必须先检查：

- `t(`
- `locale`
- `i18n`
- 现有页面字符串处理方式

如果项目已有 i18n，新字符串必须进入翻译体系。

如果该页面没有 i18n 基础，必须在 handoff 中说明：

- 当前现状
- 未接入范围
- 后续接入点

不得伪装成已完成多语言。

## 地图与图表要求

地图、heatmap、图表必须基于数据结构实现。

要求：

- 不得用静态图片替代
- 地图 path 必须数据驱动
- 图表比例必须对齐 reference
- tooltip 内容、位置、触发方式必须对齐 reference
- hover 状态必须对齐 reference
- keyboard 可访问行为必须明确

如果地图包含大量 path：

- 禁止让全部 path 进入 tab 顺序
- 地图整体必须有文本摘要
- 只有关键 hotspot 或摘要列表进入 keyboard focus
- 对可 focus hotspot，tooltip 必须支持 hover 和 focus
- 对不可 focus path，不要求逐个提供 keyboard tooltip

## 阶段 5：逐 region 视觉验收

每个 region 必须做 Reference vs Implementation 对比。

不能只跑 typecheck、lint、build 或 DOM 文本检查。

每个 region 必须验收：

- 模块顺序
- 信息结构
- 布局尺寸
- 页面密度
- 字体 / 字重 / 行高
- 颜色 / 背景
- 边框 / 圆角 / 阴影
- 间距
- 表格密度
- 卡片密度
- 图表比例
- 地图比例
- hover/focus/active 状态
- tooltip 行为
- keyboard 可访问性
- 移动端响应式
- 是否存在视觉 token 双源
- 是否存在散落 raw color
- 是否存在截图/图片伪实现

发现差异时，必须回到对应 region 的证据和实现文件继续修复，然后重新截图验证。

## 卡片验收

所有卡片类模块必须检查：

- 默认态背景
- hover 背景
- hover 边框
- hover 阴影
- hover 内部链接颜色
- 标题字号、字重、行高、截断
- 描述字号、字重、行高、截断
- meta 信息层级
- 作者、时间、来源、评论数、统计信息样式
- 图标尺寸、颜色、对齐
- 缩略图或 chart preview 行为
- 卡片圆角
- 卡片内边距
- 卡片间距
- 点击区域语义
- 嵌套链接冲突
- 移动端密度

必须检查 hover/focus，不得只检查静态截图。

## Table / Heatmap 验收

Table/Heatmap 必须检查：

- 表头高度
- 行高
- 列宽
- 对齐方式
- sticky 或横向滚动行为
- 单元格 padding
- 字体层级
- 分割线颜色
- hover 行状态
- heatmap 色阶
- 正负值颜色
- 移动端横向滚动
- keyboard 与 screen reader 行为

色阶必须来自集中定义的页面级 token，不得散落 raw color。

## 测试与扫描

必须补充与改动匹配的测试。

至少包括：

- region 渲染测试
- 关键交互测试
- hover/focus 行为测试
- token/raw color 扫描
- 地图可访问性测试
- table/heatmap 结构测试
- 响应式行为测试

raw color 扫描范围至少覆盖：

- 本次新增文件
- 本次修改文件

不要把第三方依赖或无关历史文件作为本次失败依据，但最终报告必须说明扫描范围。

## 最终交付

最终必须输出：

- 实现文件列表
- region 列表
- 每个 region 的 reference 证据路径
- 每个 region 的实现文件映射
- 每个 region 的视觉差异结论
- 每个 region 的 hover/focus/keyboard 验证结果
- table/heatmap 验证结果
- 地图/图表验证结果
- token/raw color 扫描结果
- 测试命令和结果
- 未完成项
- 风险
- 后续建议

如果存在以下情况，必须用 `[未达成]` 或 `[阻塞]` 明确标记：

- 某个 region 未完成
- 某个 region 未完成二次截图验证
- TradingView 视觉无法完全复刻
- 某些 hover/focus 状态无法验证
- 地图/图表行为无法完全复刻
- 使用了临时 CSS
- 使用了未集中管理的视觉值
- 使用了非真实实现
- i18n 未完全接入

不得包装成“基本完成”。
