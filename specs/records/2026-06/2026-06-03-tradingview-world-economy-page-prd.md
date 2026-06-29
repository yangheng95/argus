# TradingView World Economy 页面 PRD

版本：v2 readable rewrite。
日期：2026-06-03。
目标页面：https://www.tradingview.com/markets/world-economy/。
页面标题：World Economy — Rankings and Forecasts — TradingView。
交付目标：写给产品、设计、研发、测试、数据和法务都能直接使用的页面级 PRD。
行数要求：用户要求 1000 行以上，本版保留 1000 行以上，但正文按真实 PRD 阅读路径组织，不再用机械编号堆行。
重要说明：本文定义的是可实现的产品需求，不定义私有 TradingView 后端复制方案，不要求绕过版权或数据授权。

## 快速阅读路径

- 只想理解要做什么：读第 1 到第 5 章。
- 要开始设计页面：读第 6 到第 9 章。
- 要开始研发拆任务：读第 10 到第 11 章的模块规格。
- 要接数据：读第 12 到第 14 章。
- 要做测试验收：读第 21 到第 23 章。
- 要查具体页面内容：读第 24 到第 29 章附录。
- 本 PRD 的中心判断：这是一个宏观经济数据工作台，不是营销落地页。
- 实现时优先使用已有成熟组件和项目中已抽取的 TradingView 页面素材。
- 任何空白卡片、假地图、假新闻、假社区观点都不应被当作合格交付。
- 如果数据不可得，产品必须展示明确的数据不可用状态，而不是用无关内容顶替。

## 1. 一句话产品定义

- World Economy 页面是面向交易者和投资者的全球宏观经济入口页。
- 用户进入页面后，应能快速看到全球经济趋势、通胀分布、GDP 增长排行、重点美国宏观指标、国家入口、经济热力图、新闻、日历和解释型 FAQ。
- 页面的价值不是单个图表，而是把“全球概览 -> 国家/指标钻取 -> 新闻/日历跟进 -> 基础概念解释”串成一条完整路径。
- 页面第一屏必须传达数据密度和市场工具感，不能做成大图 hero 或品牌宣传页。
- 页面必须让新手能读懂 GDP、利率、通胀等基础概念，也要让专业用户能快速点击进入具体国家、指标和事件。

## 2. 当前页面观察结论

- 页面顶部是 TradingView 全站导航，包括品牌、Products、Community、Markets、Brokers、More、搜索、语言和 Get started。
- 页面主体从 Markets / Economy 面包屑进入，H1 为 Economy。
- 页面提供 Overview 和 Economic trends 两个页签。
- 核心内容从 Economic trends 开始，不是长文介绍。
- 经济趋势区域包含 Inflation map、GDP growth YoY、US unemployment rate、US interest rate、US trade balance。
- Inflation map 使用世界地图和 0%、3%、7%、12%、25% 的热力图图例。
- GDP growth YoY 排行展示 India、Indonesia、Mainland China、South Korea、Saudi Arabia、USA。
- 页面随后提供 Countries 国家 chip，覆盖 Argentina、Australia、Brazil、Canada、European Union 等 20 个入口。
- Ideas 区域展示社区观点，并提供 Popular、Recent、Video、More 分类。
- Economic indicators heatmap 用国家行和指标列展示 GDP、GDP Growth、Budget to GDP、Government Debt to GDP、Interest Rate、Inflation Rate 等。
- Main indicators 是指标目录，提供 GDP、Real GDP、GDP Per Capita、Inflation Rate、Interest Rate、Unemployment Rate 等入口。
- Global industrial map 是第二张全球热力地图，和 Inflation map 共享相似视觉语言。
- News 区域展示宏观经济新闻来源，例如 Reuters、Trading Economics。
- Economic Calendar 区域展示 Today 经济事件，例如 PMI、GDP Growth Rate QoQ、GDP Growth Rate YoY。
- FAQ 区域解释 GDP、GDP formula、GDP per capita、real GDP formula、interest rate、inflation rate formula 等。
- Footer 保留 TradingView 全站级导航和数据提供商版权声明。

## 3. 证据来源

| 类型              | 证据                                                                                                  | 用途                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Live page         | `https://www.tradingview.com/markets/world-economy/`                                                  | 确认页面标题、可见模块、可见文案和链接语义。                   |
| Rendered evidence | `.opencorvus/runtime/tasks/tsk_e8b012d9e001/frontend-design/webpage-evidence/reference.png`           | 确认桌面视口视觉结构。                                         |
| Evidence summary  | `.opencorvus/runtime/tasks/tsk_e8b012d9e001/frontend-design/webpage-evidence/prd-evidence-summary.md` | 确认页面 surface、颜色、字体、组件模式。                       |
| Source IR         | `.opencorvus/runtime/tasks/tsk_e8b012d9e001/frontend-design/webpage-evidence/source-ir/*`             | 确认布局、内容模型、样式 token 和交互 hint。                   |
| Target package    | `packages/tradingview-world-economy`                                                                  | 确认已有实现包、抽取数据和测试基线。                           |
| Extracted data    | `packages/tradingview-world-economy/src/data/economicTrendsExtracted.ts`                              | 确认地图路径、GDP 行、国家入口、指标卡、新闻、日历、FAQ 信号。 |
| Extracted table   | `packages/tradingview-world-economy/src/data/sourceData.ts`                                           | 确认 heatmap 表格和可见文本信号。                              |
| Existing spec     | `specs/records/2026-06/2026-06-03-tradingview-world-economy-extracted-clone.md`                              | 确认项目策略是 extracted-material project，不是手写近似页面。  |
| QA test           | `packages/tradingview-world-economy/qa/extracted-materials.test.ts`                                   | 确认当前抽取材料的可测试基线。                                 |

## 4. 缩写和术语

- PRD: Product Requirements Document，产品需求文档，用来对齐产品目标、范围、模块、数据、交互、验收和风险。
- UI: User Interface，用户界面，指页面可见控件、布局、文案和视觉样式。
- UX: User Experience，用户体验，指用户从进入页面到完成信息获取或跳转的完整体验。
- GDP: Gross Domestic Product，国内生产总值，用于衡量一个国家或地区的经济总产出。
- YoY: Year over Year，同比，表示当前周期相对去年同期的变化。
- QoQ: Quarter over Quarter，环比季度变化，经济日历中常用于 GDP Growth Rate QoQ。
- PMI: Purchasing Managers Index，采购经理人指数，用来衡量制造业或服务业景气度。
- CPI: Consumer Price Index，消费者价格指数，是计算通胀率的常见基础。
- PPI: Producer Price Index，生产者价格指数，用于观察生产端价格变化。
- FAQ: Frequently Asked Questions，常见问题，用来解释基础概念和公式。
- CTA: Call To Action，行动入口，例如 Get started、See all、Keep reading。
- SEO: Search Engine Optimization，搜索引擎优化，指标题、结构化内容、内部链接和可索引 FAQ。
- ARIA: Accessible Rich Internet Applications，无障碍语义属性，用于描述 tabs、accordion、toolbar 等控件状态。
- SVG: Scalable Vector Graphics，可缩放矢量图，本页面的世界地图和图标大量使用这种格式。
- LCP: Largest Contentful Paint，最大内容绘制，用来衡量首屏主要内容加载速度。
- CLS: Cumulative Layout Shift，累积布局偏移，用来衡量布局稳定性。
- INP: Interaction to Next Paint，交互到下一次绘制，用来衡量交互响应速度。
- IR: Intermediate Representation，中间表示，指 frontend_design 抽取出的页面结构、内容、布局、样式和交互证据。
- QA: Quality Assurance，质量保障，覆盖功能测试、视觉测试、数据测试、可访问性测试和性能测试。
- FRED: Federal Reserve Economic Data，美国联邦储备经济数据，页面社区观点中出现的数据源符号前缀。
- BEA: Bureau of Economic Analysis，美国经济分析局，社区观点中提到的 GDP 数据来源。
- CUSIP: Committee on Uniform Securities Identification Procedures，北美证券标识体系，页脚数据版权中出现。
- ETF: Exchange Traded Fund，交易所交易基金，全站导航中的市场品类。
- DEX: Decentralized Exchange，去中心化交易所，全站导航中的加密交易对入口。
- API: Application Programming Interface，应用程序接口，指页面向数据服务读取经济数据、新闻和日历的合约。
- SSR: Server Side Rendering，服务端渲染，用于提高首屏可索引性和加载体验。
- SPA: Single Page Application，单页应用，指页面在前端局部更新内容和交互状态。

## 5. 产品目标

- 让用户在 30 秒内判断全球经济趋势的主要信号。
- 让用户在 1 分钟内找到一个国家的宏观经济入口。
- 让用户在 1 分钟内找到一个经济指标的入口。
- 让用户能通过地图快速理解全球通胀或工业生产的地域差异。
- 让用户能通过 GDP growth YoY 排行发现增长靠前的国家。
- 让用户能通过重点指标卡追踪美国失业率、利率和贸易余额。
- 让用户能从社区观点理解别人如何解读宏观数据。
- 让用户能从新闻和经济日历跟踪短期事件。
- 让初学者能在同一页理解 GDP、真实 GDP、利率、通胀的定义和公式。
- 让页面成为 TradingView 世界经济相关内容的入口，而不是单独的静态说明页。

