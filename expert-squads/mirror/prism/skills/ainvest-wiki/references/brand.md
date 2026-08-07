---
type: brand
last-updated: 2026-07-07
sources:
  - ainvest.com 首页 / footer / about
  - 公开社交账号
  - cdn.ainvest.com/kamisAssets/*
---

# Brand — 品牌资源

## 名称

- **AInvest**（主品牌） / **AInvest Fintech Inc.**（公司全名）
- **Aime**（AI 助理的用户面品牌）/ **AIME**（内部引擎名，**只在工程/代码**用） / **AIME+**（订阅品牌，带 + 号）
- **AimeClaw**（私人助理营销活动名）
- **AI Writer**（产品化 AI 写作 agent 集合名，~40 位 agent）
- **Option+**（独立期权数据 SKU，带 + 号）

## 标语

| 语境 | 标语 |
|------|------|
| 主定位 | "Your financial world, in one intelligent hub." |
| 自我对标 | "Bloomberg Terminal meets predictive intelligence." |
| 哲学 | "We don't show data. We show what's next." |
| 价值主张 | "Every investor has habits. We built the reason to break them." |
| AI 主张 | "This isn't automation. This is intelligence." |
| AIME+ 营销 | "SMARTER INVESTING, POWERED BY AIME+" / "2026 PLANS" / "Autonomous AI Meets Real-Time Market Intel. Unlock Your Edge." |
| Aime Robo-Advisor | meta title 自标 "AI Investment Chat - Robo-Advisor Assistant" |

## 视觉

- **主色**：`#165DFF`（light）/ `#3371FF`（dark）—— 详见 [`design-system.md`](./design-system.md) + `DESIGN.md`
- **Logo 资源 CDN**：`cdn.ainvest.com/kamisAssets/`
  - Logo（亮色）：`icon_menu_logo_dark.wp20iq3a1ms.png`（注意：文件命名 `dark` 但用作 footer 主 logo；行为约定需代码层确认）
  - Aime 形象图：`aime.bpo45whq8xi.png`
  - Google Ads 横幅：`Googleadd-1.qb2n27sjewf.png`
  - 社交图标：`discord.xxesa164dog.png` / `linkedin.p2f3clfqcu.png` / `youtube.nx3tlrbzrf.png` / `ins.r538eqfoyn.png` / `twitter.8dk0zjrc8ou.png` / `tiktok.2dm7r1gi12w.png`
  - About 页 hero 图：`Group2147203012.powy3idmdu.png`
  - Option+ 介绍图：`pricing_option_intro.z5aw5109rd.png`
  - Market 页"下载 App"广告位：`adv-download.4zxma5e430i.png`
  - Market 页"用 Aime"广告位：`adv-market-aime.26r63uvakw1.png`
  - Screener 通用卡片封面：`ainvest-stock-etf-crypto.mbkns3210dl.png`
- **股票/币种图标**：
  - 美股：`cdn.ainvest.com/icon/us/{TICKER}.png`
  - ETF：`cdn.ainvest.com/icon/us/etf/{TICKER}.png`
  - 加密：`cdn.ainvest.com/icon/crypto/{SYMBOL}USDT.png`
- **社交头像**：`cdn.ainvest.com/social/account/portraits/{name}.png`（编辑作者 + AI Writer agent）
- **Screener 主题封面**（动态生成）：`cdn.ainvest.com/yyzt/upload/common/{uuid}.png?format=webp&width=636&height=356`

## 字体

- UI / 默认：`var(--font-geist-sans)` → 系统 sans
- 新闻 / 编辑：`NewYork`（iOS/macOS）/ `PTSerif`（Android）
- **不要**把 NewYork/PTSerif 用在 UI 上（详见 `DESIGN.md` 中 Do's & Don'ts）

## 域名清单

详见 [`site-map.md`](./site-map.md)

- `ainvest.com`（主站）
- `chart.ainvest.com`（AI Charts）
- `crypto.ainvest.com`（加密）
- `career.ainvest.com`（招聘）
- `affiliate.ainvest.com`（联盟）
- `contact.ainvest.com`（联系表单）
- `cdn.ainvest.com`（资产 CDN，path 前缀 `/agreement/`、`/kamisAssets/`、`/icon/`、`/yyzt/upload/common/`、`/social/account/portraits/`、`/articles/focusnews/coverimage/content/pictures/`、`/screener/images/`）

## 社交账号

| 平台 | 账号 / 链接 |
|------|------------|
| Discord | https://discord.gg/44AMr7JMtD |
| LinkedIn | https://www.linkedin.com/showcase/ainvest-fintech-inc/ |
| YouTube | https://www.youtube.com/@ainvestofficial |
| Instagram | https://www.instagram.com/ainvest_fintech/ |
| Twitter / X | https://twitter.com/AInvestOfficial（员工/公司账号同 handle） |
| TikTok | https://www.tiktok.com/@ainvestofficial |

## 移动端

- iOS：App Store，**4.8/5**（2026-07，AInvest `/pricing/` 营销页显示；App Store 实时评分需以 Apple 页面为准）
- Android：Google Play，AInvest `/pricing/` 营销页显示 **4.7/5**；Google Play 实时页抓取显示 **5.0 star / 997 reviews**（2026-07-07，口径不同，引用时标明来源）
- 推广页：`/download/`

## 文案 voice

- **专业、克制、主动**（不要浮夸营销腔）
- 拟人化 Aime 时用 she/her
- 涉及 AI 能力时配套风险披露链接（[`compliance.md`](./compliance.md)）
- 提到交易 / 券商时挂 Third-Party Brokerage Disclaimer
- AIME+ / Option+ 订阅按钮前必须带"已读且同意"勾选文案（AIME+ 4 项，Option+ 2 项 OPRA）

## 不要做

- ❌ 不要在用户面文案里把 Aime 写成 "AIME"
- ❌ 不要把 Aime 拟人成 "he"
- ❌ 不要混用 NewYork 字体到 UI 元素
- ❌ 不要用 `#00C853` 之类硬编码绿/红 —— 一律走 `price-up/price-down` token
- ❌ 不要把 AIME+ 写成 "Aime+" / "Aime Plus" —— **统一是 AIME+**（带 + 号、大写）
- ❌ 不要把 Option+ 写成 "Options+" / "Option Plus" —— **统一是 Option+**
