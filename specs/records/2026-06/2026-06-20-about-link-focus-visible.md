# About Link Focus Visible

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface. UI means
User Interface.

## Problem

Independent GUI review found Settings About panel links use pill-like visual
chrome and hover feedback, but they do not expose a tokenized keyboard
`:focus-visible` state. This makes the About links weaker for keyboard users
than for pointer users.

## Recall

| Source                                                                    | Existing decision                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `2026-06-19-retire-about-author-link-residue.md`                          | `.about-link` is the only live About link style; `.about-author-link` must stay retired.              |
| `packages/overlay/src/components/ConfigDialogHost.tsx`                    | About links are real anchors with distinct GitHub and Issues destinations.                            |
| `packages/overlay/src/styles/surfaces/settings.css`                       | Settings surface owns `.about-link` base and hover chrome.                                            |
| `packages/overlay/test/browser/runtime-icon-single-source-visual.test.ts` | Real About panel browser coverage already opens the panel, checks live links, hover, and screenshots. |

## Impact Sweep

| Sweep                                            | Result                                                                        | Decision                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `rg -n "about-link                               | About                                                                         | runtime-icon-single-source-visual                                          | ConfigDialogHost | focus-visible" packages/overlay/src/components/ConfigDialogHost.tsx packages/overlay/src/styles/surfaces/settings.css packages/overlay/test specs` | One production caller creates `.about-link`; one CSS owner defines base/hover; browser test covers hover but no keyboard focus. | Add focus-visible at the Settings surface owner and extend the existing browser test. |
| `2026-06-19-retire-about-author-link-residue.md` | The About link single-source work intentionally kept `.about-link` unchanged. | Preserve `.about-author-link` absence and add focus to `.about-link` only. |

## Fix

- Add `.about-link:focus-visible` with hover-equivalent color/background/border
  and tokenized outline.
- Extend architecture guards to require the focus-visible rule and reject hidden
  outlines.
- Extend the real About panel browser test to Tab-focus `.about-link`, verify
  focus-visible and a non-empty outline, then save a focused screenshot.

## Acceptance

- About links keep distinct destinations and the retired `.about-author-link`
  selector remains absent.
- Keyboard focus has visible tokenized chrome.
- Screenshot `.scratch/runtime-icon-about-link-focus-visible.png` shows the
  focused About link in the real About panel.
