---
type: assets
last-updated: 2026-07-07
sources:
  - ainvest.com live scraping (home, /about, /pricing, /aime, /download, /market, /prediction, /screener, /screener/etfs, /news, /news/author, /news/wire, /brokers, /brokers/light-horse, /watchlist, /kb, /stocks/NASDAQ-AAPL, /pricing/magic-portfolio)
---

# Assets — Complete Inventory

## Static Assets (secondary — less commonly used)

Static named files that are not in the SKILL.md quick-reference. For quick-access brand/banner/product assets, see SKILL.md directly.

### Identity (secondary)

| Asset | Full CDN URL |
|-------|-------------|
| Favicon | `https://cdn.ainvest.com/favicon.ico` |
| Logo (insight/affiliate variant) | `https://cdn.ainvest.com/insight/ainvest-logo.png` |

### Broker Icons

Fixed filenames on `https://cdn.ainvest.com/icon/brokers/`. Full list (15 as of 2026-07-07; `Public.png` confirmed via `/brokers/` first-screen):

| Broker | CDN URL |
|--------|---------|
| Light Horse Securities | `https://cdn.ainvest.com/icon/brokers/LightHorse.png` |
| Interactive Brokers | `https://cdn.ainvest.com/icon/brokers/InteractiveBrokers.png` |
| Public | `https://cdn.ainvest.com/icon/brokers/Public.png` |
| Robinhood | `https://cdn.ainvest.com/icon/brokers/Robinhood.png` |
| Webull | `https://cdn.ainvest.com/icon/brokers/Webull.png` |
| Fidelity | `https://cdn.ainvest.com/icon/brokers/Fidelity.png` |
| Charles Schwab | `https://cdn.ainvest.com/icon/brokers/Charles%20Schwab.png` |
| E-Trade | `https://cdn.ainvest.com/icon/brokers/E-Trade.png` |
| Vanguard | `https://cdn.ainvest.com/icon/brokers/Vanguard.png` |
| TradeStation | `https://cdn.ainvest.com/icon/brokers/TradeStation.png` |
| Alpaca | `https://cdn.ainvest.com/icon/brokers/Alpaca.png` |
| Questrade | `https://cdn.ainvest.com/icon/brokers/Questrade.png` |
| Trading 212 | `https://cdn.ainvest.com/icon/brokers/Trading212.png` |
| Wealthsimple | `https://cdn.ainvest.com/icon/brokers/Wealthsimple.png` |
| Paper Trading (demo) | `https://cdn.ainvest.com/icon/brokers/AinvestPaperTrading.png` |

### Broker Feature Icons

Static PNGs used as feature badges on broker detail/card components.

| Asset | Full CDN URL |
|-------|-------------|
| Check / verified | `https://cdn.ainvest.com/icon/brokers/icon_check.png` |
| Clock / speed | `https://cdn.ainvest.com/icon/brokers/icon_clock.png` |
| Minute / time | `https://cdn.ainvest.com/icon/brokers/icon_minute.png` |
| Money / pricing | `https://cdn.ainvest.com/icon/brokers/icon_money.png` |

### Broker Page Aime Review Assets (broker detail pages)

Static assets used on `/brokers/{broker}/` detail pages for the "Aime Broker Reviews" + "Aime Review" + "Ask Aime" sections (confirmed via `/brokers/light-horse/` 2026-07-07).

| Asset | Full CDN URL |
|-------|-------------|
| Aime logo (broker review variant) | `https://cdn.ainvest.com/kamisAssets/aime-logo.e9fsovan8p.png` |
| Positive rating star / check | `https://cdn.ainvest.com/kamisAssets/add.p366lboie9.png` |
| Aime Review "Uniqueness" icon | `https://cdn.ainvest.com/kamisAssets/11ab7bd72f00710cbb036780757efbf8af33b117.w692ccv5r7q.png` |
| Ask Aime icon (variant 1) | `https://cdn.ainvest.com/kamisAssets/6022f759-d7d0-486c-9bea-45d6b97953dc.jcifquus73l.png` |
| Ask Aime icon (variant 2) | `https://cdn.ainvest.com/kamisAssets/f4fcead3-acd8-45d3-b305-b9f9aa3db5ec.nf9azw0no1o.png` |

