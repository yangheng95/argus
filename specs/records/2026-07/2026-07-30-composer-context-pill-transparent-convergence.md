# Composer context pill transparent convergence

## Recall

- User requirement: unify the Composer pills shown as `Code`, the active Expert
  Squad, and the model selector; keep the light-theme border quiet and make
  every pill interior transparent.
- Acceptance:
  - both static conversation-context pills continue to render through the
    canonical `Badge` primitive;
  - the model selector remains the canonical Kobalte-backed Popover trigger and
    shared `Button` primitive;
  - all three share one transparent-background and low-contrast-border
    contract;
  - the Code/Work semantic accent remains in the foreground instead of painting
    a stronger body or boundary;
  - the interactive draft-state Code/Work selector remains the canonical
    Kobalte-backed `SegmentedControl`;
  - the real Overlay page is opened, interacted with, screenshotted, and
    visually reviewed in the light theme.
- Hard constraints:
  - preserve concurrent work and stage only task-owned paths;
  - do not create, update, or run UI automation tests;
  - delete directly discovered obsolete UI source/fixture tests instead of
    rewriting them;
  - use Node, never Bun, for browser driving;
  - retain the single native Overlay titlebar.
- Read records:
  - `specs/records/2026-07/2026-07-29-composer-mode-selected-state-contrast.md`
  - `specs/records/2026-07/2026-07-29-composer-model-trigger-neutral-parity.md`
  - `specs/records/2026-07/2026-07-29-ui-automated-test-prohibition.md`
- Whole-repository grep:
  - all production `Badge` callers were enumerated. The primitive is shared
    broadly, so its default appearance remains unchanged;
  - `ChatComposer.tsx` is the sole production owner of
    `composer-context-flag`, `composer-context-mode-flag`, and
    `composer-context-squad-flag`;
  - `composer.css` is the sole production style owner of those classes;
  - `ComposerModelSelector.tsx` is the sole production model-trigger renderer
    and `composer.css` is its sole production visual owner;
  - the draft selector is separately owned by `composer-mode-toggle` and
    `SegmentedControl`, so it is preserved;
  - directly discovered UI source/browser assertion owners are
    `workspace-composer-density.test.ts`,
    `composer-file-loader-right-dock.test.ts`,
    `coding-assistant-panel.test.ts`,
    `settings-persistence.test.ts`,
    `browser/chat-composer-button-primitives.test.ts`,
    `browser/light-theme-reference-browser.test.ts`, and
    `browser/neutral-chrome-wash-browser.test.ts`,
    `composer-model-selector-contract.test.ts`,
    `flat-redesign-border-policy.test.ts`,
    `overlay-architecture-guards.test.ts`,
    `mission-i18n.test.ts`,
    `browser/composer-model-selector-browser.test.ts`,
    `browser/composer-model-selector-task-context.test.ts`, and
    `browser/chat-composer-resize-browser.test.ts`. They must not be run or
    rewritten under the current UI-test prohibition.
- Independent agent feedback: none; the user did not request sub-agent or
  parallel-agent work.

## Root cause

The static context labels already share `Badge`, but Composer-local CSS
repainted the Code/Work badge with a relatively strong accent border and the
Expert Squad badge with an inset fill. The model selector already had pill
geometry but removed its persistent boundary completely. Those three
independent paint decisions defeated one coherent pill primitive at the exact
surface shown by the user.

## Implementation

1. Keep both labels on `Badge` and the model selector on its existing
   Popover/Button primitives.
2. Give `.composer-context-flag.oc-badge` and `.composer-model-selector` one
   shared CSS owner for the transparent body, quiet theme-derived pill
   boundary, radius, and resting shadow.
3. Remove the competing mode-border and squad-background repaint rules. Badge
   tone continues to own foreground semantics; model hover and focus keep their
   existing interaction feedback.
4. Remove the directly discovered obsolete UI automation/source assertion
   files without replacing them.
5. Update the centralized spec indexes.

## Verification

- Overlay typecheck passed.
- Overlay i18n integrity passed.
- `historical-docs-links.test.ts` passed 22 focused, non-UI documentation
  health checks.
- No UI test was run.
- A Node-started isolated Vite surface at `http://127.0.0.1:5197/` rendered the
  real connected light-theme Overlay without touching the installed native
  window. The exact Composer region showed:
  - `Code`: 32px high, transparent background, no shadow, one 1px
    theme-derived boundary at approximately 6.8% alpha, semantic accent
    foreground;
  - `Builtin/General`: the same body, boundary, height, and shadow contract with
    neutral foreground;
  - `Choose model`: the same transparent body, 1px boundary, 999px radius,
    border-box sizing, 32px height, and no resting shadow.
- The first model-boundary pass exposed a real 34px wrapper because its
  32px child trigger was still being added inside the new border. The shared
  primitive now owns border-box sizing and the inner model trigger consumes the
  two border pixels; the second screenshot confirmed exact 32px convergence.
- Clicking the real model pill opened the canonical Provider/model Popover;
  Escape closed it without changing the resting pill contract. Browser console
  errors remained at zero.
- The personally inspected task crop is
  `/tmp/opencorvus-composer-unified-pill-primitive.png`. It shows all three
  pills sharing a quiet transparent silhouette without a strong tinted fill or
  boundary.
- The isolated Vite process and browser tab were closed after review.
- Final delivery uses an exact task-owned diff review and isolated index; the
  concurrent Composer mention and Panel work remains outside this change.
