# OpenCorvus 总调度任务：TradingView 全站研究复刻 DFS 采集、PRD 生成与工程实现

## 0. 任务一句话

从 `https://www.tradingview.com/` 根节点开始，以 DFS 方式采集 TradingView 公开匿名态全站结构，解析从全站到子模块的页面信息，生成站点级 PRD、模块级 PRD、共享架构 PRD、数据/API/前端实现 PRD，并由 OpenCorvus 编排多 Agent 长周期迭代完成一个研究用途的 TradingView 风格完整网站复刻系统。

---

## 1. 总目标

我们要复刻的是 TradingView 的“完整网站系统”，不是两个孤立模块。

当前已有两个核心模块：

1. Stock Screener
2. Chart / Supercharts

但它们目前是割裂的。总调度必须从全站视角重新组织系统：

1. 从根页面开始爬取。
2. 识别全站顶级模块。
3. 以 DFS 方式进入模块与子模块。
4. 采集公开页面结构、URL、导航、内容区、数据模型线索。
5. 生成站点级和模块级 PRD。
6. 基于 PRD 生成工程任务。
7. 由 OpenCorvus 编排器派发给不同 Agent 完成：
   - 数据库
   - 合成行情引擎
   - 后端 API
   - 前端 Shell
   - Chart 模块
   - Screener 模块
   - Markets / News / Ideas / Scripts / Symbol / Calendar / Brokers / Pricing 等模块
   - Playwright 测试
   - 集成与回归

模块级完整度和正确性是黄金标准。

---

## 2. 最高优先级原则

### 2.1 证据优先

所有 PRD 必须基于实际采集证据，不允许凭主观印象编造。

每个需求条目必须标注来源类型：

```text
observed_dom
observed_screenshot
observed_accessibility_tree
observed_link
observed_text
observed_event
inferred_from_route
legacy_deep_evidence
unsupported_due_to_missing_evidence
```

PRD 中禁止出现“TradingView 应该有”、“一般这种网站会有”、“我猜测”等无证据描述。

如果某个 SPA 页面公开 HTML 不暴露内部结构，则只能写：

```text
当前公开匿名态 DOM 不足以确认内部交互，需要后续事件录制 / 截图深采。
```

不能把猜测写成需求。

---

### 2.2 DFS 从根节点开始

爬取必须从根页面开始：

```text
https://www.tradingview.com/
```

不能直接凭已知 URL 手工列模块。已知 URL 可以作为补充种子，但必须在 DFS 图中说明来源。

DFS 规则：

1. 访问根页面。
2. 提取内部链接。
3. 归一化 URL。
4. 分类链接。
5. 按站点层级进入子节点。
6. 每个节点输出页面快照和路由信息。
7. 每个模块只深挖到足以写模块 PRD 的层级。
8. 不要求操作每个按钮和每个交互。
9. 不登录。
10. 不绕过付费或反爬。
11. 不访问私有 API。
12. 不抓取 TradingView 私有 bundle 作为实现材料。

DFS 不是暴力爬全网。需要做模块边界识别和限深。

---

### 2.3 不需要每个按钮都点，但必须看清模块结构

本阶段不是 exhaustive interaction crawl。

不要求：

1. 每个按钮都点击。
2. 每个弹层都展开。
3. 每个 tab 都完整操作。
4. 每个 SPA 内部状态都穷举。
5. 登录态页面采集。
6. 付费态页面采集。

必须做到：

1. 识别顶级模块。
2. 识别模块 URL。
3. 识别模块核心页面区域。
4. 识别模块子路由。
5. 识别跨模块跳转关系。
6. 识别 auth / paid / route / unsupported 边界。
7. 对复杂模块列出后续深采任务。
8. 对每个主要模块生成准确 PRD。

---

### 2.4 完整度标准以模块为单位

不要追求单个按钮像素级复刻优先于模块级完整度。

黄金标准：

```text
模块级完整度 + 模块间关系正确 + 共享系统一致 + 可运行 + 可测试
```

优先级：

1. 全站信息架构正确。
2. 模块边界正确。
3. 数据模型统一。
4. 路由关系正确。
5. API 结构合理。
6. 核心交互可用。
7. UI 信息密度与工作台形态正确。
8. 边界降级诚实。
9. Playwright 可验证。
10. 长周期可迭代。

---

### 2.5 不复制私有资源

禁止：

1. 复制 TradingView 源码。
2. 使用 TradingView 私有 API。
3. 抓取 TradingView 前端 bundle 进行复用。
4. 使用 TradingView 私有图标、字体、品牌资产。
5. 嵌入官方页面 iframe 伪装复刻。
6. 盗用真实行情接口。
7. 假装实现真实登录、支付、交易、告警推送、云端保存。

允许：

1. 采集公开页面结构和可见文本用于 PRD。
2. 使用截图作为视觉参考。
3. 自研 UI。
4. 使用开源图表库或自研图表。
5. 使用合成数据。
6. 使用本地数据库。
7. 对不可实现能力做明确 boundary。

