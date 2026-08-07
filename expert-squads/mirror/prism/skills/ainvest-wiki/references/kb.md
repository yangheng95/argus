---
type: kb-index
last-updated: 2026-07-07
sources:
  - ainvest.com/kb/ (KB 入口页)
---

# Knowledge Base 索引（KB 主题速查）

> AInvest KB 入口是 `/kb/`，目前共 **10 个公开主题**。本文件是 KB 主题 + 一句话定位 + 哪个 `references/` 配套文件最适合做交叉引用。

## 10 个 KB 主题

| # | 主题 | 路径 | 一句话 | 配套 references/ |
|---|------|------|--------|-----------------|
| 1 | **Market Analysis** | `/kb/market-analysis/` | "Master the markets with data-driven insights. Explore deep-dives into US stock trends and global macroeconomic shifts." | [`markets.md`](./markets.md) |
| 2 | **AI Screener** | `/kb/ai-screener/` | "Build professional custom strategies in seconds. Use AI-powered filters to find the next breakout stock." | [`markets.md`](./markets.md) Screener 段 |
| 3 | **Meet AIme** | `/kb/aime/` | "Your personal AI investment expert. Chat with AIme to research stocks, analyze trends, and get instant market answers." | [`aime.md`](./aime.md) |
| 4 | **Premium Subscription** | `/kb/subscription/` | "Unlock the full power of Ainvest. Access professional tools, proprietary data, and advanced features." | [`business-model.md`](./business-model.md) |
| 5 | **Alert** | `/kb/alert/` | "Never miss a move. Set professional 'Buy-Zone' alerts and receive real-time notifications on price triggers." | [`signals.md`](./signals.md) |
| 6 | **Featured Data** | `/kb/featured-data/` | "Track the 'Smart Money.' Access unique datasets including Congress trading, Whale activity, and Sankey financials." | [`markets.md`](./markets.md) Featured Data 段 |
| 7 | **Crypto Market** | `/kb/crypto/` | "Decode crypto volatility. Combine technical analysis with on-chain data to find high-probability setups." | [`markets.md`](./markets.md) 加密段 + [`signals.md`](./signals.md) KOL Focus / Magic Prophet |
| 8 | **Options** | `/kb/options/` | "Stop flying blind. Discover how Ainvest's options chain and 'Whale Flow' tracker let you see institutional money moves and calculate risk/reward before you trade." | [`option-plus.md`](./option-plus.md) |
| 9 | **Financial Calendar** | `/kb/financial-calendar/` | "Stop getting caught off guard by market-moving events. Learn how to use Ainvest's Financial Calendar to track crucial earnings reports, FOMC meetings, and macroeconomic data releases so you can position your trades ahead of the volatility." | [`markets.md`](./markets.md) 宏观段 |
| 10 | **Superchart** | `/kb/superchart/` | "Stop relying on basic line graphs. Learn how to use Ainvest's Superchart to conduct advanced technical analysis, overlay custom indicators, and utilize professional drawing tools to pinpoint precise entry and exit levels across stocks, options, and crypto." | [`products.md`](./products.md) Super Charts 段 |

## KB 入口的导航 / 位置

- 主导航：**未挂**（KB 不在主导航顶行）
- 入口：footer "RESOURCES" 区块 → "Knowledge Base"
- URL：`/kb/`
- 卡片布局：每个主题一张大图卡片 + 标题 + 一句话描述 → click 进入
- KB 内页：通常是 hero + 长文 markdown-style body

## 已知 KB 内页缺口（**别瞎填**）

- 上述 10 个主题的**实际 KB 正文**只在 `ainvest.com/kb/{topic}/` 路由下提供，**agent 没有正文**，不要替 AInvest 编 KB 内容
- `/pricing/benefits/{slug}/` 与 KB 是**两套**页：KB 是教学长文，pricing/benefits 是 AIME+ 功能的工具页

## 警示

- ⚠️ KB 入口页 `/kb/` 的 footer 还在挂**旧名** `Ainvest-AI-Risk-Disclosures.pdf`（已 404），**agent 实现 AI disclaimer 跳转时**用 [`compliance.md`](./compliance.md) 里的新名
- ⚠️ KB 主题 "Premium Subscription" 描述**过时** —— 实际订阅是 **AIME+** 四档（Basic / Pro / Premium / Ultra）而非单一 "Premium"，详见 [`business-model.md`](./business-model.md)
- ⚠️ KB 主题 "Meet AIme" 标题里把 AIme 写作 "AIme"（AI + 小 me）—— 实际站点的产品名是 **Aime**（A 大写 + ime 小写）。这是 KB 自身的小不一致，agent 引用时以**正式产品名 Aime** 为准

## 新主题预判

- 公开 KB 暂未列 Option+ / Magic Portfolio 独立 KB 主题，预计会加但**等站点上了再写**
- AI Writer 暂无 KB 主题，详见 [`editorial.md`](./editorial.md)
