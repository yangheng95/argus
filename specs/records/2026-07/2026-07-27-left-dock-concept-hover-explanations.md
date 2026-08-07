# Left Dock concept hover explanations

## Recall

### User requirements

- Find the terms in UI panel icons and menus that need explanation before changing the interface.
- Research the most reasonable hover copy instead of inventing definitions from the visible labels alone.
- Add detailed hover explanations, including what Chat, Mission, and Task mean.

### Acceptance criteria

- The left Dock gives pointer and keyboard users a structured title plus explanation for the primary concept launchers.
- The Mission, Chat, and Task kind icons explain their distinct ownership and execution boundaries.
- Project organization and creation menu choices explain the result of each choice when hovered or focused.
- English and Simplified Chinese catalogs remain complete and semantically aligned.
- Existing actions, menu selection, focus behavior, row selection, and layout density remain unchanged.
- Focused tests, Overlay typecheck, real Vite interaction, Node-owned browser verification, and inspected desktop screenshots pass.

### Hard constraints

- Reuse the existing Kobalte Tooltip, DropdownMenu, Button, and Icon primitives.
- Keep Work Ledger, Mission, Chat, Task, Project, and Settings ownership unchanged; this is explanatory UI only.
- Do not add native-only `title` text as the sole explanation because it is not a reliable keyboard-accessible description.
- Do not add another concept catalog or infer definitions from icon shape.
- Preserve unrelated concurrent worktree changes and stage only task-owned files.
- Do not restart, refresh, or otherwise interfere with an existing OpenCorvus or Overlay process.

### Read sources

- `AGENTS.md`
- `specs/records/2026-07/2026-07-25-left-dock-direct-launch-and-alignment.md`
- `specs/records/2026-07/2026-07-24-work-ledger-conversation-hover-and-kind-icons.md`
- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/session/system.ts`
- `packages/opencorvus/src/work-ledger/projection.ts`
- `packages/opencorvus/src/server/routes/work-ledger.ts`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ui/Tooltip.tsx`
- `packages/overlay/src/components/ui/DropdownMenu.tsx`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- W3C WAI-ARIA tooltip, accessible-name/description, and hover/focus guidance

### Full-repository grep

| Surface / term                        | Evidence                                                                                                                               | Decision                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Chat                                  | `coding-assistant` is the direct, ad hoc workspace assistant; Work Ledger projects it as `kind: "chat"`                                | Explain it as one direct conversation for interactive workspace work, distinct from Mission coordination      |
| Mission                               | The Mission primary agent owns long-running goals, roadmap, Task coordination, and delivery reconciliation                             | Explain it as coordinated, longer-running work that can create and manage Tasks                               |
| Task                                  | SDK and Work Ledger contracts identify Task as a Mission-owned fixed-profile execution unit; standalone Tasks also exist in the ledger | Explain it as one bounded unit of work with its own progress and result, often created by a Mission           |
| Agent Squad                           | Runtime contracts define it as the fixed capability package selected for a Mission or Task lifetime                                    | Explain it as the specialist agent/tool/skill package used for a kind of work                                 |
| Scheduled automations                 | The existing launcher opens the canonical scheduled-automation surface                                                                 | Explain it as work that starts from a saved schedule                                                          |
| Channel                               | The existing launcher opens external channel configuration                                                                             | Explain it as the connection used to receive and send OpenCorvus conversations through an external service    |
| Multica Import                        | The existing action imports work into the active project directory                                                                     | Explain the active-project requirement and imported-result scope                                              |
| Work Ledger kind mark                 | `WorkLedgerKindMark` is the sole live-row kind-icon tooltip owner                                                                      | Replace the terse one-line copy with the shared structured explanation surface                                |
| Work Ledger navigation launchers      | Six Button call sites currently use native `title` plus visible labels                                                                 | Replace native-only help with the canonical Kobalte Tooltip while preserving Button ownership and click paths |
| Project organization menu             | Three organization/sort choices are owned by `settingsStore` through the existing CheckboxItem call sites                              | Add hover/focus explanations to the existing menu items; do not create another settings source                |
| Project creation menu                 | Two existing Item call sites select the canonical anonymous-project or directory browser paths                                         | Add outcome explanations without changing either action                                                       |
| Right Dock and Environment tool icons | Already identify concrete tools rather than ambiguous work-model terms, and several have canonical tool metadata                       | Preserve in this change; do not broaden a terminology repair into a second tool catalog                       |
| Archive kind icons                    | Separate Settings surface with visible kind labels and action context                                                                  | Preserve; the requested panel surface and ambiguous compact kind icons are the live left Dock                 |

### Independent-agent feedback

- No sub-agent was requested or used.

## Copy and interaction rationale

The repository model is the authority for product terms. External accessibility guidance is used only for presentation: a focusable control needs a short accessible name, while the supplementary explanation belongs in a tooltip connected as its accessible description. The existing Kobalte Tooltip already owns hover, focus, Escape dismissal, placement, and `aria-describedby`, so the repair extends that primitive with one structured title/body recipe rather than relying on browser-native `title` behavior.

Definitions use one boundary plus one outcome:

- **Chat**: direct conversation; interactive work in one workspace.
- **Mission**: coordinated long-running effort; may create and manage Tasks to reach the outcome.
- **Task**: bounded execution unit; has its own progress and result and may belong to a Mission.

The copy avoids implementation details such as database/session identity, scheduler state, or internal prompt profiles. Those facts are accurate but do not help a user choose an entry.

## Implementation plan

1. Add a structured explanatory-content variant to the existing Tooltip primitive and its shared CSS recipe.
2. Replace the six Work Ledger launcher native-title-only explanations with Kobalte hover/focus tooltips.
3. Upgrade `WorkLedgerKindMark` to use the same structured Mission, Chat, and Task definitions.
4. Add explanatory tooltips to every existing project organization, sort, and creation menu item without changing their callbacks or settings ownership.
5. Add aligned English and Simplified Chinese strings plus focused source and real-browser regression coverage.
6. Run focused tests, i18n validation, typecheck, document health, real Vite/browser interaction, screenshot review, and final diff review.

## Verification record

- `bun test packages/overlay/test/work-ledger-consolidation.test.ts --test-name-pattern "structured hover"`: **1 passed, 0 failed**.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/work-ledger-conversation-row-browser.test.ts`: **1 passed, 0 failed** using Node-owned Playwright and the real built Overlay.
- Browser assertions verified the structured Mission kind explanation, the New Chat explanation, menu-item hover/focus behavior, tooltip role, bounded width, viewport fitting, semantic row icons, selected/focus preservation, and exact menu behavior.
- Inspected desktop screenshots:
  - `.scratch/left-dock-chat-concept-tooltip.png`
  - `.scratch/left-dock-organization-menu-tooltip.png`
- A separate isolated `dev:vite` session was opened in the in-app browser. Keyboard focus on the unique left-Dock New Chat control exposed the exact structured explanation, and visual inspection confirmed the tooltip stayed aligned beside the left Dock without covering its trigger.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- The broader `work-ledger-consolidation.test.ts` file still contains unrelated stale source-shape assertions for Composer model-selector formatting, generated transport types, Mission status, and Work Ledger cursor ownership. Those failures predate and do not exercise this tooltip change; the task-owned test and real browser chain are green.