## 6. 非目标

- 不在本页实现下单、券商连接或交易执行。
- 不在本页实现完整高级图表编辑器。
- 不在本页实现用户自定义国家 watchlist。
- 不在本页实现社区观点发布流程。
- 不在本页实现后台数据供应商管理。
- 不复制 TradingView 私有接口或未授权数据源。
- 不把地图、新闻、日历、观点做成无数据来源的静态假内容。
- 不把核心页面做成营销 hero 或介绍页。

## 7. 用户画像

- 活跃交易者: 每天开盘前扫一眼宏观数据，重点关注利率、失业率、贸易余额和经济日历。
- 宏观研究员: 比较国家之间 GDP、通胀、债务、利率、工业生产等指标，寻找跨市场线索。
- 财经媒体编辑: 快速找新闻和数据点，用于解释市场波动背景。
- 国际投资者: 从全球页面跳到具体国家页面，查看某个国家更详细的经济数据。
- TradingView 社区读者: 浏览社区观点，寻找基于宏观数据的交易想法。
- 初学者: 通过 FAQ 理解 GDP、利率、通胀公式，不需要立刻进入复杂图表。
- SEO 访问者: 从搜索引擎进入，例如搜索 GDP formula、highest GDP country、inflation rate formula。

## 8. 核心用户故事

1. 作为交易者，我想在进入页面后立刻看到通胀地图和 GDP 增长排行，以便判断全球风险偏好。
2. 作为交易者，我想看到美国失业率、利率、贸易余额的 Actual、Forecast、Next release，以便安排交易日历。
3. 作为宏观研究员，我想在 heatmap 中横向比较国家和指标，以便发现异常值。
4. 作为国际投资者，我想点击国家 chip 进入具体国家页面，以便继续查看细分数据。
5. 作为社区读者，我想在 Ideas 区域切换 Popular、Recent、Video，以便筛选观点类型。
6. 作为财经编辑，我想看到新闻来源和标题，以便快速定位相关报道。
7. 作为事件驱动交易者，我想看到 Economic Calendar 的 Actual、Forecast、Prior，以便比较预期差。
8. 作为初学者，我想展开 FAQ 阅读 GDP 和 inflation 的公式，以便理解页面指标。
9. 作为移动端用户，我想所有表格和卡片在小屏上仍然可读，以便不需要桌面浏览。
10. 作为键盘用户，我想能通过键盘访问 tabs、links、FAQ 和 header controls，以便不依赖鼠标。

## 9. 页面信息架构

页面从上到下的结构必须保持如下顺序：

1. Global header: 品牌、导航、搜索、语言、Get started。
2. Breadcrumb: Markets / Economy。
3. Page title: Economy。
4. Tabs: Overview、Economic trends。
5. Economic trends summary: Inflation map、GDP growth、三张重点指标卡。
6. Countries: 国家 chip 和国家数据表。
7. Ideas: 社区观点和分类 tabs。
8. Economic indicators heatmap: 国家 x 指标矩阵。
9. Main indicators: 重要经济指标目录。
10. Global industrial map: 第二张全球热力图。
11. News: 宏观新闻流。
12. Economic Calendar: 当日经济事件卡片。
13. FAQ: 概念解释和公式。
14. Footer: TradingView 全站导航、版权和数据提供商声明。
    设计和研发不得把 FAQ、News 或 Footer 提前到经济趋势核心区之前。
    移动端可以改变布局列数，但不可以改变模块的语义顺序。

## 10. 模块级需求总览

| ID  | 模块                        | 产品目的                                                     |
| --- | --------------------------- | ------------------------------------------------------------ |
| M01 | Global Header               | 提供 TradingView 全站导航、搜索、语言切换和账号转化入口。    |
| M02 | Breadcrumb And Page Title   | 让用户知道当前位置是 Markets 下的 Economy 页面。             |
| M03 | Page Tabs                   | 在 Overview 和 Economic trends 之间提供清晰导航。            |
| M04 | Economic Trends Summary     | 把全球宏观趋势的核心信号集中在页面最前。                     |
| M05 | Inflation Map               | 用全球地图表达各国家或地区通胀水平差异。                     |
| M06 | GDP Growth YoY Ranking      | 展示同比 GDP 增长靠前的国家，并提供国家钻取入口。            |
| M07 | Macro Metric Cards          | 展示美国关键宏观指标的当前值、预测值和下次发布时间。         |
| M08 | Countries                   | 提供主要国家和地区的直接入口。                               |
| M09 | Ideas                       | 展示社区对宏观经济数据的观点，连接数据和交易想法。           |
| M10 | Economic Indicators Heatmap | 用国家 x 指标矩阵支持横向比较。                              |
| M11 | Main Indicators             | 提供常用宏观指标的目录入口。                                 |
| M12 | Global Industrial Map       | 提供全球工业趋势的地图视角。                                 |
| M13 | News                        | 提供与宏观经济相关的即时新闻入口。                           |
| M14 | Economic Calendar           | 展示今日或近期宏观经济事件，支持事件驱动观察。               |
| M15 | FAQ                         | 解释核心经济概念，兼顾新手理解和 SEO。                       |
| M16 | Footer                      | 承载全站导航、产品入口、社区入口、公司信息、政策和数据版权。 |

## 11.01 Global Header

产品目的：提供 TradingView 全站导航、搜索、语言切换和账号转化入口。

### 可见内容

- TradingView 品牌标识
- Products
- Community
- Markets
- Brokers
- More
- 搜索图标或搜索输入
- EN 语言入口
- Get started CTA

### 数据字段

- navItems: 顶部导航项列表
- navMenus: 每个可展开导航的菜单组
- searchPlaceholder: 搜索提示
- locale: 当前语言
- ctaHref: 注册或登录转化入口

### 交互

- 点击品牌回到首页
- 打开 Products 菜单
- 打开 Community 菜单
- 打开 Markets 菜单
- 触发搜索
- 打开语言选择
- 点击 Get started

### 状态

- default: 白底紧凑导航
- hover: 导航项显示可点击反馈
- focus: 键盘焦点清晰可见
- open: 下拉菜单覆盖在内容上方
- mobile: 折叠为菜单或更紧凑布局

### 验收标准

- 桌面高度接近参考页 64px
- 所有导航项是 link 或 disclosure button
- 搜索入口可通过键盘触发
- Get started 不遮挡页面内容
- 移动端不出现文字重叠
- 语言 EN 可见
- header 不随经济内容加载失败而消失

## 11.02 Breadcrumb And Page Title

产品目的：让用户知道当前位置是 Markets 下的 Economy 页面。

### 可见内容

- Markets 链接
- 斜杠分隔符
- Economy 面包屑项
- H1 Economy

### 数据字段

- breadcrumbItems: Markets 和 Economy
- pageTitle: Economy
- canonicalUrl: /markets/world-economy/

### 交互

- 点击 Markets 返回市场总入口
- 点击 Economy 保持当前页面或刷新当前分类

### 状态

- default: 位于 header 下方
- mobile: 保持可读但可压缩间距

### 验收标准

- H1 只能有一个
- 面包屑位于 tabs 之前
- H1 不被 header 遮挡
- 面包屑链接可被搜索引擎识别

## 11.03 Page Tabs

产品目的：在 Overview 和 Economic trends 之间提供清晰导航。

### 可见内容

- Overview tab
- Economic trends tab
- 选中状态

### 数据字段

- tabs: label, href, active
- activeTab: 当前 tab

### 交互

- 点击 Overview
- 点击 Economic trends
- 键盘左右切换或 Tab 访问

### 状态

- active: 当前页签突出
- hover: 可点击反馈
- focus: 可访问焦点
- mobile: 横向滚动或自动换行

### 验收标准

- 两个 tab 的顺序稳定
- active 状态不能只靠颜色表达
- tab 不应变成静态文本
- 切换后 URL 或页面状态可追踪

## 11.04 Economic Trends Summary

产品目的：把全球宏观趋势的核心信号集中在页面最前。

### 可见内容

- Economic trends 标题
- Inflation map 卡片
- GDP growth YoY 卡片
- US unemployment rate 卡片
- US interest rate 卡片
- US trade balance 卡片

### 数据字段

- summaryLayout: desktop grid areas
- mapData: 通胀地图国家桶
- gdpRows: GDP 增长排行
- metricCards: 三个重点指标卡

### 交互

- 地图 hover 或 focus
- GDP 国家点击
- 指标卡 ticker 点击
- 图表缩略图查看或跳转

### 状态

- loading: 骨架但保留尺寸
- loaded: 显示完整数据
- error: 显示数据不可用原因
- stale: 显示数据时间提示

### 验收标准

- 第一屏或首个滚动段必须看到核心经济趋势
- 卡片之间不重叠
- 不能用空白块代替地图或图表
- 失败时不展示无关假数据

