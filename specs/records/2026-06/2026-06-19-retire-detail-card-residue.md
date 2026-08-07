# Retire Detail Card Residue

Date: 2026-06-19

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

`channel-doc-card` has a live owner in `ChannelsPanel.tsx`, but the older
settings `.detail-*` card cluster no longer has production component owners.
The stale cluster remains in `settings.css`, `.detail-card` is still included
in a cross-surface message overflow reset, and tests still describe
`.detail-card` as a live Memory / Knowledge / Skills detail-card surface.

This is CSS debt plus a stale test contract: future UI using the same class
would inherit old settings/message rules without an intentional owner.

## Recall

| Source                                                       | Relevant constraint                                                                                |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `2026-06-18-settings-primitives-single-source-completion.md` | Settings surfaces should compose settings primitives instead of old local shells.                  |
| `2026-06-18-retire-settings-config-shell-residue.md`         | Removed settings shell selectors should become absence guards once production owners are gone.     |
| `channel-detail-card-single-source.test.ts`                  | Current test protects `.detail-card` as live UI, but the source sweep shows no production owner.   |
| `overlay-architecture-guards.test.ts`                        | `log-detail-*` is separately owned by LogViewer and must not be confused with retired `.detail-*`. |

## Evidence Sweep

| Command                                | Result                                                                                    | Decision                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `rg -n 'channel-doc-card               | detail-card' packages/overlay/src packages/overlay/test specs docs --glob '_._'` | `channel-doc-card` has a production owner in `ChannelsPanel.tsx`; `detail-card` appears only in CSS/tests. | Keep `channel-doc-card`; retire `detail-card`.                                            |
| `rg -n 'class="[^"]\*(channel-doc-card | detail-card                                                                               | detail-stack                                                                                               | detail-pre                                                                                | detail-grid-row                                                                                                                            | playwright-options                                                | config-inline-popup | opacity-field)' packages/overlay/src packages/overlay/test --glob '_.tsx' --glob '_.ts' --glob '\*.html'` | Runtime owners are `channel-doc-card` and `log-detail-pre` only. No `.detail-*` runtime owner exists. | Delete the old `.detail-*` settings cluster. |
| `rg -n 'detail-stack                   | detail-pre                                                                                | detail-grid-row                                                                                            | detail-card' packages/overlay/src packages/overlay/test specs docs --glob '_._'` | `.detail-stack`, `.detail-pre`, `.detail-pre-json`, and `.detail-grid-row` only appear in CSS; `.detail-card` is additionally test-pinned. | Retire the cluster together to avoid leaving same-origin residue. |
| `rg -n 'log-detail-pre                 | log-detail' packages/overlay/src packages/overlay/test --glob '_._'`                      | `LogViewer.tsx` actively renders `log-detail`, `log-detail-title`, and `log-detail-pre`.                   | Keep log detail styles and tests unchanged except for clarifying guards.                  |

## Fix

- Delete `.detail-stack`, `.detail-card`, `.detail-pre`,
  `.detail-pre-json`, and `.detail-grid-row` from `settings.css`.
- Remove `.detail-card` from the message overflow reset selector list.
- Update tests so `.channel-doc-card` remains the live owner and `.detail-*`
  becomes a retired selector family guard.
- Keep `log-detail-*` rules and guards because LogViewer still owns them.

## Acceptance

- Production CSS has no `.detail-card`, `.detail-stack`, `.detail-pre`,
  `.detail-pre-json`, or `.detail-grid-row` selectors.
- `channel-doc-card` still has a live component owner and flat chrome.
- `log-detail-*` remains owned by LogViewer.
- Focused static tests, overlay typecheck, and a real channel settings browser
  screenshot pass.
