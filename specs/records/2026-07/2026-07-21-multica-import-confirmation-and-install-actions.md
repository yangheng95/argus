# Multica import confirmation and Expert Squad install actions

## Recall

### Original user request

1. Clicking the left-rail Multica import action must first explain the operation and the content that will be synchronized; the import may start only after the user confirms.
2. Expert Squad installation actions must read visually as buttons.
3. The longer English install labels must be optimized.

### Acceptance criteria

1. The existing Multica launcher opens the shared application dialog before any Mission wake request, loading state, workspace selection, or navigation side effect.
2. The dialog identifies the current project context and explains that OpenCorvus will read the Multica Squad catalog, let the user select uninstalled Squads, synchronize the selected canonical packages into the user-global Expert Squad catalog for reuse across projects, never replace already-installed packages, and never auto-activate the result.
3. Cancel and Escape produce zero Mission wake requests and leave the current Conversation/Right Dock layout intact; confirmation continues through the one existing visible `general` Mission path.
4. Market install actions remain two explicit scopes, retain their exact global/project request values, expose full localized accessible labels, and use concise visible labels in English.
5. The two market actions use the existing `Button` and `Icon` primitives with clear surface hierarchy and bounded desktop-row geometry; no new primitive, alternate install path, responsive scope, or direct API call is introduced.
6. Unit, browser, localization, type, document-health, screenshot, and second-review evidence cover the changed behavior.
7. Commit subjects use `dsw-33987`; only this task's changes are committed and pushed to `legacy-remote/v0.0.13beta`.

### Hard constraints

- Preserve the Agent-led Multica flow: Work Ledger action -> visible `general` Mission -> Multica catalog question -> independent import Tasks.
- Preserve `prompt_profile.active` as the only active Expert Squad source and do not auto-activate an imported package.
- Preserve the existing explicit project/global installation protocol and `installExpertSquadMarketPackage` service as the only market installation path.
- Reuse the shared Kobalte-backed `Dialog`, application-dialog service, `Button`, and `Icon` primitives; do not hand-roll a modal or button implementation.
- This is desktop-only acceptance. Do not add tablet/mobile breakpoints or screenshots.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process. Use an isolated Node-launched browser fixture.
- Preserve unrelated concurrent benchmark, Environment, architecture, and spec-index changes in the worktree.

### Sources read

- `AGENTS.md`
- `specs/README.md` and `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-14-multica-expert-squad-import.md`
- `specs/records/2026-07/2026-07-15-codex-settings-multica-expert-squad-unification.md`
- `specs/records/2026-07/2026-07-17-multica-global-expert-squad-storage.md`
- `specs/records/2026-07/2026-07-18-expert-squad-explicit-install-scope-actions.md`
- `specs/records/2026-07/2026-07-20-multica-question-human-readable-option-title.md`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/components/{AppDialogHost,ui/Dialog,ui/Button}.tsx`
- `packages/overlay/src/services/app-dialog.ts`
- `packages/overlay/src/styles/{primitives/button,surfaces/dialog,surfaces/settings}.css`
- Existing Multica and Expert Squad unit/browser tests plus both locale catalogs.
- Official Kobalte Dialog, Alert Dialog, and Button documentation. The repository's existing shared dialog already provides the required modal focus/keyboard ownership, so this task must reuse it.

### Whole-repository grep evidence

The pre-plan repository-wide `rg` covered `startWorkLedgerMulticaImport`, `onStartMulticaImport`, every `multica_import.*` locale/caller/test, `installMarketItem`, `installExpertSquadMarketPackage`, both install-scope label keys, every `expert-squad-market-install` selector, dialog/confirmation primitives, and market row styles.

| Call point | Disposition |
| --- | --- |
| `packages/overlay/src/components/WorkLedger.tsx` | Keep the existing action, order, project-directory ownership, and `Button` primitive unchanged. |
| `packages/overlay/src/main.tsx::startWorkLedgerMulticaImport` | Add the shared confirmation before the first side effect; preserve the subsequent Mission wake and navigation sequence unchanged. |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json` | Add confirmation title/body/continue labels and concise visible market-scope labels while retaining the full scope labels for accessibility. |
| `packages/overlay/src/components/settings/ExpertSquadPanel.tsx::installMarketItem` | Keep the implementation and exact scope argument unchanged; refine only the two rendered market actions. |
| `packages/overlay/src/styles/surfaces/settings.css` | Give the scope actions a dedicated bounded button group and stronger primitive-backed hierarchy. |
| `packages/overlay/test/multica-import-surface.test.ts` | Assert the confirmation precedes wake and all confirmation locale keys exist. |
| `packages/overlay/test/browser/multica-import-browser.test.ts` | Prove cancel creates no wake, confirm creates the existing wake, focus is managed, layout is preserved, and capture the confirmation screenshot. |
| `packages/overlay/test/expert-squad-settings-surface.test.ts` | Assert the dedicated action-group/button classes and concise labels exist. |
| `packages/overlay/test/browser/expert-squad-panel.test.ts` | Prove concise visible English, full accessible names, rectangular button geometry, exact request scopes, and capture the resulting desktop screenshot. |
| Backend Multica adapter, Registry, Manager, Resolver, server routes, generated SDK/docs | Retain unchanged; the requested change is an Overlay interaction and presentation correction only. |