---

## 3. 总调度角色定义

总调度不是直接写所有代码的单 Agent，而是负责：

1. 控制 DFS 采集顺序。
2. 管理证据库。
3. 生成和审查 PRD。
4. 拆解 OpenCorvus 任务。
5. 分配模块 Agent。
6. 管理依赖关系。
7. 合并 PRD 与实现。
8. 监督测试和回归。
9. 防止幻觉和重复造轮子。
10. 保证最终系统可运行。

---

## 4. OpenCorvus Agent 角色建议

### 4.1 Site Crawler Agent

职责：

1. 从根 URL 开始 DFS。
2. 提取链接、标题、heading、可见文本、截图、DOM、accessibility tree。
3. 生成 site graph。
4. 标记模块候选。
5. 去重 URL。
6. 遵守速率限制。

输出：

```text
artifacts/site-crawl/
  site-graph.json
  pages/{routeHash}/snapshot.json
  pages/{routeHash}/dom.html
  pages/{routeHash}/a11y.json
  pages/{routeHash}/viewport.png
  pages/{routeHash}/fullpage.png
  pages/{routeHash}/links.json
  pages/{routeHash}/summary.md
```

---

### 4.2 Information Architecture Agent

职责：

1. 读取 crawler 输出。
2. 聚类模块。
3. 建立顶级模块清单。
4. 建立模块间引用图。
5. 建立 route registry 草案。
6. 区分 public / auth_gated / paid / route placeholder / unsupported。

输出：

```text
docs/site/site-map.md
docs/site/module-index.md
docs/site/route-registry.md
docs/site/cross-module-routing.md
```

---

### 4.3 PRD Writer Agent

职责：

1. 为站点写全站 PRD。
2. 为每个模块写 module PRD。
3. 为复杂模块拆 feature PRD。
4. 每条需求绑定 evidence anchor。
5. 标记 evidence gaps。
6. 不编造交互。

输出：

```text
docs/prd/site-prd.md
docs/prd/shared-shell-prd.md
docs/prd/shared-data-api-prd.md
docs/prd/modules/{module}/module-prd.md
docs/prd/modules/{module}/features/*.prd.md
docs/prd/evidence-gaps.md
```

---

### 4.4 System Architect Agent

职责：

1. 基于 PRD 设计系统架构。
2. 规划数据库。
3. 规划后端 API。
4. 规划前端模块。
5. 规划共享组件。
6. 规划合成数据引擎。
7. 规划测试策略。

输出：

```text
docs/architecture/system-architecture.md
docs/architecture/database-schema.md
docs/architecture/api-contracts.md
docs/architecture/frontend-architecture.md
docs/architecture/testing-strategy.md
```

---

### 4.5 Data Engine Agent

职责：

1. 设计数据库 schema。
2. 设计 deterministic synthetic market data engine。
3. 生成 instruments、quotes、bars、metrics、content、calendar、brokers、pricing 数据。
4. 确保 Chart / Screener / Markets / Symbol 使用同一资产域。
5. 编写 seed 和数据校验测试。

输出：

```text
server/db/schema.*
server/seed/*
server/services/synthetic-market-engine/*
tests/data/*.spec.*
```

---

### 4.6 Backend API Agent

职责：

1. 实现 API envelope。
2. 实现 instruments / quotes / bars。
3. 实现 screener API。
4. 实现 chart API。
5. 实现 markets / news / ideas / scripts / calendar / brokers / pricing API。
6. 实现参数校验和错误处理。

输出：

```text
server/api/*
server/services/*
tests/api/*.spec.*
```

---

### 4.7 Frontend Shell Agent

职责：

1. 实现 App shell。
2. 实现 route registry。
3. 实现 GlobalHeader。
4. 实现 GlobalSearchModal。
5. 实现 Footer。
6. 实现 BoundaryProvider。
7. 实现 theme / layout / modal / toast 基础设施。

输出：

```text
src/app/*
src/site/*
src/shared/components/shell/*
src/shared/components/boundary/*
src/shared/components/search/*
```

---

### 4.8 Module Implementation Agents

每个主要模块一个 Agent 或一个小组：

每个 Agent 必须：

1. 只实现自己模块范围。
2. 使用 shared API。
3. 使用 shared components。
4. 不复制数据模型。
5. 不实现私有能力。
6. 添加 Playwright 测试。
7. 更新模块验收报告。

---

### 4.9 QA / Regression Agent

职责：

1. 编写 Playwright 全站 smoke。
2. 编写跨模块路由测试。
3. 编写模块回归测试。
4. 编写 API 测试。
5. 编写数据校验测试。
6. 执行测试并出报告。
7. 阻止不满足 DoD 的任务合并。

---

### 4.10 Integration Manager Agent

职责：

