---
type: glossary
last-updated: 2026-07-07
---

# Glossary — 术语表

> 给 AI agent 用的术语统一表。改文案 / 起变量名 / 写代码时**先查这里**。
>
> 跨文件索引：
> - 公司 / 业务 → [`company.md`](./company.md), [`business-model.md`](./business-model.md)
> - 产品矩阵 → [`products.md`](./products.md)
> - **AIME+ 16 个功能模块** → [`signals.md`](./signals.md)
> - **Option+ / OPRA** → [`option-plus.md`](./option-plus.md)
> - **编辑 + AI Writer 名册** → [`editorial.md`](./editorial.md)
> - **KB 10 主题** → [`kb.md`](./kb.md)
> - **联盟 3 档** → [`affiliate.md`](./affiliate.md)
> - 合规 / 域名 / 视觉 token → [`compliance.md`](./compliance.md), [`site-map.md`](./site-map.md), [`design-system.md`](./design-system.md)

## 品牌

| 术语 | 用法 | 注意 |
|------|------|------|
| **AInvest** | 主品牌名 | 永远写作 "AInvest"（i 在中间，区分 "A Invest"）。代码/域名里也用 `ainvest` |
| **AInvest Fintech Inc.** | 公司全名 | 第一次提及用全名，之后用 "AInvest" |
| **AInvest Holdings Inc.** | 母公司 | 包含 AInvest Fintech Inc. + Light Horse Securities, Inc.（2026-06 LinkedIn 实测披露） |
| **Light Horse Securities, Inc.** | 兄弟公司（券商） | ainvest.com 的主券商合作方（同集团，不是纯外部第三方） |
| **Aime** | AI 助理（用户面） | 首字母大写 + 其余小写，**不写** "AIME" / "AiMe" / "aiMe" |
| **AIME** | AInvest Market Engine（内部引擎） | 只在代码/技术文档/产品代号里用；用户面**不要用** |
| **AIME+** | 订阅品牌 | 带 + 号、大写；指 AInvest 的付费层。四档：AIME+ Basic / AIME+ Pro / AIME+ Premium / AIME+ Ultra |
| **AimeClaw** | 私人助理营销活动 | 永远写作 "AimeClaw"（C 大写，无空格） |
| **AI Writer** | 产品化 AI 写作 agent 集合 | 约 40 位 agent，每位有人设和独立 byline。人类署名"AI Writer"在文末 + 错误致谢 |
| **Option+** | 独立期权数据 SKU | 带 + 号；与 AIME+ 是平行的订阅档 |
| **AInvest Nova** | 设计系统代号 | 内部代号（`DESIGN.md` frontmatter 里的 name） |

## 缩写

| 缩写 | 全称 | 何时用 |
|------|------|--------|
| KB | Knowledge Base | `/kb/...` 路径；KB 主题 |
| CTA | Call to Action | 按钮、转化文案 |
| RIA | Registered Investment Advisor | **避免**用 AInvest 自称 |
| RVOL | Relative Volume | 选股器筛选指标 |
| EMA | Exponential Moving Average | 选股器筛选指标 |
| MACD | Moving Average Convergence Divergence | 选股器筛选指标 |
| RSI | Relative Strength Index | 选股器筛选指标 |
| FOMC | Federal Open Market Committee | 回测事件类型 / 财经日历 |
| ETF | Exchange-Traded Fund | 独立路径 `/etfs/` |
| NDA | Non-Disclosure Agreement | 内部用 |
| OPRA | Options Price Reporting Authority | 期权行情分发机构；Option+ 必挂 OPRA terms + OPRA Professional Certification Requirement |
| FDA | Food and Drug Administration | 出现在 AIME+ 功能 "FDA Tracker"（医疗催化追踪）—— 缩写含义，**不是产品代号** |
| KOL | Key Opinion Leader | 出现在 AIME+ 功能 "KOL Focus (Crypto)" |
| PMS | Portfolio Management System | 内部简称，公开页不用 |
| LLM | Large Language Model | 文章页 Editorial Disclosure 自标 "advanced LLM technology" |
| CPA | Cost Per Acquisition | 联盟术语（affiliate.ainvest.com 对比表） |
| AUM | Assets Under Management | ETF 列表指标；screener category 之一 |
| NAV | Net Asset Value | ETF 列表指标（`/market/etfs-highest-nav-returns/`） |
| TTM | Trailing Twelve Months | 财务指标时段（P/E TTM / EPS TTM / Div Yield TTM） |

