---
type: products
last-updated: 2026-07-07
sources:
  - ainvest.com 首页 / footer / /aime / /screener / /chart / /news / /brokers / /watchlist / /market / /pricing / /pricing/magic-portfolio
  - ainvest.com/screener/stocks/ + category- 子页 + preset 子页
  - ainvest.com/kb
  - ainvest.com/prediction/ （**2026-06 新上线**）
---

# Products — 产品矩阵

AInvest 在主站以 **"一个 hub + 多个产品模块"** 的方式组织产品。共享的核心 AI 引擎是 **AIME**（见 [`aime.md`](./aime.md)）。付费层用 **AIME+** 品牌（4 档 + Option+），详见 [`business-model.md`](./business-model.md)。

## 总览（**10 个对外产品** + 跨产品能力 + AIME+ 功能模块）

| # | 产品 | 路由 / 子站 | 一句话 |
|---|------|------------|--------|
| 1 | **Aime** | `/aime/`、`/chat/` | AI 投资助理 / Robo-Advisor（聊天 + 主动监控） |
| 2 | **AI Charts** | `chart.ainvest.com` | 智能图表 + AI 模式识别 |
| 3 | **Super Charts** | `/chart?symbol=…` | 高级图表（指标 / 画线 / 期权 / 加密） |
| 4 | **Screener** | `/screener/stocks/`、`/screener/etfs/` | 100+ 预设策略 + 自定义筛选（按 category 分类） |
| 5 | **Newswire** | `/news/`、`/news/wire/` | 新闻流 + 编辑团队 + AI Writer |
| 6 | **Markets** | `/market/` | 行情大盘（股票 / 加密 / ETF / 期权 + 指标信号） |
| 7 | **Portfolio** | `/watchlist/` | 自选股 + AI 持仓追踪 |
| 8 | **Magic Portfolio** | `/pricing/magic-portfolio/` | AI 周度再平衡投资组合（9 个主题板块 + 大量细分策略） |
| 9 | **Trade** | `/brokers/` | 券商列表与跳转（**同集团 Light Horse Securities 是主承接方** + Robinhood / Webull） |
| 10 | **Prediction Markets** | `/prediction/`（顶部 nav 标 "🏆World Cup"） | **2026-06 新上线** —— Polymarket 数据聚合 + AIME Briefing（详见 [`prediction-markets.md`](./prediction-markets.md)） |
| ➕ | **Option+** | `/pricing/` 末段 | 期权数据 + 1v1 咨询独立 SKU（OPRA 合规） |

> 实际页面 / 导航里把 Aime、AI Charts、**🏆World Cup（Prediction Markets）**、Markets、Portfolio、News、Trade 放在主导航，**Screener、Super Charts、Magic Portfolio、Newswire** 在 footer / KB 入口里出现。

## 1. Aime

- **定位**：personal AI investment expert（meta title 直接标 "AI Investment Chat - Robo-Advisor Assistant"）
- **能力**：
  - 自然语言问答（"TSLA stock news"）
  - 自动记忆用户关注 / 自选
  - 主动推荐下一动作（chart、backtest、trade plan、watch）
  - "She doesn't just organize your workflow — she anticipates it."
  - **Fast Answer / Copilot** 和 **Expert Answer / Deep Research** quota 区分：Basic 150/10、Pro 400/100、Premium 1000/200、Ultra Unlimited/500（2026-07 `/pricing/`）
  - "live support" 关键词 → 转人工客服
- **拟人化营销**："Reserve AimeClaw"（私人助理预订）
- **代词**：she / her
- 详细见 [`aime.md`](./aime.md)

## 2. AI Charts（`chart.ainvest.com`）

- 独立子域 `chart.ainvest.com/NASDAQ-AAPL/`
- 在图表上做 **自动模式识别**：识别形态、画线、给出 bullish / bearish 判断、关联相关新闻
- 卖点："Confused by candlesticks? …bullish or bearish, while revealing the news behind every move."

## 3. Super Charts

- 路由：`/chart?symbol=NASDAQ-AAPL`
- 高级技术分析：自定义指标、画线工具、跨资产（股票 / 期权 / 加密）
- KB 主题：`/kb/superchart/`
- 强调 "precise entry and exit levels"

## 4. Screener（AI Screener）

