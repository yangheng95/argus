# Overlay Hover Interaction Responsiveness

Date: 2026-08-03
Status: Approved design; awaiting implementation-plan review

## Recall

| Item | Evidence |
| --- | --- |
| User request | Investigate and optimize the visibly delayed hover feedback on the left Project list, the recommendation buttons below the composer, and the Composer model selector. |
| Acceptance criteria | Pointer entry produces immediately perceptible feedback on all three surfaces; the Project-list descriptive Tooltip opens after 200 ms; clicking, keyboard focus, model selection, and recommendation filling preserve their current behavior. |
| Hard constraints | Desktop-only. Use the existing Solid, Kobalte, and CSS primitive ownership; do not add fallback paths, state machines, duplicate hover owners, or UI automated tests. UI acceptance is real-client manual interaction plus screenshots. Existing user changes to `packages/overlay/src-tauri/tauri.conf.json` and the July native-first-frame record are out of scope. |
| Read records | `specs/records/2026-07/2026-07-31-overlay-runtime-interaction-performance.md`; `specs/current/architecture/07-panel.md`; `specs/README.md`. |
| Whole-repository grep | Enumerated `ui-duration-fast`, `ui-duration-base`, `chat-home-suggestion`, `composer-model-selector`, `model-selector-option`, `oc-navigation-row`, `openDelay`, `project-group-summary-tooltip`, and `work-row-summary-tooltip` across `packages/overlay/src`. The three interactive targets map to `conversation.css`, `composer.css`, `navigation-row.css`, `ProjectLedgerGroup.tsx`, `WorkLedger.tsx`, and the shared design-language tokens. |
| Independent agent feedback | None; the user did not request delegation. |

## Observed Cause Chain

The delay is not a network or model-load wait. Each target applies a CSS transition after pointer entry, and the Project list additionally schedules informational Tooltip content. The global design-language token defines `--ui-duration-fast: 80ms` and `--ui-duration-base: 120ms` specifically for hover/press and regular visual transitions.

The Project-list row inherits the 120 ms `oc-navigation-row` background/color animation. Its Project and item summary Tooltip opens after 350 ms. Recommendation buttons animate background, border, box shadow, and a two-pixel vertical transform; the shadow and transform make the visual result arrive later than a simple state wash. The model selector applies hover feedback to both its outer wrapper and its nested button, resulting in two simultaneous background transitions. The optional Hexin budget Tooltip independently opens after 250 ms.

## Approved Design

### Single immediate hover owner

Each target paints one immediate `--hover-wash` / border feedback state. CSS no longer interpolates the target hover state: the hover state starts in the same rendered frame. Keyboard `:focus-visible` retains the existing focus treatment; active/selected states and click handlers are unchanged.

### Surface-specific disposition

| Surface | Change | Preserve |
| --- | --- | --- |
| Project and task rows | Replace the shared navigation-row hover transition with immediate background/color state. Change summary Tooltip open delay from 350 ms to 200 ms. | Tooltip content, anchor geometry, close delay, keyboard focus, selected wash, row actions, and row identity. |
| Conversation recommendations | Remove hover transform and expanding shadow. Make background and border feedback immediate. | Card-like resting silhouette, icons, click-to-fill behavior, focus-visible affordance, and layout. |
| Composer model trigger and options | Remove wrapper-level hover paint so the Kobalte button is the sole trigger owner. Make trigger and listbox option wash immediate. Change Hexin budget Tooltip open delay from 250 ms to 200 ms. | Popover ownership, model search, model selection, provider load, focus ring, and the descriptive budget Tooltip. |

## Verification Plan

1. Do not create, modify, or run UI automated tests. The changed behavior is rendered hover and Tooltip timing.
2. Run Overlay typecheck and production Vite build using the repository toolchain.
3. Launch the real packaged desktop client. Manually hover Project rows, task rows, recommendation buttons, the model trigger, and model options; inspect screenshots for immediate wash, no vertical jump/shadow expansion, and 200 ms Tooltip intent delay.
4. Review `git diff --check`, run the required spec-health checks, commit with the required `dsw-33987` subject prefix, and push the current main delivery branch to `legacy-remote` through hooks.
