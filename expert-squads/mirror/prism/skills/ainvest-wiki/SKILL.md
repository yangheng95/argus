---
name: ainvest-wiki
description: "Internal knowledge wiki for AInvest Fintech Inc. (ainvest.com) — AI-first fintech, AIME engine + Aime assistant (she/her), 10 products + AIME+ subscription (4 tiers: Basic/Pro/Premium/Ultra) + Option+ (OPRA) + Prediction Markets (Polymarket aggregator), AI Writer editorial agents, 4-platform apps (iOS / Android / MacOS / Windows), affiliate 3-tier, compliance PDFs, Nova design tokens, CDN assets, domains/routes, editorial roster. Trigger phrases — ainvest, AIME, AIME+, Aime, AInvest Nova, Magic Portfolio, AimeClaw, AI Writer, Option+, OPRA, price-up token, prediction markets, World Cup, screener, Polymarket, lighthorse, logo, banner, assets."
---

# AInvest Wiki

## 30-second elevator pitch

**AInvest Fintech Inc.** is a New York-based **AI-first fintech** running **ainvest.com** — a unified hub for financial data, market analytics, charting, news, screening, prediction markets, and trading-prep, all stitched together by the **AIME** (AInvest Market Engine) AI engine. The user-facing AI assistant is called **Aime** (pronoun: *she*).

- Positioning: *"Your financial world, in one intelligent hub."* / *"Bloomberg Terminal meets predictive intelligence."*
- Not a broker — trading is delegated to **Light Horse Securities, Inc.** (sibling company under **AInvest Holdings Inc.**) + external partners (Robinhood, Webull)
- Reach: 1.7M+ investor reach, 4,000+ daily updates, 100,000+ market signals (`/about`); 2M+ monthly active investors and 120+ exchanges/data sources (`/pricing`) — self-reported, different page scopes
- HQ: 330 7th Ave, Suite 902, New York, NY 10001
- Parent: **AInvest Holdings Inc.** (privately held, 11-50 employees; disclosed 2026-06 via LinkedIn)

## Reference file index

All detailed knowledge is in `references/`. Read the specific file(s) for the user's question; do **not** preload everything.

| references/ file | When to read it |
|------------------|-----------------|
| `company.md` | Company entity, address, mission, contacts, public-impact stats, support phone |
| `products.md` | The **10 products** + Option+ + Prediction Markets + 移动/桌面 App + screener 类别 |
| `prediction-markets.md` | Prediction Markets — Polymarket 聚合 + AIME Briefing + 跳转 ref + 合规边界（**2026-06 新增**） |
| `developer-api.md` | AInvest 公开开发者 API（`docs.ainvest.com`）+ MCP server + B2B 企业产品 + NEXUS-O / GAGE / BizFinBench / MME-Finance（**2026-06 新增**） |
| `signals.md` | AIME+ 16 功能模块速查（Magic Signal / Trend Sight / Peak Seeker / Pattern Detector / VIP Discord / ...） |
| `option-plus.md` | Option+ SKU + OPRA 合规 + 单设备绑定 |
| `aime.md` | AIME engine + Robo-Advisor 定位 + Fast/Expert Answer quota |
| `markets.md` | US stocks / crypto / ETF / 期权 + screener 29 categories (260 presets: 174 stock + 86 ETF) |
| `business-model.md` | 3-Day Trial → AIME+ 四档（Basic/Pro/Premium/Ultra）→ Option+ → Magic Portfolio → AimeClaw |
| `editorial.md` | 9 人类编辑 + 3 贡献者 + ~40 AI Writer agent 名册 + Editorial Disclosure |
| `team-and-org.md` | 公开招聘 JD + 推断团队线（**编辑 / AI Writer 名册见 editorial.md**） |
| `kb.md` | KB 10 主题速查 + 与 references/ 配套关系 |
| `affiliate.md` | 联盟 3 档（Partner 20% / Pro 30% / Elite 40%）+ Anti-Fraud / Locked-In 规则 |
| `brand.md` | Logo, taglines, fonts, social channels, CDN asset paths |
| `assets.md` | **Complete asset inventory** — secondary static assets (broker icons, social icons, download badges, demo videos, favicon), dynamic/parameterized URL patterns, fonts, compliance PDFs |
| `design-system.md` | Lightweight index pointing into `DESIGN.md` |
| `DESIGN.md` | Full design tokens — colors, typography, components, do/don'ts (~592 lines) |
| `web-interactions.md` | Web interaction patterns — hover/click/focus states, transitions, modals, loading, scroll, keyboard (**2026-06 新增**) |
| `compliance.md` | Legal PDFs, disclaimer-attachment rules, language to avoid, Article Editorial Disclosure |
| `glossary.md` | Term-by-term canonical spellings, words to avoid, naming rules |
| `site-map.md` | Domains, subdomains, routes, CDN paths, URL patterns |