## 产品

| 术语 | 路径 / 子域 | 备注 |
|------|------------|------|
| Aime | `/aime/`、`/chat/` | meta title 自标 Robo-Advisor |
| AI Charts | `chart.ainvest.com` | 子域独立 |
| Super Charts | `/chart?symbol=…` | 路由参数 |
| Screener | `/screener/stocks/`、`/screener/etfs/` | 16 stock + 13 ETF = 29 categories，100+ preset |
| Newswire | `/news/`、`/news/wire/` | 编辑作者：`/news/author/` |
| Markets | `/market/` | tab：Market Trackers / US Stocks / Crypto / ETFs / Options |
| Portfolio | `/watchlist/` | — |
| Magic Portfolio | `/pricing/magic-portfolio/` | 独立 landing；AIME+ 子功能 |
| Trade | `/brokers/` | Light Horse（内部）+ Robinhood / Webull（外部） |
| Prediction Markets | `/prediction/` | **2026-06 新** — Polymarket 数据聚合 + AIME Briefing（不订阅、不撮合） |
| Option+ | `/pricing/` 末段 | 独立期权数据 SKU |
| Feedback | `/feedback/` | Suggestion / Issue / Other |
| Download | `/download/` | 移动 App 推广 |

## AIME+ 功能模块（**不是独立产品**）

| 模块 | 范围 | 备注 |
|------|------|------|
| Magic Signal | Crypto / Stock | market 页 CTA → `?benefit=magic_signal&source=market_magicsignal` |
| Trend Sight | Crypto / Stock | `?benefit=trend_sight&source=market_trendsight` |
| Peak Seeker | Crypto / Stock | 顶底识别 |
| Daily Insight | 每日洞察 | — |
| Magic Day Trading | 日内交易 | `?benefit=magic_day_trading&source=market_magicdaytrading` |
| Candle Advanced | 高级 K 线 | — |
| Aime Ratings | 标的评级 | — |
| FDA Tracker | 医疗催化追踪 | **仅 app，web 即将上线** |
| Multi-Chart View | 多图联动 | **仅 app，web 即将上线** |
| Pattern Detector | 图表形态自动检测 | **仅 app，web 即将上线**（2026-07 `/pricing/` 新列） |
| KOL Focus | Crypto KOL 关注 | — |
| Magic Prophet | Crypto 预测 | — |
| Ad Free (pop) | 去广告弹窗 | — |
| Option Block Monitor | 期权大单监控 | AIME+ 四档都含，Option+ 是主战场 |
| Rating Depth Report | 评级深度报告（Option） | 期权专属 |
| VIP Discord Members Access | VIP Discord 社群准入 | 社群 perk，非信号/工具（2026-07 `/pricing/` 新列） |

## AIME 输出档

| 名称 | 含义 | Quota（Basic / Pro / Premium / Ultra） |
|------|------|----------------------------------------|
| **Aime Fast Answer** | 速答，实时数据 + 简要分析 | **150 / 400 / 1000 / Unlimited per day**（**2026-07 新增 Ultra**） |
| **Aime Expert Answer** | 深度答，AI 调高算力 | **10 / 100 / 200 / 500 per day**（**2026-07 新增 Ultra**） |
| **Aime Copilot** | 新名：原 "Aime Fast Answer" | `/product/featured/` 使用；`/pricing/` 仍用旧名 |
| **Aime Deep Research** | 新名：原 "Aime Expert Answer" | `/product/featured/` 使用；`/pricing/` 仍用旧名 |