## 11.05 Inflation Map

产品目的：用全球地图表达各国家或地区通胀水平差异。

### 可见内容

- Inflation map 标题
- 世界地图
- 0% 图例
- 3% 图例
- 7% 图例
- 12% 图例
- 25% 图例
- 禁用或无数据国家样式

### 数据字段

- countryCode
- countryName
- inflationValue
- legendBucket
- geometryPath
- dataStatus
- sourceTimestamp

### 交互

- hover 国家显示名称和值
- focus 地图摘要
- 点击国家进入国家页，如果源页面支持
- 触屏设备显示可点击摘要或 tooltip

### 状态

- loaded: 地图完整显示
- disabled: 无数据国家低对比显示
- error: 地图数据不可用
- mobile: 地图缩放并保持图例可读

### 验收标准

- 图例值必须是 0、3、7、12、25
- 地图比例接近 745x372
- 颜色使用 tan/orange heatmap 语义
- 视觉上不能像随机插画
- 无障碍摘要说明颜色含义

## 11.06 GDP Growth YoY Ranking

产品目的：展示同比 GDP 增长靠前的国家，并提供国家钻取入口。

### 可见内容

- GDP growth, YoY 标题
- Country 列
- GDP Growth 列
- Nominal GDP 列
- India 7.80% 3.91 T USD
- Indonesia 5.61% 1.40 T USD
- Mainland China 5.00% 18.74 T USD
- South Korea 3.60% 1.92 T USD
- Saudi Arabia 2.80% 1.24 T USD
- USA 2.70% 29.18 T USD

### 数据字段

- rank
- countryName
- countryHref
- countryLogo
- gdpGrowthPercent
- nominalGdpValue
- currency

### 交互

- 点击国家名称进入国家页
- hover 行显示可点击反馈
- 长国家名显示 overflow tooltip

### 状态

- loaded: 显示六行
- loading: 保留列宽
- error: 显示排行不可用
- mobile: 行信息仍按国家、增长、GDP 顺序阅读

### 验收标准

- 六个捕获国家和数值在 fixture 中必须准确
- 数值单位不可丢失
- 国家链接不可为空
- 列标题必须可见
- 移动端不能把数值挤出卡片

## 11.07 Macro Metric Cards

产品目的：展示美国关键宏观指标的当前值、预测值和下次发布时间。

### 可见内容

- US unemployment rate / USUR
- Actual 4.3%
- Forecast 4.3%
- Next release In 2 days
- US interest rate / USINTR
- 10 years
- Actual 3.75%
- Next release Jun 18, 2026
- US trade balance / USBOT
- Actual -60.31 B USD
- Next release Jun 9, 2026

### 数据字段

- title
- ticker
- symbolHref
- timeframe
- chartImages or chartSeries
- actual
- forecast
- nextRelease
- unit

### 交互

- 点击 ticker 进入经济符号页
- hover 图表缩略图
- 键盘访问卡片链接

### 状态

- loaded: 显示 chart 和三组数据
- forecastMissing: 用 dash 表示
- loading: 图表区域保留尺寸
- error: 指标不可用但卡片结构保留

### 验收标准

- USUR、USINTR、USBOT 三张卡都必须存在
- Actual、Forecast、Next release 标签不能省略
- Forecast 缺失必须显式显示 dash
- 图表不允许用纯色占位块冒充

## 11.08 Countries

产品目的：提供主要国家和地区的直接入口。

### 可见内容

- Countries 标题
- Argentina
- Australia
- Brazil
- Canada
- European Union
- France
- Germany
- India
- Indonesia
- Italy
- Japan
- Mainland China
- Mexico
- Russia
- Saudi Arabia
- South Africa
- South Korea
- Turkey
- United Kingdom
- United States
- See all 或完整国家入口

### 数据字段

- countryLabel
- countryHref
- displayOrder
- regionGroup optional

### 交互

- 点击 chip 进入国家页
- hover chip
- focus chip
- 点击 See all 展示完整列表或跳转

### 状态

- loaded: 显示至少 20 个入口
- mobile: chip 换行或横向滚动
- error: 国家入口不可用时显示明确错误

### 验收标准

- 所有捕获国家名称准确
- 国家 chip 是 anchor，不是 span
- chip 间距紧凑但触控可点
- 长名称 European Union 和 United Kingdom 不溢出

## 11.09 Ideas

产品目的：展示社区对宏观经济数据的观点，连接数据和交易想法。

### 可见内容

- Ideas 标题
- Popular tab
- Recent tab
- Video tab
- More tab
- 观点标题
- 观点摘要
- 作者
- 更新时间
- 图表或缩略图
- See all popular ideas

### 数据字段

- ideaId
- title
- href
- summary
- authorName
- authorHref
- updatedAt
- thumbnail
- symbol
- category
- directionLabel

### 交互

- 切换 Popular/Recent/Video
- 打开 More 菜单
- 点击观点卡片
- 点击作者
- 点击 See all

### 状态

- loaded: 显示多张观点卡
- empty: 当前分类无观点
- loading: 卡片骨架
- error: 社区观点不可用

### 验收标准

- 不能用编造观点填充
- tab 必须可交互
- 卡片标题和摘要不能互相覆盖
- 缩略图加载失败时布局不跳动
- Video 分类应有视频语义或入口

## 11.10 Economic Indicators Heatmap

产品目的：用国家 x 指标矩阵支持横向比较。

### 可见内容

- Economic indicators heatmap 标题
- GDP
- GDP Growth
- Budget to GDP
- Government Debt to GDP
- Interest Rate
- Inflation Rate
- Unemployment Rate
- Current Account to GDP
- Industrial Production YoY
- USA
- Mainland China
- EU
- Germany
- Japan
- India
- UK
- France
- Canada
- Russia

### 数据字段

- countryRows
- metricColumns
- formattedValue
- rawValue
- unit
- colorBucket
- href
- sourceTimestamp

### 交互

- 横向滚动
- hover cell 查看完整值
- 点击指标进入指标页
- 点击国家进入国家页

### 状态

- loaded: 表格完整
- overflow: 小屏横向滚动
- loading: 保留表格骨架
- error: 显示热力图不可用

### 验收标准

- 表头和行头必须清晰
- 单位如 % of GDP 不得丢失
- 颜色不能替代数值文本
- 移动端必须可横向浏览
- 表格语义要支持屏幕阅读器

## 11.11 Main Indicators

产品目的：提供常用宏观指标的目录入口。

### 可见内容

- GDP
- GDP Growth
- Real GDP
- GDP Per Capita
- GDP Per Capita PPP
- Inflation Rate
- Interest Rate
- Unemployment Rate
- Government Debt to GDP
- Population
- Average Hourly Earnings
- House Price Index
- Manufacturing Production YoY
- Industrial Production YoY
- Current Account
- Current Account to GDP
- Balance of Trade
- Economic Activity Index
- Crude Oil Production

### 数据字段

- indicatorLabel
- indicatorHref
- category
- displayOrder

### 交互

- 点击指标进入指标页
- hover 或 focus 显示可点击反馈
- See all 展开或跳转

### 状态

- loaded: 指标 chip 或 link 列表
- mobile: 多列变单列或换行
- error: 指标目录不可用

### 验收标准

- 主要指标名称准确
- 指标必须是可点击链接
- 布局不能像随机标签云
- 长指标名不遮挡相邻项

## 11.12 Global Industrial Map

产品目的：提供全球工业趋势的地图视角。

### 可见内容

- Global industrial map 标题
- 世界地图
- 0% 3% 7% 12% 25% 图例
- See more global trends

### 数据字段

- countryCode
- industrialValue
- legendBucket
- geometryPath
- metricName
- sourceTimestamp

### 交互

- hover 或 focus 地图
- 点击国家或 CTA
- 点击 See more global trends

### 状态

- loaded: 地图显示
- loading: 保留地图尺寸
- error: 显示数据不可用
- mobile: 地图和图例可读

### 验收标准

- 不能直接复用通胀数据冒充工业数据
- 地图视觉语言和 Inflation map 保持一致
- CTA 可点击
- 图例不溢出

## 11.13 News

产品目的：提供与宏观经济相关的即时新闻入口。

### 可见内容

- News 标题
- Reuters 来源
- Trading Economics 来源
- Japan govt finalises extra budget headline
- Japan Composite PMI headline
- Keep reading

### 数据字段

- newsId
- headline
- href
- provider
- publishedAt
- thumbnail
- summary

### 交互

- 点击新闻
- 点击来源或 provider
- 点击 Keep reading

### 状态

- loaded: 展示新闻列表
- empty: 无新闻时明确说明
- loading: 新闻骨架
- error: 新闻源不可用

### 验收标准

- 新闻来源必须可见
- 不能用无关通用新闻填充
- 标题优先展示
- Keep reading 指向新闻流
- 移动端标题不溢出

## 11.14 Economic Calendar

产品目的：展示今日或近期宏观经济事件，支持事件驱动观察。

### 可见内容