> Reference files often link to each other with `./file.md`-style paths — those links resolve relative to the `references/` folder. The top-level `AInvest Fintech Inc.` entity is canonical, and any cross-file conflicts are resolved by the file marked as authoritative for that topic (e.g. `compliance.md` wins on legal language).

## Routing — pick the right reference file

Map the user's intent to the minimum set of references to load. Grouped by topic area.

### Company & People

| User's question / task | Read these first |
|------------------------|------------------|
| "What is AInvest?" / "Who is AInvest?" | `company.md` → optionally `products.md`, `aime.md` |
| News articles, AI Writer, editorial team, bylines | `editorial.md` |
| Hiring, org structure, who does what | `team-and-org.md` |
| Light Horse Securities / brokerage / trading API | `company.md` (Light Horse section) + `site-map.md` (lighthorse.io) |

### Products & Features

| User's question / task | Read these first |
|------------------------|------------------|
| "List AInvest products" / change a product page | `products.md` (+ `aime.md` if AI-related) |
| Anything about Aime / the AI assistant | `aime.md` (+ `compliance.md` for tone limits) |
| "List AIME+ features" / change a signal page | `signals.md` (+ `business-model.md` for quota) |
| Prediction Markets / World Cup / Polymarket | `prediction-markets.md` + `products.md` |
| Option+ / OPRA / 期权数据 | `option-plus.md` (+ `business-model.md`) |
| Subscription, trial, paywall, Magic Portfolio | `business-model.md` |
| KB topics, learning content | `kb.md` |
| Price colors / charts / market-color rules | `markets.md` + `DESIGN.md` (search `price-up`, `price-crypto-up`) |

### Compliance & Legal

| User's question / task | Read these first |
|------------------------|------------------|
| Compliance, disclaimers, legal copy, broker pages | `compliance.md` (+ `site-map.md` for PDF URLs) (+ `assets.md` for direct PDF links) |
| Affiliate / 联盟计划 | `affiliate.md` |

### Design & Assets

| User's question / task | Read these first |
|------------------------|------------------|
| Pricing of color/typography/components, dark mode | `design-system.md` → then `DESIGN.md` |
| Anything that touches the codebase visuals | `design-system.md` + `DESIGN.md` |
| Hover/click/focus states, transitions, animations, modals, loading | `web-interactions.md` (+ `DESIGN.md` for tokens) |
| Keyboard accessibility, focus ring, focus management | `web-interactions.md` |
| Brand assets, logo, banners, social links | **Common CDN Assets** section above (static, reusable) |
| Stock/crypto/ETF icons, author portraits, news covers, screener covers | `assets.md` (dynamic/parameterized URL patterns) |

### Infrastructure, API & Cross-refs

| User's question / task | Read these first |
|------------------------|------------------|
| Developer API / B2B / MCP server / NEXUS-O / BizFinBench | `developer-api.md` + `company.md` (B2B section) |
| Domains, routes, subdomains, KB paths | `site-map.md` |
| Naming, spelling, terms to avoid | `glossary.md` |

## Common CDN Assets (Static — commonly used in web/UI work)

Quick-reference of the most frequently needed static AInvest assets. All are `https://cdn.ainvest.com/kamisAssets/` unless noted otherwise.

