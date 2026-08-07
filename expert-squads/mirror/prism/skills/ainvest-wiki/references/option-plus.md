---
type: option-plus
last-updated: 2026-07-07
sources:
  - ainvest.com/pricing (Option+ 段)
  - ainvest.com/feedback (OPRA 弹窗)
  - cdn.ainvest.com/kamisAssets/pricing_option_intro.z5aw5109rd.png
---

# Option+ — 独立期权数据 SKU

> **Option+** 是 AInvest 体系里**独立于 AIME+** 的期权数据订阅，单独购买。挂 `OPRA terms + OPRA Professional Certification Requirement` 强制合规文案。本文件是 Option+ 全部信息的一站式。

## 定位

- **营销名**："Option+ Great Advantages" / "Sophisticated Trading, Simplified"
- **副标**："Gain institutional-grade insights with real-time options data, intelligent flow monitoring, and personalized one-on-one strategy sessions. A complete product tailored for every trading style."
- **路由**：`/pricing/` 末段（与 AIME+ 同页，靠下分段）
- **营销图**：`cdn.ainvest.com/kamisAssets/pricing_option_intro.z5aw5109rd.png`

## 卖点（4 大块）

| 功能 | 详情 |
|------|------|
| **Option Trade Ideas** | 4 种风格：YOLO / Swing / Income / Beginners |
| **Real-Time Option Chain Quotes** | 实时期权链报价（**OPRA 实时**，单设备绑定） |
| **Options Block Monitor** | 期权大单监控（**AIME+ 四档也含** —— Option+ 是主战场） |
| **1 on 1 Options Consultation** | Monthly Session 1v1 咨询 |

→ Option+ 与 AIME+ **功能有重叠**（Options Block Monitor），但 Option+ 的核心差异化是**实时期权链 + 1v1 咨询**。**主战场是专业期权用户**。

## OPRA 合规

### 订阅按钮必挂文案

> "To subscribe to the service, I have read and agreed with the **OPRA terms** and **OPRA Professional Certification Requirement**."

→ AIME+ 的 4 项合规（Terms / Privacy / Disclosure / Disclosures for AI Tools）**不适用** Option+；Option+ 用 OPRA 单独两项。

### 单设备绑定（实测，源自 feedback 页 OPRA 弹窗）

> "The current device does not have access to option market data. Would you like to switch access to this device?
> *Due to OPRA compliance requirements, users can only link option quotes to one device at a time."

→ **一台设备同时只能绑一次期权行情**。用户切换设备会触发确认弹窗。

### 命名

- **OPRA** = **Options Price Reporting Authority**（公开证券行情协会下的期权行情分发机构）
- "OPRA Professional Certification Requirement" 是机构对**接收 / 展示 OPRA 行情**的人员提出的**职业认证**要求
- 任何 web / app 端展示实时期权链的页面 / 模块，理论上**都需要** OPRA 合规约束

## 与 AIME+ 的关系

| 维度 | AIME+ | Option+ |
|------|-------|---------|
| 订阅档 | 4 档（Basic / Pro / Premium / Ultra） | 单档（详情未公开） |
| 月 / 年 | Monthly / Annually | 公开页未明示 |
| Fast / Expert Answer | 有 quota | 不适用 |
| Option Block Monitor | ✅ 含 | ✅ 含（**主战场**） |
| Real-Time Option Chain | ❌ 不含（或仅延迟数据） | ✅ OPRA 实时 |
| 1v1 咨询 | ❌ | ✅ Monthly Session |
| 合规文案 | Terms + Privacy + Disclosure + Disclosures for AI Tools | OPRA terms + OPRA Professional Certification |

→ **两者是平行订阅**，不是 AIME+ 内的子档。**Option+ 单买**即可获得期权数据；**AIME+ 单买**不送 OPRA 实时。

## 取消 / 跨平台

- 走 `/feedback/` 提交工单（与 AIME+ web 端同流程）
- 公开页没明确写 Option+ 的退款窗口 —— **Settled Revenue 定义可能在 affiliate.md 那 60 天规则不同**（待确认）

## 客服

- 走 [`company.md`](./company.md) 里的通用客服渠道：邮箱 `support@ainvest.com` / 电话 +1 (256) 217-7803 / `/feedback/`

## 命名硬规则

- **Option+**（O 大写 + ption 小写 + **+**）—— 不要写成 "Options+" / "Option Plus" / "OPRA+"
- **OPRA**（全大写）—— 不要写成 "Opra" / "opra"
- "Option Trade Ideas" / "Options Block Monitor" —— Title Case
- "1 on 1" 中间空格 + 数字 1（不是 "1on1" / "1-on-1"）

## 不要做

- ❌ 不要把 Option+ 写成 AIME+ 内的子档（**是平行订阅**）
- ❌ 不要在 Option+ 页面提 "Disclosures for AI Tools"（不适用，期权数据不属于 AI 输出）
- ❌ 不要在 AIME+ 页面提 OPRA（不适用，AIME+ 不是 OPRA 数据）
- ❌ 不要假设"一台设备绑一次"可以绕过 —— 这是 OPRA 硬约束
- ❌ 不要在公共页用 "Real-Time Option Chain Quotes" 做 OPRA 实时报价以外的承诺