### Independent agent feedback

None. The user did not request independent agents, and the active collaboration constraints prohibit unsolicited delegation.

## Root cause and design decision

The Multica click handler currently enters loading state and wakes a Mission immediately, so there is no user-visible transaction boundary before remote catalog work begins. The correct owner is the launcher function because it alone precedes all side effects and already has the exact project context used for catalog collision validation. The synchronized packages themselves use the current canonical user-global installation scope and become available across projects. A host gate or new import state machine would duplicate the existing Mission workflow; a single shared dialog result is sufficient.

The Expert Squad Market already renders real `Button` primitives, but the `sm` outline actions sit inline with a pill Badge and carry long English verb phrases. At the captured density they read as tags and consume the row's remaining width. The correction keeps the same button primitive and request handlers, groups the two scope actions, gives the global action a primary surface and the project action a secondary surface, adds the existing download icon, and uses concise visible scope names with the full action text in `title` and `aria-label`.

## Implementation plan

1. Add localized confirmation and concise scope labels.
2. Await `showAppDialog` at the start of `startWorkLedgerMulticaImport`; return without side effects on dismissal.
3. Render the market scope actions inside one dedicated group with existing `Button`/`Icon` primitives and unchanged scope callbacks.
4. Add focused unit and real browser acceptance coverage, including request-count, keyboard focus, accessible-name, geometry, and screenshot assertions.
5. Run Overlay unit tests, targeted Node browser tests, i18n, typecheck, spec health, and visual review; fix any mismatch and repeat.
6. Review the exact task diff, append verification evidence here, commit only task-owned hunks, and push the current branch to legacy remote.

## Verification ledger

- `bun test packages/overlay/test/multica-import-surface.test.ts packages/overlay/test/expert-squad-settings-surface.test.ts`: 10 passed, 311 assertions.
- `bun run --cwd packages/overlay check:i18n`: passed for both bundled locales.
- `bun run --cwd packages/overlay typecheck`: passed.
- `git diff --check`: passed.
- `bun test --timeout 20000 packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts`: 60 passed; the remaining monthly-index assertion is blocked by three concurrent, untracked records owned by other tasks and does not involve this record or its links.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/multica-import-browser.test.ts`: passed the complete confirmation, cancellation, confirmed Mission wake, selection, and repair flow.
- `node --test --test-concurrency=1 --test-name-pattern='expert squads settings renders package identity' packages/overlay/test/browser/expert-squad-panel.test.ts` with `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1`: passed the scoped market install/action flow. The full file's two later unrelated tests currently observe `/file?path=` 404s from concurrent File Changes work; they do not execute or own this change.
- Visual review passed for `.scratch/multica-import-confirmation-current.png` and the task-scoped `.scratch/expert-squad-market-actions-current.png`: dialog content is legible without clipping, and Global/Project actions have distinct solid/outline hierarchy, bounded geometry, concise English, and full accessible labels.