- 路由：`/screener/`（落地是 `/screener/stocks/`，`/screener/etfs/` 是 ETF 筛选）
- 实时多维筛选：动量 / 成交量 / 估值 / 情绪（**Momentum · Volume · Valuation · Sentiment**）
- 自定义筛选支持：price / gap / volume / **RVOL / RSI / EMA / MACD**
- 实际预设策略 **远超 27 个**（按 category 算，**174 stock + 86 ETF = 260 presets**，2026-07-07 实测；"27 ready made" / "100+" 是早期文案，**已过时** —— 当前每个 category 下都有十几个独立 preset，Growth & Innovation 单类就有 20 个）
- 16 个 category 入口（共 174 presets，2026-07-07 实测）：

| Category | 路径 | 典型 preset | preset 数 |
|----------|------|-------------|-----------|
| For You (Weekly Spotlight) | `/screener/stocks/` | AI Enablers / AI Monetizers / Greenland Acquisition Play / Earnings Beat Breadth / Top Meme Stocks | 5 |
| Thematic & Sector Rotation | `/screener/stocks/category-thematic-sector-rotation/` | GLP-1 Demand Shift / Trade War Beneficiaries / Fed Rate Sensitive / Gold Mining / Cyclical Sector / Election-Impact / Rate Cut Beneficiary / Defensive Sector / Dollar Weakness / Onshoring / Reflation / Manufacturing PMI / Infrastructure | 13 |
| Congress Trading | `/screener/stocks/category-congress-trading/` | **7 位议员**：Nancy Pelosi / Marjorie Taylor Greene / Josh S. Gottheimer / Debbie Wasserman Schultz / **Markwayne Mullin** / **Robert P. Bresnahan** / **Susie Lee** | 7 |
| Swing Trading | `/screener/stocks/category-swing-trading/` | Reddit Meme / Twitter Trending / Breakout Flag / Mean Reversion / Volatility Squeeze / Gap Fill / Oversold Rebound / High Insider Selling 等 | 17 |
| Technical Patterns | `/screener/stocks/category-technical-patterns/` | Bullish Engulfing / Cup & Handle / Head & Shoulders / MACD Crossover / Golden Cross / Bollinger Band / Flag & Pennant / Double Bottom / Volume Climax 等 | 16 |
| Momentum Stocks | `/screener/stocks/category-momentum-stocks/` | Low Float Momentum / 52-Week High / Pre-Market Movers / High Relative Strength / Pullback Leaders / Recent Short Squeeze 等 | 11 |
| Dividend Investing | `/screener/stocks/category-dividend-investing/` | High Dividend Yield / REIT Dividend / US Dividend Growth / UK Dividend Aristocrat / Special Dividend / Recent Hike 等 | 11 |
| Corporate Events & Catalysts | `/screener/stocks/category-corporate-events-catalysts/` | Upcoming Earnings / Recent IPO / M&A Targets / Buyback / Stock Splits / Spin-Offs / CPI-PPI Sensitive / Activist Targets / Regulatory Watchlist 等 | 17 |
| AI Screeners | `/screener/stocks/category-ai-screeners/` | AI Enablers / AI Monetizers / Earnings Beat Breadth / Top Meme / Next-Gen Smart Beta / AI Earnings Revision / AI Insider Activity / Sentiment Divergence 等（⚠️ 站点 typo "Unsual Correlation"） | 13 |
| Robotics & Hardware Stocks | `/screener/stocks/category-robotics-hardware-stocks/` | 机器人 / 硬件 | 4 |
| Options & Derivatives Trading | `/screener/stocks/category-options-derivatives-trading/` | 期权衍生品 | 4 |
| Analyst & Institutional Activity | `/screener/stocks/category-analyst-institutional-activity/` | 分析师 / 机构动作 | 5 |
| Growth & Innovation Stocks | `/screener/stocks/category-growth-innovation-stocks/` | 增长 / 创新（**最大单类**） | 20 |
| International & Emerging Markets | `/screener/stocks/category-international-emerging-markets/` | 国际 / 新兴市场 | 7 |
| Clean Energy & Sustainability | `/screener/stocks/category-clean-energy-sustainability/` | 清洁能源 / ESG | 12 |
| Value Investing | `/screener/stocks/category-value-investing/` | 价值投资 | 12 |

