---
type: business-model
last-updated: 2026-07-07
sources:
  - ainvest.com 首页 / footer
  - ainvest.com/pricing (AIME+ 四档 + Option+) — **2026-07 新增 Ultra 档**
  - ainvest.com/pricing/magic-portfolio
  - ainvest.com/kb/subscription
  - tooliverse.ai (3rd-party 2026 review, historical reference only)
  - promo.ainvest.com (Public 6-mo Premium 活动页)
  - ainvest.com/pricing FAQ (2026-07-07 实测：3-Day Free + occasional 7-day trial events + 四档价格现已公开)
---

# Business Model — 商业模式与订阅

AInvest 的收入模式 = **3-Day Free Trial → AIME+ 订阅**（按功能档位分 4 档、按周期分月/年），再叠加独立的 **Option+**（期权数据 SKU）和单独的 **Magic Portfolio** 高客单订阅，以及面向顶端的 **AimeClaw** 私人助理预订营销。

## 漏斗

```text
匿名访问 / SEO 落地
    ↓
3-Day Free Trial（首页推广的 AInvest 入口）
    ↓
AIME+ Basic / Pro / Premium / Ultra 订阅（web 端主推）
    ↓
Option+（独立付费，期权实盘数据）
    ↓
Magic Portfolio（独立 landing，高客单）
    ↓
AimeClaw（"私人助理"预订，最高端 SKU，营销活动名）
```

## 1. 3-Day Free Trial

- 出现在首页 hero："AInvest ★★★★★ 3-DAY FREE"
- 推广语："Catch pre-market movers with AI signals. Claim Trial"
- 主要目的：让用户体验 Aime / 实时信号后转化到订阅
- 实现要点：试用开始/结束时间要打点；到期前弹窗/邮件触达
- 用户在用户菜单里看到 "Active / Expires in day(s)" 倒计时
- **另外**：`/pricing/` FAQ 实测披露 —— "The Basic plan is free forever and includes **occasional 7-day trial events** for higher-tier features, so you can fully evaluate the capabilities of AIME+ before deciding to upgrade." 即除首页 3-Day Free 入口外，还有**定期 7 天高 tier 试用活动**（不常驻、活动性），agent 引用试用机制时两套都要提。

## 2. AIME+ 订阅（核心付费层）

- 路由：`/pricing/`，落地为 **AIME+** 品牌
- 标题："SMARTER INVESTING, POWERED BY AIME+" / "2026 PLANS"（2026-07 已从旧 "SECURE YOUR 2025 ADVANTAGE" 切换）
- 文案："Autonomous AI Meets Real-Time Market Intel. Unlock Your Edge."
- 计费周期：**Monthly** / **Yearly**（tab 切换；年付说明为 "Lowest per-month rate with annual billing"）
- 四档（同名功能 + 不同 quota，**2026-07 新增 Ultra 档**）：

| 档位 | Aime Fast Answer / Copilot | Aime Expert Answer / Deep Research | 公开价格（2026-07-07 实测） |
|------|----------------------------|------------------------------------|----------|
| **Basic** | **150/day** | **10/day** | **Free** |
| **Pro** | **400/day** | **100/day** | **$34.99/mo**（年付折后更低） |
| **Premium** | **1000/day** | **200/day** | **$74.99/mo**（页标 "Best"；年付折后更低） |
| **Ultra** | **Unlimited** | **500/day** | **$169.99/mo**（年付折后更低） |

> **2026-07 重要变更**：
> - `/pricing/` 已新增 **Ultra** tier：Fast Answer **Unlimited** / Expert Answer **500/day**。
> - **输出类型双命名仍并存**：`/pricing/` 用旧名 **AIME Fast Answer / AIME Expert Answer**；`/product/featured/` 仍用 **Aime Copilot / Aime Deep Research**。
> - Basic / Pro / Premium quota 维持 2026-06 下调后的数值：150/10、400/100、1000/200。
> - **Premium 不再是 Unlimited**；Unlimited 现在仅归 **Ultra** tier。
>
> **公开价格可见性（2026-07-07 实测）**：`/pricing/` 现**已公开**显示四档价格 —— Basic Free、Pro **$34.99/mo**、Premium **$74.99/mo**（页标 "Best"）、Ultra **$169.99/mo**。页面有 **Monthly / Yearly** tab（年付说明为 "Lowest per-month rate with annual billing"，折后单价更低）。这是从 2026-06 的 "`-- / mo`" 状态转为公开金额；agent 可直接引用这些公开月价，年付折后金额以页面 tab 切换为准。
>
> `/product/featured/` 还展示了 Basic tier 的**额外功能**（不在 `/pricing/` 页展示）：Crypto Real-Time Quote、Stock & ETF Real-Time Quote、Actionable News Wire、Live TV、Pro Mode Technical Chart、Multi-Platform Services、Custom Watchlists、Tick by Tick Data、Stock Screener、Fundamental Analysis、Fundamental Diagnostic、Fundflow Radar（app only）、Broker Connect（app only）、Insider Trading（app only）。
>
> Premium tier 额外功能（在 `/product/featured/` 展示）：Option Real-Time Quote、Option Calculator、Option Analysis（app only）。

