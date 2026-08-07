# Composer requires an explicit model

## Recall

| Item | Evidence |
| --- | --- |
| User request | “没设置模型不允许UI发送消息” — the UI must not send a message when no model is selected. |
| Acceptance criteria | With a non-empty draft and no effective model, the composer Send action remains disabled, Enter does not submit, and the disabled reason identifies the missing model. Selecting a model immediately enables normal submission behavior. Existing task follow-up behavior remains available when its operator model context resolves to a model. |
| Hard constraints | Keep the model selector as the single source of the effective composer model; do not add a backend routing fallback, compatibility model, workflow gate, or second model selection store. Do not restart or refresh the user's running OpenCorvus/overlay process. Use the existing Kobalte-backed selector and Button primitives. Verify the real page with Playwright launched by Node and inspect a screenshot. Preserve unrelated dirty worktree files. |
| Sources read | `specs/current/architecture/06-provider.md`; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-02-agent-model-select-popup-elevation.md`; `packages/overlay/src/components/ComposerModelSelector.tsx`; `packages/overlay/src/components/ChatComposer.tsx`; `packages/overlay/src/main.tsx`; `packages/overlay/src/services/chat.ts`; `packages/overlay/src/services/config.ts`; existing composer/model browser and unit tests. |
| Whole-repository search | `canComposeChat()` has one production caller (`main.tsx`) and one focused terminal-task test. `ComposerModelSelector` has one production mount (`ChatComposer.tsx`). `getTaskOperatorModelContext()` and `modelContextID()` are consumed only by the selector in production. New/project model identity is currently derived inside the selector from `appStore.config.model` or `appStore.newTaskModel`. Submit can be initiated through the form button or Enter, both converging on `handleSubmit`. |
| Independent agent feedback | No independent agent was requested; repository instructions only authorize sub-agents when the user explicitly requests them. |

## Root cause

The composer enablement and model selector are separate projections. `canComposeChat()`
checks connection and workspace shape, while `ComposerModelSelector` alone resolves the
effective new-project or selected-task model. Consequently, a visible “Choose model”
state does not participate in `sendDisabled()` or `handleSubmit()`.

## Implementation

1. Keep `selectedModel()` in `ComposerModelSelector` authoritative and report only its
   availability to its owning `ChatComposer`.
2. Make `ChatComposer` include that availability in both its visual disabled predicate
   and its form-submit guard. Preserve Stop behavior because stopping active work does
   not require selecting a model.
3. Add a dedicated localized missing-model disabled reason.
4. Extend focused source tests and the real browser model-selector test to cover the
   empty-model draft, disabled button, blocked Enter path, model selection, enabled
   transition, and screenshot evidence.

## Verification

- Focused Bun tests for the composer/model contract.
- Node-launched Playwright browser test for the real Overlay page.
- Typecheck for the Overlay package.
- Historical-document links and document-health tests.
- Manual screenshot inspection followed by a second source/diff review.