- 每个 preset 卡片显示：**Symbol 数量 + 3-Month Return %**（例：Low Float Momentum 15 symbols +322.44%）
- 卡片有 `My Saved` 自定义保存入口
- 顶部 tab：Stocks / ETFs（"For You" tab 在股票侧渲染为 **"Weekly Spotlight"** 段，含 5 个 featured preset：AI Enablers / AI Monetizers / **Greenland Acquisition Play** / Earnings Beat Breadth / Top Meme Stocks；ETF 侧"For You"无独立 spotlight 段）
- 卡片封面图来自 `cdn.ainvest.com/yyzt/upload/common/{uuid}.png?format=webp&width=636&height=356`
- KB 主题：`/kb/ai-screener/`

## 5. Newswire

- 路由：`/news/`、`/news/wire/`
- 文章布局：
  - **Top News**（带 hero 大图 + 子新闻流）
  - **Trending News**（速报，含 1/2/3 排名）
  - **Newswire**（分钟级实时要点流 `/news/wire/`）
  - **Expert Voices**（专家署名观点）
  - **Articles**（按行情分组的 tag 卡片：Bullish and Short Term / Long Term / 高波动 / 风险控制等）
  - **For You**、**Shorts**、**Videos**、**Learn**
- 编辑作者体系：见 [`team-and-org.md`](./team-and-org.md) — 包括 **Adam Shapiro（Managing Editor）**、**Jeremy Dwyer / Gavin Maguire（Senior Content Manager）**、**Shunan Liu / Tianhao Xu / David Feng（Editor）**、**Dennis Zhang / Rodder Shi（Product Manager 同时挂名作者）**、**The Newsroom**
- **AI Writer** 是 AInvest 与 AInvest Fintech 技术团队共建的写作 agent（基于多个开源 LLM + 财经编辑微调）；每位 AI Writer 有独立主页 + 人设（Elena Vega, Vivian Qi, Arjun Varma, Sloane Whitaker, Dominic Reid, Nyra Feldon, Jax Mercer, Mira Solano, Caleb Rourke, Marion Ledger, William Carey, Liam Alford, Adrian Hoffner, 12X Valeria, Anders Miro, Riley Serkin, Penny McCormer, Evan Hultman, Adrian Sava, Carina Rivas, Henry Rivers, Eli Grant, Oliver Blake, Samuel Reed, Wesley Park, Rhys Northwood, Julian West, Nathaniel Stone, Philip Carter, Harrison Brooks, Edwin Foster, Julian Cruz, Isaac Lane, Clyde Morgan, Charles Hayes, Albert Fox, Cyrus Cole, Victor Hale, Theodore Quinn, Marcus Lee）
- AI Writer 文章强制 **人审 + 文末 AI 致谢 + 错误致谢机制**
- 与 AIME 整合：AIME 会"识别你的焦点 → 把相关 ticker 钉到 feed"
- KB 主题：`/kb/market-analysis/`

## 6. Markets

- 路由：`/market/`
- 顶部 tab：**Market Trackers / US Stocks / Crypto / ETFs / Options**
- Market Trackers 卡片（5 大指数 + BTC）：SPY / QQQ / DIA / IWM / BTC（含"Pre / 1day"切换）
- US Stocks 区：
  - **Market Momentum** + **Advancers & Decliners**（advancers / decliners 数量）
  - **US Equity Factors**（Value / Core / Growth × Large / Mid / Small 矩阵 → IVE / SPY / IVW / IJJ / IJH / IJK / IWN / IWM / IWO）
  - **Indicator Signals**（DMI / RSI / MACD 的 Dead cross / Golden cross）
  - **Chart Pattern Signals**（Double Bottom / Rounding Bottom 等）
  - **Magic Signal**（CTA → `?benefit=magic_signal&source=market_magicsignal`）
  - **Trend Sight**（CTA → `?benefit=trend_sight&source=market_trendsight`）
  - **Trending Tickers**、**Most Active**、**Most Volatile**、**Stock Gainers**、**Stock Losers**
- Crypto 区：Market Cap Ranking / Most Active / Top Gainers / Top Losers / **Fear & Greed Index**（1 Year / 1 Month / 1 Week）
- ETF 区：ETF Compare / **Top Monthly Inflow**（fund flow 1M）/ Top Monthly Outflow / **Magic Day Trading**（CTA → `?benefit=magic_day_trading&source=market_magicdaytrading`）/ Trending ETFs / Most Traded
- 移动端广告位：`adv-download.4zxma5e430i.png`（下载 App）+ `adv-market-aime.26r63uvakw1.png`（用 Aime 问市场）

## 7. Portfolio（自选）

