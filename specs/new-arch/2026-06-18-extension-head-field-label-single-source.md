# Extension Head Field Label Single Source

Date: 2026-06-18

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

`.extension-head .field-label` is a settings-only selector created by
`ChannelsPanel`, but it is defined in both `cascade/typography.css` and
`surfaces/settings.css`. The stylesheet order loads typography before settings,
so the typography rule is always overridden by the settings surface rule.

Keeping both rules leaves a dead typography source and makes future settings
header edits ambiguous.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | Remove high-confidence dead UI/CSS code and do not preserve double sources. |
| `2026-06-18-retire-settings-config-shell-residue.md` | Settings-specific shells and controls belong to settings primitives/surfaces, not stale cascade residues. |
| `field-label-typography.test.ts` | `.field-label` itself is the shared Title Case form-label primitive. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "extension-head|field-label" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test specs/new-arch` | `.extension-head` is created only in `ChannelsPanel`; the exact `.extension-head .field-label` selector exists in `typography.css` and `settings.css`. | Keep the settings surface owner and retire the cascade duplicate. |
| `packages/overlay/src/index.html` | `styles/cascade/typography.css` loads before `styles/surfaces/settings.css`. | Removing the earlier rule should not change current pixels. |
| `packages/overlay/src/styles/surfaces/settings.css` | The later rule owns font size, weight, color, text transform, and letter spacing for the settings extension header. | Preserve this rule as the single source. |

## Fix

- Remove `.extension-head .field-label` from `cascade/typography.css`.
- Add a test guard that rejects the selector from typography while requiring it
  in `surfaces/settings.css`.
- Keep `.field-label` shared typography unchanged.

## Acceptance

- The exact `.extension-head .field-label` selector appears only in
  `surfaces/settings.css`.
- Targeted typography tests and overlay typecheck pass.
- A real browser screenshot of the settings/channel header remains visually
  sane after the CSS removal.
