---
type: signals
last-updated: 2026-07-07
sources:
  - ainvest.com/pricing (AIME+ tier table)
  - ainvest.com/pricing/benefits/magic-signal/
  - ainvest.com/pricing/benefits/trend-sight/
  - ainvest.com/pricing/benefits/magic-day-trading/
  - ainvest.com/download/ (module list)
  - ainvest.com/market/ (signal CTA links)
---

# Signals — AIME+ 16 模块速查

> AInvest 把"AI 信号 / 评级 / 投资工具"打成 **16 个**独立模块（"AI signals / ratings / tools"），**包含在 AIME+ 四档订阅中**（Basic / Pro / Premium / Ultra 主要差 quota、优先权和部分高级/期权权限）。本文件是这些模块的速查；订阅档位见 [`business-model.md`](./business-model.md)，产品归属见 [`products.md`](./products.md)。
>
> **2026-07-07 更新**：`/pricing/` "Compare every benefit" 把功能分为 **29 Highlight Features + 14 Basic Functions**。其中 29 Highlight = 4 Trading Indicators + 4 Stock Picking + 14 Options Services + 7 Other Highlights。本文件的 16 模块按 **5 跨资产 + 4 股票 + 2 加密 + 5 平台/体验** 分组，**不含** 14 项 Options Services（那部分详见 [`option-plus.md`](./option-plus.md)）。**新增**：Pattern Detector、VIP Discord Members Access（归在 Other Highlights / 平台体验）。

## 16 模块总览（按资产 / 范围分组）

### 跨资产 / 通用（5 个）

| 模块 | 范围 | 一句话 |
|------|------|--------|
| **Magic Signal** | Crypto / Stock | "A technical analysis system generates bullish and bearish signals based on price momentum." |
| **Trend Sight** | Crypto / Stock | "Technical analyzes every aspect of a market trend to detect where trends starts and ends." |
| **Peak Seeker** | Crypto / Stock | 顶底识别 / 转折点检测 |
| **Daily Insight** | 跨资产 | 每日洞察摘要 |
| **Aime Ratings** | 标的评级 | AI 综合评级 |

### 股票专属（4 个）

| 模块 | 一句话 |
|------|--------|
| **Magic Day Trading** | "Technical analysis-powered stock rating system that identifies long/short chances at market open using intraday reversal effect" |
| **Candle Advanced** | 高级 K 线形态识别 |
| **Option Block Monitor** | 期权大单监控（**注意**：AIME+ 四档都含；Option+ SKU 才是主战场，详见 [`option-plus.md`](./option-plus.md)） |
| **Rating Depth Report (Option)** | 评级深度报告（期权标的） |

### 加密专属（3 个）

| 模块 | 一句话 |
|------|--------|
| **KOL Focus** | 加密 KOL 关注名单 / 持仓跟踪 |
| **Magic Prophet** | 加密预测 |
| （Magic Signal / Trend Sight / Peak Seeker 也覆盖加密） | — |

### 平台 / 体验（5 个）

| 模块 | 一句话 |
|------|--------|
| **FDA Tracker** | 医疗催化追踪（FDA 审批 / 临床节点）—— **仅 app，web 即将上线** |
| **Multi-Chart View** | 多图联动 / 跨标的对比 —— **仅 app，web 即将上线** |
| **Pattern Detector** | 图表形态自动检测 —— **仅 app，web 即将上线**（2026-07-07 `/pricing/` 新列） |
| **Ad Free (pop)** | 去广告弹窗 |
| **VIP Discord Members Access** | VIP Discord 社群准入资格（社群 perk，非信号/工具；2026-07-07 `/pricing/` 新列） |

> 16 个条目 = **15 个信号/工具模块**（含 Pattern Detector）+ **1 个 VIP Discord 社群准入 perk**。`/pricing/` "Other Highlights" 把这 5 项与 Candle Advanced、KOL Focus 一并列为 7 个。

## 信号表页（每个模块的 landing）通用模式

> 实测 `/pricing/benefits/magic-signal/`、`/pricing/benefits/trend-sight/`、`/pricing/benefits/magic-day-trading/` 三页验证 —— 模板一致：

- **页头**：模块名 + 一句话定位（meta title 通常是 "Unlock Exclusive Technical Analysis & Queries - Ainvest"）
- **主控件**：信号类别 tab（不同模块不一样，见下表）
- **过滤栏（Filter by Stock）**：固定列表 —— Symbol / Change % / Market Cap / Last / Volume / Turnover / Turnover % / P/E (TTM) / EPS (TTM) / Industry / Range % / High / Low / P/B (MRQ) / ROE (TTM) / ROA (TTM)
- **未订阅 CTA**：表头右侧 "Unlock the [Module]" 按钮 → `/pricing/?benefit={slug}&source={source}`