> For **less common static assets** (broker icons, social icons, download badges, demo videos, favicon) and all **dynamic/parameterized URL patterns** → see [`references/assets.md`](./references/assets.md).

### Brand & Identity

| Asset | Full CDN URL |
|-------|-------------|
| **Logo** (main, dark variant) | `https://cdn.ainvest.com/kamisAssets/icon_menu_logo_dark.wp20iq3a1ms.png` |
| **Aime** (AI assistant mascot) | `https://cdn.ainvest.com/kamisAssets/aime.bpo45whq8xi.png` |

### Banners & Hero Images

| Asset | Full CDN URL |
|-------|-------------|
| Google Ads banner | `https://cdn.ainvest.com/kamisAssets/Googleadd-1.qb2n27sjewf.png` |
| Market "Download App" | `https://cdn.ainvest.com/kamisAssets/adv-download.4zxma5e430i.png` |
| Market "Use Aime" | `https://cdn.ainvest.com/kamisAssets/adv-market-aime.26r63uvakw1.png` |
| Article "Ask Aime Lite" | `https://cdn.ainvest.com/kamisAssets/adv-lite-aime.h7rk9lwd314.png` |
| About page hero | `https://cdn.ainvest.com/kamisAssets/Group2147203012.powy3idmdu.png` |

### Product Graphics

| Asset | Full CDN URL |
|-------|-------------|
| Option+ intro graphic | `https://cdn.ainvest.com/kamisAssets/pricing_option_intro.z5aw5109rd.png` |
| Screener generic card cover | `https://cdn.ainvest.com/kamisAssets/ainvest-stock-etf-crypto.mbkns3210dl.png` |
| Portfolio analysis graphic | `https://cdn.ainvest.com/kamisAssets/portfolio.ggxi53p96ct.png?format=webp` |

## Hard rules (always enforce)

These constraints apply across the AInvest codebase and outputs. Violating them is a review-blocker.

1. **Price colors are semantic tokens**, not generic green/red. Use `price-up` / `price-down`. Crypto uses separate tokens: `price-crypto-up` / `price-crypto-down`. **Never** use Tailwind `green-500` / `red-500` for price changes.
2. **All colors go through atom tokens** (`--atom-color-*` CSS variables + Tailwind utilities). **No hard-coded hex** — it breaks dark mode.
3. **Dual mode is required.** All UI must support light + dark. In dark mode, use `background-layer3/layer4` layering — **do not** use shadow-based elevation.
4. **Rounded corners on interactive elements** (4–8px for cards/inputs; fully rounded ~9999px / pill for buttons and badges). **No `border-radius: 0`** on interactive elements — flat zero is reserved for data tables and dividers.
5. **Aime's pronoun is "she" / "her"** in all user-facing copy. This is an intentional persona decision.
6. **Brand spelling is `Aime`** (capital A, lowercase rest) for user-facing copy. Engine/code name is `AIME` (AInvest Market Engine) — keep that only inside code/tokens, never in marketing copy.
7. **Any AI output requires the AI Risk Disclosures link** (`Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf` on `cdn.ainvest.com/agreement/`). Hard compliance requirement. The old name `AInvest-AI-Risk-Disclosures.pdf` is **404** as of 2026-06 — always use the new filename.
8. **Third-party broker pages require the Third-Party Brokerage Disclaimer** PDF link.
9. **Editorial fonts (NewYork / PTSerif) are for article titles only.** Never use them in UI chrome.
10. **Adding a new color requires extending the atom-token system** (`variables-v1.css` *and* `tailwind.config.ts` in sync).
11. **Button hover variants are siblings, not nested.** Write `button-primary-hover`, never `button-primary.hover`.
12. **AIME+ has FOUR tiers as listed on `/pricing/` (2026-07-07):** Basic 150/10 (Free), Pro 400/100 (**$34.99/mo**), Premium 1000/200 (**$74.99/mo**, "Best"), **Ultra Unlimited/500** (**$169.99/mo**) — Fast Answer / Expert Answer per day. `/pricing/` now **publicly** shows all four prices (Monthly + Yearly tabs; annual = lower per-month). **Unlimited Fast Answer now belongs only to Ultra** — Premium is capped at 1000. Do **not** quote old numbers (200/20, 500/100), claim Premium is Unlimited, or repeat the stale "`-- / mo`" wording.
13. **Light Horse Securities, Inc. is a sibling company under AInvest Holdings Inc.**, not an external third-party broker. Robinhood and Webull are external partners.
14. **Common static assets (logo, Aime mascot, banners, product graphics) live in the "Common CDN Assets" table above** — all on `https://cdn.ainvest.com/kamisAssets/`. When a task needs a logo, Aime visual, or banner, **first look up the exact URL in that table**; for less common static assets or any **dynamic/parameterized URL** (stock/crypto/ETF icons, author portraits, news covers, screener covers) use `references/assets.md`. **Never invent, guess, or hard-code an image URL** — always copy the canonical CDN path from the wiki. The Aime mascot specifically is `https://cdn.ainvest.com/kamisAssets/aime.bpo45whq8xi.png`; do not rename it to `aime.png` or similar.

