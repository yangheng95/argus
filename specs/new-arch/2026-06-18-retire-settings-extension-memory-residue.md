# Retire Settings Extension Memory Residue

Date: 2026-06-18

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Problem

Settings and left activity panels already render installed skills, MCP servers,
market cards, and memory rows through the live `.ext-group`, `.extension-row*`,
`.market-card*`, `.knowledge-item*`, `.knowledge-item-meta-row`, and
`.oc-button[data-action="delete-memory"]` contracts. Four older selector
families remained CSS-only and test-preserved:

- `.extension-block`
- `.extension-policy`
- `.knowledge-item-actions`
- `.knowledge-delete`

Keeping them makes settings look like it has two row/action contracts and gives
future edits a stale target to revive.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Shared UI semantics should converge on mature primitives and remove hand-rolled remnants after migration. |
| `2026-06-18-retire-settings-config-shell-residue.md` | Settings CSS-only shells should be retired once there are no production creation points. |

## Impact Sweep

| Sweep | Result |
| --- | --- |
| `rg -n "extension-block|extension-policy|knowledge-item-actions|knowledge-delete|ext-group|extension-row|extension-status|market-card|knowledge-item-meta-row|delete-memory" packages/overlay/src packages/overlay/test specs/new-arch` | Retired selectors were CSS/test-only; live component creation points use `.ext-group`, `.extension-row*`, `.market-card*`, `.knowledge-item-meta-row`, and `data-action="delete-memory"`. |
| `git diff -- packages/overlay/src/styles/surfaces/settings.css packages/overlay/src/styles/surfaces/activity.css packages/overlay/test/overlay-architecture-guards.test.ts` | `settings.css` and `activity.css` already had unrelated local changes; staging must isolate only the retired selector removal. |

## Fix

- Delete `.extension-block`, `.extension-block + .extension-block`, and
  `.extension-policy` from settings CSS.
- Delete `.knowledge-item-actions` and `.knowledge-delete` from settings CSS.
- Remove the left activity panel's `.knowledge-item-actions` grouped selector.
- Change architecture guards to reject the retired selectors in production
  source while preserving live selector checks.

## Acceptance

- Retired settings extension/memory selectors have no production source hits.
- Live settings and side activity selector contracts remain covered.
- Targeted architecture/unit tests, browser checks, typecheck, docs check, and
  visual screenshot review pass.
