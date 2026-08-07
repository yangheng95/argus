# Image Asset Usage

**Category:** Asset Presentation
**Scope:** Stock ticker logos, politician avatars, news thumbnails, company logos, and functional icons.

## Single source

Every image must resolve before rendering to one exact project-owned or package-local file. This package's assets live under `ainvest-design-system/assets/`. Runtime URL probing, CDN-to-local switching, generated placeholders, initials substitution, and alternate-host loading are not part of the contract. If a required file is absent or fails to decode, the delivery is incomplete and must report the missing logical asset path.

## Stock and ticker logos

- Use an exact `assets/logos/stocks/{TICKER}.png` file with uppercase, case-sensitive ticker identity.
- Display the package asset in a circular container with `border-radius: 50%` and `overflow: hidden`.
- Apply `object-fit: cover`, explicit `width` and `height`, and `display: block`.
- Do not construct a network URL, change file extension, synthesize initials, or render an empty placeholder.

```css
.ticker-logo {
  border-radius: 50%;
  overflow: hidden;
}
.ticker-logo img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
```

## Politician and person avatars

- Use the exact local file under `assets/avatars/politicians/`.
- Apply a circular container and `object-fit: cover`.
- Do not synthesize an avatar for a person whose asset is absent.

Available package assets:

- `Cleo_Fields.png`
- `Debbie_Wasserman_Schultz.png`
- `Delaney_April_McClain.png`
- `Gil_Cisneros.png`
- `Jonathan_Jackson.png`
- `Marjorie_Taylor_Greene.png`

## News and article thumbnails

- Resolve the exact project-owned thumbnail path before rendering.
- Use `border-radius: var(--radius-sm)` and `object-fit: cover`.
- Missing thumbnails are incomplete delivery evidence, not permission to fetch or synthesize another asset.

## Brand and AIme assets

- AInvest logo: `assets/logos/ainvest-logo.svg`.
- AIme animated asset: `assets/logos/aime-animated.png`.
- AIme static asset: `assets/logos/aime-static.png`.
- Use the exact file; preserve aspect ratio and accessible text semantics.

## Functional icons

- Use an exact local SVG under `assets/icons/`.
- Present files are `bell.svg`, `chevron-right.svg`, and `search.svg`.
- Missing required icons fail the visual contract. Comments, dashed boxes, Unicode glyphs, and invented icon names are not icon evidence.

## General rules

- Set explicit `width` and `height` to prevent layout shift.
- Set useful `alt` text for content images and empty `alt` for decorative images.
- Preserve source aspect ratio unless the component contract explicitly requires cropping.
- Verify the rendered image in the real page and screenshot; a path string alone is not visual evidence.

## Failure conditions

- A required logical asset does not resolve to one exact local file.
- A file fails to decode or render.
- A ticker or avatar violates its required shape.
- An image distorts because dimensions or `object-fit` are wrong.
- The implementation introduces a second asset source or generated substitute.
