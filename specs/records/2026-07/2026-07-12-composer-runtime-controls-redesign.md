# Composer runtime controls redesign

## Recall

| Item | Detail |
| --- | --- |
| User request | Remove Run completely and improve the runtime controls directly in the input box; the previous menu-only navigation was not configurable and looked poor. |
| Acceptance criteria | The titlebar returns to File, Edit, View, Help with no Run trigger or Run content. Parallelism is directly adjustable in the composer through compact decrement/value/increment controls. Unattended is a clear switch-like control with visible on/off state. Both persist through the existing authoritative config path and expose saving/disabled feedback. The controls visually align with attachment, intent, model, and send controls at desktop width. Real browser interaction and screenshot review pass. |
| Hard constraints | No duplicate runtime control surface, fallback value, local shadow config, fake button, native unstyled number spinner, live Overlay restart, or unrelated dirty-worktree changes. Preserve `assistant.max_executor_groups`, `experimental.auto_confirm_proposed_tasks`, and `experimental.auto_question` as authorities. Use the existing Button and Icon primitives. |
| Sources read | `AGENTS.md`; Browser control skill; `2026-07-11-composer-parallelism-unattended-controls.md`; `2026-07-11-run-menu-runtime-control-rebuild.md`; current ChatComposer, TitlebarMenubar, composer/titlebar styles, i18n, focused source tests, and Node browser fixtures. |
| Whole-repository search evidence | `rg` covered every Run menu identifier/i18n key/test, every composer parallelism/unattended selector, config patches, and browser interactions. The only current runtime UI owners are Titlebar Run and ChatComposer; this change removes Titlebar Run and makes ChatComposer the sole owner. |
| Independent agent feedback | None; the user did not request delegation. |

## Design

The composer runtime controls become one compact visual family. Parallelism uses two Button primitives around a tabular value, avoiding the browser-native number spinner and arbitrary maximums. Unattended uses the existing Button primitive with a switch track and thumb, while `aria-pressed` remains the semantic state. Both write exact existing config patches and disable during writes.

## Verification

- Focused source tests prove Run is absent and the composer owns both configurable controls.
- The Node browser fixture changes parallelism through both buttons, toggles unattended, captures exact PATCH bodies, and saves a desktop screenshot.
- Overlay typecheck/build and final screenshot inspection complete acceptance.

## Result

- Removed Run from the titlebar menu type, menu order, access keys, content, i18n, and browser expectations. The top-level order is now File, Edit, View, Help.
- Replaced the native parallelism number input with Button-primitive decrement/increment controls around an authoritative tabular value.
- Replaced the unattended status dot with a visible switch track/thumb while preserving `aria-pressed` and the exact atomic config patch.
- Visual iteration caught and repaired two rejected states: separate competing pills, then a non-shrinking group that clipped its label and displaced intent/model controls. The accepted compact group preserves all composer controls.
- Passed focused source tests, Overlay TypeScript, production Vite build, exact PATCH interaction checks, titlebar browser regression, and screenshot review of `.scratch/chat-composer-run-controls.png`.

## 2026-07-12 visual and interaction correction

The prior acceptance claim was invalidated by the real packaged screenshot: the stepper placed Button primitives whose authoritative icon width is 32px into 18px grid columns and attempted to override a nonexistent `--oc-button-size` variable. The result clipped minus/value/plus into unreadable strokes. The outer combined pill also conflicted with the composer's established independent control-pill language. In addition, Composer alone patched config without `currentProjectConfigRequestOptions()`, unlike the model, permission, and network controls.

The corrected design gives Parallel and Unattended independent 32px pill surfaces, uses explicit 22px Button geometry plus a scoped 12px icon override, preserves a legible numeric column, and sends both mutations through the current-project config authority. Packaged-page screenshot and real click persistence must be re-run; source fixture screenshots alone are no longer accepted as evidence.