- Economic Calendar 标题
- Today 标签
- Riyad Bank PMI
- RatingDog Composite PMI
- RatingDog Services PMI
- GDP Chain Price Index QoQ
- GDP Growth Rate QoQ
- GDP Growth Rate YoY
- GDP Final Consumption QoQ
- GDP Capital Expenditure QoQ
- Actual
- Forecast
- Prior
- See all market events

### 数据字段

- eventId
- dateLabel
- time
- country
- eventName
- actual
- forecast
- prior
- unit
- href

### 交互

- 横向浏览事件卡
- 点击事件
- 点击 See all market events

### 状态

- loaded: 显示事件卡
- noActual: Actual 为空时显示 dash
- loading: 保留卡片宽度
- error: 日历不可用

### 验收标准

- Actual/Forecast/Prior 三列语义清楚
- 事件时间不和标题混在一起
- See all market events 可点击
- 小屏可横向滚动或垂直堆叠

## 11.15 FAQ

产品目的：解释核心经济概念，兼顾新手理解和 SEO。

### 可见内容

- What is GDP?
- What is the GDP formula?
- What is GDP per capita?
- What country has the highest GDP?
- What is the real GDP formula?
- What is interest rate?
- How are interest rates calculated?
- What is the interest rate today?
- What is inflation?
- What is the inflation rate formula?
- What is Japan inflation rate YoY today?

### 数据字段

- question
- answerBlocks
- formulaBlocks
- relatedLinks
- displayOrder

### 交互

- 展开 FAQ
- 收起 FAQ
- 点击相关链接
- 键盘切换 accordion

### 状态

- collapsed: 默认可扫描
- expanded: 显示完整回答
- focus: 标题焦点清晰
- mobile: 间距适合触控

### 验收标准

- 问题文本必须可索引
- 公式必须是文本
- accordion 状态有 ARIA 表达
- 答案不能是隐藏给搜索引擎看的伪内容
- FAQ 位于新闻和日历之后

## 11.16 Footer

产品目的：承载全站导航、产品入口、社区入口、公司信息、政策和数据版权。

### 可见内容

- More than a product
- Screeners
- Heatmaps
- Calendars
- More products
- Apps
- Community
- Tools & subscriptions
- Trading
- Special offers
- About company
- Policies & security
- Business solutions
- Growth opportunities
- Terms of Use
- Disclaimer
- Privacy Policy
- Cookies Policy
- Accessibility Statement
- Copyright
- FactSet attribution
- ICE Data Services attribution
- CUSIP attribution

### 数据字段

- footerGroups
- footerLinks
- legalTexts
- socialLinks
- localeLinks

### 交互

- 点击 footer link
- 打开社交链接
- 打开政策链接
- 移动端展开 footer group

### 状态

- desktop: 多列 dense footer
- mobile: 分组折叠或堆叠
- focus: link 焦点清晰
- legal: attribution 始终可见

### 验收标准

- 法务链接不能省略
- 数据供应商声明不能省略
- footer 不应比主体内容更早出现
- 移动端 footer 不应形成超宽横向滚动

## 12. 数据模型

| 模型             | 字段                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| PageMeta         | title、description、canonicalUrl、locale、lastUpdatedAt。                                            |
| NavigationItem   | label、href、menuGroups、isExternal、trackingId。                                                    |
| BreadcrumbItem   | label、href、position。                                                                              |
| TabItem          | label、href、active、panelId。                                                                       |
| MapMetricCountry | countryCode、countryName、value、formattedValue、unit、bucket、geometryAssetPath、href、dataStatus。 |
| GdpGrowthRow     | rank、countryName、countryHref、logoSrc、growthPercent、nominalGdp、currency。                       |
| MetricCard       | title、ticker、href、timeframe、actual、forecast、nextRelease、chartImages、sourceTimestamp。        |
| CountryLink      | label、href、slug、displayOrder。                                                                    |
| IdeaCard         | title、href、summary、thumbnail、authorName、authorHref、category、symbol、updatedAt。               |
| HeatmapTable     | metrics、countries、cells、legend、sourceTimestamp。                                                 |
| HeatmapCell      | countryCode、metricKey、rawValue、formattedValue、unit、bucket、href。                               |
| IndicatorLink    | label、href、category、displayOrder。                                                                |
| NewsItem         | headline、href、provider、publishedAt、summary、thumbnail。                                          |
| CalendarEvent    | dateLabel、timeLabel、country、eventName、actual、forecast、prior、unit、href。                      |
| FaqItem          | question、answerMarkdown、formulaText、relatedLinks、displayOrder。                                  |
| FooterGroup      | title、links、displayOrder。                                                                         |
| LegalAttribution | providerName、text、href、requiredLocales。                                                          |

## 13. 数据格式规则

- 百分比统一保留 %，负数保留 minus 符号。
- GDP 金额使用 T 或 B 缩写时必须保留 currency，例如 USD。
- Budget to GDP、Government Debt to GDP、Current Account to GDP 必须保留 “of GDP”。
- Forecast 不可得时显示 dash，不显示 0。
- Next release 使用源数据给出的自然语言，例如 In 2 days 或 Jun 18, 2026。
- 国家名称使用页面可见命名，例如 Mainland China、USA、EU。
- ticker 使用 ECONOMICS 符号时不得本地化。
- 公式中的 C、G、I、X、M、CPI 等变量必须保持可读文本。
- 中文或其他语言版本可翻译说明文字，但不应翻译 ticker、单位缩写和公式变量。

## 14. 数据刷新和失败处理

- 生产实现必须定义宏观数据刷新周期。
- 如果数据源返回部分国家缺失，地图应显示 disabled 或 no data 样式。
- 如果 GDP ranking 数据不可用，应显示该卡片错误状态，而不是隐藏整个 Economic trends 区域。
- 如果新闻源不可用，应显示新闻源错误，不应用 FAQ 或静态营销内容填充。
- 如果社区观点不可用，应显示社区内容不可用，不生成假观点。
- 如果日历源不可用，应显示日历不可用，并保留 See all market events 的可用跳转前提。
- 所有失败状态应保留布局尺寸，避免页面大幅跳动。
- stale 数据必须展示更新时间或 stale 标识。

## 15. 视觉设计要求

- 整体应保持 TradingView 风格：白底、深色文本、浅灰分隔、蓝色链接、紧凑卡片。
- 主体页面不能使用装饰性渐变背景。
- 不能使用大面积营销插画替代数据卡片。
- 标题层级应清楚：H1 Economy，H2 为各区域标题，卡片标题小于区域标题。
- 正文系统字体接近 `-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif`。
- 主要文本色接近 rgb(15, 15, 15)。
- 次级文本色接近 rgb(112, 112, 112)。
- 链接色使用 TradingView 蓝色方向，不随意改成紫色或品牌外颜色。
- heatmap 使用 tan/orange scale，不换成无意义彩虹色。
- 卡片 radius 保持克制，不做大圆角营销卡。
- 表格、列表和卡片必须保持高密度但可读。
- 地图和图表必须有稳定 aspect ratio，避免资源加载后挤压文本。

## 16. 响应式要求

| 视口     | 验收重点                                  |
| -------- | ----------------------------------------- |
| 1440x900 | 桌面参考视口，必须用于主视觉对比。        |
| 1280x800 | 常规笔记本，经济趋势网格应保持多列。      |
| 1024x768 | 平板横屏，可减少列数但保留卡片顺序。      |
| 768x1024 | 平板竖屏，heatmap 可横向滚动。            |
| 430x932  | 移动大屏，卡片单列或两列混排，但不重叠。  |
| 390x844  | 移动常见宽度，国家 chip 和 FAQ 必须可读。 |
| 360x740  | 窄屏，header、tabs、地图图例必须不溢出。  |

- 移动端 header 可以折叠，但搜索、语言和账号入口仍应可达。
- tabs 可横向滚动，但 active 状态不能消失。
- 地图图例在窄屏上可以换行，但不能盖住地图。
- GDP ranking 在窄屏上可以变成 stacked row，但国家、增长、GDP 三项都要保留。
- heatmap 必须支持横向滚动，不得把列压到不可读。
- footer 在移动端可以按 group 折叠，但政策和版权必须可达。

## 17. 无障碍要求

- 页面必须有 header、main、footer landmark。
- H1 到 H2 到 H3 的 heading 顺序必须自然。
- 所有链接必须有可理解的 accessible name。
- tabs 必须表达 active/selected 状态。
- FAQ accordion 必须表达 expanded/collapsed 状态。
- 地图至少要有整体 accessible summary，说明颜色表示什么。
- heatmap 单元格必须有文本数值，不能只靠颜色。
- 键盘焦点必须清晰可见。
- 图表缩略图如果只是装饰，应为空 alt；如果传递信息，应有说明。
- 颜色对比必须覆盖深色文本、灰色说明、蓝色链接和橙色 heatmap label。

## 18. SEO 要求

