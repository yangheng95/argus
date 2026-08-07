# Composer Intent Pointer Focus Ring Repair

## Recall

User request, 2026-07-27: after choosing Chat or Mission in the composer,
the rounded blue border around the selector remains visible and is visually
occluded; adjust the UI.

Acceptance criteria:

- Choosing Chat or Mission with the pointer leaves the compact intent control
  in its normal selected presentation without a lingering blue focus ring.
- Keyboard navigation still presents an unbroken, accessible focus-visible
  ring around the same control.
- Chat/Mission mode selection, the Mission Expert Squad submenu, composer
  focus styling, and the shared Button primitive remain unchanged.
- A real Overlay page is exercised with Node-started Playwright, the affected
  state is captured, and the screenshot is visually reviewed.

Hard constraints retained from project instructions:

- Use the existing Button and Kobalte DropdownMenu primitives; do not create a
  second selector, state owner, focus manager, or frontend-only interaction.
- Fix the focus modality at the owning composer surface. Do not hide the ring
  with clipping, overflow, a z-index workaround, or a timeout.
- Preserve unrelated dirty worktree changes. Do not reset, restore, create a
  worktree, or interfere with a running OpenCorvus/Overlay process.
- Browser verification uses an isolated preview and Playwright is started with
  Node, never Bun.
- Stage only this repair, use the `dsw-33987` commit prefix, and push to the
  legacy remote through normal hooks.

Sources read before implementation:

- `AGENTS.md`
- `specs/records/2026-07/2026-07-25-composer-chat-mission-manual-switch-restoration.md`
- `specs/records/2026-07/2026-07-27-chat-mission-recommendation-confirmation.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/styles/primitives/button.css`
- `packages/overlay/test/browser/global-new-chat-provider-error-browser.test.ts`
- `packages/overlay/test/browser/chat-composer-button-primitives.test.ts`
- `packages/overlay/test/workspace-composer-density.test.ts`

Whole-repository grep evidence:

- `composer-intent-select-wrap` has one production render in
  `ChatComposer.tsx`, one style owner in `surfaces/composer.css`, focused source
  assertions, and browser fixtures/tests. There is no second production intent
  selector.
- The actual intent trigger is itself the shared `Button`; the class name
  `composer-intent-select-wrap` is historical and does not identify a wrapper
  element.
- `:is(.composer-intent-select-wrap, .composer-model-selector):focus-within`
  is the only composer-family rule that converts any retained focus, including
  pointer focus restored by Kobalte after selection, into a blue ring.
- `.oc-button:focus-visible` already owns keyboard focus indication. The
  intent surface therefore does not need a broader `:focus-within` signal.
  The model selector is a true wrapper and needs a descendant
  `:focus-visible` projection rather than pointer-insensitive `:focus-within`.
- Existing real browser coverage in
  `global-new-chat-provider-error-browser.test.ts` already exercises Mission
  to Chat and Chat to Mission through the production Overlay bundle and is the
  narrowest truthful place to assert and capture the post-selection state.

Independent agent feedback:

- Not launched. The user did not request sub-agents, and the active
  collaboration policy prohibits unsolicited delegation. The main agent will
  perform the required second review.

## Diagnosis

The visible blue ring is not a selected-state border and is not being clipped
by the DropdownMenu. After a pointer choice, Kobalte correctly restores focus
to its trigger. The composer then applies a `:focus-within` box shadow to that
focused trigger. Unlike `:focus-visible`, `:focus-within` does not distinguish
keyboard focus from pointer focus, so the ring persists after the menu closes.
Because the ring is an outer box shadow on a compact pill nested inside the
larger focused composer shell, it reads as partially covered chrome.

The shared Button primitive already uses `:focus-visible`, which is the
appropriate modality-aware source. The root repair is to align the
composer-family selector with that source, not to alter selection state,
spacing, clipping, or menu focus restoration.

## Call-Site Treatment

| Call site / sibling | Treatment |
| --- | --- |
| `ChatComposer.tsx` intent trigger | Preserve production structure and selection behavior. |
| `composer.css` intent focus rule | Replace pointer-insensitive `:focus-within` with direct `:focus-visible`. |
| `composer.css` model selector wrapper | Preserve keyboard ring by projecting the child Button's `:focus-visible` state with `:has(...)`. |
| Shared `button.css` | Preserve as the canonical Button keyboard-focus source. |
| Production Overlay browser flow | Assert pointer-selected Chat/Mission has no ring, assert keyboard focus still has a visible ring, and save the reviewed state. |
| Static composer density contract | Pin the modality-aware selectors and reject the retired broad focus rule. |

## Implementation Plan

1. Add this record and both spec-index entries.
2. Replace the broad composer selector `:focus-within` rule with
   modality-aware intent and model focus-visible selectors.
3. Extend focused static and production browser coverage for pointer and
   keyboard focus states.
4. Run focused tests, Overlay typecheck/build as required by the normal hook,
   real Node/Playwright visual verification, docs health, `git diff --check`,
   and an exact-file second review.
5. Commit only this repair with the required prefix and push the current main
   delivery branch to `legacy-remote`.

## Verification Commands

- `bun test packages/overlay/test/workspace-composer-density.test.ts`
- `bun test packages/overlay/test/settings-persistence.test.ts`
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test packages/overlay/test/browser/global-new-chat-provider-error-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `git diff --check`

## Verification Results

- Focused composer source tests: 32 passed, 0 failed. The run also exposed
  three stale density assertions that still described the retired
  model-selector-only surface; they now assert the existing shared
  Chat/Mission/model selector family without changing production behavior.
- Production Overlay build completed successfully before the browser run.
- Overlay typecheck passed.
- Node/Playwright primitive visual regression: 1 passed. It focuses the real
  Button-shaped intent fixture by pointer, moves the pointer away, proves the
  button remains active without matching `:focus-visible`, and proves its
  computed box shadow is `none`. The visually reviewed light-theme screenshot
  is `.scratch/chat-composer-button-primitives.png`.
- Production Overlay Node/Playwright regression: 1 passed. It exercises New
  Mission to Chat and Chat to Mission, proves both pointer-selected surfaces
  have no blue ring, proves keyboard Escape restoration still has the
  focus-visible ring, and captures the goal-scoped composer at
  `.scratch/composer-intent-pointer-selection.png`. The reviewed screenshot
  shows one complete outer composer boundary and no occluded inner selector
  border.
- The production browser fixture initially reached its final error audit and
  reported an unhandled root `GET /file`; the same fixture already renders the
  file workbench and sibling Overlay fixtures return an empty file list. The
  fixture now supplies that canonical empty response, and the complete browser
  test passes with no unexpected responses.
- Historical document links: 22 passed, 0 failed.
- Product documentation single source: 8 passed, 0 failed.
- Final document health reached 62 passed and one failure solely because a
  concurrent, unrelated Environment task added an index link to its own
  still-untracked record,
  `2026-07-27-environment-panel-responsive-docking-and-conversation-presentation.md`.
  This repair's record is tracked and no longer appears in the offender list;
  the concurrent working tree remains preserved.
- `git diff --check` passed before the final review.
- Commit `8f90f24054` passed the normal pre-push SDK-import, AI-runtime,
  repository typecheck, route-inventory, API-doc, Overlay i18n, and secret-scan
  hooks and reached the legacy remote delivery branch.
