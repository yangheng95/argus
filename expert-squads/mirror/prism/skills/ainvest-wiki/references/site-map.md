---
type: site-map
last-updated: 2026-07-07
sources:
  - ainvest.com 实际抓取的导航和链接
  - ainvest.com/screener/, /market/, /news/, /pricing/, /feedback/, /download/, **/prediction/**
  - **promo.ainvest.com**（**2026-06 新发现**，Public.com 6-mo Premium 活动页）
  - **linkedin.com/company/ainvestofficial**（AINVEST HOLDINGS INC. 主页，2026-06）
---

# Site Map — 域名、子站、路由

## 域名总览

| 域名 | 类型 | 用途 |
|------|------|------|
| `ainvest.com` | 主站 | Web 端、登录/注册、订阅、内容 |
| `chart.ainvest.com` | 子域 | AI Charts 独立产品（独立子域） |
| `crypto.ainvest.com` | 子域 | 加密行情 |
| `career.ainvest.com` | 子域 | 招聘 |
| `affiliate.ainvest.com` | 子域 | 联盟计划（3 档佣金，详见 [`affiliate.md`](./affiliate.md)） |
| `contact.ainvest.com` | 子域 | 联系表单（4 部门：Client Support / Content Inquiry / Marketing / Business Partnership） |
| `promo.ainvest.com` | 子域 | **2026-06 新** —— 营销活动页（已知：`/public-open-account-get-aime-premium` —— Public.com 开户 6 个月 Premium 赠送活动） |
| `cdn.ainvest.com` | CDN | 静态资源、合规 PDF |
| `docs.ainvest.com` | 子域 | **2026-06 新** —— 开发者 API 文档站（REST API，6 模块 + OpenAPI specs + MCP server 配置） |
| `openapi.ainvest.com` | 子域 | **2026-06 新** —— API 生产 endpoint（`/open` 路径，需 API key） |
| `docsmcp.ainvest.com` | 子域 | **2026-06 新** —— MCP server（Model Context Protocol，供 Claude 等 AI 调用 AInvest API） |
| `lighthorse.io` | 独立域名 | **2026-06 新** —— Light Horse Securities 独立站（券商，API docs + pricing + terms + app downloads） |
| `client.lighthorse.io` | 独立域名子站 | **2026-07-07 实测** —— Light Horse 开户 onboarding 入口：`client.lighthorse.io/onboarding/?utm_source=ainvest_app`（`/brokers/light-horse/` "Open Account" 按钮跳转目标） |
| `insight.ainvest.com` | CDN 路径前缀 | affiliate 页 logo 引用（`cdn.ainvest.com/insight/ainvest-logo.png`） |
| `polymarket.com/?r=ainvestfintech` | 第三方跳转 | **Prediction Markets 跳转目标**，带 AInvest 联盟 ref |
| `form.typeform.com` | 第三方表单 | 文章页 "Report an Issue" 入口：`/to/V5GRCO3T?typeform-source=contact.ainvest.com` |
| `linkedin.com/company/ainvestofficial` | 第三方公司页 | **AINVEST HOLDINGS INC.** 主页（7,127 followers，2026-06） |

## 主站路由（`ainvest.com`）

### 顶层页面

| 路径 | 用途 |
|------|------|
| `/` | 首页 |
| `/aime/` | Aime 介绍（meta title: "AI Investment Chat - Robo-Advisor Assistant - Aime by AInvest"） |
| `/chat/` | Aime 聊天入口（带 `?comefrom=` 来源参数） |
| `/market/` | 行情大盘（**Market Trackers / US Stocks / Crypto / ETFs / Options** —— 5 个顶层 tab，2026-07-07 实测；Options 是**独立顶层 tab**，不再仅是 ETF 页子段） |
| `/watchlist/` | 自选股 / Portfolio |
| `/news/` | 新闻列表（Top News / Newswire / Expert Voices / Articles / For You / Shorts / Videos / Learn） |
| `/news/wire/` | Newswire 实时要点 |
| `/news/author/` | 编辑团队 + 贡献者 + AI Writer |
| `/news/author/{slug}/` | 单个作者 / AI agent 主页（例：`/news/author/adam-shapiro/`、`/news/author/elena-vega/`） |
| `/news/{slug}-{YYMM}/` | 单篇文章（例：`/news/...-2606/`）—— breadcrumb: News / Sector / Stock ticker / Articles Details；含 origin-proof token + pixel + World Cup promo banner + author card + Editorial Disclosure |
| `/news/deep-topic/topic/{slug}-{YYMM}/` | **2026-07-07 新** Deep Topic 专题聚合页（例：`/news/deep-topic/topic/samsungq2-2607/`，跨多篇相关文章聚合） |
| `/news/sector/{slug}/` | **2026-07-07 新** 行业筛选新闻（例：`/news/sector/information-technology/`） |
| `/news/stock/{EXCHANGE}-{TICKER}/` | **2026-07-07 新** 个股筛选新闻（例：`/news/stock/NASDAQ-MSFT/`） |
| `/brokers/` | 券商列表 / 跳交易（首屏 2026-07-07：Light Horse / TradeStation / Interactive Brokers / Public / Paper Trading / Webull，含 "Show more"；同集团 Light Horse Securities 是主承接方，详见 [`company.md`](./company.md)） |
| `/brokers/{broker}/` | 单个券商详情页（例：`/brokers/light-horse/`、`/brokers/tradestation/`、`/brokers/interactive-brokers/`、`/brokers/public/`、`/brokers/webull/`）—— 含 Aime Broker Reviews 评分 + 开户 / Connect 入口 |
| `brokers.ainvest.com` | **2026-07 新** Broker Compare / 集成 hub（自称 23+ brokerages 能力矩阵，详见 [`products.md`](./products.md) Trade 段） |
| `/prediction/` | **2026-06 新** Prediction Markets（Polymarket 数据聚合 + AIME Briefing，详见 [`prediction-markets.md`](./prediction-markets.md)） |
| `/stocks/` | 美股列表 |
| `/stocks/{EXCHANGE}-{TICKER}/` | 股票详情页（例：`/stocks/NASDAQ-AAPL/`） |
| `/etfs/` | ETF 列表 |
| `/etfs/{EXCHANGE}-{TICKER}/` | ETF 详情页（例：`/etfs/ARCA-SPY/`） |
| `/compare/` | ETF Compare |
| `/screener/` | AI Screener 入口 |
| `/screener/stocks/` | 股票筛选（带 16 个 category 入口 + 实时筛选） |
| `/screener/etfs/` | ETF 筛选（13 个 category） |
| `/screener/stocks/category-{slug}/` | 主题分类页（例：`/screener/stocks/category-congress-trading/`） |
| `/screener/stocks/{preset-slug}/` | 单个预设策略页（例：`/screener/stocks/bullish-engulfing-candlestick/`） |
| `/chart?symbol={EXCHANGE}-{TICKER}` | Super Charts（例：`/chart?symbol=NASDAQ-AAPL`） |
| `/pricing/` | AIME+ 订阅页（4 档：Basic / Pro / Premium / Ultra，Monthly / Yearly）+ Option+ 段 |
| `/pricing/magic-portfolio/` | Magic Portfolio 独立 landing |
| `/pricing/benefits/{slug}/?source=...` | 单个 AIME+ 功能 landing（例：`/pricing/benefits/magic-signal/?source=marketpage_magicsignal`） |
| `/download/` | App 下载推广（iOS / Android / **MacOS / Windows**） |
| `/feedback/` | 用户反馈表单（Suggestion / Issue / Other + 上传图） |
| `/kb/` | 知识库入口（10 主题，详见 [`kb.md`](./kb.md)） |
| `/kb/{topic}/` | KB 子主题 |
| `/about/` | 公司介绍（meta title: "About Our Mission to Democratize Investing with AI - AInvest"） |
| `/contact/` | 重定向到 `contact.ainvest.com`（子站） |

### Pricing `?benefit=` 参数

`/pricing/?benefit=...&source=...`，已知值：

| benefit | 关联功能 | 典型 source |
|---------|---------|-------------|
| `magic_portfolio` | Magic Portfolio 订阅 | `pricing_magic_portfolio_home` |
| `magic_signal` | Magic Signal | `market_magicsignal` |
| `trend_sight` | Trend Sight | `market_trendsight` |
| `magic_day_trading` | Magic Day Trading | `market_magicdaytrading` |

### Chat `?comefrom=` 参数

`/chat/?comefrom=...`，已知值：

| 值 | 触发位置 |
|----|---------|
| `WebainvestFooter` | 首页 / 全站 footer "Aime" 链接 |
| `WebainvestNavirobot` | pricing FAQ 中的 Aime "live support" 入口 |
| `WebainvestHome` | 首页 CTA（如适用） |

### Market 子页

| 路径 | 用途 |
|------|------|
| `/market/stocks-indicator-signals` | 指标信号（DMI / RSI / MACD Dead / Golden cross） |
| `/market/stocks-chart-pattern-signals` | 形态信号（Double Bottom / Rounding Bottom 等） |
| `/market/stocks-trending-tickers` | 热门个股 |
| `/market/stocks-most-active` | 最活跃 |
| `/market/stocks-most-volatile` | 最波动 |
| `/market/stocks-top-gainers` | 涨幅榜 |
| `/market/stocks-top-losers` | 跌幅榜 |
| `/market/crypto-large-cap` | 加密市值榜 |
| `/market/crypto-most-active` | 加密最活跃 |
| `/market/crypto-top-gainers` | 加密涨幅榜 |
| `/market/crypto-top-losers` | 加密跌幅榜 |
| `/market/etfs-top-monthly-inflow` | ETF 月度资金流入榜 |
| `/market/etfs-top-monthly-outflow` | ETF 月度资金流出榜 |
| `/market/etfs-trending-etfs` | 热门 ETF |
| `/market/etfs-most-traded` | 最活跃 ETF |
| `/market/etfs-best-performing` | 3 年回报最佳 |
| `/market/etfs-largest-aum` | AUM 最大 |
| `/market/etfs-highest-nav-returns` | NAV 回报最高 |
| `/market/etfs-highest-aum-growth` | AUM 增长最快 |
| `/market/etfs-high-dividend-yield` | 高股息率 |
| `/market/etfs-ytd` | 年初至今 |
| `/market/etfs-low-cost` | 低费率 |
| `/market/etfs-top-gainers` | 涨幅榜 |
| `/market/etfs-top-losers` | 跌幅榜 |
| `/market/etfs-pre-market-most-active` | 盘前最活跃 |
| `/market/etfs-pre-market-gainers` | 盘前涨幅 |
| `/market/etfs-pre-market-losers` | 盘前跌幅 |
| `/market/etfs-after-hours-most-active` | 盘后最活跃 |
| `/market/etfs-after-hours-gainers` | 盘后涨幅 |
| `/market/etfs-after-hours-losers` | 盘后跌幅 |
| `/market/etfs-52w-high` | 52 周新高 |
| `/market/etfs-near-high` | 接近 52 周高 |
| `/market/etfs-52w-low` | 52 周新低 |
| `/market/etfs-near-low` | 接近 52 周低 |
| `/market/etfs-all-time-high` | 历史新高 |
| `/market/etfs-all-time-low` | 历史新低 |
| `/market/etfs-highest-beta` | 最高 beta |
| `/market/etfs-highest-expense-ratio` | 最高费率 |
| `/market/etfs/options` | Options tab（**实际是 ETF 页面的 Options 子段**） |

> 备注：`/market/options/` 实际是 `/market/etfs/options`（ETF 页面下的 Options 段落），但 2026-07-07 实测 `/market/` 顶 tab 已新增 **Options 作为独立顶层 tab**。Screener 那边另有 `/screener/stocks/category-options-derivatives-trading/`。

### Screener 子页

| 路径 | 用途 |
|------|------|
| `/screener/stocks/` | 股票筛选（16 categories） |
| `/screener/stocks/category-{slug}/` | 主题分类页 |
| `/screener/stocks/{preset-slug}/` | 单个 preset 页 |
| `/screener/etfs/` | ETF 筛选（13 categories） |
| `/screener/etfs/category-{slug}/` | ETF 主题分类页 |
| `/screener/etfs/{preset-slug}/` | ETF 单个 preset 页 |

→ 共 **16 stock + 13 ETF = 29 categories**。每个 preset 卡片显示 Symbol 数 + 3-Month Return %。

### Pricing 落地页

| 路径 | 用途 |
|------|------|
| `/pricing/` | AIME+ 订阅 + Option+ 段 |
| `/pricing/magic-portfolio/` | Magic Portfolio 独立 landing |
| `/pricing/benefits/{slug}/` | 单个 AIME+ 模块落地（已知：`magic-signal` / `trend-sight` / `magic-day-trading` / `magic-portfolio`） |

### KB 主题清单

| 主题 | 路径 |
|------|------|
| Market Analysis | `/kb/market-analysis/` |
| AI Screener | `/kb/ai-screener/` |
| Meet Aime | `/kb/aime/` |
| Premium Subscription | `/kb/subscription/` |
| Alert | `/kb/alert/` |
| Featured Data | `/kb/featured-data/` |
| Crypto Market | `/kb/crypto/` |
| Options | `/kb/options/` |
| Financial Calendar | `/kb/financial-calendar/` |
| Superchart | `/kb/superchart/` |

> 警示：当前 KB 入口页 `/kb/` 的 footer "AInvest AI Risk Disclosures" 链接还指向 `Ainvest-AI-Risk-Disclosures.pdf`（旧名，已 404）。**agent 实现 AI disclaimer 跳转时以 `Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf` 为准**，不要照抄 KB 入口的旧链接。

## 子域路由

### `chart.ainvest.com`
- `/` — 图表首页
- `/{EXCHANGE}-{TICKER}/` — 单标的图表页（例：`/NASDAQ-AAPL/`）

### `crypto.ainvest.com`
- `/` — 加密行情首页
- `/{SYMBOL}/?exchange={EXCHANGE}` — 单币种页（例：`/JTOUSDT/?exchange=BINANCE`）

### `career.ainvest.com`
- `/` — 招聘列表
- 锚点 `#retailtrading` / `#growthmanager` / `#socialmediaspecialist` / `#communitymanager` / `#annotator`

### `affiliate.ainvest.com`
- `/` — 联盟计划页（具体子路径未在抓取中确认）

### `contact.ainvest.com`
- `/` — 联系表单

## CDN 资源（`cdn.ainvest.com`）

### 法律文件 `/agreement/`

| 路径 | 状态 |
|------|------|
| `/agreement/Ainvest-Fintech-Inc-Privacy-Policy.pdf` | ✅ 200 |
| `/agreement/Ainvest-Fintech-Terms-of-Use.pdf` | ✅ 200 |
| `/agreement/AIME-Terms-of-Use.pdf` | ✅ 200 |
| `/agreement/Third-Party-Brokerage-Disclaimer.pdf` | ✅ 200 |
| `/agreement/Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf` | ✅ 200（**线上最新，footer / pricing / magic-portfolio 全部指向此**） |
| `/agreement/Ainvest-AI-Risk-Disclosures.pdf` | ⚠️ KB 旧链；其他页面已 404，**别再用作 AI disclaimer 链接** |
| `/agreement/AInvest-AI-Risk-Disclosures.pdf` | ❌ 404（已 2026-06 实测） |

### 品牌资产 `/kamisAssets/`

文件命名带 hash 后缀，举例：

| 文件 | 用途 |
|------|------|
| `kamisAssets/aime.bpo45whq8xi.png` | Aime 形象图 |
| `kamisAssets/icon_menu_logo_dark.wp20iq3a1ms.png` | 主 logo |
| `kamisAssets/Googleadd-1.qb2n27sjewf.png` | Google Ads 横幅 |
| `kamisAssets/discard.xxesa164dog.png` | Discord icon |
| `kamisAssets/linkedin.p2f3clfqcu.png` | LinkedIn icon |
| `kamisAssets/youtube.nx3tlrbzrf.png` | YouTube icon |
| `kamisAssets/ins.r538eqfoyn.png` | Instagram icon |
| `kamisAssets/twitter.8dk0zjrc8ou.png` | Twitter icon |
| `kamisAssets/tiktok.2dm7r1gi12w.png` | TikTok icon |
| `kamisAssets/Group2147203012.powy3idmdu.png` | About 页 hero 图 |
| `kamisAssets/pricing_option_intro.z5aw5109rd.png` | pricing 页 Option+ 介绍图 |
| `kamisAssets/adv-download.4zxma5e430i.png` | market 页"下载 App"广告位（article 页也用） |
| `kamisAssets/adv-market-aime.26r63uvakw1.png` | market 页"用 Aime"广告位 |
| `kamisAssets/adv-lite-aime.h7rk9lwd314.png` | article 页"Ask Aime Lite"广告位（news 页脚） |
| `kamisAssets/ainvest-stock-etf-crypto.mbkns3210dl.png` | screener 卡片通用封面 |

### 行情图标 `/icon/`

| 路径 | 用途 |
|------|------|
| `/icon/us/{TICKER}.png` | 美股图标（例：`/icon/us/AAPL.png`） |
| `/icon/us/etf/{TICKER}.png` | ETF 图标（例：`/icon/us/etf/SPY.png`） |
| `/icon/crypto/{SYMBOL}USDT.png` | 加密币种图标（例：`/icon/crypto/BTCUSDT.png`） |

### 媒体资产 `/yyzt/upload/common/`

screener 主题封面图（动态生成）：

- 范例：`https://cdn.ainvest.com/yyzt/upload/common/{UUID}.png?format=webp&width=636&height=356`
- 用于 screener preset / 主题卡片背景

### 社交头像 `/social/account/portraits/`

`/news/author/` 头像（如 `Logo_Adam_Shapiro.png`、`jeremy.png`、`gavin_a7763afe1767770425714.jpeg`）和 AI Writer 头像（如 `elena.png`、`author_carey.png`）。

## URL 模式注意事项

- 股票 / ETF ticker 大小写：URL 里**全大写**（`AAPL` 而不是 `aapl`）
- 路径分隔符：用 `/` 而不是 `-`（除了 ticker 连接处和日期戳）
- 查询参数：`?exchange=` 用在加密页，`?symbol=` 用在 chart 页
- chat 来源追踪：`?comefrom=`（例：`/chat/?comefrom=WebainvestFooter`）
- pricing 功能落地：`?benefit=...&source=...`
- 文章 slug：kebab-case + `-YYMM` 月份后缀（`/news/...-2606/`）
- 作者 slug：kebab-case（`/news/author/adam-shapiro/`、`/news/author/elena-vega/`）
- screener preset slug：kebab-case（`/screener/stocks/cup-handle-breakouts/`）
- KB slug：kebab-case（`/kb/market-analysis/`）

## 跳转/外链

- 交易执行 → 第三方券商（站外）
- 招聘 → `career.ainvest.com`
- 法务文件 → `cdn.ainvest.com/agreement/*.pdf`
- 联盟注册 → `affiliate.ainvest.com`
- 反馈 / 取消订阅 → `/feedback/`（web 端）；iOS / Android → 各自应用商店

## 不要做

- ❌ 不要在主站路径里硬编码 `cdn.ainvest.com` —— 走 `<CDN_BASE>` 环境变量
- ❌ 不要在没有 disclaimer 链接的情况下跳第三方券商
- ❌ 不要把 chat URL 的 `comefrom` 参数用作安全/权限判断（仅是来源追踪）
- ❌ 不要引用 `AInvest-AI-Risk-Disclosures.pdf`（404）做 AI disclaimer 链接
- ❌ 不要给订阅按钮拼写 OPRA 之外的合规文案（Option+ 必含 OPRA terms + OPRA Professional Certification Requirement）