- 路由：`/watchlist/`
- 自选股追踪；与 Portfolio 仪表板联动
- 配合 AIME+ 的 **AI Portfolio Tracker** 卖点："Compare your results against market and with other users for a comprehensive view of your success."

## 8. Magic Portfolio

- 路由：`/pricing/magic-portfolio/`（独立 landing）
- 标题："Outperform Benchmarks with Weekly AI Rebalancing: 9 Sectors & Theme-Based Portfolios"
- 卖点：AIME 周度再平衡 + 9 个主题板块（trade 风格 + 主题风格）
- 归在 AIME+ 体系下 —— 四档都含；本身 landing 是高客单 SEO hook
- 详细定价见 [`business-model.md`](./business-model.md)

## 9. Trade

- 路由：`/brokers/`
- **不直接执行交易**，列券商并跳转
- 涉及交易页面**必须挂** `Third-Party Brokerage Disclaimer`（见 [`compliance.md`](./compliance.md)）
- 主站 `/brokers/` 首屏 Brokerlist（2026-07）：**Light Horse**（Tradable / Fractional，同集团）、**TradeStation**（Tradable）、**Interactive Brokers**（Equity）、**Public**（Tradable）、**Paper Trading**（Demo Account / Equity & Crypto / Fractional）、**Webull**（Tradable / Equity & Crypto）。页面有 "Show more"，不是完整集成清单。
- 新增 `brokers.ainvest.com` Broker Compare / integration hub（2026-07）：自称 AInvest integrates with **23+ brokerages**，列出 Alpaca / Alpaca Paper / Binance / Coinbase / E*Trade / Kraken / Moomoo / Public / Questrade OAuth / Schwab Trading / Stake Australia / tastytrade / TradeStation / TradeStation Paper / Tradier / Trading212 / Trading212 Practice / Wealthsimple / Webull CA / Webull US / Interactive Brokers / TradeZero / Light Horse 等，含区域、资产类别、订单类型、行情延迟/实时、盘前盘后等能力矩阵。
- Broker Compare 独家奖励（2026-07 抓取）：TradeStation $100 code `AIVTAGRY`；Kraken / Coinbase / Interactive Brokers / Moomoo / Light Horse 等给 1-Month AIME Pro；TradeZero 给 2-Month AIME Pro。以 broker 页面当前条款为准。
- Light Horse 主站活动："Open and fund with $1000.00 or more to receive 2 months AIME+ Pro"；盘前/盘后 4 AM – 8 PM ET
- ⚠️ **2026-06 更新**：**Light Horse Securities, Inc.** 经 LinkedIn 公开信息确认为 **AInvest Holdings Inc. 同集团兄弟公司**（不是真外部第三方），承接 ainvest.com 主交易流。Robinhood / Webull 仍是外部合作方。

## 10. Option+（独立 SKU）

- 路由：`/pricing/` 末段 "Option+ Great Advantages"
- 营销图：`cdn.ainvest.com/kamisAssets/pricing_option_intro.z5aw5109rd.png`
- 解锁内容：
  - **Option Trade Ideas**（YOLO / Swing / Income / Beginners 四种风格）
  - **Real-Time Option Chain Quotes**（实时期权链）
  - **Options Block Monitor**（大单监控）
  - **1 on 1 Options Consultation**（Monthly Session 1v1 咨询）
- 新发现独立子站：`optionpilot.ainvest.com`（AInvest Option Pilot，2026-07 beta）—— institutional-grade options intelligence platform，5,900+ tickers scored daily、650+ data points per ticker、26 strategies、17 setup scenarios、500+ tickers scored every trading day、5-pillar score（Value / Sentiment / Activity / Liquidity / Timing），free during beta。`/idea` 显示 daily curated ideas；`/idea` 文案称 **AIME Premium** 看当日 flow live、Option+ 用户看 15-day old flow、free accounts unlock 30-day archive、60+ day articles public。
- 新发现内容子站：`labs.ainvest.com`（AInvest Option Labs）—— options / unusual activity premium analysis 内容站；与 OptionPilot / Option+ 的关系未在主站明确，引用时标注为独立子站/内容站。
- 合规文案绑定 **OPRA terms + OPRA Professional Certification Requirement**
- 单设备 OPRA 限制：期权行情一次只能绑一台设备
- 详见 [`option-plus.md`](./option-plus.md)

## 11. Prediction Markets（**2026-06 新上线**）

