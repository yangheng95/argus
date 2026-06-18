# Memory Search Field Primitive

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Problem

Independent GUI review found `MemoryPanel` still renders its search input with
`class="knowledge-search"` and `settings.css` owns a private search input
shell. The selector duplicates padding, border, background, focus, placeholder,
and `outline: none` while the overlay already has the shared `.search-field`
primitive in `field.css`.

The old test contract in `overlay-architecture-guards.test.ts` also pins
`knowledge-search`, making the private search style source look intentional.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-memory-row-nested-interactions.md` | Live memory row contracts are `.knowledge-item*` and `data-action="delete-memory"`; `MemoryPanel` is shared by Settings and the left activity panel. |
| `2026-06-18-retire-settings-extension-memory-residue.md` | Retired memory/settings selectors should be removed once no production creation point remains. |
| `packages/overlay/src/styles/surfaces/field.css` | `.search-field`, `.search-field-input`, `.search-field-icon`, and `.oc-button[data-ui$="-search-clear"]` are the shared compact search primitive. |
| `search-field-unification.test.ts` | TaskList and FileExplorer already assert search-field usage; MemoryPanel is the missing caller. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -e "knowledge-search" -e "search-field" -e "memory-search" packages/overlay/src packages/overlay/test specs specs/new-arch` | `knowledge-search` only appears in `MemoryPanel.tsx`, `settings.css`, and tests. Shared search-field callers already exist in TaskList, FileExplorer, MissionList, and CodingAssistantSessionList. | Retire `knowledge-search` instead of adapting it. |
| `MemoryPanel.tsx` inspection | The component already imports `Button` and `Icon`; Enter and Search button both call `doSearch(searchQuery())`; Refresh clears and reloads. | Reuse existing imports and handlers; add a small clear handler that clears submitted searches through `loadMemory()`. |
| `settings.css` inspection | `.knowledge-search` defines search chrome and `outline: none`; `.knowledge-toolbar` is only layout. | Keep `.knowledge-toolbar` as layout; delete `.knowledge-search` rules. |
| `overlay-architecture-guards.test.ts` inspection | The guard currently requires `.knowledge-search`, `.knowledge-search:focus`, and placeholder styles. | Update it to require the shared search-field contract and reject the retired selector. |

## Fix Plan

1. Replace the bare Memory input with a `.memory-search.search-field` wrapper.
2. Add `.search-field-icon`, `type="search"`, `.memory-search-input.search-field-input`, and explicit `aria-label`.
3. Add `Button data-ui="memory-search-clear"` for clearing non-empty queries.
4. Add `data-ui="memory-search-submit"` and `data-ui="memory-refresh"` to the existing operation buttons.
5. Delete `.knowledge-search` CSS from `settings.css`.
6. Extend source tests and architecture guards so MemoryPanel participates in
   the shared search-field contract.
7. Add a Node/Playwright visual fixture that focuses the memory search field,
   validates the focus ring, clear Button, submit Button, and saves screenshots.

## Acceptance

- `MemoryPanel.tsx` contains no `class="knowledge-search"`.
- Memory search uses `.search-field`, `.search-field-input`, and
  `.search-field-icon`.
- The input has an explicit `aria-label`.
- The clear action is `.oc-button[data-ui="memory-search-clear"]`.
- `settings.css` no longer defines `.knowledge-search` or its focus/placeholder
  rules.
- Browser screenshot evidence shows the shared search focus ring and no layout
  overlap.
