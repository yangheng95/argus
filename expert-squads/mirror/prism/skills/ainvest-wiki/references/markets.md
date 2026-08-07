---
type: markets
last-updated: 2026-07-07
sources:
  - ainvest.com 首页 gainers/losers 列表
  - ainvest.com/market/ (Market Trackers / US Stocks / Crypto / ETFs / Options 全 tab)
  - ainvest.com/screener/stocks/ + category- 子页
  - ainvest.com/kb
---

# Markets — 覆盖的资产与市场

AInvest 是 **美股 + 加密 + ETF + 期权** 多资产并行的平台，正在向"全球市场（World News / Macro）"扩展。

## 资产类别

| 类别 | 已覆盖 | 备注 |
|------|--------|------|
| 美股 | ✅ NASDAQ / NYSE / AMEX | 主力，首页"Stocks gainers / losers" |
| 加密货币 | ✅ 多交易所（Binance 等） | 独立子域 `crypto.ainvest.com`，URL 带 `?exchange=BINANCE` |
| 期权 | ✅ 实时期权链 + Option+ SKU | OPRA 合规，单设备绑定 |
| ETF | ✅ 独立列表 + 资金流榜单 | 路径 `/etfs/{EXCHANGE}-{TICKER}/` |
| 期货 / 外汇 / 衍生品 | 🟡 间接（news 偶有） | 未在产品矩阵直接列 |
| 全球宏观 | 🟡 进行中 | Market Dashboard 包含 World News / Macro Insights |
| 国会议员交易 / 鲸鱼活动 | ✅ Featured Data + Screener 16 类别 | `/kb/featured-data/` |
| 加密衍生情绪 | ✅ Fear & Greed Index | market 页 Crypto tab，1Y/1M/1W 切换 |

## 美股

- 列表覆盖：小盘 / 中盘 / 大盘
- 链接范式：`/stocks/{EXCHANGE}-{TICKER}/`（如 `/stocks/NASDAQ-AAPL/`）
- Market 页 US Stocks 区子模块：
  - **Market Momentum**（上涨下跌家数）
  - **Advancers & Decliners**（advancers / decliners 数量）
  - **US Equity Factors** 矩阵（Value / Core / Growth × Large / Mid / Small → IVE / SPY / IVW / IJJ / IJH / IJK / IWN / IWM / IWO）
  - **Indicator Signals**（DMI / RSI / MACD 的 Dead cross / Golden cross 实时滚动）
  - **Chart Pattern Signals**（Double Bottom / Rounding Bottom / Head & Shoulders 等）
  - **Magic Signal**（CTA → AIME+ 解锁）
  - **Trend Sight**（CTA → AIME+ 解锁）
  - **Trending Tickers**、**Most Active**、**Most Volatile**、**Stock Gainers**、**Stock Losers**
- 首页 gainers / losers 是动态数据，**agent 引用具体数字会过期**，建议改写为相对描述（"三只 >200% 涨幅 / 三只 -40%~-50% 跌幅"）

## ETF

- 独立列表：`/etfs/`
- 单 ETF 详情：`/etfs/{EXCHANGE}-{TICKER}/`（如 `/etfs/ARCA-SPY/`）
- Market 页 ETF 区：
  - **ETF Compare**（`/compare/`）
  - **Top Monthly Inflow**（fund flow 1M，金额）
  - **Top Monthly Outflow**
  - **Magic Day Trading**（CTA → AIME+ 解锁）
  - **Trending ETFs**、**Most Traded**
- 图标路径：`/icon/us/etf/{TICKER}.png`（与美股图标路径不同，多一层 `/etf/`）

## 加密

- 独立子域：`crypto.ainvest.com`
- 链接范式：`https://crypto.ainvest.com/{SYMBOL}/?exchange={EXCHANGE}`
- 交易所标识（已知）：`BINANCE`
- 行情指标：USDT 报价
- Market 页 Crypto 区：
  - **Market Cap Ranking**（BTC / ETH / BNB / USDC / XRP 等）
  - **Most Active**
  - **Top Gainers** / **Top Losers**
  - **Fear & Greed Index**（1 Year / 1 Month / 1 Week 切换）
- KB 主题：`/kb/crypto/`，强调"技术面 + on-chain"

## 期权

- KB 主题：`/kb/options/`
- 卖点：options chain + "Whale Flow" tracker（跟踪机构资金流）
- 风控：calculate risk/reward before you trade
- 付费 SKU：**Option+**（独立订阅，含 1v1 咨询 + 实时期权链）
- 监控信号：**Option Block Monitor**（AIME+ 四档都含）
- OPRA 合规：**单设备同时只能绑定一次期权行情**

## Featured Data（特色数据）

| 数据 | 说明 |
|------|------|
| Congress trading | 美国国会议员的交易披露；screener 内置 **7 位议员**（2026-07-07 实测：Nancy Pelosi / Marjorie Taylor Greene / Josh S. Gottheimer / Debbie Wasserman Schultz / Markwayne Mullin / Robert P. Bresnahan / Susie Lee）独立 category |
| Whale activity | 鲸鱼（机构/大户）异动 |
| Sankey financials | 资金流向 Sankey 图 |
| Institutional Activity | screener 独立 category："Analyst & Institutional Activity" |
| ETF Fund Flows | 月度资金流入 / 流出榜单 |

## Screener 主题分类（**16 stock + 13 ETF = 29 categories**，**174 stock + 86 ETF = 260 presets**，2026-07-07 实测）

### 股票侧（16 categories，路径 `/screener/stocks/category-{slug}/`，共 174 presets）

