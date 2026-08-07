# Composer Work Placeholder

Date: 2026-07-23

## Recall

| Field | Evidence |
| --- | --- |
| User requirement | Add a `Work` tab below the existing `Chat` / `Mission` choices in the UI, as a placeholder only, without implementing functionality. |
| Acceptance criteria | The shared composer intent menu renders `Work` after `Chat` and `Mission`; `Work` is visibly and semantically disabled; activating it cannot change composer mode, expert-squad selection, drafts, attachments, or submit routing; English and Chinese labels are present; focused contract tests and a real Node-launched browser screenshot pass. |
| Hard constraints | Preserve `ComposerMode` as the only active intent source; do not add a Work route, state, handler, fallback, synthetic message, or backend API; reuse the existing Kobalte dropdown and Icon primitives; desktop-only scope; do not restart or refresh the user's running OpenCorvus / Overlay; do not overwrite unrelated dirty-worktree changes; commit subjects use `dsw-33987`; push to `legacy-remote`. |
| Sources read | `AGENTS.md`; `specs/records/2026-06/2026-06-12-mission-assistant-shared-composer-panel.md`; current `ChatComposer.tsx`; `composer.css`; `Icon.tsx` / `Icon.lucide.ts`; `work-ledger-consolidation.test.ts`; `expert-squad-selector-browser.test.ts`; English and Chinese locale catalogs. |
| Whole-repository search evidence | `ChatComposer.tsx` is the only producer of `data-ui="composer-intent-selector"`, `data-ui="composer-intent-menu"`, and the `Chat` / `Mission` intent rows. `main.tsx` owns the only `ComposerMode` signal and submission routing. `composer.css` owns menu geometry and already styles disabled dropdown items through the shared primitive cascade. `work-ledger-consolidation.test.ts` is the focused source-contract owner; browser intent interaction is owned by `expert-squad-selector-browser.test.ts`. Locale keys under `chat.composer_intent_*` are the single copy source. No Work composer mode, route, callback, or sibling intent renderer exists. |
| Independent agent feedback | Not requested by the user; repository rule 30.1 forbids spawning an independent agent unless the user explicitly asks. |

## Design

The placeholder is one disabled `DropdownMenu.Item` immediately after the
Mission submenu. It uses the existing `avatar-build` icon and locale-owned
`Work` / `Coming soon` copy. Because it has no `onSelect` callback and does not
extend `ComposerMode`, it cannot become a second intent source or enter any
submission path.

## Call-point decisions

| Call point | Decision |
| --- | --- |
| `ChatComposer.tsx` intent trigger and Chat item | Keep unchanged. |
| `ChatComposer.tsx` Mission submenu and expert-squad selection | Keep unchanged; append the disabled Work item after the submenu. |
| `main.tsx` `ComposerMode`, `composerMode`, and submit routing | Keep unchanged; Work is not functional state. |
| `composer.css` intent menu rules | Reuse unchanged unless rendered visual evidence proves the primitive disabled state is insufficient. |
| `en-US.json` / `zh-CN.json` | Add label and placeholder-description keys beside the existing composer-intent copy. |
| `work-ledger-consolidation.test.ts` | Assert order, disabled semantics, absent Work mode/handler, and locale copy. |
| Node browser intent test | Assert the rendered row is disabled, cannot change the current Chat intent, and capture the task-scoped open-menu screenshot. |

## Verification

1. Run the focused composer/work-ledger contract tests and Overlay typecheck.
2. Launch the isolated Overlay browser fixture with Node, open the intent menu,
   verify disabled interaction semantics, and capture the menu at desktop size.
3. Inspect the screenshot at original resolution, correct visual issues, rerun,
   and perform a second diff review.

## Verification evidence

- Focused Work placeholder source contract: passed, 1 test / 36 assertions.
- Overlay TypeScript typecheck: passed.
- Overlay locale catalog check: passed.
- Historical docs and spec-link health: passed, 21 tests.
- Production Vite build: passed.
- Node-launched browser test: passed. The rendered `Work` row resolves to a
  disabled button with `aria-disabled="true"` and `data-disabled`; programmatic
  activation preserves the selected Chat intent, and the ordinary Chat submit
  lifecycle still passes.
- Task-scoped screenshot:
  `.scratch/composer-work-placeholder/composer-intent-menu.png`.

The first browser run exposed three stale fixture omissions introduced by the
current product contract (`/mission-skill/catalog`, `pendingQuestions`, and
`sessionAgentID`). The fixture now supplies those exact canonical fields, and
the original browser command passes.

## Codex second review

The original-resolution screenshot shows Chat, Mission, then Work in one
consistent menu rhythm. Work uses the existing hammer glyph, remains legible
but visibly muted, and the `即将推出` line communicates placeholder status
without suggesting an available action. Diff review confirms there is no Work
composer mode, callback, route, API request, or CSS fork. No visual correction
was required after inspection.

The full `work-ledger-consolidation` / `mission-launcher-component` combined run
still contains two unrelated failures against the dirty `main.tsx` Mission
dispatch path. The exact Work contract passes independently. The repository
pre-push hook is also currently blocked by unrelated, uncommitted engine and
orchestrator type errors; these are outside this UI change and are not hidden
or bypassed.
