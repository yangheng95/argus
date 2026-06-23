# Retire Pref Item Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

The old `.pref-item*` preference-row selector family has no production
component, service, or HTML owner, but it still exists in three production CSS
owners and one owner-surface test. That keeps a retired settings row contract
alive and creates a false second styling source beside the current settings
primitives and live knowledge/channel/market rows.

The remaining runtime preference-like fixture ids in browser tests use strings
such as `pref-1`; those are test data ids, not DOM class contracts.

## Recall

| Source                                                       | Relevant constraint                                                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-18-settings-primitives-single-source-completion.md` | Settings rows should be owned by the `.s-*` primitive layer, with domain classes only where live components still render them. |
| `2026-06-18-retire-settings-extension-memory-residue.md`     | Retired settings CSS selectors should be deleted once no production owner remains; live memory rows are `.knowledge-item*`.    |
| `2026-06-18-memory-row-nested-interactions.md`               | `MemoryPanel` owns the live `.knowledge-item*` row contract across settings and left activity panels.                          |
| `2026-06-19-retire-detail-card-residue.md`                   | Keep live `.channel-doc-card`; retire selector families without component owners instead of preserving sibling-style residue.  |

## Evidence Sweep

| Command                | Result                                                                              | Decision                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `rg -n "pref-item      | pref-" packages/overlay/src packages/overlay/test specs/new-arch docs --glob "_._"` | Production hits were CSS-only: `settings.css`, `field.css`, and `inspector.css`. Browser test `pref-*` hits are fixture ids, not classes. | Delete the CSS selector family and add production-source absence guards. |
| `rg -n "pref-item      | pref-" packages/overlay/src -g "_.tsx" -g "_.ts" -g "_.html" -g "_.json"`           | No production TS/TSX/HTML/JSON owner exists.                                                                                              | Do not keep compatibility styling for an unowned DOM contract.           |
| `rg -n "knowledge-item | market-card                                                                         | channel-doc-card                                                                                                                          | MemoryPanel                                                              | SkillMarketPanel | ChannelsPanel" packages/overlay/src packages/overlay/test specs/new-arch docs --glob "_._"` | `.knowledge-item`, `.market-card`, and `.channel-doc-card` have live component owners. | Preserve those selectors and only remove `.pref-item*` entries from shared lists. |

## Fix

- Remove `.pref-item`, `.pref-item:hover`, `.pref-item-value`,
  `.pref-item-head`, and `.pref-item-key` from production CSS.
- Keep `.knowledge-item`, `.market-card`, and `.channel-doc-card` live rules
  unchanged except for removing the retired sibling selector from grouped
  rules.
- Convert `owner-surface-consistency.test.ts` from protecting
  `.knowledge-item, .pref-item` to protecting `.knowledge-item` and rejecting
  the retired `.pref-item*` family across production source.

## Acceptance

- Production source and CSS no longer contain the retired `.pref-item*` class
  family.
- Live settings neighbors still have component owners and their CSS remains
  present.
- Static owner-surface tests pass.
- Browser validation covers the live Knowledge, Skills, and Channels surfaces
  after selector deletion.