- title 包含 World Economy 和 TradingView 语义。
- H1 为 Economy。
- FAQ 问题和答案是可索引文本。
- 国家 chip 是真实 anchor。
- 指标目录是真实 anchor。
- 面包屑可被搜索引擎理解。
- canonical 指向 `/markets/world-economy/`。
- 如果支持多语言，需要 hreflang。
- 页面说明应覆盖 world economy、economic indicators、GDP、inflation、interest rate 等关键词。
- 不要把核心内容全部放进 canvas 或不可索引图片。

## 19. 性能要求

- 首屏必须尽快显示 header、面包屑、H1、tabs 和 Economic trends 的框架。
- 地图 SVG 路径多，渲染应避免无关交互触发整图重绘。
- chart thumbnails 应设置 width/height 或 aspect-ratio。
- below-the-fold 的 News、Calendar、FAQ、Footer 可以延迟加载，但不能造成 CLS。
- production build 下评估 LCP、CLS、INP。
- 大型 CSS sidecar 若暂时保留，必须承认它是 visual parity 成本，并在后续有证据地瘦身。
- heatmap 表格不要一次绑定昂贵 hover listeners 到每个 cell，除非性能验证通过。
- 移动端横向滚动区域不能触发页面整体横向滚动。

## 20. 法务和版权要求

- 保留 TradingView copyright。
- 保留 ICE Data Services 声明，如果页面使用相关市场数据。
- 保留 FactSet reference data 声明，如果页面使用相关参考数据。
- 保留 American Bankers Association 和 CUSIP Database 声明，如果页面使用相关证券标识数据。
- 保留 Terms of Use、Disclaimer、Privacy Policy、Cookies Policy、Accessibility Statement。
- PRD 不授权复制 TradingView 私有 API。
- 生产前必须确认所有第三方数据展示方式和版权文案。

## 21. 埋点要求

- page_view: world_economy。
- header_nav_click: label、href。
- search_open: source=header。
- locale_open: currentLocale。
- get_started_click: source=world_economy_header。
- tab_click: tabName。
- inflation_map_hover: countryCode、bucket，前提是隐私允许且事件量受控。
- gdp_row_click: countryName、rank。
- metric_card_click: ticker。
- country_chip_click: countryName。
- ideas_tab_click: tabName。
- idea_card_click: ideaId、category。
- heatmap_cell_click: countryCode、metricKey。
- indicator_link_click: indicatorLabel。
- industrial_map_cta_click。
- news_item_click: provider、newsId。
- calendar_event_click: eventId。
- faq_expand: questionId。
- footer_link_click: group、label。

## 22. 测试计划

### 单元测试

- 验证 inflationMapPaths fixture 数量为 205，除非源证据更新。
- 验证 GDP rows 包含 India、Indonesia、Mainland China、South Korea、Saudi Arabia、USA。
- 验证 metric tickers 为 USUR、USINTR、USBOT。
- 验证 country links 至少包含 20 个捕获国家入口。
- 验证 heatmap 包含捕获的 metric headers。
- 验证 FAQ 包含捕获的问题列表。
- 验证 footer 包含政策链接和版权声明。

### 集成测试

- 渲染 TradingViewWorldEconomyPage 不报错。
- header links 有 href 或 disclosure 行为。
- tabs 可点击或可导航。
- country chips 是真实 anchors。
- metric cards ticker links 是真实 anchors。
- FAQ 可以展开和收起。
- heatmap 在窄容器内提供横向滚动。

### 视觉测试

- 1440x900 对比 reference.png。
- 390x844 检查无重叠、无横向页面滚动。
- 地图区域检查图例和路径颜色。
- GDP card 检查列对齐。
- metric cards 检查 chart thumbnail 是否渲染。
- footer 检查多列或移动折叠。

### 人工复核

- 产品复核：模块顺序是否符合页面价值。
- 设计复核：页面是否仍是市场工具感，而不是营销页。
- 研发复核：数据模型是否足够实现。
- QA 复核：验收标准是否可测。
- 法务复核：版权和数据声明是否保留。

## 23. 验收标准

- PRD 可被产品、设计、研发、QA 按章节阅读。
- PRD 覆盖目标页面所有主要模块。
- PRD 明确哪些是可见内容，哪些是数据字段，哪些是交互。
- PRD 明确失败状态，不允许假数据顶替。
- PRD 明确移动端、无障碍、SEO、性能、法务要求。
- PRD 提供测试计划。
- PRD 行数超过 1000 行，但不靠无意义重复满足行数。
- 实现 PRD 时，必须使用现有抽取素材和成熟组件，不从零手搓复杂 UI。

## 24. 里程碑

| 阶段        | 交付物                          | 验收                                                                           |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------ |
| M1 PRD      | 本文档                          | 产品、设计、研发、QA 可读；行数超过 1000；模块完整。                           |
| M2 数据模型 | typed data contracts            | 覆盖 map、ranking、metric cards、heatmap、ideas、news、calendar、FAQ、footer。 |
| M3 页面骨架 | Header 到 Footer 完整结构       | 无 placeholder；模块顺序正确。                                                 |
| M4 数据渲染 | 所有核心数据区域渲染            | fixture 测试通过。                                                             |
| M5 交互     | tabs、FAQ、links、scroll tables | 键盘和鼠标可用。                                                               |
| M6 响应式   | desktop/tablet/mobile           | 无重叠、无页面级横向滚动。                                                     |
| M7 视觉验收 | reference screenshot parity     | 主要区域比例、密度、颜色、字体接近目标。                                       |
| M8 发布准备 | tests、legal、SEO、analytics    | 所有 release checklist 通过。                                                  |

## 25. 风险和待确认问题

- 实时数据刷新频率需要数据服务确认。
- Ideas、News、Calendar 是动态 feed，fixture 只能代表捕获时状态。
- 地图每个国家的真实 bucket 需要权威数据源。
- TradingView footer 链接可能随时间变化，发布前要重新抽样。
- 法务 attribution 文案必须以授权数据源为准。
- 如果后续要求 95% 以上视觉相似，可能需要保留更多 extracted CSS 和资产。
- 如果后续要求独立产品而非 TradingView replica，需要重写品牌、法务和导航范围。

## 26. 页面内容清单

### GDP Growth Rows

- India: GDP Growth 7.80%; Nominal GDP 3.91 T USD.
- Indonesia: GDP Growth 5.61%; Nominal GDP 1.40 T USD.
- Mainland China: GDP Growth 5.00%; Nominal GDP 18.74 T USD.
- South Korea: GDP Growth 3.60%; Nominal GDP 1.92 T USD.
- Saudi Arabia: GDP Growth 2.80%; Nominal GDP 1.24 T USD.
- USA: GDP Growth 2.70%; Nominal GDP 29.18 T USD.

### Countries

- Argentina
- Australia
- Brazil
- Canada
- European Union
- France
- Germany
- India
- Indonesia
- Italy
- Japan
- Mainland China
- Mexico
- Russia
- Saudi Arabia
- South Africa
- South Korea
- Turkey
- United Kingdom
- United States

### Economic Indicator Headers

- GDP
- GDP Growth
- Budget to GDP
- Government Debt to GDP
- Interest Rate
- Inflation Rate
- Unemployment Rate
- Current Account to GDP
- Industrial Production YoY

### Heatmap Country Rows

- USA
- Mainland China
- EU
- Germany
- Japan
- India
- UK
- France
- Canada
- Russia

### Main Indicators

- GDP
- GDP Growth
- Real GDP
- GDP Per Capita
- GDP Per Capita PPP
- Inflation Rate
- Interest Rate
- Unemployment Rate
- Government Debt to GDP
- Population
- Average Hourly Earnings
- House Price Index
- Manufacturing Production YoY
- Industrial Production YoY
- Current Account
- Current Account to GDP
- Balance of Trade
- Economic Activity Index
- Crude Oil Production

### Economic Calendar Visible Events

- Riyad Bank PMI
- RatingDog Composite PMI
- RatingDog Services PMI
- GDP Chain Price Index QoQ
- GDP Growth Rate QoQ
- GDP Growth Rate YoY
- GDP Final Consumption QoQ
- GDP Capital Expenditure QoQ

### FAQ Questions

- What is GDP?
- What is the GDP formula?
- What is GDP per capita?
- What country has the highest GDP?
- What is the real GDP formula?
- What is interest rate?
- How are interest rates calculated?
- What is the interest rate today?
- What is inflation?
- What is the inflation rate formula?
- What is Japan inflation rate YoY today?

## 27. 详细验收矩阵

### M01 Global Header

