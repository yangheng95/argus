# logos/

Product-owned logos and branded image assets. **Not for financial ticker logos** — those come from CDN (see `references/rules/image-asset-usage.md §6.1`).

---

## What belongs here

| Type | Example files | Purpose |
|---|---|---|
| Ainvest brand logo | `ainvest-logo.svg` | Nav, footer, splash, any place the product name appears |
| AIme character | `aime-animated.png`, `aime-static.png` | AI assistant avatar (animated for loading, static for inline) |
| Stock logos | `stocks/{TICKER}.png` | Canonical package-local ticker assets |

**Do NOT add here:** CDN-served ticker logos (AAPL, NVDA, BTC etc.), politician avatars (use `assets/avatars/politicians/`), UI functional icons (use `assets/icons/`).

---

## Loading strategy — package-local single source

Ticker, crypto, ETF, brand, and AIme assets must resolve to one exact package-local file before rendering. A missing required asset is an explicit incomplete-delivery error; consumers must not fetch, synthesize, or substitute a second representation.

---

## Naming convention

| Asset | Rule |
|---|---|
| Stock logo | `stocks/{TICKER}.png` — **uppercase, case-sensitive** (`AAPL.png` ≠ `aapl.png`) |
| Brand logo | `ainvest-logo.svg` — single canonical file, recolored via CSS filter (see `image-asset-usage.md §5.1`) |
| AIme | `aime-animated.png` / `aime-static.png` — no version suffix, replace in place |

**SVG warning:** Do not add `.svg` for ticker logos. The Ainvest CDN serves `.svg` as plain colored blocks, not real logos — always use `.png` (`image-asset-usage.md §6.1 CRITICAL`).

---

## Adding a new asset

1. Put the file in this directory following the naming convention above
2. If it's a brand / AIme asset, register it in `image-asset-usage.md §5`
3. Register the exact asset path where the consuming component contract requires it
4. Commit — no build step required

---

## Related rules

- `references/rules/image-asset-usage.md` — full image rendering rules
- `references/tokens/color.md` — image container color tokens
