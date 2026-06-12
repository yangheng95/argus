我需要复刻网页：<https://www.tradingview.com/markets/world-economy/>

这是一个多阶段任务。目标不是像素级复制 TradingView 的品牌视觉，而是在保留 TradingView 页面信息架构、模块结构、布局密度和交互语义的前提下，严格用 AInvest 设计系统实现生产可合入页面。

你需要基于OpenCorvus的Frontend Design 和 Frontend Researcb等Agent编排两个 task。

阶段 1：目标网页资源抽取 + 设计方案 + 模块实现 (architect > 20 goals，每个页面主要组件至少 1 个 goal)

使用 frontend_design / frontend_research 获取目标网页资源和详细 PRD。必须输出可追溯证据，而不是主观描述。

每个 region 必须至少包含：

- region 名称和页面位置
- reference screenshot，含 desktop/mobile
- source-dom 摘要
- style-profile 摘要，包括尺寸、字体、字重、行高、间距、边框、圆角、颜色语义
- CSS sidecar 或等价样式证据
- 交互行为证据
- 数据来源证据
- 对应 AInvest 组件复用清单
- 对应实现文件

实现要求：

- 按网页模块写组件，组件消费对应 region 的 source-dom、style-profile、截图和 CSS sidecar 证据
- 地图、表格、图表都按可交互功能组件实现
- 图表优先使用成熟 chart 库或项目已有图表抽象
- 地图优先使用 GeoJSON / topojson / 成熟地图渲染方案，不得复制截图或手写静态 SVG 冒充
- 禁止把目标网页截图、iframe、远程 DOM、临时 query/signal 或本地 preview hack 当成实现
- 右侧预览只能使用 task-scoped backend preview target / evidence 作为单一来源
- Playwright 必须用 node 启动，Windows 上禁止用 bun 启动

阶段 1 结束前必须落盘：

- 实现方案文档，列出每个 region 的证据、组件、token、数据源、文件路径
- 接口/数据源设计文档，说明真实接口、已有仓库协议或本地唯一数据源
- 调用点 grep 结果，尤其是 @ainvest 组件、icons、variables-v1.css、i18n、已有 service/model/hook

阶段 2：逐模块检查、修复、二次验收  (architect > 20 goals，每个页面主要组件至少 1 个 goal)

使用 Playwright 或 Browser MCP 对每个 region 做 Reference vs Implementation 单独对比。不能只跑 typecheck。

每个 region 必须检查：

- 布局尺寸
- 字体 / 字重 / 行高
- 间距 / 边框 / 圆角
- 颜色 / 背景，确认无 raw hex/rgb/hsl 和无自建 token 体系
- 表格密度
- 图表比例
- 地图比例和 tooltip/hover 行为
- 移动端布局
- 键盘可访问性和 focus-visible
- 使用的 AInvest 组件是否真实复用，而不是重新造 primitive
- 图标是否来自 @ainvest/icons

发现不一致、丑陋、不合理、不可访问、未复用组件、接口幻觉、双源样式时，必须回到对应 region 的源材料和实现文件继续修复，然后重新截图验证。

最终验收必须包含：

- pnpm exec eslint 通过
- pnpm exec tsc --noEmit 通过
- 针对新增/修改行为的单元测试或 e2e 测试通过
- Playwright desktop/mobile 截图证据
- 每个 region 的 Reference vs Implementation 对比结论
- 无 console/page runtime error
- 无未使用导入、未使用导出、临时代码
- 无 @ainvest 组件可复用却手写的 primitive
- 无通用手写 inline SVG 图标
- 无 hardcoded user-visible colors
- 无自建 TradingView token 体系
- handoff 文档完整说明接口设计/复用、数据源、未解决风险和验证命令

如果无法交付，必须明确说明未达成项、影响范围、已验证证据、失败原因，禁止包装成“基本完成”。

硬性约束：

1. 必须先读取并遵守：
   - AGENTS.md
   - .agents/skills/ainvest-design-system-lite/SKILL.md
   - .agents/skills/ainvest-icons/SKILL.md
   - src/styles/variables-v1.css
   - 项目中已有 @ainvest/* 组件用法

2. 禁止视觉双源：
   - 禁止自建 --tv-*、--tradingview-* 或其他平行 token 体系
   - 禁止 raw hex/rgb/hsl、text-[#...]、bg-white、border-[#...] 等用户可见硬编码颜色
   - 所有颜色、背景、边框、文字层级必须来自 src/styles/variables-v1.css 的 --atom-* token 或项目已封装语义类
   - 如确有业务色阶需求，必须先查已有 token，无法复用时在方案中说明证据，不得临时散落硬编码

3. 必须复用 AInvest 成熟组件：
   - Button 使用 @ainvest/button
   - Table/Heatmap 类表格优先使用 @ainvest/table
   - Tag/Pill 使用 @ainvest/tag
   - Tabs 使用 @ainvest/pill-tabs 或 @ainvest/segment-tabs
   - FAQ/Accordion 使用 @ainvest/collapse
   - Tooltip 使用 @ainvest/tooltip
   - Link 使用 @ainvest/link
   - 通用图标必须使用 @ainvest/icons，例如 Search、Chevron、Person、Setting、Plus、Close 等
   - 禁止手写通用 inline SVG。仅允许保留图标库不存在且有业务必要的图形资源，例如数据驱动地图路径

4. 架构必须符合 View -> Hook/Store -> Service -> Model：
   - View 不直接拼接口、不直接 fetch、不直接写转换逻辑
   - 如果页面是静态克隆，必须把本地数据模块作为唯一数据源，并在 handoff 文档中明确“未发现/未接入真实接口，不得手搓幻觉 API”
   - 如果仓库已有接口协议，必须 grep 实际 route/service/model 定义后接入，不得凭空设计接口

5. 所有用户可见字符串必须按项目 i18n 现状处理：
   - 先 grep 现有 t()/locale/i18n 用法
   - 如果项目已接入 i18n，新字符串必须进入翻译体系
   - 如果该页面当前没有 i18n 基础，必须在 handoff 说明现状和后续接入点，不能只传 locale 但完全不用