- M01-AC-01: 桌面高度接近参考页 64px
- M01-AC-02: 所有导航项是 link 或 disclosure button
- M01-AC-03: 搜索入口可通过键盘触发
- M01-AC-04: Get started 不遮挡页面内容
- M01-AC-05: 移动端不出现文字重叠
- M01-AC-06: 语言 EN 可见
- M01-AC-07: header 不随经济内容加载失败而消失
- M01-CONTENT-01: 必须覆盖可见内容「TradingView 品牌标识」。
- M01-CONTENT-02: 必须覆盖可见内容「Products」。
- M01-CONTENT-03: 必须覆盖可见内容「Community」。
- M01-CONTENT-04: 必须覆盖可见内容「Markets」。
- M01-CONTENT-05: 必须覆盖可见内容「Brokers」。
- M01-CONTENT-06: 必须覆盖可见内容「More」。
- M01-CONTENT-07: 必须覆盖可见内容「搜索图标或搜索输入」。
- M01-CONTENT-08: 必须覆盖可见内容「EN 语言入口」。
- M01-CONTENT-09: 必须覆盖可见内容「Get started CTA」。
- M01-INTERACTION-01: 必须支持「点击品牌回到首页」。
- M01-INTERACTION-02: 必须支持「打开 Products 菜单」。
- M01-INTERACTION-03: 必须支持「打开 Community 菜单」。
- M01-INTERACTION-04: 必须支持「打开 Markets 菜单」。
- M01-INTERACTION-05: 必须支持「触发搜索」。
- M01-INTERACTION-06: 必须支持「打开语言选择」。
- M01-INTERACTION-07: 必须支持「点击 Get started」。

### M02 Breadcrumb And Page Title

- M02-AC-01: H1 只能有一个
- M02-AC-02: 面包屑位于 tabs 之前
- M02-AC-03: H1 不被 header 遮挡
- M02-AC-04: 面包屑链接可被搜索引擎识别
- M02-CONTENT-01: 必须覆盖可见内容「Markets 链接」。
- M02-CONTENT-02: 必须覆盖可见内容「斜杠分隔符」。
- M02-CONTENT-03: 必须覆盖可见内容「Economy 面包屑项」。
- M02-CONTENT-04: 必须覆盖可见内容「H1 Economy」。
- M02-INTERACTION-01: 必须支持「点击 Markets 返回市场总入口」。
- M02-INTERACTION-02: 必须支持「点击 Economy 保持当前页面或刷新当前分类」。

### M03 Page Tabs

- M03-AC-01: 两个 tab 的顺序稳定
- M03-AC-02: active 状态不能只靠颜色表达
- M03-AC-03: tab 不应变成静态文本
- M03-AC-04: 切换后 URL 或页面状态可追踪
- M03-CONTENT-01: 必须覆盖可见内容「Overview tab」。
- M03-CONTENT-02: 必须覆盖可见内容「Economic trends tab」。
- M03-CONTENT-03: 必须覆盖可见内容「选中状态」。
- M03-INTERACTION-01: 必须支持「点击 Overview」。
- M03-INTERACTION-02: 必须支持「点击 Economic trends」。
- M03-INTERACTION-03: 必须支持「键盘左右切换或 Tab 访问」。

### M04 Economic Trends Summary

- M04-AC-01: 第一屏或首个滚动段必须看到核心经济趋势
- M04-AC-02: 卡片之间不重叠
- M04-AC-03: 不能用空白块代替地图或图表
- M04-AC-04: 失败时不展示无关假数据
- M04-CONTENT-01: 必须覆盖可见内容「Economic trends 标题」。
- M04-CONTENT-02: 必须覆盖可见内容「Inflation map 卡片」。
- M04-CONTENT-03: 必须覆盖可见内容「GDP growth YoY 卡片」。
- M04-CONTENT-04: 必须覆盖可见内容「US unemployment rate 卡片」。
- M04-CONTENT-05: 必须覆盖可见内容「US interest rate 卡片」。
- M04-CONTENT-06: 必须覆盖可见内容「US trade balance 卡片」。
- M04-INTERACTION-01: 必须支持「地图 hover 或 focus」。
- M04-INTERACTION-02: 必须支持「GDP 国家点击」。
- M04-INTERACTION-03: 必须支持「指标卡 ticker 点击」。
- M04-INTERACTION-04: 必须支持「图表缩略图查看或跳转」。

### M05 Inflation Map

- M05-AC-01: 图例值必须是 0、3、7、12、25
- M05-AC-02: 地图比例接近 745x372
- M05-AC-03: 颜色使用 tan/orange heatmap 语义
- M05-AC-04: 视觉上不能像随机插画
- M05-AC-05: 无障碍摘要说明颜色含义
- M05-CONTENT-01: 必须覆盖可见内容「Inflation map 标题」。
- M05-CONTENT-02: 必须覆盖可见内容「世界地图」。
- M05-CONTENT-03: 必须覆盖可见内容「0% 图例」。
- M05-CONTENT-04: 必须覆盖可见内容「3% 图例」。
- M05-CONTENT-05: 必须覆盖可见内容「7% 图例」。
- M05-CONTENT-06: 必须覆盖可见内容「12% 图例」。
- M05-CONTENT-07: 必须覆盖可见内容「25% 图例」。
- M05-CONTENT-08: 必须覆盖可见内容「禁用或无数据国家样式」。
- M05-INTERACTION-01: 必须支持「hover 国家显示名称和值」。
- M05-INTERACTION-02: 必须支持「focus 地图摘要」。
- M05-INTERACTION-03: 必须支持「点击国家进入国家页，如果源页面支持」。
- M05-INTERACTION-04: 必须支持「触屏设备显示可点击摘要或 tooltip」。

### M06 GDP Growth YoY Ranking

- M06-AC-01: 六个捕获国家和数值在 fixture 中必须准确
- M06-AC-02: 数值单位不可丢失
- M06-AC-03: 国家链接不可为空
- M06-AC-04: 列标题必须可见
- M06-AC-05: 移动端不能把数值挤出卡片
- M06-CONTENT-01: 必须覆盖可见内容「GDP growth, YoY 标题」。
- M06-CONTENT-02: 必须覆盖可见内容「Country 列」。
- M06-CONTENT-03: 必须覆盖可见内容「GDP Growth 列」。
- M06-CONTENT-04: 必须覆盖可见内容「Nominal GDP 列」。
- M06-CONTENT-05: 必须覆盖可见内容「India 7.80% 3.91 T USD」。
- M06-CONTENT-06: 必须覆盖可见内容「Indonesia 5.61% 1.40 T USD」。
- M06-CONTENT-07: 必须覆盖可见内容「Mainland China 5.00% 18.74 T USD」。
- M06-CONTENT-08: 必须覆盖可见内容「South Korea 3.60% 1.92 T USD」。
- M06-CONTENT-09: 必须覆盖可见内容「Saudi Arabia 2.80% 1.24 T USD」。
- M06-CONTENT-10: 必须覆盖可见内容「USA 2.70% 29.18 T USD」。
- M06-INTERACTION-01: 必须支持「点击国家名称进入国家页」。
- M06-INTERACTION-02: 必须支持「hover 行显示可点击反馈」。
- M06-INTERACTION-03: 必须支持「长国家名显示 overflow tooltip」。

### M07 Macro Metric Cards

- M07-AC-01: USUR、USINTR、USBOT 三张卡都必须存在
- M07-AC-02: Actual、Forecast、Next release 标签不能省略
- M07-AC-03: Forecast 缺失必须显式显示 dash
- M07-AC-04: 图表不允许用纯色占位块冒充
- M07-CONTENT-01: 必须覆盖可见内容「US unemployment rate / USUR」。
- M07-CONTENT-02: 必须覆盖可见内容「Actual 4.3%」。
- M07-CONTENT-03: 必须覆盖可见内容「Forecast 4.3%」。
- M07-CONTENT-04: 必须覆盖可见内容「Next release In 2 days」。
- M07-CONTENT-05: 必须覆盖可见内容「US interest rate / USINTR」。
- M07-CONTENT-06: 必须覆盖可见内容「10 years」。
- M07-CONTENT-07: 必须覆盖可见内容「Actual 3.75%」。
- M07-CONTENT-08: 必须覆盖可见内容「Next release Jun 18, 2026」。
- M07-CONTENT-09: 必须覆盖可见内容「US trade balance / USBOT」。
- M07-CONTENT-10: 必须覆盖可见内容「Actual -60.31 B USD」。
- M07-CONTENT-11: 必须覆盖可见内容「Next release Jun 9, 2026」。
- M07-INTERACTION-01: 必须支持「点击 ticker 进入经济符号页」。
- M07-INTERACTION-02: 必须支持「hover 图表缩略图」。
- M07-INTERACTION-03: 必须支持「键盘访问卡片链接」。

### M08 Countries