| 模块 | tab 结构 | source 标识 |
|------|---------|-------------|
| Magic Signal | Bullish Signal / Bearish Signal / Watchlist | `market_magicsignal` |
| Trend Sight | Uptrend Start / Uptrend End / Watchlist | `market_trendsight` |
| Magic Day Trading | Bullish+Bearish / Bullish / Bearish（toggle） | `market_magicdaytrading` |
| Peak Seeker | （未实测 —— 推断 Buy-Zone / Sell-Zone / Watchlist） | `market_peakseeker` |

> 其他 13 个模块不一定都有公开 landing —— 不少只在 AIME+ 订阅后才解锁。

## Market 页里的挂载点

AIME+ 模块作为 CTA 卡片，挂在 `/market/` 的对应 tab：

| 位置 | 卡片 | 跳转 |
|------|------|------|
| `/market/` US Stocks tab | **Magic Signal** | `?benefit=magic_signal&source=market_magicsignal` |
| `/market/` US Stocks tab | **Trend Sight** | `?benefit=trend_sight&source=market_trendsight` |
| `/market/` ETFs tab | **Magic Day Trading** | `?benefit=magic_day_trading&source=market_magicdaytrading` |

→ AIME+ 其他模块的"market 页 CTA"暂未在公开页面看到，估计在订阅后或 KB 内有挂载。

## 落地页（`/pricing/benefits/{slug}/`）

已确认的 slug：

| slug | 模块 |
|------|------|
| `magic-signal` | Magic Signal |
| `trend-sight` | Trend Sight |
| `magic-day-trading` | Magic Day Trading |
| `magic-portfolio` | Magic Portfolio（见 [`business-model.md`](./business-model.md)） |

未确认的 slug（推断存在）：`peak-seeker` / `daily-insight` / `candle-advanced` / `aime-ratings` / `fda-tracker` / `multi-chart-view` / `pattern-detector` / `kol-focus` / `magic-prophet` / `option-block-monitor` / `rating-depth-report` / `ad-free` / `vip-discord-members-access`。

## Quota / 订阅

- **AIME+ Basic / Pro / Premium / Ultra 四档**对多数模块的大类入口相同 —— 主要差异是 **Aime Fast / Expert Answer 速率、优先权和部分高级/期权实时权限**（详见 [`business-model.md`](./business-model.md)）。
- `/pricing/` 现已**公开**显示四档价格（2026-07-07 实测：Basic Free / Pro $34.99 / Premium $74.99 / Ultra $169.99 mo，Monthly + Yearly tab），进入 `/pricing/?benefit={slug}` 落地后跳到对应档订阅流。
- 旧 App 内单独购买的"老 SKU" 订阅**暂时**无法在 web 端升级到 AIME+ Pro（FAQ 实测）。

## 命名硬规则

- **Aime Ratings**（A 大写 + ime 小写）—— 不要写成 "AIME Ratings"
- **Magic Signal**、**Magic Day Trading**、**Magic Prophet**、**Magic Portfolio** —— "Magic" 开头的产品名首字母大写
- **Trend Sight**、**Peak Seeker**、**Daily Insight**、**Candle Advanced**、**KOL Focus**、**Option Block Monitor**、**Rating Depth Report**、**FDA Tracker**、**Multi-Chart View**、**Pattern Detector**、**VIP Discord Members Access** —— 全部 Title Case
- 不要把这些模块名**单独**写成 "产品" —— 它们是 **AIME+ 内的功能模块**，不是独立 tier
- `benefit=` query 参数值是 **kebab-case**（`magic-signal`，不是 `magic_signal`）
- `source=` query 参数值是 **snake_case**（`market_magicsignal`，不是 `market-magicsignal`）

## 不要做

- ❌ 不要把这些模块**单独**列在主导航或 footer PRODUCTS 区（**它们不出现**，footer 只有 Aime / Newswire / Screener / Super Charts / Magic Portfolio）
- ❌ 不要把它们当独立 SKU 写"价格"
- ❌ 不要引用 `?benefit=magic_signal&source=market_magicsignal` 这种下划线 vs 中划线搞混的 URL —— 严格按 kebab-case benefit + snake_case source
- ❌ 不要在没有 `?source=` 的情况下跳 `/pricing/?benefit=...` —— 会丢失转化追踪
