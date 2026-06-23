# File Explorer Search Input Single Source

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface. DOM means
Document Object Model.

## Recall

| Source                                                  | Relevant constraint                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                             | UI work must avoid double sources, use mature primitives, and include visual browser verification.      |
| `2026-06-19-memory-search-field-primitive.md`           | Search rows use `.search-field`, `.search-field-input`, `.search-field-icon`, and Button clear actions. |
| `2026-06-19-retire-field-input-action-residue.md`       | Plain controls use `.field-input`; search controls use `.search-field*`.                                |
| `2026-06-20-file-changes-search-field-single-source.md` | Search inputs must not keep private `.field-input` focus chrome beside `.search-field:focus-within`.    |
| `packages/overlay/src/styles/surfaces/field.css`        | `.search-field-input` already owns search input reset, transparent background, and no inner box shadow. |

## Problem

Independent GUI review found the File Explorer toolbar search input still
combines two primitives on the same element:

- `class="file-explorer-search-input search-field-input field-input"`
- `.file-explorer-search-input.field-input { min-height: 0; }`

That makes the search field depend on both `.search-field*` and `.field-input`.
When the input is focused, `.field-input:focus` has higher specificity than
`.search-field-input`, so it can apply an inner input focus shadow while
`.search-field:focus-within` applies the shared outer focus ring. Later
`.field-input` rules can also reintroduce plain-field background and border
assumptions to a search input that should be transparent inside the shared
search shell.

## Evidence Sweep

| Sweep                                        | Result                                                                                                                              | Decision                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `rg -n "file-explorer-search-input           | file-explorer-search                                                                                                                | search-field-input field-input" packages/overlay/src packages/overlay/test specs/new-arch -S` | Live production hits are isolated to `FileExplorerPanel.tsx` and `inspector.css`; `search-field-unification.test.ts` pins the old class mix. | Migrate this one search input and update the contract. |
| `field.css` review                           | `.search-field-input` already sets the needed height, transparent background, border reset, outline reset, and search cancel reset. | Do not preserve `.field-input` for search behavior.                                           |
| `file-explorer-accessibility.test.ts` review | The existing Node browser fixture already opens the real File Explorer panel and captures screenshots.                              | Extend that fixture to focus the search field and assert outer-only focus chrome.             |
| Independent explorer audit                   | Confirmed high confidence and found no necessary exception requiring the old selector.                                              | Proceed with a narrow File Explorer search migration.                                         |

## Fix Plan

1. Remove `field-input` from the File Explorer search input class list.
2. Delete `.file-explorer-search-input.field-input` from `inspector.css`.
3. Update search-field unification and File Explorer static tests to reject
   `search-field-input field-input` for search controls.
4. Extend the File Explorer browser fixture to focus the search input, assert
   the outer `.search-field` owns the focus ring, assert the inner input has no
   box shadow or border, and save screenshot evidence.
5. Leave file tree rows, upload, retry, virtualized list, search behavior, and
   clear Button behavior unchanged.

## Acceptance

- File Explorer search input uses `.search-field-input` without `.field-input`.
- `inspector.css` no longer defines `.file-explorer-search-input.field-input`.
- Static tests reject search input primitive mixing.
- Real browser validation shows focused File Explorer search has a shared outer
  focus ring and no inner input focus chrome.
