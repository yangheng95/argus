# Retire Coding Assistant Activity Residue

## Context

Independent CSS review found `.coding-assistant-activity` still defined in
`workspace.css`. The Coding Assistant surface now lives in the left activity
panel; the old center-workbench assistant activity no longer has a DOM owner.

## Recall

| Source                                                                                  | Constraint                                                                                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/index.html`                                                       | Defines `leftPanelAssistant` and `codingAssistantSessionListPanel`; it does not define `centerWorkbenchAssistant`. |
| `packages/overlay/src/main.tsx`                                                         | Left activities include `"assistant"`; center workbench panels no longer include an assistant panel.               |
| `packages/overlay/test/coding-assistant-panel.test.ts`                                  | Existing contract rejects the retired `centerWorkbenchAssistant` and `solidCodingAssistantMount` DOM owners.       |
| `rg -n -F "coding-assistant-activity" packages/overlay/src packages/overlay/test specs` | The only live hit was the CSS rule in `workspace.css`.                                                             |

## Fix

- Remove the orphan `.coding-assistant-activity` rule from `workspace.css`.
- Extend `coding-assistant-panel.test.ts` to reject the retired CSS selector
  alongside the existing retired DOM owner assertions.

## Acceptance

- No source or test contract keeps `.coding-assistant-activity`.
- Coding Assistant remains owned by the left panel surface.
- Center-workbench assistant residue cannot silently return through CSS.