> The `aime-logo.e9fsovan8p.png` is a **distinct** Aime logo from the main mascot `aime.bpo45whq8xi.png` — used specifically in broker-review contexts. Do not confuse the two.

### Banners & Hero Images (extended)

| Asset | Full CDN URL |
|-------|-------------|
| World Cup promo banner (article page) | `https://cdn.ainvest.com/yyzt/upload/common/{UUID}.jpg?format=webp&height=188` (dynamic UUID, 2026-07-07 实测例：`70a248a6-ec8b-4443-be3b-c8c93bab126e`) |
| Article quote template image | `https://cdn.ainvest.com/articles/focusnews/coverimage/content/pictures/Quote%20Template_{hash}.jpg?format=webp&width=700` |

### Lighthorse.io Static Assets (broker partner domain)

Static assets served from `lighthorse.io` root (not `cdn.ainvest.com`). Used on the broker partner site.

| Asset | Path on lighthorse.io |
|-------|----------------------|
| Light Horse logo | `/logo.png` |
| App Store badge | `/app-store-badge.png` |
| Google Play badge | `/google-play-badge.png` |
| Claude skill badge | `/claude-badge.png` |
| Icon (256px) | `/icon-256.png` |
| Android APK QR code | `/android-apk-qr.svg` |
| Android APK direct download | `https://cdn.lighthorse.io/package/android/com.lighthorse.android.apk` |