> ⚠️ 2026-07 `/pricing/` 新增 **Ultra** tier（Fast Answer **Unlimited** / Expert Answer **500/day**）。Premium 仍为硬上限 1000/200，**Unlimited 现仅归 Ultra**。旧 quota（200/500 + 20）已过时，不要引用。输出类型仍有新旧两套名称并存。

## B2B / 企业产品

| 术语 | 说明 |
|------|------|
| **AInvest API** | 公开 REST API（`docs.ainvest.com`），6 模块（Securities / News / Market Data / Calendar / Ownership / Analysis-Ratings） |
| **MCP Server** | Model Context Protocol server（`docsmcp.ainvest.com`），供 Claude 等 AI 直接调用 AInvest API |
| **NEXUS-O** | 工业级 omni-modal 基础模型（GTC 2026 发布）；text + audio + visual 同时处理 |
| **GAGE** | 高速评估沙箱引擎（GTC 2026 发布）；GPU/CPU 最大化 + Agent sandbox + game theory arena |
| **BizFinBench** | 100K+ 双语金融 LLM benchmark（arXiv:2505.19457）；5 维度 9 任务；含 Iterajudge 机制 |
| **MME-Finance** | 视觉金融 LLM benchmark（GTC 2026 发布）；首个由 10+ 年金融从业者标注的视觉测试 |
| **Research Agent** | 可嵌入第三方的 AI 研究代理（B2B 产品） |
| **Aime Copilot (B2B)** | 企业版 Aime，可集成到第三方金融应用 |
| **AI Fitting Mirror** | 与 New Port AI 合作的 AR 试穿镜（零售/时尚，非金融） |

## 视觉 / 设计

| 术语 | 含义 | 何时用 |
|------|------|--------|
| atom token | 设计系统最小语义单元（颜色/字号/圆角） | 改 UI 时；引用 `--atom-color-*` 或 Tailwind utility |
| dual mode | light + dark 双主题 | 任何 UI 都必须支持 |
| `price-up` | 涨价色，绿 | 显示股票涨 / 加密涨 / 正向变化 |
| `price-down` | 跌价色，红 | 显示股票跌 / 加密跌 / 负向变化 |
| `price-crypto-up` | 加密涨，青绿 | 仅加密市场，**不**与股票色混用 |
| `price-crypto-down` | 加密跌，粉 | 仅加密市场 |
| `price-even` | 平盘，黑/白 | 价格无变化 |
| `stock-color-mode=reverse` | 涨跌色反转 | 某些地区市场习惯（中国大陆、台湾等） |

→ 完整设计 token 见 `DESIGN.md`

## 域名 / 子域

| 域名 | 用途 |
|------|------|
| ainvest.com | 主站 |
| chart.ainvest.com | AI Charts |
| crypto.ainvest.com | 加密行情 |
| career.ainvest.com | 招聘 |
| affiliate.ainvest.com | 联盟 |
| contact.ainvest.com | 联系表单 |
| promo.ainvest.com | 营销活动页（Public.com 等合作） |
| docs.ainvest.com | 开发者 API 文档 |
| openapi.ainvest.com | API 生产 endpoint |
| docsmcp.ainvest.com | MCP server |
| cdn.ainvest.com | 资产 CDN（agreement、kamisAssets、icon、yyzt、social、articles、screener/images） |
| lighthorse.io | Light Horse Securities 独立站（券商，API + app downloads） |

## 角色 / 部门