- 路由：`/prediction/`，主导航 icon 写作 **🏆World Cup**
- 定位：**信息聚合层** —— AInvest **不撮合**，**只**展示 + 跳转
- 底层数据：**Polymarket**（跳转带 `?r=ainvestfintech` ref）
- 覆盖类别：FIFA World Cup 2026（默认高亮）+ Trending / Sports / Politics / Crypto / Finance / Tech / Culture / Economy / Climate & Science
- AIME 集成：AIME Briefing（赛前 / 事件前简报，由 AIME 生成 → **AI 输出** → 触发 AI Risk Disclosures 链接）
- 完整规格 + 合规边界 + 命名规则 → 详见 [`prediction-markets.md`](./prediction-markets.md)

## 跨产品 / 跨页面能力（AIME+ 包含的功能模块）

> 16 个 AIME+ 功能模块（Magic Signal / Trend Sight / Peak Seeker / Daily Insight / Magic Day Trading / Candle Advanced / Aime Ratings / FDA Tracker / Multi-Chart View / **Pattern Detector** / KOL Focus / Magic Prophet / Ad Free / Option Block Monitor / Rating Depth Report / **VIP Discord Members Access**）的完整速查、tab 结构、过滤栏、落地页 slug 都在 [`signals.md`](./signals.md)。

## 跨产品 / 跨页面内容能力

- **Featured Data**：Congress trading / Whale activity / Sankey financials（KB 主题 `/kb/featured-data/`）
- **Alert**：Buy-Zone alerts + 实时推送（KB 主题 `/kb/alert/`）
- **Options**：options chain + "Whale Flow" 跟踪（KB 主题 `/kb/options/`）
- **Financial Calendar**：earnings / FOMC / 宏观数据（KB 主题 `/kb/financial-calendar/`）
- **Crypto Market**：技术面 + on-chain（KB 主题 `/kb/crypto/`）

## 移动端 / 桌面 App（下载与跨平台）

- 路由：`/download/`
- **平台**（实测 `/download/` 落地页）：
  - iOS（App Store，**4.8/5 2026-07**，AInvest `/pricing/` 营销页显示；Apple 实时页需单独确认）
  - Android（AInvest `/pricing/` 营销页显示 **4.7/5**；Google Play 实时页抓取显示 **5.0 star / 997 reviews**，2026-07-07；口径不同，引用时带来源）
  - **MacOS**（独立桌面 App）
  - **Windows**（独立桌面 App）
- 卖点："Free real-time stock & ETF quotes, news, and charts" / "Personalize your app with customized Pro and Lite chart modes" / "24 x 7 support"
- 限制：在 app 内购买的单产品老订阅**暂时**无法在 web 端升级到 AIME+ Pro（FAQ 实测）
- App Store 2026-06 更新日志："Ainvest has launched a brand new category – Prediction! You can now find the Prediction tab on the market..."
- MacOS / Windows 桌面 App 的功能是否 100% 等同 web 端**未公开声明** —— agent 不要假设

## Screener ETF 类别（13 个 category，与股票并行的另一侧，共 86 presets）

ETF 也有独立 Screener，路径 `/screener/etfs/`，13 个 category（含 "For You" tab，但 ETF 侧 "For You" 无独立 spotlight 段，直接进 Income Strategies）：

