# About Issues Link Target

Date: 2026-06-19

GUI means Graphical User Interface. URL means Uniform Resource Locator.

## Problem

The Settings About panel renders two visible links under `about.links`.
`GitHub` and `about.issues` both point to `https://github.com/yangheng95`.
The second link is labelled `Issues` / `问题反馈`, so it should open the
OpenCorvus project issue tracker instead of the author profile.

## Recall

| Source                                                  | Relevant decision                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `package.json`                                          | The project repository URL is `https://github.com/yangheng95/opencorvus`.                               |
| `2026-06-19-retire-about-author-link-residue.md`        | About links use the shared `.about-link` list; do not revive author-specific link styles.               |
| `packages/overlay/src/i18n/en-US.json` and `zh-CN.json` | `about.issues` is user-facing copy for the issue-feedback link.                                         |
| Feynman independent agent report                        | The root cause is duplicated hard-coded `href` values in `ConfigDialogHost`, not a CSS or i18n problem. |

## Impact Sweep

| Sweep                                              | Result                                                                                                                   | Decision                                                             |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `rg -n "github\\.com/yangheng95                    | about\\.issues                                                                                                           | about\\.links                                                        | about-link" package.json packages/overlay/src packages/overlay/test specs` | Only `ConfigDialogHost` owns the live About hrefs; tests check only the first `.about-link`. | Fix the component source and strengthen the existing About browser test. |
| `ConfigDialogHost.tsx` About panel review          | Links are duplicated literal anchors inside the panel render branch.                                                     | Introduce one `ABOUT_LINKS` array as the link target source.         |
| `runtime-icon-single-source-visual.test.ts` review | The test already opens About and screenshots the dialog, but only checks that the first link starts with the author URL. | Assert both visible links, distinct hrefs, and the exact Issues URL. |

## Fix Plan

1. Add `ABOUT_LINKS` in `ConfigDialogHost.tsx` with:
   - `GitHub` -> `https://github.com/yangheng95`
   - `about.issues` -> `https://github.com/yangheng95/opencorvus/issues`
2. Render the About links with `For` from that data source.
3. Add a static architecture guard for distinct About link targets.
4. Extend the real browser About panel test to verify visible text, exact hrefs,
   hover style, and screenshot output.

## Acceptance

- About link hrefs are distinct.
- `Issues` / `问题反馈` opens `https://github.com/yangheng95/opencorvus/issues`.
- `.about-link` remains the single live About link style.
- Unit/static tests, overlay typecheck, and the real About panel browser visual
  test pass.