- M08-AC-01: 所有捕获国家名称准确
- M08-AC-02: 国家 chip 是 anchor，不是 span
- M08-AC-03: chip 间距紧凑但触控可点
- M08-AC-04: 长名称 European Union 和 United Kingdom 不溢出
- M08-CONTENT-01: 必须覆盖可见内容「Countries 标题」。
- M08-CONTENT-02: 必须覆盖可见内容「Argentina」。
- M08-CONTENT-03: 必须覆盖可见内容「Australia」。
- M08-CONTENT-04: 必须覆盖可见内容「Brazil」。
- M08-CONTENT-05: 必须覆盖可见内容「Canada」。
- M08-CONTENT-06: 必须覆盖可见内容「European Union」。
- M08-CONTENT-07: 必须覆盖可见内容「France」。
- M08-CONTENT-08: 必须覆盖可见内容「Germany」。
- M08-CONTENT-09: 必须覆盖可见内容「India」。
- M08-CONTENT-10: 必须覆盖可见内容「Indonesia」。
- M08-CONTENT-11: 必须覆盖可见内容「Italy」。
- M08-CONTENT-12: 必须覆盖可见内容「Japan」。
- M08-CONTENT-13: 必须覆盖可见内容「Mainland China」。
- M08-CONTENT-14: 必须覆盖可见内容「Mexico」。
- M08-CONTENT-15: 必须覆盖可见内容「Russia」。
- M08-CONTENT-16: 必须覆盖可见内容「Saudi Arabia」。
- M08-CONTENT-17: 必须覆盖可见内容「South Africa」。
- M08-CONTENT-18: 必须覆盖可见内容「South Korea」。
- M08-CONTENT-19: 必须覆盖可见内容「Turkey」。
- M08-CONTENT-20: 必须覆盖可见内容「United Kingdom」。
- M08-CONTENT-21: 必须覆盖可见内容「United States」。
- M08-CONTENT-22: 必须覆盖可见内容「See all 或完整国家入口」。
- M08-INTERACTION-01: 必须支持「点击 chip 进入国家页」。
- M08-INTERACTION-02: 必须支持「hover chip」。
- M08-INTERACTION-03: 必须支持「focus chip」。
- M08-INTERACTION-04: 必须支持「点击 See all 展示完整列表或跳转」。

### M09 Ideas

- M09-AC-01: 不能用编造观点填充
- M09-AC-02: tab 必须可交互
- M09-AC-03: 卡片标题和摘要不能互相覆盖
- M09-AC-04: 缩略图加载失败时布局不跳动
- M09-AC-05: Video 分类应有视频语义或入口
- M09-CONTENT-01: 必须覆盖可见内容「Ideas 标题」。
- M09-CONTENT-02: 必须覆盖可见内容「Popular tab」。
- M09-CONTENT-03: 必须覆盖可见内容「Recent tab」。
- M09-CONTENT-04: 必须覆盖可见内容「Video tab」。
- M09-CONTENT-05: 必须覆盖可见内容「More tab」。
- M09-CONTENT-06: 必须覆盖可见内容「观点标题」。
- M09-CONTENT-07: 必须覆盖可见内容「观点摘要」。
- M09-CONTENT-08: 必须覆盖可见内容「作者」。
- M09-CONTENT-09: 必须覆盖可见内容「更新时间」。
- M09-CONTENT-10: 必须覆盖可见内容「图表或缩略图」。
- M09-CONTENT-11: 必须覆盖可见内容「See all popular ideas」。
- M09-INTERACTION-01: 必须支持「切换 Popular/Recent/Video」。
- M09-INTERACTION-02: 必须支持「打开 More 菜单」。
- M09-INTERACTION-03: 必须支持「点击观点卡片」。
- M09-INTERACTION-04: 必须支持「点击作者」。
- M09-INTERACTION-05: 必须支持「点击 See all」。

### M10 Economic Indicators Heatmap

- M10-AC-01: 表头和行头必须清晰
- M10-AC-02: 单位如 % of GDP 不得丢失
- M10-AC-03: 颜色不能替代数值文本
- M10-AC-04: 移动端必须可横向浏览
- M10-AC-05: 表格语义要支持屏幕阅读器
- M10-CONTENT-01: 必须覆盖可见内容「Economic indicators heatmap 标题」。
- M10-CONTENT-02: 必须覆盖可见内容「GDP」。
- M10-CONTENT-03: 必须覆盖可见内容「GDP Growth」。
- M10-CONTENT-04: 必须覆盖可见内容「Budget to GDP」。
- M10-CONTENT-05: 必须覆盖可见内容「Government Debt to GDP」。
- M10-CONTENT-06: 必须覆盖可见内容「Interest Rate」。
- M10-CONTENT-07: 必须覆盖可见内容「Inflation Rate」。
- M10-CONTENT-08: 必须覆盖可见内容「Unemployment Rate」。
- M10-CONTENT-09: 必须覆盖可见内容「Current Account to GDP」。
- M10-CONTENT-10: 必须覆盖可见内容「Industrial Production YoY」。
- M10-CONTENT-11: 必须覆盖可见内容「USA」。
- M10-CONTENT-12: 必须覆盖可见内容「Mainland China」。
- M10-CONTENT-13: 必须覆盖可见内容「EU」。
- M10-CONTENT-14: 必须覆盖可见内容「Germany」。
- M10-CONTENT-15: 必须覆盖可见内容「Japan」。
- M10-CONTENT-16: 必须覆盖可见内容「India」。
- M10-CONTENT-17: 必须覆盖可见内容「UK」。
- M10-CONTENT-18: 必须覆盖可见内容「France」。
- M10-CONTENT-19: 必须覆盖可见内容「Canada」。
- M10-CONTENT-20: 必须覆盖可见内容「Russia」。
- M10-INTERACTION-01: 必须支持「横向滚动」。
- M10-INTERACTION-02: 必须支持「hover cell 查看完整值」。
- M10-INTERACTION-03: 必须支持「点击指标进入指标页」。
- M10-INTERACTION-04: 必须支持「点击国家进入国家页」。

### M11 Main Indicators

- M11-AC-01: 主要指标名称准确
- M11-AC-02: 指标必须是可点击链接
- M11-AC-03: 布局不能像随机标签云
- M11-AC-04: 长指标名不遮挡相邻项
- M11-CONTENT-01: 必须覆盖可见内容「GDP」。
- M11-CONTENT-02: 必须覆盖可见内容「GDP Growth」。
- M11-CONTENT-03: 必须覆盖可见内容「Real GDP」。
- M11-CONTENT-04: 必须覆盖可见内容「GDP Per Capita」。
- M11-CONTENT-05: 必须覆盖可见内容「GDP Per Capita PPP」。
- M11-CONTENT-06: 必须覆盖可见内容「Inflation Rate」。
- M11-CONTENT-07: 必须覆盖可见内容「Interest Rate」。
- M11-CONTENT-08: 必须覆盖可见内容「Unemployment Rate」。
- M11-CONTENT-09: 必须覆盖可见内容「Government Debt to GDP」。
- M11-CONTENT-10: 必须覆盖可见内容「Population」。
- M11-CONTENT-11: 必须覆盖可见内容「Average Hourly Earnings」。
- M11-CONTENT-12: 必须覆盖可见内容「House Price Index」。
- M11-CONTENT-13: 必须覆盖可见内容「Manufacturing Production YoY」。
- M11-CONTENT-14: 必须覆盖可见内容「Industrial Production YoY」。
- M11-CONTENT-15: 必须覆盖可见内容「Current Account」。
- M11-CONTENT-16: 必须覆盖可见内容「Current Account to GDP」。
- M11-CONTENT-17: 必须覆盖可见内容「Balance of Trade」。
- M11-CONTENT-18: 必须覆盖可见内容「Economic Activity Index」。
- M11-CONTENT-19: 必须覆盖可见内容「Crude Oil Production」。
- M11-INTERACTION-01: 必须支持「点击指标进入指标页」。
- M11-INTERACTION-02: 必须支持「hover 或 focus 显示可点击反馈」。
- M11-INTERACTION-03: 必须支持「See all 展开或跳转」。

### M12 Global Industrial Map

- M12-AC-01: 不能直接复用通胀数据冒充工业数据
- M12-AC-02: 地图视觉语言和 Inflation map 保持一致
- M12-AC-03: CTA 可点击
- M12-AC-04: 图例不溢出
- M12-CONTENT-01: 必须覆盖可见内容「Global industrial map 标题」。
- M12-CONTENT-02: 必须覆盖可见内容「世界地图」。
- M12-CONTENT-03: 必须覆盖可见内容「0% 3% 7% 12% 25% 图例」。
- M12-CONTENT-04: 必须覆盖可见内容「See more global trends」。
- M12-INTERACTION-01: 必须支持「hover 或 focus 地图」。
- M12-INTERACTION-02: 必须支持「点击国家或 CTA」。
- M12-INTERACTION-03: 必须支持「点击 See more global trends」。

### M13 News

- M13-AC-01: 新闻来源必须可见
- M13-AC-02: 不能用无关通用新闻填充
- M13-AC-03: 标题优先展示
- M13-AC-04: Keep reading 指向新闻流
- M13-AC-05: 移动端标题不溢出
- M13-CONTENT-01: 必须覆盖可见内容「News 标题」。
- M13-CONTENT-02: 必须覆盖可见内容「Reuters 来源」。
- M13-CONTENT-03: 必须覆盖可见内容「Trading Economics 来源」。
- M13-CONTENT-04: 必须覆盖可见内容「Japan govt finalises extra budget headline」。
- M13-CONTENT-05: 必须覆盖可见内容「Japan Composite PMI headline」。
- M13-CONTENT-06: 必须覆盖可见内容「Keep reading」。
- M13-INTERACTION-01: 必须支持「点击新闻」。
- M13-INTERACTION-02: 必须支持「点击来源或 provider」。
- M13-INTERACTION-03: 必须支持「点击 Keep reading」。

### M14 Economic Calendar