1. 处理多 Agent 代码冲突。
2. 合并共享类型。
3. 检查重复组件。
4. 检查 API 命名一致性。
5. 检查路由一致性。
6. 检查测试覆盖。
7. 生成 release notes。

---

## 5. DFS 采集规范

### 5.1 起点

```text
https://www.tradingview.com/
```

### 5.2 URL 归一化

规则：

1. 仅采集 `tradingview.com` 内部链接。
2. 去掉追踪参数，但保留业务参数。
3. 保留 hash 状态用于 SPA 模块识别。
4. 统一尾部 `/`。
5. 资产路由统一识别：

   ```text
   /symbols/{EXCHANGE}-{TICKER}/
   ```

6. Chart 分享链接识别：

   ```text
   /chart/{layoutId}/
   ```

7. Calendar 参数保留：

   ```text
   /earnings-calendar/?countries=us
   /ipo-calendar/?countries=us
   ```

### 5.3 DFS 限深

建议限深：

```text
depth 0: /
depth 1: 顶级导航和首页显式链接
depth 2: 模块一级子路由
depth 3: 代表性详情页，如 symbol、news article、idea、script、broker detail
```

限制：

1. 不展开无限分页。
2. 不爬用户 profile 的无穷内容。
3. 不爬所有 symbol。
4. 不爬所有 news article。
5. 不爬所有 idea / script detail。
6. 每类详情页选代表性样本即可。
7. SPA 内部缺失信息时记录 evidence gap，另派深采任务。

### 5.4 采集内容

每个页面必须采集：

```text
url
final_url
status
title
meta description
canonical
h1/h2/h3 headings
visible_text_summary
top nav links
footer links
main content sections
internal links
external links
forms/search inputs
buttons with accessible names
tables
cards
tabs
breadcrumbs
route_out candidates
screenshots
DOM snapshot
accessibility snapshot
```

### 5.5 页面摘要格式

每个页面输出：

```markdown
# Page Snapshot

## URL

## Status

## Title

## Page Type

## Main Headings

## Visible Sections

## Navigation Links

## Route Outs

## Forms / Inputs

## Tables / Cards

## Auth / Paid / Route Boundary Candidates

## Evidence Gaps

## Suggested Module Mapping
```

---

## 6. 模块识别规则

### 6.1 顶级模块候选

如果页面满足以下任一条件，识别为模块：

1. 顶级导航直接入口。
2. 首页主要 CTA / section 入口。
3. Footer 产品组入口。
4. URL 第一段稳定。
5. 有独立页面标题和内容结构。
6. 被多个模块引用。
7. 对数据域有独立需求。

### 6.2 必须识别的主要模块

初始模块集合至少包括：

```text
home
chart
screener
markets
news
ideas
scripts
symbol
heatmap-stock
crypto-screener
economic-calendar
earnings-calendar
ipo-calendar
brokers
pricing
support
about
```

可扩展模块：

```text
etf-screener
bond-screener
cex-pair-screener
dex-pair-screener
pine-screener
etf-heatmap
crypto-heatmap
yield-curves
options
macro-maps
news-flow
mobile-apps
desktop-app
features
market-data
widgets
charting-libraries
lightweight-charts
advanced-charts
trading-platform
brokerage-integration
advertising
partner-program
education-program
```

这些可扩展模块不一定第一轮完整实现，但必须在 site graph 中识别、分类、标记实现优先级。

---

## 7. PRD 生成规范

### 7.1 全站 PRD 必须包含

```text
1. 产品定位
2. 证据范围
3. 顶级模块清单
4. 全站信息架构
5. 全站 shell
6. 全站 route registry
7. 全站数据域
8. 全站 API namespace
9. Auth/Paid/Route/Unsupported boundary
10. 模块间引用图
11. 实施优先级
12. 验收标准
13. 测试策略
14. Evidence gaps
```

### 7.2 每个模块 PRD 必须包含

```text
1. 模块定位
2. Evidence anchors
3. In scope
4. Out of scope
5. 页面结构
6. 子路由
7. 核心数据模型
8. API 需求
9. 关键组件
10. 核心交互
11. 边界与降级
12. 与其他模块的路由关系
13. Playwright 测试
14. Definition of Done
15. Evidence gaps
```

### 7.3 Feature PRD 触发条件

以下情况必须拆 feature PRD：

1. 模块有复杂工作台交互。
2. 模块包含表格筛选排序。
3. 模块包含图表渲染。
4. 模块包含绘图/指标。
5. 模块包含日历表格。
6. 模块包含 feed/filter/sort。
7. 模块包含跨模块数据流。
8. 模块包含 paid/auth/private boundary。

必须拆 feature PRD 的模块：

```text
chart
screener
markets
symbol
calendar
heatmap
crypto-screener
news
ideas
scripts
pricing
brokers
```

---

## 8. 模块复刻优先级

### P0：平台底座与现有核心模块

