# Icon HTML Single Source - 2026-06-17

## Acronyms

- DOM: Document Object Model, the browser tree used by the overlay.
- GUI: Graphical User Interface, the visible operator panel.
- HTML: HyperText Markup Language, the string output used by template flows.
- SVG: Scalable Vector Graphics, the vector icon markup rendered by `Icon`.
- UI: User Interface, the visible controls and affordances.

## Problem

`packages/overlay/src/utils/icon-html.tsx` still owns an `ICON_PATHS` registry and
falls back to `square` for unknown names. That is a second icon source beside
`packages/overlay/src/components/Icon.tsx`, so Lucide-backed and custom icon
definitions can drift. The existing guard `flat-redesign-icon-coverage.test.ts`
already fails because `iconHtml` does not render through Solid's `Icon`
primitive.

## Evidence Sweep

Command:

```powershell
rg -n "iconHtml|data-oc-icon|REGISTERED_ICONS|ICON_PATHS" packages/overlay/src packages/overlay/test specs -g "*.ts" -g "*.tsx" -g "*.md" -g "*.html"
```

| Surface | Evidence | Decision |
| --- | --- | --- |
| `utils/icon-html.tsx` | Owns `ICON_PATHS` and unknown `square` fallback. | Delete the local registry; validate names against `REGISTERED_ICONS`. |
| `components/Icon.tsx` | Exports `Icon`, `IconName`, and `REGISTERED_ICONS`. | Use this as the only icon source. |
| `utils/markdown.ts` | `iconHtml("copy", 12)` for code-copy buttons. | Keep callsite; generated HTML must come from `Icon`. |
| `utils/dom-utils.ts` | `iconHtml("folder", 13)` and `iconHtml("close", 13)`. | Keep callsites; generated HTML must come from `Icon`. |
| `src/index.html` | Three `data-oc-icon="plus"` placeholders. | Keep placeholders; hydration must use `Icon` HTML. |
| Tests mocking iconHtml | Several non-icon tests mock `iconHtml`. | Leave mocks unchanged; add focused source/runtime coverage in icon test. |

## Fix

1. Import `render` from `solid-js/web` and render `<Icon />` into a detached DOM
   container.
2. Validate `name` against `REGISTERED_ICONS` before rendering.
3. Throw on unknown icon names instead of drawing a fallback glyph.
4. Preserve caller-facing `iconHtml(name, size, className)` and
   `hydrateIconPlaceholders(root)` contracts.
5. Extend `flat-redesign-icon-coverage.test.ts` to reject `ICON_PATHS` and
   require unknown-icon failure coverage.

## Acceptance

- `iconHtml` contains no local SVG path registry.
- `iconHtml` uses browser-safe Solid `render()` and does not use
  `renderToString`.
- Unknown icon names throw an explicit error.
- `hydrateIconPlaceholders` still fills static `data-oc-icon` placeholders.
- `bun test packages/overlay/test/flat-redesign-icon-coverage.test.ts` passes.
- Overlay typecheck and i18n checks pass.
- Browser visual smoke confirms static sidebar placeholder icons and markdown
  copy icons render from the updated HTML path.