### `/pricing/` 功能分类（2026-07-07 实测，29 Highlight + 14 Basic = 43 项）

`/pricing/` 的 "Compare every benefit" 表把功能分成三大块，每档解锁数不同（Basic 3/29、Pro 15/29、Premium 26/29、Ultra 29/29 Highlight；Basic 14/14 全开）：

| 大类 | 子项数 | 包含 |
|------|--------|------|
| **AI Intelligence** | 2 | Financial Expert Agent；AIME Fast Answer；AIME Expert Answer |
| **Trading Indicators** | 4 | Magic Signal (Crypto/Stock)、Trend Sight (Crypto/Stock)、Peak Seeker (Crypto/Stock)、Magic Prophet (Crypto) |
| **Stock Picking Tools** | 4 | Magic Portfolio、Daily Insight、Magic Day Trading、AIME Ratings |
| **Options Services** | 14 | Option Block Monitor、Option Real-Time Quote、Option Calculator Real-Time、Option Analysis (app·web soon)、Option Rating Depth Report (EOD)、Option Trade Ideas (soon, 30D/5D delay)、Option Setup Scenarios (soon, 30D/5D delay)、Option Alert (soon)、Email Weekly Newsletter、Email Daily Pre-market Brief、Email Daily Trade Idea (soon)、Option Rating Depth Report Real-Time (soon)、Option Unusual Flow (soon)、Email Daily Unusual Flow Digest (soon) |
| **Other Highlights** | 7 | FDA Tracker (app·web soon)、Multi-Chart View (app·web soon)、**Pattern Detector** (app·web soon)、Candle Advanced、KOL Focus (Crypto)、Ad-Free (pop)、**VIP Discord Members Access** |
| **Market Data** (Basic Function) | 4 | Crypto Real-Time Quote、Stocks & ETFs Real-Time Quote、Tick by Tick Data、Pro Mode Technical Chart |
| **Real-Time News** (Basic Function) | 2 | Actionable News Wire、Live TV |
| **Platform & Analytics** (Basic Function) | 5 | Multi-Platform Services、Custom Watchlists、Stock Screener、Multi-Dimensional Analysis、Financial Overview |
| **Broker & Trade Path** (Basic Function) | 3 | Broker Connect、Fundflow Radar、Insider Trading |

> **新增模块**（旧版 14 模块之外）：**Pattern Detector**（图表形态检测，app·web 即将上线）和 **VIP Discord Members Access**（VIP Discord 社群准入）—— 两者都归在 "Other Highlights"，详见 [`signals.md`](./signals.md)。
>
> **Options Services 14 项**里有 8 项标注 "coming soon" —— 实际已上线的核心是 Option Block Monitor / Option Real-Time Quote / Option Calculator / Option Rating Depth Report (EOD) / 3 个 Email 送达；Option+ SKU 详见 [`option-plus.md`](./option-plus.md)。

### 四档都包含的功能（解锁门控仅在 quota 上）

| 功能 | 适用范围 | 备注 |
|------|---------|------|
| Magic Portfolio | 四档均含 | AI 驱动的投资组合产品 |
| Magic Signal (Crypto / Stock) | 四档均含 | market 页挂 `?benefit=magic_signal&source=market_magicsignal` |
| Trend Sight (Crypto / Stock) | 四档均含 | 趋势信号 |
| Peak Seeker (Crypto / Stock) | 四档均含 | 顶/底识别 |
| Daily Insight | 四档均含 | 每日洞察 |
| Magic Day Trading | 四档均含 | 日内交易信号（market 页挂 `?benefit=magic_day_trading`） |
| Candle Advanced | 四档均含 | 高级 K 线 |
| Aime Ratings | 四档均含 | 标的评级 |
| FDA Tracker | 四档均含 | **仅 app，web 即将上线** |
| Multi-Chart View | 四档均含 | **仅 app，web 即将上线** |
| KOL Focus (Crypto) | 四档均含 | 加密 KOL 关注名单 |
| Magic Prophet (Crypto) | 四档均含 | 加密预测 |
| Ad Free (pop) | 四档均含 | 去广告弹窗 |
| Option Block Monitor | 四档均含 | 期权大单监控 |
| Rating Depth Report (Option) | 四档均含 | 评级深度报告（期权） |

→ Basic / Pro / Premium / Ultra 的大类功能集合接近，主要差异是 **quota + 优先权 + 部分 Option/高级能力的延迟或实时权限**。营销上 "Ultra" 是顶级；Fast Answer Unlimited 只属于 Ultra。

### 订阅按钮合规文案（AIME+ 必挂）

```text
To subscribe to the service, I have read and agreed with the T&C's, Privacy Policy, Disclosure and Disclosures for AI Tools
```

→ 4 个文件一次性确认：`Ainvest-Fintech-Terms-of-Use.pdf` / `Ainvest-Fintech-Inc-Privacy-Policy.pdf` / Disclosure（具体文件未单列） / `Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf`。

