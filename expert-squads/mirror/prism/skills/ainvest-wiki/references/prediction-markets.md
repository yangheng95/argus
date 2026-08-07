---
type: prediction-markets
last-updated: 2026-07-07
sources:
  - ainvest.com/prediction/ (主页面 + hero)
  - ainvest.com 顶部主导航（"🏆World Cup" 入口）
  - App Store 更新日志 2026-06 ("Ainvest has launched a brand new category – Prediction!")
  - LinkedIn (AINVEST HOLDINGS INC.) 关于 prediction markets 的 2026-06 帖子
---

# Prediction Markets — 预测市场

> **Prediction Markets** 是 AInvest 在 2026-06 上线的**第 10 个对外产品**，定位是"Polymarket 上层聚合 / 跟踪面板"。AInvest **不**自己撮合合约，**仅做信息聚合 + 跳转**，最终交易在 **Polymarket**（带 AInvest 联盟 ref）完成。
>
> 营销 hero："World Cup 2026 is live — get Aime's daily match calls."

## 定位

- **产品类别**：prediction markets aggregator / tracker（非自营撮合）
- **路由**：`https://www.ainvest.com/prediction/`
- **主导航位置**：AInvest 顶部 nav 第二个 tab（紧邻 AI Charts），icon 写作 **🏆World Cup**
- **底层数据**：**Polymarket**（AInvest 跳转链接带 `?r=ainvestfintech` ref 标识）
- **上游合规边界**：AInvest 不撮合、不结算，仅展示市场 + 概率走势 + 跳转

## 覆盖的市场类别（9 + 1 个高亮）

来自 `/prediction/` 顶部 tab 排序：

| 顺序 | 类别 | 备注 |
|------|------|------|
| 0 | **FIFA World Cup 2026** | **默认 / 高亮展示**（2026 季节性 hook） |
| 1 | Trending | 全站热门 |
| 2 | Sports | 综合体育 |
| 3 | Politics | 政治选举 / 政策 |
| 4 | Crypto | 加密相关预测（价格 / 协议事件） |
| 5 | Finance | 利率 / 财报 / 宏观 |
| 6 | Tech | AI / 半导体 / 大型科技事件 |
| 7 | Culture | 文化娱乐 |
| 8 | Economy | 实体经济指标 |
| 9 | Climate & Science | 气候 / 科学事件 |

> 9 个平铺类别 + 1 个高亮类别。FIFA World Cup 2026 因 6-7 月开赛被钉在第一位（默认 hero），其余按热度排序。

## 单事件页能力（基于 World Cup 样例）

| 区块 | 数据 |
|------|------|
| **Header** | 标题 + 倒计时（比赛 / 事件时间） |
| **Probability Movement (24H)** | 24h / 12h / 6h / Now 的概率变化曲线（百分比堆叠） |
| **Order Book Depth** | Trade ATA / Price / Total 实时盘口 |
| **Whales TradeFlow** | 大单 / 鲸鱼链上异动（"Large on-chain orders will appear here when market activity starts"） |
| **AIME Briefing** | Aime 自动生成的赛前 / 事件前简报（赛前会有，正式开赛前显示 "No AIME briefing available yet"） |
| **Group view（仅 World Cup）** | "48 teams, 12 groups, 72 matches before knockout. Hover any group to see all 6 fixtures with live odds." |

→ 这套组件是 Polymarket 数据 + AInvest AIME 生成的"解读层"叠加。

## 跳转 / 商业化

- **CTA**：每个事件下方 "Place Bet on Polymarket →" 按钮 → `https://polymarket.com/?r=ainvestfintech`
- **Ref tag**：`r=ainvestfintech` 是 AInvest 在 Polymarket 的**联盟追踪参数**
- **不**在站内做 KYC / 支付 / 结算
- 联盟关系对应 [`affiliate.md`](./affiliate.md) 体系（推断走 Polymarket 自有 affiliate program，**未在 ainvest affiliate FAQ 公开披露**）

## 移动端

- iOS / Android App 已经同步上线 "Prediction" tab（在 market 区）
- App Store 更新日志（2026-06）："Ainvest has launched a brand new category – Prediction! You can now find the Prediction tab on the market..."

## 关系网

```
Prediction Markets（聚合 / 展示）
    ↓ 数据
Polymarket（实际撮合 / 结算） ← AInvest 联盟 ref
    ↓
AIME（解读 / Briefing / 赛前简报）
```

- 不是 AIME+ 内的功能模块（**任何人**都能看基础概率，**不锁 AIME+ 订阅**）
- 不是独立订阅 SKU（**没有专门的订阅**）
- 仅做信息层 + 跳转层

## 合规边界（重要）

AInvest 在这里只是**信息聚合 / 跳转方**：

- ❌ **不是**交易场所 / 撮合方 / 清算方
- ❌ **不**在美国本土受 CFTC / SEC 直接监管（**Polymarket 才是**）
- ❌ **不**为预测结果背书（"Past performance is for educational purposes only" 在全站其它产品都是标配）
- ✅ 跳转 Polymarket 时**建议**继续挂 Third-Party Brokerage Disclaimer / AI Risk Disclosures（推断合规要求，**未实测跳转页是否挂**）
- ⚠️ 涉及"投注 / 下注"语义 → 与公司"不做投资建议"主体边界要分开讲（预测市场 ≠ 投资建议；Polymarket 也标注为 event contracts / derivatives，不是 securities）

## 为什么这个产品值得记

1. **产品线扩展**：AInvest 历史上是"美股 + 加密 + ETF + 期权"，现在**首次**进入**事件合约 / 衍生品赛道**（区别于 Option+ 的传统股票期权）
2. **流量商业化**：跳转 Polymarket 带 ref → AInvest **变现路径新增**一条（联盟佣金，参数大小未公开）
3. **AIME Briefing**：把 AIME 的"AI 解读"能力延伸到事件合约 → AIME 从金融分析扩张到广义事件分析
4. **2026 季节性**：World Cup 2026 是 6-7 月最大的全球流量事件，AInvest 借此 hook 拉新（首页 hero 文案已切到 "World Cup 2026 is live"）

## 命名硬规则

- **Prediction Markets**（首字母大写，**全名**）—— 不写 "Prediction" / "Polymarket Tracker" / "Betting"
- **Polymarket**（驼峰）—— 写第三方平台时首字母大写
- **World Cup**（用户面 icon 用 "🏆World Cup"，没有空格）
- 内部代号 / URL slug：`/prediction/`（不是 `/world-cup/` 或 `/polymarket/`）
- ref 参数：`?r=ainvestfintech`（**保留**）

## 不要做

- ❌ 不要把 Prediction Markets 描述成 AInvest 自营撮合 — 是聚合 / 跳转
- ❌ 不要把"World Cup"和 FIFA 商标混淆 — AInvest 没有 FIFA 授权，hero 只用通用描述
- ❌ 不要在合规文案里挂 "Disclosures for AI Tools"（这是聚合页，**不**是 AI 输出）—— 但 AIME Briefing 是 AI 输出，**那块**要挂
- ❌ 不要假设有"独立订阅 SKU" — **没有**
- ❌ 不要在没有 Polymarket 授权假设下使用其 logo / 商标（除引用场景外）
- ❌ 不要把"Place Bet on Polymarket"按钮改写成 "Trade on Polymarket"（站点原文是 "Place Bet"，是 Polymarket 自己的语义）
