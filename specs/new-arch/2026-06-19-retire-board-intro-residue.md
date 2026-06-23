# Retire BoardIntro Residue

Date: 2026-06-19

## Problem

`BoardIntro` was deleted, but the overlay still shipped `.board-intro__cta`
inside the reduced-motion cascade and several tests still treated
`board-intro*` selectors as live UI. The production selector has no component
owner, and the partial guard only checked a few files, so cascade residue could
survive unnoticed.

## Recall

| Source                                 | Relevant constraint                                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `overlay-architecture-guards.test.ts`  | The current guard states `BoardIntro` was deleted with `board.css`, but it only checked selected selectors/files. |
| `styles-no-dangling-selectors.test.ts` | Historical BoardIntro selector leakage caused unrelated shell layout to inherit stale rules.                      |
| `content-subtitles-typography.test.ts` | Notes that `.board-intro__section-title` no longer exists after the flat redesign.                                |

## Evidence Sweep

| Command                                                                                       | Result                                                                       | Decision                                                       |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| `rg -n 'board-intro__cta' packages/overlay/src packages/overlay/test specs docs --glob '*.*'` | Only production source hit is `base.css`; remaining hits are tests/comments. | Remove `.board-intro__cta` from production CSS.                |
| `rg -n 'board-intro                                                                           | BoardIntro                                                                   | board-intro\_\_cta                                             | board-intro\_\_cta-action' packages/overlay/src packages/overlay/test specs docs --glob '_._'` | No component or HTML runtime emission exists. | Strengthen BoardIntro retirement guard across all production styles and source. |
| `rg -n 'prefers-reduced-motion                                                                | task-list-skeleton-row' packages/overlay/src packages/overlay/test`          | `.task-list-skeleton-row` is the live reduced-motion selector. | Keep reduced-motion coverage for the current skeleton row.                                     |

## Fix

- Remove `.board-intro__cta` from `base.css` reduced-motion selectors.
- Remove live-selector checks for BoardIntro from visual/style budget tests.
- Update architecture guards to reject `board-intro` selectors across all
  production CSS files and `BoardIntro` references in runtime source.
- Add a real browser reduced-motion smoke test for the current
  `.task-list-skeleton-row` loading surface.

## Acceptance

- No production source/style file contains `.board-intro*` or `BoardIntro`.
- `.task-list-skeleton-row` still disables animation under reduced motion.
- Focused static tests, overlay typecheck, browser reduced-motion smoke, and
  screenshot review pass.