| Category | 路径 | 典型 preset |
|----------|------|-------------|
| For You | `/screener/etfs/` | 推荐（无独立 spotlight 段） |
| Income Strategies | `/screener/etfs/category-income-strategies/` | Monthly Dividend / Covered-Call Income / High-Dividend Yield / Preferred Stock / Multi Asset Income（5 presets） |
| Performance & Momentum | `/screener/etfs/category-performance-momentum/` | YTD Momentum Leader / Sector Relative Strength / Breakout+Volume / 5-Day Momentum / Low Volatility / Premium/Discount 等（11 presets） |
| Fixed Income & Rates | `/screener/etfs/category-fixed-income-rates/` | IG Corporate / Tax-Free Municipal / High-Yield Junk / Floating Rate / Short-Duration Treasury / Emerging Market Bond / Inflation Protected（7 presets） |
| Factor & Smart Beta | `/screener/etfs/category-factor-smart-beta/` | Momentum / Deep-Value / Quality / Low-Vol / Multi-Factor / Small Size / Dividend Growth / Shareholder Yield（8 presets） |
| Core Portfolio | `/screener/etfs/category-core-portfolio/` | Total World / Total US / S&P 500 / Target-Date / Total International / Balanced / Core Bond / Low-Cost Broad（8 presets） |
| Thematic Investing | `/screener/etfs/category-thematic-investing/` | Cybersecurity / Space / AI / Clean Energy & Solar / EV Supply Chain / Defense & Aerospace / Blockchain（7 presets） |
| Sector & Industry | `/screener/etfs/category-section-industry/` | Semiconductor / US Financial / Healthcare Innovator / Real-Estate REIT / Technology Leader（5 presets） |
| ESG & Sustainability | `/screener/etfs/category-esg-sustainability/` | Fossil Fuel Free / Low-Carbon / Gender Diversity / Green Bond / ESG Leaders（5 presets） |
| Commodity & Real Assets | `/screener/etfs/category-commodity-real-assets/` | Energy / Global Infrastructure / Agriculture / Broad Commodity / Physical Gold（5 presets） |
| Flows & Sentiment | `/screener/etfs/category-flows-sentiment/` | New Launch Traction / Single Day Spike / Risk-On Rotation / Unusual Inflows / Sector Rotation / Flow Reversal / Hot-Money Outflows 等（11 presets） |
| International & Regional | `/screener/etfs/category-international-regional/` | Asia-Pacific / Core Emerging / Currency-Hedged / Japan / Europe Large-Cap / China Tech（6 presets） |
| Leveraged & Inverse | `/screener/etfs/category-leveraged-inverse/` | Leveraged Semi / 2x Nasdaq / 3x S&P / Leveraged Crude / Volatility / Treasury / Inverse S&P（8 presets） |

→ ETF screener 与 stock screener **结构平行**，但 category 名称差异不小（ETF 偏 Factor / Flows / Thematic，stock 偏 Congress / Technical Patterns / Corporate Events）。每个 preset 卡片同样显示 **Symbol 数 + 3-Month Return %**。ETF 侧全 86 presets 卡片形态统一（股票侧有 3 种形态）。

## 反馈 / 客服入口

- 路由：`/feedback/`
- 字段：Feedback Type（Suggestion / Issue / Other）+ 文本（300 字限）+ 上传图
- 客服部门分流（`contact.ainvest.com` 4 类）：
  - **Client Support**（账户 / 平台 / 一般咨询）
  - **Content Inquiry**（文章 / 研究 / 教育材料）
  - **Marketing / Advertisement**（广告 / 营销合作）
  - **Business Partnership**（战略合作 / 业务发展）
- 标注 "Available 24/7" / "Quick response time"

## 产品间的依赖关系

```text
       AIME (核心 AI 引擎)
       /  |  \  \   \   \   \   \
      /   |   \   \   \   \   \   \
   Aime  AI Charts Screener Newswire  Markets  Portfolio  Magic Portfolio
                                  ↘         ↘          ↘        ↘
                                   Trade ──→ Option+ (AIME+ 内 SKU)
                                   Prediction Markets (Polymarket 数据 + AIME Briefing)
```

AIME 是横切能力，被各产品调用；其余产品相互之间通过共享数据（自选股、新闻、价格）联动。Option+ 是 AIME+ 体系内的独立数据 SKU。Prediction Markets 是**信息聚合层**（不订阅、不撮合），叠加在 AIME Briefing 输出之上。

## 命名硬规则

- **Aime**（首字母大写 + 其余小写）—— **不写** "AIME"（用户面）
- 内部 token / 引擎名仍是 **AIME**（AInvest Market Engine）
- 其它产品名首字母大写、避免连字符或下划线：Screener、Newswire、Super Charts、Markets、Portfolio、Magic Portfolio、Trade、**Prediction Markets**、Option+
- 订阅品牌 **AIME+**（注意带 + 号）—— 四档是 "AIME+ Basic / AIME+ Pro / AIME+ Premium / AIME+ Ultra"
- 模块名首字母大写：Magic Signal、Trend Sight、Peak Seeker、Daily Insight、Magic Day Trading、Candle Advanced、Aime Ratings、FDA Tracker、Multi-Chart View、**Pattern Detector**、KOL Focus、Magic Prophet、Option Block Monitor、Rating Depth Report、**VIP Discord Members Access**
- "AI Writer" 是产品化的写作 agent 集合名，不是单个产品
- "Prediction Markets" 全名，**不**写成 "Prediction" / "Polymarket Tracker" / "Betting"
- Polymarket 是第三方平台名，首字母大写，写跳转时带 `?r=ainvestfintech`
