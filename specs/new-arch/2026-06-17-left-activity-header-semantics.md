# Left Activity Header Semantics - 2026-06-17

## Acronyms

- ARIA: Accessible Rich Internet Applications, attributes that expose UI semantics to assistive technology.
- GUI: Graphical User Interface, the visible overlay workbench.
- ID: Identifier, a DOM or activity key.
- UI: User Interface, the visible and semantic controls users operate.

## Problem

The left activity panel switches between Mission, Tasks, Coding Assistant,
Memory, Skill, and MCP bodies. The visible header title updates, but the header
actions toolbar keeps the static `aria-label` and `data-i18n-aria-label` from
`index.html`. That means the UI can show Tasks or Coding Assistant while the
toolbar still announces Mission.

The title keys are also duplicated: `LEFT_ACTIVITIES` already owns each
activity `labelKey`, while `LEFT_ACTIVITY_TITLE_KEYS` repeats the same mapping.

## Evidence Sweep

Command:

```powershell
rg -n "LEFT_ACTIVITIES|LEFT_ACTIVITY_BODY_IDS|LEFT_ACTIVITY_TITLE_KEYS|leftPanelTaskActions|data-activity-actions|leftPanelTitle" packages/overlay/src packages/overlay/test -g "*.ts" -g "*.tsx" -g "*.html" -g "*.css"
```

Findings:

| Surface | Evidence | Decision |
| --- | --- | --- |
| Static shell | `index.html` initializes `leftPanelTaskActions` with `aria-label="Mission"` and `data-i18n-aria-label="mission.title"`. | Keep initial HTML for first paint, but runtime must synchronize semantics with active activity. |
| Runtime activity definition | `main.tsx` `LEFT_ACTIVITIES` owns `labelKey` per activity. | Use this as the title/ARIA key source. |
| Duplicate title map | `main.tsx` `LEFT_ACTIVITY_TITLE_KEYS` repeats label keys. | Delete the duplicate map and derive from `LEFT_ACTIVITIES`. |
| Header effect | Runtime effect updates title text and button visibility, but not toolbar ARIA/i18n attributes. | Update `aria-label`, `data-i18n-aria-label`, and `data-activity-actions` in the same effect. |
| Tests | Browser side-activity test already inspects `#leftPanelTaskActions`; static tests pin Mission header actions. | Add assertions for semantic synchronization across Mission, Tasks, Assistant, and tool panels. |

## Fix

1. Add a `LEFT_ACTIVITY_BY_ID` lookup derived from `LEFT_ACTIVITIES`.
2. Replace `LEFT_ACTIVITY_TITLE_KEYS` with a helper that returns the activity
   definition's `labelKey`.
3. In the existing left panel effect, compute `titleKey` and `titleText` once.
4. Update the header title text, toolbar `aria-label`,
   `data-i18n-aria-label`, and `data-activity-actions` from that same source.
5. Extend static/browser tests so switching activity updates both visible and
   semantic toolbar state.

## Acceptance

- `LEFT_ACTIVITY_TITLE_KEYS` no longer exists.
- The header title and actions toolbar ARIA label derive from `LEFT_ACTIVITIES`.
- Switching to Tasks makes `#leftPanelTaskActions` announce the localized task ledger title.
- Switching to Coding Assistant makes it announce the localized assistant title.
- Switching to a tool-only activity hides create actions but still announces the active tool panel title.
- Overlay unit/browser tests and typecheck pass.
- A real browser screenshot is inspected after the UI change.
