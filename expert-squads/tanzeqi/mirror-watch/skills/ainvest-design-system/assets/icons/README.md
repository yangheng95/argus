# icons/

UI functional icons in SVG format — arrows, chevrons, actions, states, navigation glyphs. Sourced from the Ainvest Matrix icon library.

**Not for:** brand logos, ticker logos, person avatars, illustrations (see `assets/logos/` or CDN).

---

## Loading strategy — package-local only

Use `icons/{name}.svg` only when that exact package-local file exists. AI MUST NOT invent icon names, render a placeholder, or silently leave empty space. A missing required icon is an explicit incomplete-delivery error.

---

## Icon source — Ainvest Matrix (manual sync only)

The authoritative icon set lives in the internal `@ainvest-matrix/icons` package. Browse the gallery at:

> **Gallery URL:** https://f2e.myhexin.com/thor/storybook/ainvest-matrix-react/?path=/story/icons-gallery--gallery

**Why manual:** The gallery bundle ships icons as webpack-hashed SVG string constants with no stable name→SVG export map. Programmatic fetching has been attempted and failed (bundle is opaque, remote access blocked from some networks). **Do not try to script the sync.**

### Human sync workflow

1. Open the gallery URL in a browser
2. Find the needed icon by visual search
3. Copy the inline SVG markup (right-click → Inspect, copy the `<svg>...</svg>` node)
4. Save as `icons/{kebab-case-name}.svg`
5. Strip fixed `fill=` / `stroke=` values from strokable paths — replace with `currentColor` so CSS can recolor the icon
6. Commit

---

## Naming convention

- **kebab-case**, descriptive, no underscores: `arrow-up.svg`, `chevron-right.svg`, `check-circle.svg`
- Prefix variants: `arrow-up.svg`, `arrow-up-filled.svg`, `arrow-up-small.svg`
- No size in the filename unless the variant differs visually beyond a CSS scale

---

## Color control

Icons MUST be monochrome and use `fill="currentColor"` (and/or `stroke="currentColor"`) so they inherit the parent element's CSS `color` property.

```css
.icon {
  width: 16px;
  height: 16px;
  color: var(--color-text-primary);
}
```

**MUST NOT:** hardcode colors inside the SVG, import colored multi-tone icons, or use `<img>` with CSS filter tricks to recolor (brittle, inconsistent).

---

## MUST NOT

- MUST NOT import third-party icon fonts (Font Awesome, Material Icons, etc.) — breaks design system consistency
- MUST NOT embed raster PNGs as icons — always SVG
- MUST NOT silently omit a missing icon — always render the placeholder + TODO comment
- MUST NOT rename synced icons away from their Matrix gallery name without updating every consumer

---

## Related rules

- `references/rules/image-asset-usage.md §7` — placement, sizing, and color rules for functional icons
- `references/tokens/color.md` — text color tokens that icons inherit via `currentColor`