## What NOT to do

- ❌ Do **not** call AInvest a broker, broker-dealer, or RIA. It is a **fintech data + tools platform**; trading is executed via **Light Horse Securities (sibling company)** + external brokers (Robinhood, Webull).
- ❌ Do **not** spell the AI assistant as `AIME` in user-facing copy. Use `Aime`. (`AIME` is the engine name and stays in code only.)
- ❌ Do **not** call Aime *he/his*. Pronoun is *she/her*.
- ❌ Do **not** promise returns or use words like *guaranteed*, *risk-free*, *will profit*. Use research / analyze / insights / *may* / *could* instead.
- ❌ Do **not** mirror the design tokens in the wiki — `DESIGN.md` is the single source of truth for tokens.
- ❌ Do **not** invent internal facts (employee count, tech stack, DB schemas). If a fact isn't in the references, say so — don't guess.
- ❌ Do **not** add marketing tone to wiki files. They are engineering docs for agents: factual, anchored, concise.

## Core entity tree

```text
AInvest Holdings Inc. (NY, parent — privately held, 11-50 employees)
   ├─ Light Horse Securities, Inc. (brokerage, under same group)
   └─ AInvest Fintech Inc. (NY)
        └─ ainvest.com (web + iOS / Android / MacOS / Windows apps)
             ├─ Aime          ── user-facing AI assistant (chat + proactive monitoring)
             ├─ AI Charts     ── chart.ainvest.com, AI pattern recognition
             ├─ Super Charts  ── /chart?symbol=... advanced indicators + drawing
             ├─ Screener      ── 29 categories (16 stock + 13 ETF), 260 presets (174 stock + 86 ETF) + custom screening
             ├─ Newswire      ── news feed + editorial team + AI Writer agents
             ├─ Markets       ── stock + crypto market dashboards
             ├─ Portfolio     ── /watchlist/, plus Magic Portfolio (paid)
             ├─ Trade         ── /brokers/ — Light Horse (same group) + TradeStation / Interactive Brokers / Public / Paper Trading / Webull + "Show more" (Robinhood / Fidelity / Vanguard / E-Trade / Schwab / Alpaca / Wealthsimple / Questrade / Trading212 via brokers.ainvest.com compare hub, 23+)
             ├─ Prediction Markets ── /prediction/ Polymarket aggregator + AIME Briefing (**2026-06 新增**)
             └─ AIME (engine) ── shared core AI powering all the above
```

## Quick-reference cheat sheet

- **Brand primary color:** `#165DFF` light / `#3371FF` dark (see `DESIGN.md`)
- **Stock price colors:** `price-up` green / `price-down` red
- **Crypto price colors:** `price-crypto-up` teal / `price-crypto-down` pink (intentionally distinct from stock colors)
- **Aime pronoun:** *she / her*
- **Required PDFs:**
  - `cdn.ainvest.com/agreement/Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf` — attached to any AI output
  - `cdn.ainvest.com/agreement/Third-Party-Brokerage-Disclaimer.pdf` — attached to broker pages
  - `cdn.ainvest.com/agreement/AIME-Terms-of-Use.pdf` — Aime intro/onboarding
