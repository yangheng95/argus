---
type: core-engine
last-updated: 2026-07-07
sources:
  - ainvest.com/about
  - ainvest.com/aime/ (meta title: "AI Investment Chat - Robo-Advisor Assistant - Aime by AInvest")
  - ainvest.com 首页 hero
  - ainvest.com/kb/aime
  - ainvest.com/pricing (Fast / Expert Answer quota — **2026-07 新增 Ultra 档**)
  - ainvest.com/news/ainvest-gtc-4-ultimate-tools-rebuilding-financial-ai-infrastructure-2603/ (GTC 2026 文章披露 NEXUS-O / GAGE / BizFinBench / MME-Finance)
---

# AIME — AInvest Market Engine

> "She doesn't just organize your workflow — she anticipates it."
>
> meta title 自标："AI Investment Chat - Robo-Advisor Assistant"

## 是什么

**AIME**（AInvest Market Engine）是 AInvest 平台的核心 AI 引擎，所有"AI-first"产品都建立在它之上：

- **Aime**（聊天助理 / Robo-Advisor）是 AIME 的 **用户面**入口
- **AI Charts / Screener / Newswire / Magic Portfolio / Option+ / Magic Signal / Trend Sight / Peak Seeker / Daily Insight / Magic Day Trading / Aime Ratings** 等产品都通过 AIME 拿到 AI 能力
- AIME 的工程内部代号仍是 **AIME**，**用户面/营销文案**统一叫 **Aime**
- 订阅品牌为 **AIME+**（带 + 号）—— AIME 的付费层

→ 命名规则详见 [`glossary.md`](./glossary.md)

## 核心价值主张

| 维度 | 旧工作流 | AIME 工作流 |
|------|---------|------------|
| 入口 | 多 tab、被动搜索 | 自然语言一句触发 |
| 记忆 | 无 | 记住你 follow 的 ticker / 主题 |
| 上下文 | 切来切去 | 自动把 chart、news、backtest 串成一个会话 |
| 节奏 | 你追市场 | AIME 提前告诉你"什么要动了" |
| 角色 | 工具 | "Robo-Advisor" / 私人助理（拟人化） |

## 用户旅程（来自 about 页面）

> 1. 你搜 "TSLA stock news"
> 2. AIME 立刻识别你的关注，把 Tesla 钉到你的 feed，浮出最关键的头条和催化事件
> 3. 她问："我已经为你构建了一张图表，要看吗？"
> 4. 图表出现——已标注、有呼吸感、准备好分析
> 5. 一会儿她又问："要回测 Tesla 历史财报反应吗？"
> 6. 一键下去，profit curve、win rate、波动率 map 出现
> 7. 准备行动时，AIME 帮你框出 trade——给 size、stops、targets——并持续监控，标记什么会变

这个流程是 AIME **拟人化叙事**的标准范式：搜索 → 识别焦点 → 推荐下一步 → 监控。

## 能力清单（公开页面披露）

| 能力 | 体现 |
|------|------|
| 自然语言问答 | "Chat with Aime to research stocks, analyze trends" |
| 个性化关注 | "knows what you follow. Connects the dots" |
| 智能图表 | "scans the chart, draws the lines, and tells you: bullish or bearish" |
| 关联新闻 | "revealing the news behind every move" |
| AI 回测 | "groups similar events like earnings calls or FOMC meetings, calculates win rates, max gains, worst-case drawdowns" |
| 自定义回测 | "want to test a custom strategy? Just ask Aime!" |
| 交易辅助 | "suggesting size, stops, and targets" |
| 持续监控 | "keeps watch, flagging what could change next" |
| 隔夜主动推送 | "Charts are refreshed. Alerts are adjusted. Insights are refined." |
| 实时行情数据 | **Aime Copilot**（`/pricing/` 旧名 "Aime Fast Answer"）—— 限速版本（AIME+ 150/400/1000/Unlimited per day） |
| 深度分析 | **Aime Deep Research**（`/pricing/` 旧名 "Aime Expert Answer"）—— 更高成本版本（AIME+ 10/100/200/500 per day） |
| 人工坐席 | 输入 "live support" → 转人工（来自 `/chat/?comefrom=WebainvestNavirobot`） |

> **2026-06 输出类型重命名**：`/product/featured/` 页将 "Aime Fast Answer" → **"Aime Copilot"**，"Aime Expert Answer" → **"Aime Deep Research"**。`/pricing/` 主页仍使用旧名。两套名称并存，agent 以使用场景选择。

## Quota 体系（AIME+ 四档，**2026-07 已更新**）

AIME 输出分两档速率与质量，叠加在 AIME+ 订阅档位上：

| 档位 | Aime Fast Answer / Copilot | Aime Expert Answer / Deep Research | 单价（2026-07-07 公开） |
|------|----------------------------|------------------------------------|------|
| AIME+ Basic | **150 / day** | **10 / day** | Free |
| AIME+ Pro | **400 / day** | 100 / day | **$34.99/mo** |
| AIME+ Premium | **1000 / day** | **200 / day** | **$74.99/mo**（页标 "Best"） |
| AIME+ Ultra | **Unlimited** | **500 / day** | **$169.99/mo** |

→ 四档功能大类接近，主要差异是 **quota + 优先权**。**Unlimited Fast Answer 仅属 Ultra**；Premium 及以下都有硬上限。`/pricing/` 现已公开全部四档月价（Monthly / Yearly tab，年付折后更低）。详见 [`business-model.md`](./business-model.md)。

## 哲学

- **"We don't show data. We show what's next."** —— 平台哲学
- **"This isn't automation. This is intelligence."** —— 与脚本/机械流程的差异
- **"Every investor has habits. We built the reason to break them."** —— about 页
- AIME **不**做个性化投资建议 —— 见 [`compliance.md`](./compliance.md)

## 拟人化

- 代词：**she / her**（所有文案必须一致）
- 营销名：**Aime**（用户面） / **AIME**（内部 / 引擎名） / **AIME+**（订阅品牌）
- 衍生营销活动：**AimeClaw**（"Get Your Private Assistant: Reserve AimeClaw"）
- 形象资产：`cdn.ainvest.com/kamisAssets/aime.bpo45whq8xi.png`

## UI/集成触点

| 场景 | 集成方式 |
|------|---------|
| 通用聊天 | `/chat/` 入口（带 `?comefrom=` 来源参数） |
| 介绍页 | `/aime/`（meta title: Robo-Advisor） |
| KB 主题 | `/kb/aime/` |
| 文末署名 / footer | "Powered by AIME" 风格 |
| Market 页广告位 | `kamisAssets/adv-market-aime.26r63uvakw1.png`（"Ask Aime"） |
| 图标 | `aime.bpo45whq8xi.png`（CDN 上） |

## 文案 / Tone

- **专业、克制、主动**：用 "I can…" / "Want me to…" / "I've already…"
- **永远不要**把 AIME 描述成"自动交易机器人"或"保证收益"
- 涉及 AI 输出 → 必须链接到 `Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf`（**新文件名**，旧名 `AInvest-AI-Risk-Disclosures.pdf` 已 404，详见 [`compliance.md`](./compliance.md)）
