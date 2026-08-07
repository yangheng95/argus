---
type: compliance
last-updated: 2026-07-07
sources:
  - cdn.ainvest.com/agreement/*
  - ainvest.com footer
  - ainvest.com/pricing (AIME+ subscribe copy)
---

# Compliance — 合规与法律

AInvest 的合规边界一句话：**不是券商，不提供个性化投资建议**。所有交易走第三方券商；所有 AI 输出都附带风险披露。

## 关键合规文件（CDN 托管）

| 文件 | URL | 用途 |
|------|-----|------|
| Privacy Policy | https://cdn.ainvest.com/agreement/Ainvest-Fintech-Inc-Privacy-Policy.pdf | 全站 |
| Terms of Use | https://cdn.ainvest.com/agreement/Ainvest-Fintech-Terms-of-Use.pdf | 主站 |
| **AIME Terms of Use** | https://cdn.ainvest.com/agreement/AIME-Terms-of-Use.pdf | **Aime / AI 功能页必挂** |
| Third-Party Brokerage Disclaimer | https://cdn.ainvest.com/agreement/Third-Party-Brokerage-Disclaimer.pdf | **券商 / 交易页必挂** |
| **AI Risk Disclosures** | https://cdn.ainvest.com/agreement/Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf | **任何 AI 输出必挂** |
| AI Risk Disclosures (KB 别名) | https://cdn.ainvest.com/agreement/Ainvest-AI-Risk-Disclosures.pdf | KB 页 / 旧链接（footer 已切到上面那个，**别再引用本路径**） |

> **2026-06 重要更新**：footer、pricing 页和 magic-portfolio 页的 "AI Risk Disclosures" 链接全部指向新文件 `Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf`。旧名 `AInvest-AI-Risk-Disclosures.pdf` 当前 **404**（已实测）。**所有 agent 引用 / 跳转 / KB 链接都改成新文件名**。KB 入口页 `/kb/` 还有个别旧名链接残留，是站点自身的旧文，**不要**被它带偏。

### Article Editorial Disclosure（AI 协助文章的页脚标配）

任何 `/news/{slug}-{YYMM}/` 单文章页**页脚**都带一段 Editorial Disclosure & AI Transparency（实测 Adam Shapiro 文章）：

> **Editorial Disclosure & AI Transparency**: Ainvest News utilizes advanced Large Language Model (LLM) technology to synthesize and analyze real-time market data. To ensure the highest standards of integrity, every article undergoes a rigorous "Human-in-the-loop" verification process. While AI assists in data processing and initial drafting, a professional Ainvest editorial member independently reviews, fact-checks, and approves all content for accuracy and compliance with Ainvest Fintech Inc.'s editorial standards. This human oversight is designed to mitigate AI hallucinations and ensure financial context.
>
> **Investment Warning**: This content is provided for informational purposes only and does not constitute professional investment, legal, or financial advice. Markets involve inherent risks. Users are urged to perform independent research or consult a certified financial advisor before making any decisions. Ainvest Fintech Inc. disclaims all liability for actions taken based on this information.
>
> Found an error? **Report an Issue** → `https://form.typeform.com/to/V5GRCO3T?typeform-source=contact.ainvest.com`

→ 这段是 AIME Terms / Disclosures for AI Tools **之外的扩展合规**。AI 协助产出的文章**必须**带这一段（含 Human-in-the-loop 声明 + Investment Warning + Report an Issue 入口）。详见 [`editorial.md`](./editorial.md) 的 Editorial Disclosure 段。

→ `Report an Issue` 跳转的是 Typeform（`form.typeform.com/to/V5GRCO3T`），不是站内 `/feedback/`。是站点**专门为文章纠错**留的入口。

### AIME+ 订阅页订阅按钮的合规文案（实测）

AIME+ 四档（Basic / Pro / Premium / Ultra）订阅按钮前显示：

> "To subscribe to the service, I have read and agreed with the T&C's, Privacy Policy, Disclosure and **Disclosures for AI Tools**"

→ 即 AIME+ 把 Terms of Use / Privacy Policy / Disclosure / **Disclosures for AI Tools** 一并打包。Option+ 还多挂一个：

> "To subscribe to the service, I have read and agreed with the OPRA terms and OPRA Professional Certification Requirement."

→ Option+ 涉及实时期权行情，**OPRA** 单独合规要求必挂。

## 什么时候必须挂 disclaimer

| 场景 | 必挂 | 备注 |
|------|------|------|
| 任何 AI 输出（chat、chart 解读、backtest、news summarize） | AI Risk Disclosures | 链接放在输出附近 |
| `/brokers/`、Trade 页、涉及跳第三方券商 | Third-Party Brokerage Disclaimer | 跳转按钮旁 |
| Aime 聊天入口、Aime 介绍页 | AIME Terms of Use | 注册/首次使用弹窗 |
| 注册/订阅页 | Terms of Use + Privacy Policy | 同意按钮处 |
| Option+ 订阅按钮 | OPRA terms + OPRA Professional Certification Requirement | **不是** Disclosures for AI Tools |
| AIME+ 订阅按钮 | Terms / Privacy / Disclosure / Disclosures for AI Tools（4 项） | 见 [`option-plus.md`](./option-plus.md) 对照 |
| 单文章页（AI 协助产出） | Article Editorial Disclosure & AI Transparency | 文末标配段，含 Report an Issue 入口 |
| 任何地区合规要求 | Privacy Policy | 至少 footer 链 |

## 关键边界（agent 改文案时要注意）

- ❌ **不要**把 Aime / AIME 描述成"投资顾问 / financial advisor / RIA"
- ❌ **不要**承诺收益（"一定赚"、"稳赢"等）
- ❌ **不要**用 "guarantee" / "risk-free" / "保证" 这类词
- ❌ **不要**省略 AI 输出的风险披露（哪怕是 chart 解读）
- ✅ 可以用 "research" / "analyze" / "insight" / "研究 / 分析 / 洞察"
- ✅ 用 "may" / "could" / "suggests" 替代 "will" / "guarantees"
- ✅ 强调 "for informational purposes only, not investment advice"

## 商标

- "AInvest" / "Aime" / "AimeClaw" 是 AInvest Fintech Inc. 的商标
- "AIME" 是内部技术名，**不在用户面作为商标使用**（避免与品牌商标混淆）

## 数据合规

- 公开页面未明确披露 GDPR / CCPA 详情 → 内部合规团队确认
- 涉及个人信息收集的页面（注册、订阅、聊天）必须有 Privacy Policy 链接

## 不要做

- ❌ **不要**把 disclaimer 链接藏在多层导航后面（要直接可见）
- ❌ **不要**让 chat 输出里没有 AI Risk Disclosures 链接就出现
- ❌ **不要**在弹窗里关闭 disclaimer 同意流程