1. Shared Shell
2. Shared Data/API
3. Route Registry
4. Boundary System
5. Global Search
6. Stock Screener
7. Chart / Supercharts
8. Symbol Detail skeleton

目标：让现有两个模块不再割裂。

---

### P1：全站闭环模块

1. Home
2. Markets
3. Symbol Detail full MVP
4. Pricing
5. News MVP

目标：形成用户从首页到市场、资产详情、图表、筛选器、付费边界的闭环。

---

### P2：内容与工具扩展

1. Ideas
2. Scripts
3. Heatmap Stock
4. Crypto Screener
5. Economic Calendar
6. Earnings Calendar
7. IPO Calendar
8. Brokers

目标：覆盖主要 TradingView 模块类型。

---

### P3：补充页与商业链接

1. Support
2. About
3. Widgets
4. Charting libraries
5. Mobile / Desktop apps
6. Features
7. Market data
8. Policies

目标：补齐站点结构和 footer 路由。

---

## 9. 统一工程目标

### 9.1 不允许静态 mock

禁止：

1. 把页面截图贴成 UI。
2. 把行情数据写死在 React 组件里。
3. 每个模块各自造一套 symbol 数据。
4. 每个模块各自写 auth modal。
5. 每个模块各自写 route placeholder。
6. 只做静态页面不做状态变化。
7. 用真实 TradingView API。
8. 假装实现登录、交易、支付、告警、云保存。

必须：

1. 数据来自本地数据库或数据服务。
2. 数据由 deterministic synthetic engine 生成。
3. 前端通过 API 获取数据。
4. 共享资产域贯穿全站。
5. Chart 和 Screener 共享 instrument / quote。
6. 模块之间通过 route registry 跳转。
7. Boundary 行为统一。
8. Playwright 可验证。

---

### 9.2 推荐目录结构

```text
docs/
  prd/
    site-prd.md
    shared-shell-prd.md
    shared-data-api-prd.md
    modules/
      home/
      markets/
      news/
      ideas/
      scripts/
      chart/
      screener/
      heatmap-stock/
      crypto-screener/
      calendar/
      symbol/
      brokers/
      pricing/
      support/
      about/
  architecture/
  evidence/
  test-reports/

src/
  app/
    App.tsx
    routes.tsx
    providers/
  site/
    modules.ts
    route-registry.ts
    route-utils.ts
    shells/
  shared/
    api/
    components/
    domain/
    hooks/
    types/
    utils/
  modules/
    home/
    markets/
    news/
    ideas/
    scripts/
    chart/
    screener/
    heatmap/
    crypto-screener/
    calendar/
    symbol/
    brokers/
    pricing/
    support/
    about/

server/
  api/
    site/
    instruments/
    quotes/
    bars/
    markets/
    screener/
    chart/
    news/
    ideas/
    scripts/
    calendar/
    brokers/
    pricing/
  db/
  seed/
  services/
    synthetic-market-engine/
    indicators/
    search/
    content/

tests/
  e2e/
  api/
  data/
```

---

## 10. 统一数据库要求

至少设计以下表或等价模型：

```text
instruments
quotes
market_bars
market_metrics
financial_metrics
content_items
content_authors
calendar_events
brokers
pricing_plans
watchlists
chart_layouts
chart_indicators
drawing_objects
screener_presets
screener_views
filter_definitions
column_definitions
heatmap_configs
site_pages
site_nav_items
```

### 10.1 instruments

统一全站资产主表：

```text
id
symbol                // NASDAQ:NVDA
route_key             // NASDAQ-NVDA
ticker                // NVDA
exchange              // NASDAQ
name
asset_class           // stock, crypto, forex, futures, index, etf, bond
country
currency
sector
industry
description
is_active
created_at
updated_at
```

### 10.2 quotes

```text
instrument_id
last_price
change
change_percent
volume
market_status
updated_at
```

### 10.3 market_bars

```text
instrument_id
timeframe
timestamp
open
high
low
close
volume
```

### 10.4 market_metrics

```text
instrument_id
market_cap
pe_ratio
eps_diluted_growth
dividend_yield_percent
performance_percent
revenue_growth
peg_ratio
roe
beta
analyst_rating
recent_earnings_date
upcoming_earnings_date
```

---

## 11. 合成数据引擎要求

必须实现全站统一 synthetic data engine。

### 11.1 生成范围

至少生成：

```text
100+ stocks
50+ crypto instruments
30+ ETFs
20+ indices
20+ futures
20+ forex pairs
20+ bonds
100+ news items
100+ ideas
50+ scripts
100+ calendar events
20+ brokers
5+ pricing plans
```

### 11.2 必含资产

```text
NASDAQ:NVDA
NASDAQ:AAPL
NASDAQ:MSFT
NASDAQ:TSLA
NASDAQ:AMZN
NASDAQ:GOOGL
NASDAQ:META
NYSE:IBM
NASDAQ:AMD
NASDAQ:COIN
BINANCE:BTCUSDT
COINBASE:ETHUSD
SP:SPX
NASDAQ:NDX
TVC:DXY
COMEX:GC1!
NYMEX:CL1!
```