> These are on the `lighthorse.io` domain (Light Horse's independent site), **not** on `cdn.ainvest.com`. See [`company.md`](./company.md) Light Horse section for context.

### Demo Videos

| Asset | Full CDN URL |
|-------|-------------|
| Prediction Markets demo | `https://cdn.ainvest.com/insight/temp/prediction.market.mp4` |
| Dashboard demo | `https://cdn.ainvest.com/kamisAssets/dashboard.l10bgca2gya.mp4` |
| SuperChart demo | `https://cdn.ainvest.com/kamisAssets/s-superchart.oyrj1t60ls.mp4` |
| Backtest demo | `https://cdn.ainvest.com/kamisAssets/s-backtest.c09pkqdy27v.mp4` |

### App Download Badges

| Asset | Full CDN URL |
|-------|-------------|
| Apple App Store (white) | `https://cdn.ainvest.com/kamisAssets/apple_white.9yeqgqe7xlg.png` |
| Apple App Store (black) | `https://cdn.ainvest.com/kamisAssets/apple.uw3u0yr7tu.png` |
| Google Play Store | `https://cdn.ainvest.com/kamisAssets/google.t9pdagermu.png` |
| Windows badge | `https://cdn.ainvest.com/kamisAssets/windows.mzzqysk442.png` |
| App preview (phone mockup) | `https://cdn.ainvest.com/kamisAssets/app_default.gr6pcqozzlc.webp` |
| Download page QR code | `https://cdn.ainvest.com/kamisAssets/download-qr-code.jsyfj0lw6yd.png` |

### Social Icons (site footer)

| Asset | Full CDN URL |
|-------|-------------|
| Discord | `https://cdn.ainvest.com/kamisAssets/discord.xxesa164dog.png` |
| LinkedIn | `https://cdn.ainvest.com/kamisAssets/linkedin.p2f3clfqcu.png` |
| YouTube | `https://cdn.ainvest.com/kamisAssets/youtube.nx3tlrbzrf.png` |
| Instagram | `https://cdn.ainvest.com/kamisAssets/ins.r538eqfoyn.png` |
| Twitter/X | `https://cdn.ainvest.com/kamisAssets/twitter.8dk0zjrc8ou.png` |
| TikTok | `https://cdn.ainvest.com/kamisAssets/tiktok.2dm7r1gi12w.png` |

### Author-page Social Icons

Used on `/news/author/{slug}/` pages for profile links.

| Asset | Full CDN URL |
|-------|-------------|
| Twitter/X | `https://cdn.ainvest.com/social/account/portraits/icon_x.png` |
| LinkedIn | `https://cdn.ainvest.com/social/account/portraits/icon_in.png` |
| Facebook | `https://cdn.ainvest.com/social/account/portraits/icon_fb.png` |

---

## Dynamic Asset URL Patterns

Parameterized / data-driven asset URLs whose content changes over time (per ticker, per article, per AI generation, per deployment). These are **not** static reusable dev assets — patterns only.

## Market Icons (per ticker/symbol)

| Type | URL pattern | Example |
|------|------------|---------|
| US stock icon | `https://cdn.ainvest.com/icon/us/{TICKER}.png` | `https://cdn.ainvest.com/icon/us/AAPL.png` |
| ETF icon | `https://cdn.ainvest.com/icon/us/etf/{TICKER}.png` | `https://cdn.ainvest.com/icon/us/etf/SPY.png` |
| Crypto icon | `https://cdn.ainvest.com/icon/crypto/{SYMBOL}USDT.png` | `https://cdn.ainvest.com/icon/crypto/BTCUSDT.png` |
| Crypto icon (large variant) | `https://cdn.ainvest.com/icon/crypto/{SYMBOL}USDT.P.png` | `https://cdn.ainvest.com/icon/crypto/BTCUSDT.P.png` |

## Broker Icons (per broker)

URL pattern: `https://cdn.ainvest.com/icon/brokers/{BrokerName}.png`

Known filenames (as of 2026-07-07): `LightHorse`, `InteractiveBrokers`, `Public`, `Robinhood`, `Webull`, `Fidelity`, `Charles%20Schwab`, `E-Trade`, `Vanguard`, `TradeStation`, `Alpaca`, `Questrade`, `Trading212`, `Wealthsimple`, `AinvestPaperTrading`.

## Nova FrontResources (Next.js build artifacts — hashes change per deploy)

Multiple Nova micro-frontend apps share a common Aime sidebar icon set. All under:
`https://cdn.ainvest.com/frontResources/s/{nova-app}/{page}/_next/static/media/`

| Nova app | Page scope | Has sidebar icons | World Cup bg |
|----------|-----------|-------------------|-------------|
| `nova-home` | `home` | ask-aime, fact-check-{light\|dark}, explain-{light\|dark}, copy-{light\|dark} | — |
| `nova-pricing` | `pricing` | ask-aime, fact-check-light, explain-light, copy-light | — |
| `nova-trade` | `brokers` | ask-aime, fact-check-dark, explain-dark, copy-dark | — |
| `nova-screener` | `screener` | ask-aime, fact-check-light, explain-light, copy-light | — |
| `nova-market` | `market` | — | `world-cup-bg-v3.{hash}.png` |

Representative observed filenames (hashes are build-time; resolve at build, don't hard-code):

| Name | Observed hash |
|------|--------------|
| `ask-aime.{hash}.png` | `1b2005bc` (consistent across all apps) |
| `fact-check-light.{hash}.svg` | `f461f892` |
| `fact-check-dark.{hash}.svg` | `ba49a244` |
| `explain-light.{hash}.svg` | `b53a9cb8` |
| `explain-dark.{hash}.svg` | `70dfeca7` |
| `copy-light.{hash}.svg` | `96bfab5d` |
| `copy-dark.{hash}.svg` | `89bd0beb` |
| `world-cup-bg-v3.{hash}.png` | `e6efc10b` (nova-market only) |

## Author & Editorial Portraits

| Type | URL pattern | Example |
|------|------------|---------|
| Author portrait (primary) | `https://cdn.ainvest.com/social/account/portraits/{name}.png` | `https://cdn.ainvest.com/social/account/portraits/Logo_Adam_Shapiro.png` |
| Author portrait (alt) | `https://cdn.ainvest.com/articles/focusnews/coverimage/content/pictures/{name}.jpeg` | `https://cdn.ainvest.com/articles/focusnews/coverimage/content/pictures/gavin_a7763afe1767770425714.jpeg` |

## News & Article Images

| Type | URL pattern | Example |
|------|------------|---------|
| News cover image | `https://cdn.ainvest.com/articles/focusnews/coverimage/content/pictures/{name}.{ext}?format=webp&width={w}&height={h}` | `.../Screenshot0625-0805_e54e4c7c1782345927684.jpg?format=webp&width=800&height=600` |
| AI-generated article image | `https://cdn.ainvest.com/aigc/hxcmp/images/compress-qwen_generated_{id}.jpg.png` | `.../compress-qwen_generated_1782375116197.jpg.png` |

## Screener Covers

| Type | URL pattern | Example |
|------|------------|---------|
| Screener preset cover | `https://cdn.ainvest.com/yyzt/upload/common/{UUID}.png?format=webp&width=636&height=356` | — |
| Screener category cover | `https://cdn.ainvest.com/screener/images/{slug}.{ext}?format=webp&width=636&height=356` | `.../screener/images/glp-demand-shift-stocks_1772609225644@quality=0.3.jpeg?format=webp&width=636&height=356` |

## Fonts

AInvest uses three font families. Font files are not served from `cdn.ainvest.com` — Geist Sans is self-hosted via Next.js (`_next/static`), while NewYork and PTSerif are platform-native system fonts.

| Role | Font family | Source | Usage |
|------|------------|--------|-------|
| **UI / base** | `Geist Sans` (`var(--font-geist-sans)`) | Next.js self-hosted | All UI chrome, body text, data, navigation |
| **Editorial / news titles** (desktop) | `NewYork` | iOS/macOS system font | Article headlines, premium editorial content. **Never use in UI chrome.** |
| **Editorial / news titles** (Android) | `PTSerif` | Android system font | Article headlines on Android. **Never use in UI chrome.** |
| **System fallback stack** | `-apple-system, BlinkMacSystemFont, "PingFang SC", "Robot", "Source Han Sans", sans-serif` | OS-native | Cascading fallback for all font families |

### Font scale (design tokens)

| Token | Size | Weight |
|-------|------|--------|
| `font-size-super-large` | 32px | — |
| `font-size-extra-large` | 24px | — |
| `font-size-large` | 20px | — |
| `font-size-base` | 18px | — |
| `font-size-medium` | 16px | — |
| `font-size-small` | 15px | — |
| `font-size-extra-small` | 14px | — |
| `font-size-super-small` | 13px | — |
| `font-size-xxs` | 12px | — |
| `font-size-xxxs` | 10px | — |

### Font weight scale

| Weight | Token name |
|--------|-----------|
| 400 | `fontWeightRegular` |
| 500 | `fontWeightMedium` |
| 600 | `fontWeightSemibold` |
| 700 | `fontWeightBold` |

Full typography tokens in [`DESIGN.md`](./DESIGN.md).

## Compliance & Legal PDFs

All served from `https://cdn.ainvest.com/agreement/`. These are static documents referenced site-wide.

| Document | Full CDN URL | Required on |
|----------|-------------|-------------|
| **Privacy Policy** | `https://cdn.ainvest.com/agreement/Ainvest-Fintech-Inc-Privacy-Policy.pdf` | All pages (footer) |
| **Terms of Use** | `https://cdn.ainvest.com/agreement/Ainvest-Fintech-Terms-of-Use.pdf` | All pages (footer) |
| **AIME Terms of Use** | `https://cdn.ainvest.com/agreement/AIME-Terms-of-Use.pdf` | Aime intro/onboarding pages |
| **Third-Party Brokerage Disclaimer** | `https://cdn.ainvest.com/agreement/Third-Party-Brokerage-Disclaimer.pdf` | Broker/trading pages |
| **AI Risk Disclosures** | `https://cdn.ainvest.com/agreement/Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf` | **Any page with AI-generated output** |
| ~~AI Risk Disclosures (old)~~ | ~~`https://cdn.ainvest.com/agreement/Ainvest-AI-Risk-Disclosures.pdf`~~ | **DEPRECATED — 404 as of 2026-06**. Always use the new filename above. |

Hard rule: any page rendering AI-produced content **must** link to `Disclosures-for-AI-Tools-on-Ainvest-Fintech-Inc.pdf`. The old filename `AInvest-AI-Risk-Disclosures.pdf` returns 404.

Full compliance details in [`compliance.md`](./compliance.md).
