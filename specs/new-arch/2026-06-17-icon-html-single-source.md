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

1. Keep `utils/icon-html.tsx` as a pure utility entry that does not import
   `Icon.tsx`, `lucide-solid`, or any TSX module. Pure utility tests import
   `markdown.ts` and `dom-utils.ts`; those imports must not pull browser-only
   Solid rendering code into Bun's server-side test runtime.
2. Install the real renderer from `main.tsx`, where `Icon`, `REGISTERED_ICONS`,
   and browser DOM `render()` are already valid runtime dependencies.
3. Validate `name` against `REGISTERED_ICONS` before rendering.
4. Throw on unknown icon names instead of drawing a fallback glyph.
5. Preserve caller-facing `iconHtml(name, size, className)` and
   `hydrateIconPlaceholders(root)` contracts.
6. Extend `flat-redesign-icon-coverage.test.ts` to reject `ICON_PATHS`, reject
   direct `Icon` imports from `icon-html`, and require `main.tsx` to install the
   renderer through the Icon owner.

## Acceptance

- `iconHtml` contains no local SVG path registry.
- `iconHtml` stays importable by pure tests without loading `Icon.tsx` or
  `lucide-solid`.
- The browser renderer uses Solid `render()` and does not use `renderToString`.
- Unknown icon names throw an explicit error.
- `hydrateIconPlaceholders` still fills static `data-oc-icon` placeholders.
- `bun test packages/overlay/test/flat-redesign-icon-coverage.test.ts` passes.
- `bun test packages/overlay/test/markdown-safety.test.ts` passes.
- `bun test packages/overlay/test/workspace-editor.test.ts` passes.
- Overlay typecheck and i18n checks pass.
- Browser visual smoke confirms static sidebar placeholder icons and markdown
  copy icons render from the updated HTML path.
