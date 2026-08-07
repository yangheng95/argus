# Architect Integrity Badge Primitive

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface.

## Problem

Independent GUI review found two inspector surfaces still implement read-only
status/category chips as private `span` primitives:

- Architect categories use `.arch-cat-badge`.
- Integrity reviewer counters and finding/repair tags use
  `.integrity__reviewer-chip` and `.integrity__tag`.

The AppDialog recommended label has already introduced the shared `Badge`
primitive. Keeping per-surface badge chrome in Architect and Integrity creates
two visual sources for the same read-only pill role, and it makes the next
white-surface contrast audit depend on separate CSS blocks instead of one
component contract.

## Recall

| Source                                                 | Relevant constraint                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                            | UI primitives must use mature shared components, not hand-written per-surface primitives.                                                                |
| `2026-06-20-app-dialog-recommended-badge-primitive.md` | `Badge` is the canonical read-only pill/tag primitive for overlay labels.                                                                                |
| `2026-06-18-integrity-panel-token-source.md`           | Integrity report chrome must resolve on light surfaces through canonical overlay tokens.                                                                 |
| `overlay-architecture-guards.test.ts`                  | The inspector surface guard currently pins the private badge classes, so the guard must move to the shared primitive contract.                           |
| `integrity-panel-token-source-browser.test.ts`         | Browser screenshot coverage already exercises the Integrity panel on a white surface. It should include the shared badge primitive after this migration. |

## Impact Sweep

| Sweep                                          | Result                                                                                                 | Decision                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `rg -n 'arch-cat-badge                         | integrity\_\_reviewer-chip                                                                             | integrity\_\_tag' packages/overlay/src packages/overlay/test`                                                                      | Production hits are limited to `ArchitectPanel.tsx`, `IntegrityCard.tsx`, and `inspector.css`; tests reference the old classes in architecture guards and one typography comment. | Replace all production uses in one pass and update the guards; remove old selectors instead of keeping compatibility classes. |
| `rg -n 'oc-badge                               | Badge' packages/overlay/src packages/overlay/test specs`                                      | `Badge` is defined in `components/ui/Badge.tsx`, loaded by `styles/primitives/badge.css`, and already used by `AppDialogHost.tsx`. | Reuse the existing primitive; no new component family.                                                                                                                            |
| `IntegrityCard.tsx`                            | Reviewer chips are passive counts; finding/repair tags are passive classification labels.              | Use `<Badge>` because these are read-only labels, not buttons or links.                                                            |
| `ArchitectPanel.tsx`                           | Category badges are passive category labels with a `title` for the raw key.                            | Use `<Badge tone="muted" size="sm">` and keep the existing `title`.                                                                |
| `inspector.css`                                | Private badge styles duplicate primitive concerns: border, radius, background, color, font, uppercase. | Delete the private badge blocks; keep only layout containers such as `.arch-categories` and `.integrity__reviewer-meta`.           |
| `integrity-panel-token-source-browser.test.ts` | Fixture currently renders old markup manually.                                                         | Update the fixture to render `.oc-badge` nodes and assert private selectors are absent on the white-surface screenshot.            |

## Fix Plan

1. Import `Badge` into `ArchitectPanel.tsx` and `IntegrityCard.tsx`.
2. Replace `.arch-cat-badge`, `.integrity__reviewer-chip`, and
   `.integrity__tag` with `<Badge>` using explicit `data-ui` markers for
   tests and browser evidence.
3. Route finding severity labels through warning/bad badge tones; route repair
   ids and neutral reviewer counters through neutral/muted tones.
4. Remove the retired private badge CSS selectors from `inspector.css`.
5. Update static tests to require the shared Badge primitive and reject the
   retired selectors.
6. Update the Integrity browser test fixture and screenshot checks so the
   white-surface evidence includes shared badges.

## Acceptance

- Architect categories render through the shared `Badge` primitive.
- Integrity reviewer counters, finding severity labels, and repair ids render
  through the shared `Badge` primitive.
- Production source and inspector CSS no longer contain
  `.arch-cat-badge`, `.integrity__reviewer-chip`, or `.integrity__tag`.
- Browser evidence on a light surface proves the shared badge chrome resolves
  and the retired private selectors are absent.
- Static tests fail if the private badge selectors return.
