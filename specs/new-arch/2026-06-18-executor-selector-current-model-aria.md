# Executor Selector Current Model ARIA

## Context

The expert-squad selector report described unreadable unselected options on a white menu background. The current implementation is not a native HTML `select`; the visible model choices are `button.executor-popover-model` rows rendered by `ProviderModelGroup` inside the shared `ExecutorSelector` Popover. The visual white-background contrast was already validated in the selector popup investigation, but the same option list had a related selection-quality gap: the current row was only marked with `data-active`, which is visual styling state and not an accessibility contract.

## Recall

- `2026-06-18-retire-composer-selector-residue.md`: the active composer selector surface is the prompt-profile selector plus the dual executor chips; retired selector code must not be revived.
- `2026-06-18-hexin-budget-selector-regression.md`: the Hexin budget display stays inline inside the OpenCorvus chip with `role="status"` and `aria-live="polite"`.
- `2026-06-18-executor-chip-density-guard.md`: executor chip density must keep using the shared Button compact token and avoid local spacing overrides.
- `2026-06-07-codex-executor-native-model-fix.md`: external executors use native CLI model strings; OpenCorvus internal model selection is the provider/model surface.

## Impact Sweep

- `packages/overlay/src/components/ExecutorSelector.tsx`: `ProviderModelGroup` is the single render point for OpenCorvus and external executor model rows; `ExecutorChip` renders popover content through Kobalte Portal so the menu does not participate in chip-row flex layout.
- `packages/overlay/src/styles/surfaces/composer.css`: `.executor-popover-model[data-active="true"]` remains the visual current-row style; the popover no longer adds its own `left`/`bottom` positioning on top of Kobalte Popover placement.
- `packages/overlay/test/executor-selector-dualbar.test.ts`: static guard covers the selected-row semantic contract and rejects toggle semantics for a non-toggle action.
- `packages/overlay/test/browser/executor-selector-redesign.test.ts`: real browser coverage verifies selected and unselected rows on the white popover surface, locks external native model current-state matching, checks `Tabs` `aria-selected` parity, and saves visual evidence.

## Decision

Expose the current model row with `aria-current="true"` at the existing `ProviderModelGroup` source. Unselected rows omit `aria-current`. This matches the behavior: each row is still a command button that selects a model, not a persistent toggle button or a full listbox/radio-group rewrite.

## Acceptance

- The current model row has both `data-active="true"` and `aria-current="true"`.
- Unselected model rows have `data-active="false"` and no `aria-current`.
- Both OpenCorvus and external executor popovers use the same source behavior.
- Browser verification includes a screenshot of the white-background menu with current and unselected rows visible.
- OpenCorvus and external popovers stay inside the viewport while covering their trigger; positioning has a single source in Kobalte Popover.