## 3. Option+（独立 SKU，期权数据）

- 路由：`/pricing/`（与 AIME+ 同页，靠下分段 "Option+ Great Advantages"）
- 营销图：`cdn.ainvest.com/kamisAssets/pricing_option_intro.z5aw5109rd.png`
- 卖点："Sophisticated Trading, Simplified"
- 解锁内容 / OPRA 合规 / 单设备绑定等详见 [`option-plus.md`](./option-plus.md)
- 与 AIME+ 的关系：**平行订阅**（不是 AIME+ 子档），核心差异化是 OPRA 实时 + 1v1 咨询

## 4. Magic Portfolio

- 独立 landing：`/pricing/magic-portfolio/`
- 标题："Outperform Benchmarks with Weekly AI Rebalancing: 9 Sectors & Theme-Based Portfolios"
- CTA：`/pricing/?benefit=magic_portfolio&source=pricing_magic_portfolio_home`
- 描述："Discover More Data-Driven Portfolios — Subscribe Magic Portfolio to Unlock the Data"
- 是 AIME+ 四档**都**含的功能模块之一，但本身也有独立 landing（hook SEO / 高客单搜索）
- 不要把 Magic Portfolio 当独立 tier 写——它**是 AIME+ 的子功能**

## 5. AimeClaw（营销活动，最高端）

- 营销活动名："Reserve AimeClaw"
- 标签："Get Your Private Assistant"
- 定位：**最高端 SKU** —— 1:1 私人助理级服务
- 出现在首页 hero（"Get Your Private Assistant: Reserve AimeClaw"）
- 公开页面没披露价格 / 范围 → 内部补
- 与 AIME+ / Option+ / Magic Portfolio 都没在产品矩阵里列在一起，**仅是营销叙事**

## 付费墙实现要点

| 边界 | 行为 |
|------|------|
| 试用开始 | 全功能开放 + 倒计时 banner |
| 试用到期前 24h | 弹窗 + 邮件转化 |
| 试用结束未订阅 | 回退到 free tier（保留基础行情 + 部分新闻） |
| 已订阅 AIME+ Basic | Fast 150/day + Expert 10/day |
| 已订阅 AIME+ Pro | Fast 400/day + Expert 100/day |
| 已订阅 AIME+ Premium | Fast 1000/day + Expert 200/day |
| 已订阅 AIME+ Ultra | Fast Unlimited + Expert 500/day |
| 已订 AIME+ 又订 Option+ | 解锁实时期权链 + 1v1 咨询 |
| 未登录试用 | 受限数据 + 登录墙 |
| 没订 Option+ 想看期权链 | 只显示延迟数据 / 引导订阅 |

## 取消 / 跨平台订阅管理（FAQ 实测）

- **iOS 用户**：在 App Store 取消订阅
- **Android 用户**：在 Google Play 取消
- **Web 用户**：在 `/feedback/` 提交申请，附订阅邮箱
- **App 老订阅 vs Web 新 AIME+**：如果在 app 内单独买了 Magic Portfolio / Magic Signal 等"老 SKU" 订阅，**暂时**无法在 web 端升级到 AIME+ Pro —— 需在 app 内管理，或联系 `support@ainvest.com`。官方承认这个问题在解决中。

## 客服渠道

| 渠道 | 入口 |
|------|------|
| Web 反馈 | `/feedback/`（Suggestion / Issue / Other + 上传图） |
| App 内 Send Feedback | 用户菜单 → "Send Feedback" |
| 跟 Aime 说 "live support" | `/chat/?comefrom=WebainvestNavirobot` → 转人工 |
| 电话 | **+1 (256) 217-7803**（pricing 页 FAQ 实测） |
| 邮件 | `support@ainvest.com` |

## 不要做

- ❌ 不要把"免费试用"写成"完全免费"——3 天期限是硬约束
- ❌ 不要在试用期内显示价格以外的"承诺收益"文案（合规红线）
- ❌ 不要让 trial 流量绕过 AI Risk Disclosures 链接
- ❌ 不要引用过期的 "`-- / mo`" 价格说法 —— 2026-07-07 起 `/pricing/` 已**公开**月价（Pro $34.99 / Premium $74.99 / Ultra $169.99）；年付折后价以页面 tab 切换为准
- ❌ 不要把 Magic Portfolio 当独立 tier 写——它是 AIME+ 的子模块
- ❌ 不要在 Option+ 之外的页面提 OPRA 合规文案

## 反向链接 / 跳转

- "Claim Trial" → 登录/注册 + 支付页
- "Subscribe" → AIME+ 四档选择（带 `?benefit=` 跳到对应功能落地）
- "Upgrade" → 当前订阅状态 + 升级路径（app 内）
- "Try Magic" → `/pricing/?benefit=magic_portfolio&source=pricing_magic_portfolio_home`
- "Reserve AimeClaw" → 私人助理咨询表单（具体 URL 未在公开页面披露）
