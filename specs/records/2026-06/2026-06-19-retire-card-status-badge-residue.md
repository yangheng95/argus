# Retire Card Status Badge Residue

## Context

Independent CSS review found the retired card header status badge still kept
alive by `card.css`, `status-badge.ts`, stale unit tests, and static visual
fixtures. The live `CardHeader` no longer renders `statusBadge` or
`.card__badge`; `CardHeaderChrome` owns current metadata/action chrome.

## Recall

| Source                                             | Constraint                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/overlay/src/components/CardHeader.tsx`   | Renders `.card__icon`, title/meta text, duration, and `CardHeaderChrome`; no status badge. |
| `packages/overlay/test/card-header-chrome.test.ts` | Already rejects `statusBadge` and `class="card__badge"` in `CardHeader`.                   |
| `packages/overlay/src/utils/status-badge.ts`       | No production import; only tests import it.                                                |
| `packages/overlay/src/styles/surfaces/card.css`    | Still defines `.card__badge` and tone selectors, creating orphan chrome.                   |
| `rg -n "card\_\_badge                              | statusBadge                                                                                | status-badge" packages/overlay/src packages/overlay/test` | Live hits are stale CSS, a dead helper/test, static fixtures, and negative tests. |

## Fix

- Delete the unused `status-badge.ts` helper and its dedicated test.
- Remove `.card__badge*` CSS from `card.css`.
- Keep `.card__spinner`, because BrowserPreview, Architect, FrontendResearch,
  and Requirements panels still use it directly.
- Update `tree-writer-hierarchy.test.ts` to assert the canonical card data
  fields instead of a retired presentation helper.
- Remove `.card__badge` markup from static visual fixtures and debug script
  probes.
- Extend card header tests to reject the retired badge CSS.

## Acceptance

- Production code has no `statusBadge`, `status-badge`, or `.card__badge`
  implementation path.
- Static fixtures no longer preserve retired badge chrome.
- Current card header metadata/action chrome remains owned by
  `CardHeaderChrome`.