| Category | 主题数 | 备注 |
|----------|-----------|------|
| For You / Weekly Spotlight | 5 | AI Enablers / AI Monetizers / **Greenland Acquisition Play** / Earnings Beat Breadth / Top Meme Stocks（仅标题 + Symbols，无 3-Month Return） |
| Thematic & Sector Rotation | 13 | GLP-1 / 基建 / 贸易战受益 / 美联储利率敏感 / 制造业 PMI / Cyclical Sector / Election-Impact / Rate Cut Beneficiary / Defensive Sector / Dollar Weakness / Onshoring / Reflation / Manufacturing PMI 等 |
| Congress Trading | 7 | 按议员拆分（**7 位**，见 Featured Data 段）；卡片仅标题无数据 |
| Swing Trading | 17 | Reddit Meme / Twitter Trending / 重磅内部人买入 / Breakout Flag / Mean Reversion / Volatility Squeeze / Gap Fill / Oversold Rebound 等 |
| Technical Patterns | 16 | Bullish Engulfing / Cup & Handle / Head & Shoulders / MACD Bullish Crossover / Golden Cross / Bollinger Band / Flag & Pennant / Double Bottom 等 |
| Momentum Stocks | 11 | Low Float Momentum / 52-Week High / Pre-Market Movers / High Relative Strength / Pullback Leaders / Recent Short Squeeze 等 |
| Dividend Investing | 11 | High Yield / REIT / US Dividend Growth Leaders / UK Dividend Aristocrat / Special Dividend / Recent Hike 等 |
| Corporate Events & Catalysts | 17 | Upcoming Earnings / IPO / M&A / Buyback / Stock Splits / Spin-Offs / CPI/PPI Sensitive / Activist Targets / Regulatory Watchlist 等 |
| AI Screeners | 13 | AI Enablers / AI Monetizers / Earnings Beat Breadth / Top Meme / Next-Gen Smart Beta / AI Earnings Revision / AI Insider Activity / Sentiment Divergence 等（⚠️ 站点有 typo："Unsual Correlation Stocks" 应为 "Unusual"） |
| Options & Derivatives Trading | 4 | 期权衍生品 |
| Robotics & Hardware Stocks | 4 | 机器人 / 硬件 |
| Analyst & Institutional Activity | 5 | 分析师 / 机构动作 |
| Growth & Innovation Stocks | 20 | 增长 / 创新（**最大单类**） |
| International & Emerging Markets | 7 | 国际 / 新兴市场 |
| Clean Energy & Sustainability | 12 | 清洁能源 / ESG |
| Value Investing | 12 | 价值投资 |

### ETF 侧（13 categories，路径 `/screener/etfs/category-{slug}/`，共 86 presets）

| Category | 主题数 | 备注 |
|----------|-----------|------|
| Income Strategies | 5 | Monthly Dividend / Covered-Call / High-Dividend Yield / Preferred Stock / Multi-Asset |
| Performance & Momentum | 11 | YTD Momentum / Sector Relative Strength / Breakout+Volume / 5-Day Momentum / Low Volatility / Premium/Discount 等 |
| Fixed Income & Rates | 7 | IG Corporate / Tax-Free Municipal / High-Yield Junk / Floating Rate / Short-Duration Treasury / Emerging Market Bond / Inflation Protected |
| Factor & Smart Beta | 8 | Momentum / Deep-Value / Quality / Low-Vol / Multi-Factor / Small Size / Dividend Growth / Shareholder Yield |
| Core Portfolio | 8 | Total World / Total US / S&P 500 / Target-Date / Total International / Balanced / Core Bond / Low-Cost Broad |
| Thematic Investing | 7 | Cybersecurity / Space / AI / Clean Energy / EV / Defense / Blockchain |
| Sector & Industry | 5 | Semiconductor / Tech Leader / US Financial / REIT / Healthcare |
| ESG & Sustainability | 5 | Low-Carbon / Fossil Fuel Free / Gender Diversity / Green Bond / ESG Leaders |
| Commodity & Real Assets | 5 | Global Infrastructure / Energy / Agriculture / Broad Commodity / Physical Gold |
| Flows & Sentiment | 11 | New Launch / Single Day Spike / Risk-On Rotation / Unusual Inflows / Sector Rotation / Flow Reversal / Hot-Money Outflows / Contrarian / Persistent 4-Week 等 |
| International & Regional | 6 | Asia-Pacific / Emerging / Currency-Hedged / Japan / Europe / China Tech |
| Leveraged & Inverse | 8 | Leveraged Semi / 2x Nasdaq / 3x S&P / Crude / Volatility / Treasury / Inverse S&P |

→ 每个 preset 卡片显示 **Symbol 数量 + 3-Month Return %**。**两边合计 174 + 86 = 260 presets**（"27 ready made" / "100+" 是早期文案，**已过时**）。股票侧有 3 种卡片形态：标准（标题+Symbols+Return，162 个）、Weekly Spotlight（标题+Symbols，5 个）、议员（仅标题，7 个）；ETF 侧全统一。

## 配色规则（关键）

来自 `DESIGN.md`：

| 资产 | 涨 | 跌 |
|------|----|----|
| 股票 | `price-up`（`#009B67` / `#00A36D`） | `price-down`（`#FF381A` / `#FF4A2E`） |
| 加密 | `price-crypto-up`（`#2DD0D0`） | `price-crypto-down`（`#E9528F`） |
| 平盘 | `price-even`（light `#000` / dark `#FFF`） | — |

**为什么要分开？** 加密色和股票色刻意区分，避免用户在快速扫盘时把"加密涨"误读为"股票涨"。

→ 详见 [`design-system.md`](./design-system.md) 和 `DESIGN.md`

## 反向模式

`DESIGN.md` 提到 `stock-color-mode=reverse`，在某些市场习惯下（中国大陆、台湾等）涨跌色会反过来。涉及多地区时记得检查这一开关。
