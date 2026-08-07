# Retire About Author Link Residue

Date: 2026-06-19

## Problem

The Settings About author card no longer renders an author-specific link, but
`settings.css` still defines `.about-author-link` and its hover state. The live
About links use `.about-link`, so keeping the old selector creates a second
Cascading Style Sheets (CSS) source that can silently re-style future About
content.

## Recall

| Source                                                       | Relevant constraint                                                                                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-retire-settings-config-shell-residue.md`         | Settings selectors without production creation points should be retired instead of kept as CSS-only shells.                            |
| `2026-06-18-runtime-inline-svg-icon-single-source.md`        | The About author card still owns avatar/name visuals through `.about-author-*`, but the link surface is the shared `.about-link` list. |
| `2026-06-18-settings-primitives-single-source-completion.md` | Settings surface rules should stay tied to live primitive or domain classes, not stale local chrome.                                   |

## Evidence Sweep

| Command                                      | Result                                                                                                   | Decision                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `rg -n "about-author-link                    | about-link                                                                                               | about-author" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test specs` | Production component source creates `.about-author-card`, `.about-author-avatar`, `.about-author-info`, `.about-author-name`, and `.about-link`; no component creates `.about-author-link`. | Delete the dead `.about-author-link` style rules. |
| `ConfigDialogHost.tsx` About panel review    | The author card renders only the avatar and strong author name; GitHub/issues anchors use `.about-link`. | Keep author-card/name/avatar styles and the shared link styles unchanged.                                             |
| `overlay-architecture-guards.test.ts` review | The guard required `.about-author-link` and `.about-author-link:hover`, locking in the stale selector.   | Convert that requirement into an absence guard.                                                                       |

## Fix

- Remove `.about-author-link` and `.about-author-link:hover` from
  `packages/overlay/src/styles/surfaces/settings.css`.
- Keep `.about-link` as the single live About link style.
- Update architecture guards to reject `.about-author-link` in Settings source
  and About panel component output.
- Extend the real About panel browser visual flow to assert the old selector is
  absent while `.about-link` hover remains visible.

## Acceptance

- No production source or Settings stylesheet contains `.about-author-link`.
- About author card layout remains unchanged.
- About links still use `.about-link` and retain hover color/background changes.
- Focused unit tests, overlay typecheck, browser visual test, and screenshot
  review pass.