### 11.3 数据要求

1. deterministic。
2. 可重复 seed。
3. OHLC 合法。
4. 多 timeframe。
5. sectors 分布合理。
6. industries 分布合理。
7. price / volume / market cap 分布合理。
8. 支持 Screener filter。
9. 支持 Chart rendering。
10. 支持 Symbol Detail stats。
11. 支持 Markets cards。
12. 支持 Heatmap grouping。
13. 支持 Calendar events。
14. 支持 News / Ideas related symbols。

---

## 12. 统一 API 要求

### 12.1 Response Envelope

```ts
type ApiResponse<T> =
  | {
      ok: true;
      data: T;
      meta?: {
        total?: number;
        page?: number;
        pageSize?: number;
        source?: "synthetic" | "local_db";
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        boundary?: "auth" | "paid" | "route" | "unsupported";
      };
    };
```

### 12.2 API Namespace

```text
GET /api/site/nav
GET /api/site/footer
GET /api/site/search
GET /api/site/pages
GET /api/instruments/search
GET /api/instruments/:symbol
GET /api/quotes
GET /api/bars
GET /api/markets/overview
GET /api/markets/sections/:id
GET /api/screener/stocks
GET /api/screener/filters
GET /api/screener/columns
GET /api/screener/views
GET /api/chart/layouts/default
GET /api/chart/indicators
GET /api/chart/indicators/calculate
GET /api/news
GET /api/ideas
GET /api/scripts
GET /api/calendar/events
GET /api/brokers
GET /api/pricing/plans
GET /api/symbols/:symbol/overview
GET /api/heatmap/stocks
```

---

## 13. 全站共享前端要求

### 13.1 Shared Shell

```text
GlobalHeader
GlobalFooter
MarketingShell
DataPageShell
ScreenerShell
ChartShell
HeatmapShell
```

### 13.2 Shared Components

```text
GlobalSearchModal
SymbolSearchInput
SymbolLink
AssetCard
QuoteCard
PriceChange
MarketTable
ContentCard
CalendarEventTable
BrokerCard
PlanCard
AuthBoundaryModal
PaidBoundaryModal
RoutePlaceholderToast
UnsupportedFeatureToast
Modal
Popover
Toast
Tabs
FilterBar
DataTable
```

### 13.3 Route Registry

必须集中定义：

```text
/
 /chart/
 /chart/:layoutId/
 /screener/
 /markets/
 /news/
 /ideas/
 /scripts/
 /symbols/:exchangeTicker/
 /heatmap/stock/
 /crypto-coins-screener/
 /economic-calendar/
 /earnings-calendar/
 /ipo-calendar/
 /brokers/
 /pricing/
 /support/
 /about/
```

---

## 14. 主要模块实现要求

### 14.1 Home

必须复刻：

1. 全站 hero。
2. market summary。
3. major indices。
4. crypto market cap。
5. futures / commodities。
6. economic indicators。
7. community ideas。
8. indicators and strategies。
9. top stories。
10. US stocks / community trends。

---

### 14.2 Markets

必须复刻：

1. markets hero。
2. market tabs。
3. indices。
4. world indices。
5. US stocks。
6. highest volume stocks。
7. volatile stocks。
8. gainers / losers。
9. earnings calendar preview。
10. IPO calendar preview。
11. world stocks。
12. crypto / forex / futures / bonds / ETFs route placeholders or MVP。

---

### 14.3 Symbol Detail

必须复刻：

1. `/symbols/{EXCHANGE}-{TICKER}/`。
2. breadcrumbs。
3. symbol header。
4. quote summary。
5. tabs：Overview / Financials / News / Documents / Community / Technicals / Forecasts / Seasonals / Options / Bonds / ETFs / More。
6. full chart CTA。
7. mini chart。
8. key facts。
9. latest earnings。
10. key stats。
11. about company。
12. related stocks。
13. financials preview。
14. community forum preview。
15. news preview。
16. ideas preview。

---

### 14.4 Stock Screener

必须接入已有深度 PRD，并全站化：

1. 使用 shared instrument domain。
2. 使用 shared API client。
3. symbol link -> Symbol Detail。
4. see on chart -> Chart。
5. auth/payed boundary 使用 shared components。
6. 所有原 filter / sorting / column setup / horizontal scroll / table search 功能不能退化。

---

### 14.5 Chart / Supercharts

必须接入已有深度 PRD，并全站化：

1. `/chart/`。
2. `/chart/?symbol=NASDAQ:NVDA`。
3. `/chart/{layoutId}/` 共享图表链接降级。
4. 使用 shared instrument search。
5. 使用 shared quote / bars API。
6. symbol profile -> Symbol Detail。
7. save / alert / publish -> auth boundary。
8. paid chart features -> paid boundary。
9. 不使用 TradingView 私有 chart bundle。

