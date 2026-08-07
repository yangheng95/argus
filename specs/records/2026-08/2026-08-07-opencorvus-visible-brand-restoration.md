# OpenCorvus Visible Brand Restoration

## Recall

| Item | Evidence and constraint |
| --- | --- |
| User request | Change the current User Interface (UI) brand back from `MOSA` to `OpenCorvus`. |
| Acceptance criteria | The Overlay title, titlebar, sidebar identity, startup surface, native menu/tray/errors, localized product copy, public website copy, and active package descriptions use `OpenCorvus`; technical identifiers remain unchanged; a real page is opened, screenshotted, and manually reviewed. |
| Hard constraints | One visible brand with no alias or fallback; preserve runtime paths, executable names, package names, protocol identities, and user-authored project data; do not add, modify, or run UI automation tests; delete UI source/string tests discovered in touched paths; preserve unrelated dirty worktree changes. |
| Sources read | `AGENTS.md`; `specs/records/2026-08/2026-08-04-windows-frame-and-mosa-visible-brand.md`; orphaned commit `90d41932ce` and its `2026-08-06-opencorvus-brand-and-readme-product-narrative.md` record; current Overlay native shell, brand components, startup HTML, locale catalogs, website landing copy, and active Expert Squad READMEs. |
| Whole-repository search | The current branch retains `MOSA` in Overlay chrome/native/localized copy, the public landing page, and two active Expert Squad READMEs plus their generated payload. Commit `90d41932ce` already implemented and visually verified the inverse change on `v0.0.31beta`, but it is not an ancestor of current `v0.0.33beta`; selective migration is required instead of cherry-picking unrelated README work. |
| Independent agent feedback | None. The user did not request delegation, so no sub-agent was started. |

## Design

`OpenCorvus` is the sole user-visible product brand. All active UI copy and accessibility labels converge on it. Lowercase `opencorvus` paths, executable/package identifiers, environment variables, protocol names, and user project names remain technical identities and are not rebranded.

Existing tests that inspect TSX, CSS, HTML, native menu labels, or visible error strings are UI automation under the repository prohibition and are removed from the touched test surfaces without being run. Verification uses non-UI type/build/document checks plus a real Browser session and manual screenshot inspection.

## Verification plan

1. Replace every active visible `MOSA` occurrence and regenerate derived Expert Squad payloads.
2. Remove discovered UI source/string tests from touched paths and run only non-UI checks.
3. Open the real Overlay page, inspect the titlebar/sidebar/settings surfaces, and capture a fresh screenshot.
4. Review the focused diff, commit only this task, and push `v0.0.33beta` to git-cc.

## Visual acceptance

The rebuilt production Overlay was opened at `http://127.0.0.1:5175/` in the real in-app Browser. Manual review confirmed `OpenCorvus` in the document title, top-left product heading, bottom-left product identity, and backend-unavailable notice, with the existing layout and component system preserved. Evidence: [current restored brand](../../artifacts/2026-08-07-opencorvus-brand-restored-current.png).
