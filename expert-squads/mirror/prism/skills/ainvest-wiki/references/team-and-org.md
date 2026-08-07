---
type: team
last-updated: 2026-07-07
sources:
  - career.ainvest.com
  - ainvest.com/news/author/ (公开编辑团队 + 贡献者 + AI Writer 名册)
  - ainvest.com/pricing (客服电话)
  - linkedin.com/company/ainvestofficial (AINVEST HOLDINGS INC. 2026-06 实测)
---

# Team & Org — 团队结构信号

> AInvest 没有公开组织架构图。本文件基于 `career.ainvest.com` 公开 JD + `/news/author/` 公开编辑名册 + **LinkedIn AINVEST HOLDINGS INC. 公司页（2026-06 实测）** 反推团队能力，**不写**未在公开渠道出现的角色或具体人数。

## 母公司架构（2026-06 LinkedIn 实测）

```text
AInvest Holdings Inc.（母公司，privately held，11-50 employees）
    ├─ AInvest Fintech Inc.（fintech 软件，跑 ainvest.com）
    └─ Light Horse Securities, Inc.（券商牌照，承接交易）
```

- **AINVEST HOLDINGS INC.** 是对外公司页名（LinkedIn），7,127 followers
- **Light Horse Securities, Inc.** 是 ainvest.com 的**核心券商合作方**（pricing FAQ "Light Horse / Robinhood / Webull" 排第一位）—— 2026-06 确认为**同集团**，不是纯外部第三方
- career 页 "Strategic Partnership With..." 推断即指 Light Horse Securities

## 公开在招的岗位（career.ainvest.com）

| 岗位 | 隐含的能力 / 团队 | 关键信号 |
|------|------------------|---------|
| **Product Manager — Retail Trading Solution** | 零售交易产品线 | 与工程紧密协作；5+ PM 经验；Agile；金融/交易背景 |
| **Growth Manager** | 增长 / 数据驱动增长 | A/B 测试、转化漏斗、付费渠道 |
| **Social Media Marketing Specialist** | 营销 / 社媒 | 多平台运营、付费社媒投放 |
| **Community Manager** | 社区 / 用户关系 | Discord / Slack / Discourse 经验 |
| **AI Investment Logic Annotator** | AI 训练 / 数据标注 | 投研逻辑标注；为模型训练供数据 |

## 公开编辑 / 内容团队（`/news/author/`）

人类编辑（9 位）+ 外部贡献者（3 位）+ AI Writer 约 40 位 agent 的完整名册见 [`editorial.md`](./editorial.md)。

## 推断的团队线

```text
AInvest
├── Product（公开至少 2 位 PM：Retail Trading + 投研方向；Dennis Zhang / Rodder Shi 横跨产品和编辑）
├── Engineering（PM JD 间接证实；同时支撑 AI Writer 工程）
├── Growth / Marketing
│   ├── Growth Manager
│   └── Social Media Marketing
├── Community / User Success
│   └── Community Manager
├── Editorial / Content（详见 editorial.md）
│   ├── Managing Editor (Adam Shapiro)
│   ├── Senior Content Manager (Jeremy Dwyer / Gavin Maguire)
│   ├── Editor (Shunan Liu / Tianhao Xu / David Feng)
│   ├── Contributors (Mike Dickson / Michelle Connell / Rick Newman)
│   └── AI Writer（~40 位 agent 集合，由 news + tech 团队共建）
├── Business Partnership / Affiliate（affiliate.ainvest.com 业务线；推断）
└── AI / Research
    └── AI Training Data（Investment Logic Annotator）+ AI Writer 工程
```

## 推断的工程能力（间接信号）

- **前端 / Web**：站点有完整 light/dark 主题、atom token、组件库（DESIGN.md 推断）
- **移动 + 桌面**：iOS（App Store，4.8/5）+ Android（Google Play，4.7/5）+ **MacOS + Windows 桌面 App**（2026-07 `/pricing/` + `/download/` 实测）
- **数据 / 后端**：处理 100,000+ 实时市场信号、4,000+ 每日更新（来自 about 页）
- **AI / 模型**：AIME 引擎 + 投资逻辑标注团队（推断含 LLM 调优 / RLHF / 投研 reasoning chain）
- **AI Writer 工程**：基于多个开源 LLM + 财经编辑微调 + 人审流水线
- **合规 / 法务**：独立的 AIME Terms、Brokerage Disclaimer、Disclosures for AI Tools、OPRA terms（间接证实法务存在）

## 福利（来自 career 页）

- Full medical coverage
- 401(k) matching up to 4%
- Exclusive employee perks

## 文化信号

- "AI-First Company"
- "coexistence of Human Intelligence and Artificial Intelligence"
- 多样性、"every voice is valued and heard"
- 与某机构 "Strategic Partnership With..."（具体对象未在公开页面披露）
- 招聘页宣传语："Be a Tech Trendsetter" / "The Best Place to Grow Your Career" / "Diversity and Culture"

## 联系方式

- 招聘邮箱：`recruitment@ainvest.com`
- 投递邮件标题格式：`Application for <Job Title>`（来自页面 "Apply Now" 链接 mailto；注意 Growth / Social / Community 三个岗位的 Apply Now 当前仍沿用 PM 的 subject 模板，是站点 bug，**不影响实际投递**）
- 客服电话：**+1 (256) 217-7803**

## 注意

- ❌ **不要** 写未在 JD 中出现的具体员工数 / 部门数 / 汇报线
- ❌ **不要** 推测未公开的团队负责人名字
- ❌ **不要** 假设具体技术栈（后端语言、数据库、ML 框架）—— 公开信息不足以支撑
- ✅ 可以基于 JD 用语推断**能力 / 协作模式**
- ✅ 编辑 + AI Writer 名册去 [`editorial.md`](./editorial.md)；这里只放产品 / 工程的推断组织架构
- ✅ 写 "AI Writer" 时记得是产品化 agent 集合名，不是单人