---

### 14.6 News

必须复刻：

1. news landing。
2. top stories。
3. markets categories。
4. corporate / economics / provider categories。
5. news feed。
6. provider list。
7. related symbol links。
8. exclusive news auth boundary。

---

### 14.7 Ideas

必须复刻：

1. community ideas landing。
2. popular / editors’ picks。
3. all ideas。
4. videos only。
5. most recent / most popular。
6. idea cards。
7. related symbol links。
8. publish / like / comment auth boundary。

---

### 14.8 Scripts

必须复刻：

1. indicators and strategies landing。
2. popular / editors’ picks。
3. all types。
4. open-source only。
5. most recent / most popular。
6. script cards。
7. Pine Script indicator/library labels。
8. add to chart / favorite / publish boundary。

---

### 14.9 Calendar

必须复刻统一 calendar：

1. economic calendar。
2. earnings calendar。
3. IPO calendar。
4. revenue / dividends placeholders。
5. today/date controls。
6. country / timezone / importance filters。
7. event table。
8. FAQ / educational content。
9. symbol links。

---

### 14.10 Brokers

必须复刻：

1. brokers hero。
2. best rated。
3. all brokers。
4. asset class filters。
5. broker cards。
6. ratings / reviews / accounts。
7. promotions。
8. open account / learn more boundary。

---

### 14.11 Pricing

必须复刻：

1. free plan。
2. plan cards。
3. monthly / annual toggle。
4. compare plans。
5. chart feature limits。
6. alerts / screeners / watchlists / data / support feature groups。
7. try free auth boundary。
8. checkout unsupported boundary。

---

### 14.12 Heatmap

必须复刻：

1. stock heatmap route。
2. hash config parsing。
3. sector grouping。
4. market cap size metric。
5. change color metric。
6. symbol hover tooltip。
7. click cell -> Symbol Detail。
8. unsupported advanced data sources boundary。

---

### 14.13 Crypto Screener

必须复用 Screener 框架：

1. crypto universe。
2. crypto columns。
3. search BTC/ETH。
4. sort/filter。
5. symbol -> Symbol Detail。
6. chart route。
7. auth boundary。

---

### 14.14 Support / About

MVP：

1. support search skeleton。
2. product links。
3. help article placeholder。
4. about hero。
5. company intro。
6. CTA route links。
7. footer consistency。

---

## 15. 边界系统要求

### 15.1 Auth Boundary

用于：

```text
sign in
get started
save screen
save layout
create alert
edit watchlist
publish idea
comment
like
follow
read exclusive news
favorite script
save notes
```

要求：

1. 展示登录/注册弹层。
2. 不假装登录成功。
3. 可关闭。
4. 所有模块一致。

### 15.2 Paid Boundary

用于：

```text
advanced chart types
bar replay advanced
multi chart layout
extra indicators
data export
auto refresh
advanced alerts
paid scripts
premium market data
```

要求：

1. 展示付费提示。
2. 可跳转 Pricing。
3. 不假装已开通。

### 15.3 Route Placeholder

用于：

```text
unimplemented detail pages
external docs
broker detail
news detail
idea detail
script detail
widget docs
payment checkout
help articles
```

要求：

1. 阻止无效跳转。
2. 保留链接形态。
3. 提示当前复刻未覆盖。

### 15.4 Unsupported Boundary

用于：

```text
evidence missing
private API
real market data
real trading
real alert push
real cloud save
```

要求：

1. 不静默失败。
2. 不伪装完成。
3. 写入最终降级清单。

---

## 16. OpenCorvus 任务拆解格式

每个任务必须使用以下结构发布：

```markdown
# Task: {task title}

## Type

research | prd | architecture | backend | frontend | data | test | integration | refactor

## Module

site | shared | home | markets | symbol | screener | chart | news | ideas | scripts | calendar | brokers | pricing | support | about

## Goal

一句话目标。

## Evidence Inputs

- path or URL
- evidence anchor
- screenshot / DOM / event file

## Required Reading

- docs/prd/site-prd.md
- docs/prd/modules/{module}/module-prd.md
- relevant evidence files

## Scope

明确 in scope。

## Out of Scope

明确不做什么。

## Implementation Requirements

工程要求。

## Acceptance Criteria

可测试验收条件。

## Tests Required

需要新增或修改的测试。

## Dependencies

依赖哪些 task。

## Outputs

需要产出的文件或代码。

## Done Definition

完成条件。
```

---

## 17. 任务依赖图

```text
T0 root crawl
  -> T1 site graph
    -> T2 site PRD
      -> T3 shared architecture
        -> T4 database + synthetic engine
        -> T5 shared API
        -> T6 shared frontend shell
          -> T7 symbol detail skeleton
          -> T8 screener migration
          -> T9 chart migration
          -> T10 home/markets
          -> T11 news/ideas/scripts
          -> T12 calendar/brokers/pricing
          -> T13 heatmap/crypto-screener
            -> T14 full site e2e
              -> T15 integration hardening
```

