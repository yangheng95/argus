我需要复刻网页：<https://www.tradingview.com/markets/world-economy/>

这是一个多阶段任务。像素级复制 TradingView 的品牌视觉，保留 TradingView 页面信息架构、模块结构、布局密度和交互语义的前提下，严格用 AInvest 设计系统实现生产可合入页面，特别是ainvest-ui-components库中的组件，禁止手写 primitive 或复制截图冒充实现。你需要基于OpenCorvus的Frontend Design 和 Frontend Research等Agent编排两个 task。Frontend Design 必须为每个页面主要 region 输出可执行的 VisualRegionBinding 清单：包含 source reference artifact、source bbox、viewport、region_scope、目标 route、implementation locator、component_files。Build 不得用全页截图替代已有 binding 的 region comparison；若 binding 缺失，必须失败并说明缺失 region，而不是继续实现。

阶段 1：目标网页资源抽取 + 设计方案 + 模块实现 (architect > 20 goals，每个页面主要组件至少 1 个 goal)

获取目标网页资源和详细 PRD。必须输出可追溯证据，而不是主观描述。根据获取的资源和PRD逐个组件复刻页面细节,采用ainvest-ui-components实现。使用 task-scoped backend browser evidence runner 对每个 region 做 Reference vs Implementation 单独对比。不能只跑 typecheck。实现的组件必须是真正的 AInvest 组件复用，而不是重新造 primitive。每个组件的不可以降级为图片，占位，SVG模拟等非真正实现的形式。

阶段 2：逐模块检查、修复、二次验收  (architect > 20 goals，每个页面主要组件至少 1 个 goal)

使用 task-scoped backend browser evidence runner 对每个 region 做 Reference vs Implementation 单独对比。不能只跑 typecheck。

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

发现不一致、丑陋、不合理、不可访问、未复用组件、接口幻觉、双源样式时，必须回到对应 region 的源材料和实现文件继续修复，然后重新截图验证。如果无法交付，必须明确说明未达成项、影响范围、已验证证据、失败原因，禁止包装成“基本完成”。

硬性约束：

1. 视觉相似为第一目标，不可妥协！必须先读取并遵守下面的视觉要求：
   - AGENTS.md
   - ainvest-ui-components skill
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
