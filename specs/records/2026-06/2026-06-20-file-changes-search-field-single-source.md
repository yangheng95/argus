# File Changes Search Field Single Source

Date: 2026-06-20

CSS means Cascading Style Sheets. UI means User Interface. DOM means Document
Object Model.

## Recall

| Source                                              | Relevant constraint                                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                         | UI work must use mature primitives, avoid double sources, and include visual verification.                                                                      |
| `2026-06-18-file-changes-filter-primitive-owner.md` | `FileChangesView` already moved clear-filter and status filter controls to `Button` and `SegmentedControl`; this fix must not revisit row/list/status behavior. |
| `2026-06-19-memory-search-field-primitive.md`       | Search rows should use `.search-field`, `.search-field-input`, `.search-field-icon`, and Button clear actions.                                                  |
| `2026-06-19-retire-toolbar-search-residue.md`       | `.search-field*` is the single search-input primitive surface.                                                                                                  |
| `2026-06-20-provider-search-field-single-source.md` | Provider search retired private search chrome and joined the shared `search-field` contract.                                                                    |
| `packages/overlay/src/styles/surfaces/field.css`    | Shared search chrome, input reset, focus ring, icon tint, and clear affordance live in `.search-field*`.                                                        |

## Problem

Independent GUI review found `FileChangesView` still renders its filter/search
toolbar as a private search shell:

- `class="changes-filter-field"`
- `class="changes-filter-input field-input"`
- `changes.css` rules for `.changes-filter-field`,
  `.changes-filter-field:focus-within`,
  `.changes-filter-input.field-input`, and
  `.changes-filter-input.field-input:focus`

That duplicates the shared `.search-field*` primitive that now owns search
field shell, focus, input reset, icon tint, and clear button chrome. The clear
Button also uses `data-ui="file-changes-filter-clear"`, which does not match
the shared clear selector `.search-field .oc-button[data-ui$="-search-clear"]`.

## Evidence Sweep

| Sweep                                                      | Result                                                                                                                      | Decision                                                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `rg -n "changes-filter-field                               | changes-filter-input                                                                                                        | file-changes-filter-clear                                     | changes-toolbar" packages/overlay/src packages/overlay/test specs -S` | Live hits are isolated to `FileChangesView.tsx`, `changes.css`, `agent-file-changes.test.ts`, and `toolbar-diff-navigation.test.ts`. | Migrate this one search surface and its tests. |
| `2026-06-18-file-changes-filter-primitive-owner.md` review | The old fix scoped to clear Button and status `SegmentedControl`; it did not establish a private search shell as permanent. | Treat this as a later search-field unification follow-up.     |
| `search-field-unification.test.ts` review                  | Task, File Explorer, Memory, and Provider search are covered; File Changes search is missing.                               | Add File Changes to the shared contract test.                 |
| `toolbar-diff-navigation.test.ts` review                   | Existing Node browser flow types in the filter, clicks clear, and screenshots the real File Changes panel.                  | Extend the same flow for focused/typed search-field evidence. |
| Independent explorer audit                                 | Confirmed high confidence and found no evidence requiring old selectors.                                                    | Proceed with a narrow search-field migration.                 |

## Fix Plan

1. Change the toolbar wrapper to `class="changes-filter-field search-field"`.
2. Give the search icon `class="changes-filter-icon search-field-icon"`.
3. Change the input to `class="changes-filter-input search-field-input"` and
   add `data-ui="file-changes-search-input"` for stable browser tests.
4. Change the clear Button to `data-ui="file-changes-search-clear"` so shared
   `.search-field` clear chrome applies.
5. Delete private search shell/input/focus/clear chrome from `changes.css`;
   keep only toolbar layout if needed.
6. Update static tests and browser selectors to the shared search contract.
7. Keep status `SegmentedControl`, Kobalte Listbox rows, diff loading, and
   filtering behavior unchanged.

## Acceptance

- File Changes search DOM uses `.search-field`, `.search-field-icon`, and
  `.search-field-input`.
- `changes.css` no longer defines private search field chrome or clear Button
  chrome for the filter toolbar.
- Search typing, clear action, and focus restoration still work.
- File Changes joins `search-field-unification.test.ts`.
- Node/Playwright screenshot evidence shows the real focused/typed search
  toolbar without icon, text, or clear-button overlap.