---

## 18. 首批任务清单

### T0：DFS Crawler Bootstrap

目标：

从 `/` 根节点启动 DFS 爬取，生成第一版 site graph。

输出：

```text
artifacts/site-crawl/site-graph.json
artifacts/site-crawl/page-snapshots/*
docs/evidence/crawl-summary.md
```

验收：

1. 至少识别 15 个顶级模块。
2. 每个模块有 URL、title、summary、route_outs。
3. 有截图和 DOM。
4. 有 evidence gaps。

---

### T1：全站模块索引 PRD

目标：

基于 T0 生成全站模块索引。

输出：

```text
docs/prd/site-prd.md
docs/prd/module-index.md
docs/prd/cross-module-routing.md
```

验收：

1. 模块清单完整。
2. 每个模块有 one-liner。
3. 每个模块有优先级。
4. 每个模块有实现策略。
5. 不含无证据功能断言。

---

### T2：共享 Shell / Route / Boundary PRD

输出：

```text
docs/prd/shared-shell-prd.md
docs/prd/route-registry-prd.md
docs/prd/boundary-system-prd.md
```

验收：

1. GlobalHeader 可追溯到证据。
2. route registry 覆盖主要模块。
3. boundary 分类明确。
4. Chart/Screener 的特殊 Shell 明确。

---

### T3：共享数据和 API PRD

输出：

```text
docs/prd/shared-data-api-prd.md
docs/architecture/database-schema.md
docs/architecture/api-contracts.md
```

验收：

1. instruments/quotes/bars/metrics/content/calendar/brokers/pricing 模型完整。
2. Chart 和 Screener 共享数据域。
3. API envelope 统一。
4. seed 要求明确。

---

### T4：模块 PRD 批量生成

对每个模块生成：

```text
docs/prd/modules/{module}/module-prd.md
```

首批模块：

```text
home
markets
symbol
screener
chart
news
ideas
scripts
calendar
brokers
pricing
heatmap-stock
crypto-screener
support
about
```

验收：

1. 每个 PRD 有 evidence anchors。
2. 每个 PRD 有 in/out scope。
3. 每个 PRD 有数据/API/组件/测试要求。
4. 每个 PRD 有 evidence gaps。
5. PRD 之间不矛盾。

---

### T5：工程底座实现

输出：

```text
src/app
src/site
src/shared
server/db
server/api
tests/e2e/site-smoke.spec.ts
```

验收：

1. 本地可启动。
2. 基础路由可访问。
3. GlobalHeader 可见。
4. BoundaryProvider 可用。
5. API health check 可用。
6. e2e smoke 通过。

---

### T6：共享数据引擎实现

输出：

```text
server/db/schema
server/seed
server/services/synthetic-market-engine
tests/data
```

验收：

1. seed deterministic。
2. 必含关键 symbol。
3. OHLC 合法。
4. Screener/Chart/Markets/Symbol 使用同一资产表。
5. 数据测试通过。

---

### T7：Screener 全站迁移

验收：

1. 原功能不退化。
2. symbol link -> Symbol Detail。
3. 使用 shared API。
4. 使用 shared boundary。
5. e2e regression 通过。

---

### T8：Chart 全站迁移

验收：

1. `/chart/?symbol=NASDAQ:NVDA` 可用。
2. shared instrument search。
3. bars/quotes API。
4. symbol profile -> Symbol Detail。
5. auth/paid boundary。
6. e2e regression 通过。

---

### T9：Symbol Detail MVP

验收：

1. `/symbols/NASDAQ-NVDA/` 可访问。
2. header/key stats/about/news/ideas/related stocks 可见。
3. Full chart -> Chart。
4. Related symbol -> Symbol Detail。
5. Symbol route tests 通过。

---

### T10：Home + Markets MVP

验收：

1. Home 可访问。
2. Markets 可访问。
3. Home -> Markets。
4. Markets -> Symbol。
5. Market cards 使用 shared quotes。
6. tests 通过。

---

### T11：内容模块 MVP

模块：

```text
news
ideas
scripts
```

验收：

1. feed 可见。
2. filters/tabs 可用。
3. related symbols 可跳转。
4. auth/route boundary。
5. tests 通过。

---

### T12：工具/商业模块 MVP

模块：

```text
calendar
brokers
pricing
support
about
```

验收：

1. 页面可访问。
2. 核心结构可见。
3. Pricing 接 paid boundary。
4. Brokers 交易能力 private boundary。
5. Calendar symbol links。
6. tests 通过。

---

### T13：可视化/衍生模块 MVP

模块：

```text
heatmap-stock
crypto-screener
```

验收：