- **Address:** 330 7th Ave, Suite 902, New York, NY 10001, US
- **Support email:** `support@ainvest.com`
- **Support phone:** `+1 (256) 217-7803`
- **Recruiting email:** `recruitment@ainvest.com`
- **Subscription brand:** `AIME+` (4 tiers: Basic / Pro / Premium / Ultra, monthly + yearly)
- **AIME+ quotas & prices (2026-07-07):** Basic = **150 Fast / 10 Expert** (Free), Pro = **400 / 100** ($34.99/mo), Premium = **1000 / 200** ($74.99/mo, "Best"), Ultra = **Unlimited / 500** ($169.99/mo). `/pricing/` now publicly shows all four prices (Monthly + Yearly tabs; annual = lower per-month rate).
- **AIME+ output names (2026-07):** `/pricing/` uses **AIME Fast Answer / AIME Expert Answer**; `/product/featured/` uses **Aime Copilot / Aime Deep Research**. Both name sets coexist.
- **Parent company:** AInvest Holdings Inc. (includes Light Horse Securities, Inc.)
- **Light Horse Securities:** CRD #120242, FINRA+SIPC, Apex Clearing, $0 commission, lighthorse.io, 4AM-8PM ET extended hours
- **Developer API:** docs.ainvest.com (free tier, MCP server at docsmcp.ainvest.com)
- **Prediction Markets:** `/prediction/` — Polymarket aggregator with AIME Briefing (not a subscription product)
- **Compliance PDF old name `AInvest-AI-Risk-Disclosures.pdf` is 404** — always use `Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf`
- **Common static assets (logo, Aime mascot, banners, product graphics):** look them up in the **Common CDN Assets** table above — all live under `https://cdn.ainvest.com/kamisAssets/`. Copy the exact URL; do not rename, re-host, or re-encode.
- **Aime mascot:** `https://cdn.ainvest.com/kamisAssets/aime.bpo45whq8xi.png` — this is the only sanctioned Aime image. Use it for any AI-assistant visual (avatars, prompts, banners, empty states).
- **Less common or dynamic assets** (broker icons, social icons, download badges, demo videos, favicon, stock/crypto/ETF icons, author portraits, news covers, screener covers): see `references/assets.md` for both static inventory and parameterized URL patterns.

## Source-of-truth priority

When facts conflict, prefer sources in this order:

1. `ainvest.com` public pages (home, `/about`, `/kb`, `/news/author`, `/pricing`, **`/prediction/`**)
2. `career.ainvest.com` (job posts — useful to infer team capabilities)
3. `cdn.ainvest.com/agreement/*` (compliance PDFs)
4. `DESIGN.md` (design system, canonical for tokens)
5. Public social accounts (Discord / LinkedIn / YouTube / Twitter / Instagram / TikTok)
6. `linkedin.com/company/ainvestofficial` (AINVEST HOLDINGS INC. parent entity — 2026-06 disclosure of Light Horse Securities relationship)

**Do not fabricate** anything that isn't in these sources. If the user requests an internal-only detail, ask them to add it to an `internal/` folder rather than polluting the public wiki.

## Maintenance rules (when editing the wiki)

- New topic → add a row to the **Reference file index** table above
- Renamed product or term → grep both `SKILL.md` and `references/` for the old name, then update `references/glossary.md` first, then update every consumer
- Changed company info (address, plan name) → update `references/company.md` or `references/business-model.md`
- Design token change → edit `references/DESIGN.md` only (the wiki does **not** mirror tokens)
- Before deleting any file, grep `SKILL.md` and `references/` for the filename to avoid dangling links
- Cross-wiki links use bare filenames (e.g. `./products.md`) — never absolute paths
- External resources (PDFs, CDN URLs) live in `compliance.md` and `brand.md`; everywhere else links to them