- M14-AC-01: Actual/Forecast/Prior 三列语义清楚
- M14-AC-02: 事件时间不和标题混在一起
- M14-AC-03: See all market events 可点击
- M14-AC-04: 小屏可横向滚动或垂直堆叠
- M14-CONTENT-01: 必须覆盖可见内容「Economic Calendar 标题」。
- M14-CONTENT-02: 必须覆盖可见内容「Today 标签」。
- M14-CONTENT-03: 必须覆盖可见内容「Riyad Bank PMI」。
- M14-CONTENT-04: 必须覆盖可见内容「RatingDog Composite PMI」。
- M14-CONTENT-05: 必须覆盖可见内容「RatingDog Services PMI」。
- M14-CONTENT-06: 必须覆盖可见内容「GDP Chain Price Index QoQ」。
- M14-CONTENT-07: 必须覆盖可见内容「GDP Growth Rate QoQ」。
- M14-CONTENT-08: 必须覆盖可见内容「GDP Growth Rate YoY」。
- M14-CONTENT-09: 必须覆盖可见内容「GDP Final Consumption QoQ」。
- M14-CONTENT-10: 必须覆盖可见内容「GDP Capital Expenditure QoQ」。
- M14-CONTENT-11: 必须覆盖可见内容「Actual」。
- M14-CONTENT-12: 必须覆盖可见内容「Forecast」。
- M14-CONTENT-13: 必须覆盖可见内容「Prior」。
- M14-CONTENT-14: 必须覆盖可见内容「See all market events」。
- M14-INTERACTION-01: 必须支持「横向浏览事件卡」。
- M14-INTERACTION-02: 必须支持「点击事件」。
- M14-INTERACTION-03: 必须支持「点击 See all market events」。

### M15 FAQ

- M15-AC-01: 问题文本必须可索引
- M15-AC-02: 公式必须是文本
- M15-AC-03: accordion 状态有 ARIA 表达
- M15-AC-04: 答案不能是隐藏给搜索引擎看的伪内容
- M15-AC-05: FAQ 位于新闻和日历之后
- M15-CONTENT-01: 必须覆盖可见内容「What is GDP?」。
- M15-CONTENT-02: 必须覆盖可见内容「What is the GDP formula?」。
- M15-CONTENT-03: 必须覆盖可见内容「What is GDP per capita?」。
- M15-CONTENT-04: 必须覆盖可见内容「What country has the highest GDP?」。
- M15-CONTENT-05: 必须覆盖可见内容「What is the real GDP formula?」。
- M15-CONTENT-06: 必须覆盖可见内容「What is interest rate?」。
- M15-CONTENT-07: 必须覆盖可见内容「How are interest rates calculated?」。
- M15-CONTENT-08: 必须覆盖可见内容「What is the interest rate today?」。
- M15-CONTENT-09: 必须覆盖可见内容「What is inflation?」。
- M15-CONTENT-10: 必须覆盖可见内容「What is the inflation rate formula?」。
- M15-CONTENT-11: 必须覆盖可见内容「What is Japan inflation rate YoY today?」。
- M15-INTERACTION-01: 必须支持「展开 FAQ」。
- M15-INTERACTION-02: 必须支持「收起 FAQ」。
- M15-INTERACTION-03: 必须支持「点击相关链接」。
- M15-INTERACTION-04: 必须支持「键盘切换 accordion」。

### M16 Footer

- M16-AC-01: 法务链接不能省略
- M16-AC-02: 数据供应商声明不能省略
- M16-AC-03: footer 不应比主体内容更早出现
- M16-AC-04: 移动端 footer 不应形成超宽横向滚动
- M16-CONTENT-01: 必须覆盖可见内容「More than a product」。
- M16-CONTENT-02: 必须覆盖可见内容「Screeners」。
- M16-CONTENT-03: 必须覆盖可见内容「Heatmaps」。
- M16-CONTENT-04: 必须覆盖可见内容「Calendars」。
- M16-CONTENT-05: 必须覆盖可见内容「More products」。
- M16-CONTENT-06: 必须覆盖可见内容「Apps」。
- M16-CONTENT-07: 必须覆盖可见内容「Community」。
- M16-CONTENT-08: 必须覆盖可见内容「Tools & subscriptions」。
- M16-CONTENT-09: 必须覆盖可见内容「Trading」。
- M16-CONTENT-10: 必须覆盖可见内容「Special offers」。
- M16-CONTENT-11: 必须覆盖可见内容「About company」。
- M16-CONTENT-12: 必须覆盖可见内容「Policies & security」。
- M16-CONTENT-13: 必须覆盖可见内容「Business solutions」。
- M16-CONTENT-14: 必须覆盖可见内容「Growth opportunities」。
- M16-CONTENT-15: 必须覆盖可见内容「Terms of Use」。
- M16-CONTENT-16: 必须覆盖可见内容「Disclaimer」。
- M16-CONTENT-17: 必须覆盖可见内容「Privacy Policy」。
- M16-CONTENT-18: 必须覆盖可见内容「Cookies Policy」。
- M16-CONTENT-19: 必须覆盖可见内容「Accessibility Statement」。
- M16-CONTENT-20: 必须覆盖可见内容「Copyright」。
- M16-CONTENT-21: 必须覆盖可见内容「FactSet attribution」。
- M16-CONTENT-22: 必须覆盖可见内容「ICE Data Services attribution」。
- M16-CONTENT-23: 必须覆盖可见内容「CUSIP attribution」。
- M16-INTERACTION-01: 必须支持「点击 footer link」。
- M16-INTERACTION-02: 必须支持「打开社交链接」。
- M16-INTERACTION-03: 必须支持「打开政策链接」。
- M16-INTERACTION-04: 必须支持「移动端展开 footer group」。

## 28. 实施注意事项

- 实现时先保持页面结构和真实数据，再做视觉细化。
- 对于地图、表格、tabs、accordion、carousel 等成熟交互，优先使用已有组件库或项目现有组件。
- 不要为了快速过视觉验收写死大量不可维护 DOM。
- 不要把 extracted CSS 全部理解成最终设计系统；它是视觉证据，后续可在有截图证据时收敛。
- 不要把动态 feed 的当前值当成长期不变常量；fixture 用于回归，不代表生产数据。
- 如果实现需要真实 API，先定义数据合约，再接入服务。
- 如果 API 暂不可用，应该明确交付 mock fixture 模式和 production data mode 的边界。
- 任何 mock 必须标注为测试 fixture，不允许在线上伪装成实时数据。

## 29. 最终复核清单

- 文档是否从摘要开始，而不是直接进入几千条编号。
- 每个模块是否都有产品目的。
- 每个模块是否都有可见内容。
- 每个模块是否都有数据字段。
- 每个模块是否都有交互。
- 每个模块是否都有状态。
- 每个模块是否都有验收标准。
- 是否覆盖 TradingView live page 的主要内容。
- 是否覆盖已有 extracted package 的核心数据。
- 是否明确禁止假地图、假新闻、假观点。
- 是否明确移动端和无障碍要求。
- 是否明确 SEO 和法务要求。
- 是否明确测试计划。
- 是否超过 1000 行。
- 是否能被人正常读完并用于拆任务。

## 30. 可拆分研发任务 Backlog

### E01 Header

- 目标：实现全站 header 结构、桌面导航、移动导航、搜索入口、语言入口、Get started。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E02 Page shell

- 目标：实现 breadcrumb、H1、tabs 和 main/footer landmarks。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E03 Economic summary layout

- 目标：实现 Economic trends grid、card shell、responsive grid。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E04 Inflation map

- 目标：接入 SVG geometry、legend、bucket colors、tooltip/accessibility summary。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E05 GDP ranking

- 目标：实现 GDP growth row component、country logo、link、numeric formatting。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E06 Metric cards

- 目标：实现 USUR、USINTR、USBOT 卡片、chart thumbnails、Actual/Forecast/Next release。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E07 Countries

- 目标：实现 country chip list、See all、mobile wrapping。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E08 Ideas

- 目标：实现 ideas tabs、cards、author、thumbnail、empty/error states。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E09 Heatmap

- 目标：实现 table model、horizontal scroll、cell color/value rendering。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E10 Main indicators

- 目标：实现 indicator link catalog 和 responsive layout。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E11 Industrial map

- 目标：实现第二张 map、metric data、CTA。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E12 News

- 目标：实现 news cards、provider label、Keep reading。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E13 Calendar

- 目标：实现 calendar events、Actual/Forecast/Prior、See all market events。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E14 FAQ

- 目标：实现 accordion、formula text、SEO-visible answers。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E15 Footer

- 目标：实现 footer groups、legal links、attribution。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。

### E16 QA

- 目标：实现 unit、integration、visual、a11y、performance checks。
- 输入：本 PRD 对应模块需求、source IR、extracted data fixture、reference screenshot。
- 输出：可渲染组件、typed data、必要样式、测试。
- 验收：模块内容准确、无 placeholder、响应式通过、键盘可达。
- 风险：数据源缺失时必须暴露真实状态，不能编造内容。