1. Heatmap 可视化。
2. Hash config。
3. Crypto Screener 复用 Screener framework。
4. symbol routing。
5. tests 通过。

---

### T14：全站回归与稳定性

验收：

1. site smoke 全部通过。
2. cross-module route 全部通过。
3. API tests 全部通过。
4. data tests 全部通过。
5. Chart regression 通过。
6. Screener regression 通过。
7. 无 P0/P1 缺陷。

---

## 19. Playwright 测试矩阵

```text
tests/e2e/site-smoke.spec.ts
tests/e2e/site-header.spec.ts
tests/e2e/site-routing.spec.ts
tests/e2e/site-boundaries.spec.ts
tests/e2e/global-search.spec.ts

tests/e2e/home.spec.ts
tests/e2e/markets.spec.ts
tests/e2e/symbol.spec.ts
tests/e2e/screener.spec.ts
tests/e2e/chart.spec.ts
tests/e2e/news.spec.ts
tests/e2e/ideas.spec.ts
tests/e2e/scripts.spec.ts
tests/e2e/calendar.spec.ts
tests/e2e/brokers.spec.ts
tests/e2e/pricing.spec.ts
tests/e2e/heatmap.spec.ts
tests/e2e/crypto-screener.spec.ts
tests/e2e/support-about.spec.ts

tests/api/*.spec.ts
tests/data/*.spec.ts
```

---

## 20. 验收标准

### 20.1 全站级验收

1. 所有主要路由可访问。
2. GlobalHeader 一致。
3. Footer 一致。
4. GlobalSearch 可用。
5. Symbol route 统一。
6. Chart route 统一。
7. Auth/Paid/Route/Unsupported boundary 统一。
8. 数据来自 API。
9. 数据来自 synthetic engine / local DB。
10. 无 TradingView 私有 API。
11. 无静态截图拼贴。
12. Playwright 可一键执行。

### 20.2 模块级验收

每个模块必须满足：

1. PRD 已完成。
2. Evidence anchors 已标注。
3. MVP 已实现。
4. API 已实现。
5. 前端已接入。
6. 测试已覆盖。
7. 降级项已记录。
8. 不存在未声明的假实现。

### 20.3 回归验收

Screener 和 Chart 原有验收不能退化。

---

## 21. 缺陷等级

```text
P0: 页面无法启动、核心 API 全挂、数据无法 seed、路由全站崩溃
P1: Chart/Screener 核心功能不可用、Symbol 路由失效、共享数据不一致
P2: 单模块重要功能缺失、筛选/排序/跳转异常
P3: 样式/布局/提示问题
P4: 文案和轻微体验问题
```

合并条件：

```text
P0 = 0
P1 = 0
P2 必须记录并有修复计划
```

---

## 22. 最终交付物

```text
1. docs/prd/site-prd.md
2. docs/prd/shared-shell-prd.md
3. docs/prd/shared-data-api-prd.md
4. docs/prd/modules/*/module-prd.md
5. docs/architecture/*
6. artifacts/site-crawl/*
7. server/db/*
8. server/api/*
9. server/seed/*
10. src/app/*
11. src/site/*
12. src/shared/*
13. src/modules/*
14. tests/e2e/*
15. tests/api/*
16. tests/data/*
17. docs/test-reports/*
18. docs/release-notes/*
```

---

## 23. 总调度最终汇报格式

每个大版本结束后必须输出：

```markdown
# TradingView Full Site Clone Iteration Report

## Iteration

## 本地访问 URL

- Home:
- Markets:
- Screener:
- Chart:
- Symbol:
- Pricing:

## 本轮完成模块

| 模块 | 状态 | 证据 | 测试 |
|---|---|---|---|

## 已实现共享能力

- Shell:
- Route:
- Data:
- API:
- Boundary:
- Tests:

## 未实现 / 降级项

| 功能 | 类型 | 原因 | 后续任务 |
|---|---|---|---|

## Evidence Gaps

| 模块 | 缺口 | 需要的采集 |
|---|---|---|

## 测试结果

| 测试套件 | 通过 | 失败 | 跳过 |
|---|---:|---:|---:|

## 缺陷

| ID | 等级 | 模块 | 描述 | 状态 |
|---|---|---|---|---|

## 下一轮计划

1.
2.
3.
```

---

## 24. 给 OpenCorvus 的执行口令

从根节点开始。先爬、再写 PRD、再设计架构、再实现。不要把两个已有模块当成独立页面继续堆代码。先建立全站路线图和证据库，再把 Screener 和 Chart 迁入统一站点。所有模块必须有 PRD，所有 PRD 必须有证据，所有实现必须来自 PRD，所有重要交互必须有测试。任何登录、付费、真实行情、真实交易、真实告警、云端保存、私有 API 都必须明确降级，不能伪装完成。模块级完整度和正确性优先于局部按钮穷举。DFS 从 `/` 开始，按站点结构进入子模块，逐步扩展到完整复刻系统。