| 角色 | 说明 |
|------|------|
| PM Retail Trading | 零售交易产品经理（career JD） |
| Growth Manager | 增长 |
| Social Media Marketing | 社媒营销 |
| Community Manager | 社区 |
| AI Investment Logic Annotator | AI 训练数据标注（career JD） |
| Managing Editor | 主编（Adam Shapiro） |
| Senior Content Manager | 高级内容经理（Jeremy Dwyer / Gavin Maguire） |
| Editor | 编辑（Shunan Liu / Tianhao Xu / David Feng） |
| Contributor | 外部贡献者（Mike Dickson / Michelle Connell / Rick Newman） |
| Product Manager (in author byline) | 同时挂名作者（**Dennis Zhang** / **Rodder Shi**） |

## 客服 / 联系方式

| 渠道 | 详情 |
|------|------|
| 邮箱 | support@ainvest.com |
| 招聘邮箱 | recruitment@ainvest.com |
| **客服电话** | **+1 (256) 217-7803**（pricing FAQ 实测） |
| 站内反馈 | /feedback/（Suggestion / Issue / Other） |
| App 内反馈 | 用户菜单 → Send Feedback |
| Aime "live support" | /chat/?comefrom=WebainvestNavirobot |
| Discord | https://discord.gg/44AMr7JMtD |
| Contact form | https://contact.ainvest.com/（4 部门：Client Support / Content Inquiry / Marketing-Advertisement / Business Partnership） |
| 文章纠错入口 | `https://form.typeform.com/to/V5GRCO3T?typeform-source=contact.ainvest.com`（Typeform 第三方） |
| 联盟申请 | `https://forms.gle/SbVRALw2efqnNMM67`（Google Form） |
| 联盟登录 | `/auth/google/start?callbackUrl=/affiliate/dashboard`（Google OAuth） |
| 联盟高量伙伴 | `mailto:support@ainvest.com`（"Partner Concierge"） |

## 避免的词 / 表达

| ❌ 避免 | ✅ 替换 | 为什么 |
|--------|---------|--------|
| "guaranteed profit" | "potential outcome based on historical data" | 合规红线 |
| "risk-free" | "lower-risk strategies available" | 误导 |
| "we recommend buying X" | "Aime's analysis suggests…" | 不当投资建议 |
| "AIME"（用户面） | "Aime" | 品牌统一 |
| "Aime+" / "Aime Plus" | "AIME+" | 品牌 + 号 + 大写 |
| "Options+" / "Option Plus" | "Option+" | 品牌 + 号 |
| "he / his"（指 Aime） | "she / her" | 品牌决策 |
| "broker-dealer"（指 AInvest） | "third-party brokerage integration" | 主体错位 |
| "investment advice" | "research, analysis, insights" | 合规边界 |
| "我们" | "Aime" 或 "AInvest" | 一致性 |
| "NewYork 字体"（UI 元素） | 用 `--font-base` | 设计 token 约束 |
| "27 ready made strategies" / "100+ presets" | "260 presets across 29 categories (174 stock + 86 ETF)" | screener 数字已过时（2026-07-07 实测） |
| 引用 `AInvest-AI-Risk-Disclosures.pdf` | 改用 `Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf` | 旧 PDF 已 404 |

## 数据 / 行情

| 缩写 | 含义 |
|------|------|
| ticker | 股票代码（如 AAPL、TSLA） |
| USDT | 加密稳定币报价单位 |
| exchange | 交易所（Binance、NASDAQ、NYSE、AMEX） |
| catalyst | 股价催化事件（财报、并购等） |
| win rate | 策略历史胜率（回测输出） |
| max drawdown | 最大回撤（回测输出） |
| Buy-Zone | AInvest 预警术语，价格进入预设区间的提醒 |
| Whale Flow | 大单/机构资金流（options 跟踪） |
| DMI | Directional Movement Index（market 页 Indicator Signals 用） |
| Golden cross / Dead cross | 均线交叉信号（AIME 推送） |
| 3-Month Return | screener 卡片显示的近 3 月回报率 |
| Fear & Greed Index | 加密市场情绪指数（1Y/1M/1W 切换） |
