---
type: company
last-updated: 2026-07-07
sources:
  - ainvest.com 首页 / about (meta title: "About Our Mission to Democratize Investing with AI - AInvest")
  - cdn.ainvest.com/agreement/*
  - career.ainvest.com
  - ainvest.com/pricing (客服电话 +1 (256) 217-7803)
  - linkedin.com/company/ainvestofficial (2026-06 实测)
---

# Company — AInvest Fintech Inc.

## 一句话

**AInvest Fintech Inc.** 是一家位于纽约的 **AI-first 金融科技公司**，做面向个人投资者的"金融数据 + 行情 + 交易 + AI 投资助理 + 预测市场"一体化平台。

公司本身**不是券商**，交易主要通过 **兄弟公司 Light Horse Securities, Inc.** 完成（不是纯外部第三方），详见下方"公司架构"。合规边界见 [`compliance.md`](./compliance.md)。

## 基本信息

| 项 | 值 |
|----|---|
| 全名 | AInvest Fintech Inc. |
| 母公司 | **AInvest Holdings Inc.**（2026-06 LinkedIn 实测披露） |
| 同集团兄弟公司 | **Light Horse Securities, Inc.**（券商牌照主体，详见下方） |
| 域名 | ainvest.com |
| 总部 | 330 7th Ave, Suite 902, New York, NY 10001, US |
| 公司类型 | AI-first 金融科技公司（fintech 资讯 + 工具平台） |
| 移动端 | iOS（App Store，AInvest `/pricing/` 显示 **4.8/5 2026-07**）+ Android（AInvest `/pricing/` 显示 **4.7/5**；Google Play 实时页抓取显示 **5.0 star / 997 reviews**） |
| 公司标语 | "Your financial world, in one intelligent hub." |
| 自述定位 | "Bloomberg Terminal meets predictive intelligence." |
| 哲学 | "We don't show data. We show what's next." |
| 使命（about 页 meta title） | "Democratize Investing with AI" |
| 版权 | Copyright 2026 AInvest Fintech Inc. All rights reserved. |
| LinkedIn 主页 | linkedin.com/company/ainvestofficial（**AINVEST HOLDINGS INC.** 名义，7,127 followers） |

## 公司架构（2026-06 LinkedIn 实测）

```text
AInvest Holdings Inc.（母公司，私营，11-50 employees）
    ├─ AInvest Fintech Inc.（fintech 软件公司，跑 ainvest.com）
    └─ Light Horse Securities, Inc.（持牌券商，承接交易）
```

- **AInvest Holdings Inc.** 是 LinkedIn / 商业活动（如 NVIDIA GTC 2026 Booth #187）使用的**对外品牌**名
- **AInvest Fintech Inc.** 是网站 footer / 法律文件 / 客服渠道的**主体公司**
- **Light Horse Securities, Inc.** 是兄弟公司，承接 ainvest.com `/brokers/` 跳出的交易执行（之前 wiki 表述为"第三方券商"，**现在明确为同集团**，因此 finance FAQ "Trade directly through your connected broker. Seamless integration with top brokers like **Light Horse**, Robinhood, Webull and more." 的 Light Horse 是**内部打通**，不是真外部）
- career 页 "Strategic Partnership With..." 实测指向的就是 Light Horse Securities / 同集团生态

### Light Horse Securities 详情（2026-06 lighthorse.io + FINRA 实测）

| 项 | 值 |
|----|---|
| 全名 | Light Horse Securities, Inc. |
| 独立站 | `lighthorse.io`（**不是** ainvest.com 子域） |
| iOS App | App Store: `light-horse-stock-trading`（id1658794284） |
| Android App | Google Play: `cn.com.ainvestbrokers` |
| CRD # | **120242**（FINRA BrokerCheck） |
| 注册 | SEC + FINRA + SIPC |
| 前身 | **Ainvest Financial Inc.**（fka Lighthorse Market Solutions, Inc.；2024-02 更名） |
| 清算方 | **Apex Clearing Corporation**（第三方托管 + 清算） |
| 交易品种 | NMS 上市美股 / ETF / ADR / **期权**（2026-07-07 lighthorse.io 实测：首页"What you can trade"已列 **Options**，且 features 列 "options"；⚠️ 注意 `/brokers/light-horse/` 的 Aime Review "Risk Considerations" 段仍写 "Options... not yet available" —— **lighthorse.io 主站为准**，broker-page review 文案滞后） |
| 佣金 | **$0**（美股 / ETF / crypto） |
| 保证金利率 | **6.75%** annual（按日计算，按月收取） |
| 初始存款 | **$100** 最低 |
| SIPC 保护 | **$500,000**（含 $250,000 现金上限） |
| 额外保险 | Apex Clearing **$150M** aggregate（单客户 $37.5M 证券 + $900K 现金） |
| 盘前/盘后 | **4 AM - 8 PM ET** |
| 零股交易 | ✅ 支持 |
| PFOF | ✅ 接受 Payment for Order Flow |
| API | `lighthorse.io/docs`（HMAC-SHA256 签名认证；trading / cash / account） |
| MCP Server | lighthorse.io 也提供 Claude / Gemini / ChatGPT 集成 |
| 净资本 | $872,409（2023-12-31，超出最低要求 $822,409） |
| 合规文件 | Form CRS: `lighthorse.io/terms/form-crs` |
| 支持邮箱 | `support@lighthorse.io` |

→ **重要**：Light Horse **不提供投资建议**，是纯 self-directed brokerage（"We do not offer you recommendations"）。AInvest 的 AI 输出（Aime / AI Writer）**不是** Light Horse 的投资建议——两者主体分离。

### Light Horse "Built for AI" 定位（2026-07-07 lighthorse.io 实测）

lighthorse.io 主站现在明确以 **AI agent 交易**为核心卖点：

- **Tagline**："Built for AI" / "The agent trades. The human stays in control."
- **核心能力**：pre-defined skills + code snippets + strategies（"preserve tokens"），为 AI agent 提供交易接口
- **接口**：markdown instructions for agents（`/instructions`）、web/mobile GUI for humans
- **Claude skill 集成**：`/instructions/ai/claude`（"Install Claude skill"）
- **ChatGPT 集成**：`/instructions/ai/chatgpt`（"Add to ChatGPT"）
- **agentMode onboarding**：`client.lighthorse.io/onboarding/?agentMode=true&utm_source=lighthorse_web`（agent 模式开户链接，带 `agentMode=true` 参数）
- **MCP Server**：lighthorse.io 也提供 Claude / Gemini / ChatGPT 集成（已在 wiki 中记录）
- **Global Clients**：支持非美国账户持有人交易美国市场

→ Light Horse 定位为 **AI-native brokerage**，与 AInvest 的 AI-first fintech 形成上下游协同（AInvest 出研究/AI 判断 → Light Horse 执行交易）。

### lighthorse.io 子路径（2026-07-07 实测）

| 路径 | 用途 |
|------|------|
| `/` | 主页（Built for AI hero + portfolio demo + skill install） |
| `/instructions` | agent 用 markdown 指令文档 |
| `/instructions/ai/claude` | Claude skill 安装 |
| `/instructions/ai/chatgpt` | ChatGPT 集成 |
| `/docs` | API 文档 |
| `/pricing` | 费率表 |
| `/terms` | Terms + Risk Disclosure |
| `/terms/form-crs` | Form CRS（Customer Relationship Summary） |
| `/terms/margin-disclosure` | Margin Disclosure |
| `client.lighthorse.io/onboarding/` | 开户 onboarding（带 `?agentMode=true&utm_source=...`） |

### lighthorse.io 静态资产

| 资产 | 路径 |
|------|------|
| Logo | `/logo.png` |
| App Store badge | `/app-store-badge.png` |
| Google Play badge | `/google-play-badge.png` |
| Claude badge | `/claude-badge.png` |
| Icon 256 | `/icon-256.png` |
| Android APK QR | `/android-apk-qr.svg` |
| Android APK 直下载 | `https://cdn.lighthorse.io/package/android/com.lighthorse.android.apk` |

### Light Horse Promotions（2026-06 实测）

- **"Open and fund with $1000.00 or more to receive 2 months AIME+ Pro"** —— ainvest.com 首页 `/brokers/` 区块可见（Light Horse 卡片）
- Public.com 合作：`promo.ainvest.com/public-open-account-get-aime-premium` —— 开户 + 入金 Public brokerage 获 6 个月 AIME+ Premium

### B2B 企业产品（2026-06 GTC 披露）

AInvest 在 NVIDIA GTC 2026（Booth #187，Session S81729）展示了 6 个企业产品：

| 产品 | 说明 |
|------|------|
| Financial Data API | 面向金融平台的 REST API（详见 [`developer-api.md`](./developer-api.md)） |
| Research Agent | 可嵌入第三方的 AI 研究代理 |
| Aime Copilot | 企业版 Aime Copilot |
| AI Digital Assistant | 通用 AI 数字助理 |
| Custom Data Visualization | 可定制数据可视化组件 |
| AI Fitting Mirror | 与 **New Port AI** 合作的 AR 试穿镜（零售/时尚场景） |

→ GTC Session 摘要："Deep Research-powered long-context framework for financial multi-modal conversational models"；同时发布了 **BizFinBench**（arXiv:2505.19457）和 **MME-Finance** 两个金融 AI benchmark，以及 **NEXUS-O**（omni-modal 基础模型）和 **GAGE**（高速评估引擎）。

## 使命

> "Every investor has a ritual. TradingView for charts. CNBC for headlines. Yahoo for quotes. Dozens of tabs, creating dozens of distractions."
>
> AInvest 把这些散点收拢到 **一个 hub**，由核心 AI 引擎 **AIME** 串起（见 [`aime.md`](./aime.md)）。

about 页新增了一组数据化痛点叙述（agent 引用时记得带源）：

- 📊 **61%** of investors feel disconnected from their own workflow
- ⚡ **80%** use multiple platforms daily to piece together the full picture
- 💡 **54%** miss key opportunities due to this fractured experience

## 联系方式

| 用途 | 联系方式 |
|------|---------|
| 用户支持邮箱 | support@ainvest.com |
| 招聘邮箱 | recruitment@ainvest.com |
| **客服电话** | **+1 (256) 217-7803**（pricing 页 FAQ 实测；非紧急工单首选邮件） |
| 联系表单 | https://contact.ainvest.com/ |
| 站内反馈 | https://www.ainvest.com/feedback/ |
| Discord | https://discord.gg/44AMr7JMtD |
| 招聘官网 | https://career.ainvest.com/ |
| 联盟注册 | https://affiliate.ainvest.com/ |

## 影响数据（自述 / 公开页面披露）

- **1.7M+** 投资者触达（`/about` 页）
- **4,000+** 每日更新和分析（`/about` 页）
- **100,000+** 实时市场信号追踪（`/about` 页）
- **2M+** Monthly Active Investors（`/pricing/` 页，2026-07；与 about 页 1.7M 口径不同，引用时注明来源页）
- **120+** Exchanges & Data Sources（`/pricing/` 页，2026-07）
- App 评分（AInvest `/pricing/` 营销页 2026-07）：**App Store 4.8/5**、**Google Play 4.7/5**
- App 评分（Google Play 实时页抓取 2026-07-07）：**5.0 star / 997 reviews**；Google 搜索结果也可能显示旧口径（如 4.4），不要混用

> 上述数字来源于 AInvest / app-store 公开页面，agent 在引用时要带来源页，不要二次推测或混用不同页面的口径。

## 文化与价值观（来自招聘页）

- **AI-First Company** —— "the coexistence of Human Intelligence and Artificial Intelligence"
- 多样性与包容性，"every voice is valued and heard"
- 员工福利：full medical coverage / 401(k) matching up to 4% / exclusive employee perks
- 招聘页文案："the future of finance... actively building it" / "Be a Tech Trendsetter" / "The Best Place to Grow Your Career"
- "Strategic Partnership With..." 出现在 career 页底部，**具体合作方未在公开页面披露** → 不要瞎填

## 团队结构（从招聘 JD + 编辑页推断）

详见 [`team-and-org.md`](./team-and-org.md)。已知线索：

- **公开在招**：PM Retail Trading Solution / Growth Manager / Social Media Marketing Specialist / Community Manager / AI Investment Logic Annotator
- **编辑团队（公开署名）**：Adam Shapiro（Managing Editor）、Jeremy Dwyer / Gavin Maguire（Senior Content Manager）、Shunan Liu / Tianhao Xu / David Feng（Editor）、Dennis Zhang / Rodder Shi（Product Manager 兼署名作者）、The Newsroom
- **外部 Contributors**：Mike Dickson、Michelle Connell、Rick Newman
- **AI Writer** 是产品化 agent 集合（约 40 位），由 AInvest news + 技术团队共建

→ 由此可推断团队至少包含 **产品 / 增长 / 营销 / 社区 / AI 训练 / 编辑 / AI Writer 工程** 七条线；工程团队通过 PM JD 中的"work closely with engineering teams"间接证实存在。

## 合规边界（高层）

- **不持有券商牌照**，交易走第三方 broker
- **不提供个性化投资建议**；AI 输出有专门风险披露（`Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf`，**新文件名**）
- 详情见 [`compliance.md`](./compliance.md)

## 不要在公司层面这样说

- ❌ "AInvest 是一家券商 / broker-dealer" —— 错。它把流量导向第三方券商。
- ❌ "AInvest 提供投资建议 / 是投资顾问" —— 错。AI 是研究/分析工具，不是 RIA。
- ❌ "AInvest 的总部在硅谷" —— 错。在纽约曼哈顿。
- ❌ "AInvest 2026 的使命是 X"—— about 页只挂"Democratize Investing with AI"，不要外推。

## 2026-06 / 2026-07 更新项摘要

- ✅ **Prediction Markets** 产品上线（`/prediction/`，详见 [`prediction-markets.md`](./prediction-markets.md)）
- ✅ **AInvest Holdings Inc.** 母公司身份曝光（LinkedIn 公开）
- ✅ **Light Horse Securities, Inc.** 确认为同集团兄弟公司（券商牌照主体）
- ✅ LinkedIn 公布员工数区间 **11-50**
- ✅ AIME+ quota 已下调并在 2026-07 新增 **Ultra** tier（详见 [`business-model.md`](./business-model.md)）
- ✅ App 评分存在**页面口径差异**：AInvest `/pricing/` 营销页显示 App Store 4.8 / Google Play 4.7；Google Play 实时页抓取显示 5.0 star / 997 reviews。引用时必须带来源页，不再写单一全局评分。
