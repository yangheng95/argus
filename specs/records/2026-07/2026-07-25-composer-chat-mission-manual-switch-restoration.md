# Composer Chat and Mission manual switch restoration

## Recall

### User requirements

- The New Chat / New Mission direct-entry redesign incorrectly removed the Composer selector.
- Clicking either entry must select that mode only as the initial value.
- The shared Composer must always retain a visible manual Chat/Mission switch.

### Acceptance

- New Chat opens the anonymous-project launcher in Chat mode and focuses the shared textarea.
- New Mission opens the same launcher in Mission mode and focuses the shared textarea.
- Both paths render the same `composer-intent-selector`.
- The user can switch Chat to Mission and Mission to Chat without reopening the left Dock.
- Draft text and attachments survive mode changes.
- Mission mode retains the existing expert-squad selection hierarchy and submits selected manifest IDs through `wakeMission`.
- Real Vite interaction, Node-launched Playwright, task-scoped screenshots, focused tests, typecheck, i18n, document health, and second review pass.

### Constraints

- Preserve `composerMode` in `main.tsx` as the single mode source.
- Reuse the existing Kobalte DropdownMenu, Button, Icon, expert-squad catalog, anonymous-project launcher, and shared ChatComposer.
- Do not add another Composer, hidden mode state, fallback route, or entry-specific submit pipeline.
- Preserve every unrelated worktree change and do not restart or refresh a running OpenCorvus / Overlay process.

### Read sources

- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-08-mission-task-chat-toolbar-consolidation-impact.md`
- `specs/records/2026-07/2026-07-23-overlay-interaction-settings-and-mailbox-refinement.md`
- `specs/records/2026-07/2026-07-25-left-dock-direct-launch-and-alignment.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/styles/surfaces/composer.css`
- focused source and browser tests named below

### Full-repository grep

| Surface | Findings | Decision |
| --- | --- | --- |
| `composerMode` / `setComposerMode` | `main.tsx` is the sole reactive owner; direct entries and selected Work Ledger records set it | Keep this single source and reconnect the Composer callback |
| `openGlobalComposer` | Both direct entries already use the canonical anonymous-project launcher and then set Chat or Mission | Keep both paths; their mode is an initial selection, not a lock |
| `composer-intent-selector` | Product markup was deleted by `72991f7db0`, while browser tests for Chat/Mission switching, draft preservation, expert-squad selection, and project launch still reference it | Restore one selector in the shared Composer |
| `selectedMissionExpertSquadIDs` | The same deletion removed the only Mission multi-squad selection state and submission projection | Restore it under `main.tsx`; validate against the request-scoped catalog |
| `expertSquadCatalogRequestKeyForScope` | Required when the user changes Mission squad selection from a selected project/session | Restore the prior request-key path; do not scan or infer another catalog |
| `ComposerSubmitDirectives` | Current directives preserve explicit `@squad` and `@mission`; selected menu squads were removed | Add selected IDs back while preserving explicit directive precedence |
| `composer-intent-*` locale/CSS | Locale keys and the complete Kobalte menu styles were deleted together with the control | Restore the same semantic keys and component-owned surface styles |
| source tests asserting absence | `coding-assistant-panel`, `mission-launcher-component`, `mission-session-source`, `settings-persistence`, and `work-ledger-consolidation` encode the incorrect deletion | Replace absence assertions with the corrected single-source contract |
| browser tests | `global-new-chat-provider-error`, `composer-mention`, `project-directory-new-chat`, `expert-squad-selector`, `chat-default-assistant`, and command-palette tests exercise the selector | Extend the direct-entry fixture to prove both default values and both manual switch directions |

### Independent-agent feedback

- No sub-agent was requested or used.

## Causal chain

The direct-entry change correctly added separate New Chat and New Mission buttons, but its plan declared the Composer selector a duplicate source. That classification was wrong: the Dock entries are commands that choose an initial value, while `composerMode` is the actual state and the Composer selector is its user-editable projection. Deleting the selector therefore did not remove duplicate state; it removed the only affordance that could update the canonical state after launch. The same deletion also removed Mission expert-squad selection even though the current architecture still requires Composer-selected manifest IDs to reach `wakeMission`.

## Implementation plan

1. Restore the Composer Kobalte intent selector and its Chat, Mission, expert-squad, install-more, and disabled Work entries.
2. Reconnect `onComposerModeChange` to the existing `handleComposerModeChange`, preserving the new-request draft transfer, selected-source clear, primary-panel update, and focus path.
3. Restore request-scoped expert-squad selection state, catalog validation, pruning, and submit projection without changing explicit `@squad` / `@mission` precedence.
4. Restore locale and component surface styles.
5. Correct the affected source assertions and extend the real direct-entry browser test to cover Chat → Mission and Mission → Chat.
6. Run real Vite and Node Playwright interaction with screenshots, focused source tests, typecheck, i18n, document-health checks, second diff review, precise commit, and normal-hook legacy remote push.

## Verification record

- Source contract: the shared Composer again owns one Kobalte intent menu whose trigger projects `composerMode`; New Chat and New Mission still call the same anonymous-project launcher and only choose its initial mode.
- Submission contract: menu-selected expert-squad manifest IDs are validated against the request-scoped catalog, pruned when the catalog changes, and forwarded only for Mission submission. Explicit `@squad` and `@mission` directives retain precedence.
- Focused source regression:

  ```text
  bun test test/mission-launcher-component.test.ts test/coding-assistant-panel.test.ts test/work-ledger-consolidation.test.ts test/mission-session-source.test.ts test/settings-persistence.test.ts test/composer-file-loader-right-dock.test.ts test/composer-mention-ui.test.ts test/composer-run-controls.test.ts
  76 pass, 0 fail, 1100 expectations
  ```

- Static validation:

  ```text
  bun run typecheck
  pass
  bun run check:i18n
  pass
  git diff --check
  pass
  ```

- Real Vite and Node Playwright regression:

  ```text
  OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test test/browser/global-new-chat-provider-error-browser.test.ts
  1 pass, 0 fail
  ```

  The browser path verifies New Mission initially renders Mission, Mission can switch to Chat, Chat can switch back to Mission, New Chat initially renders Chat, and the Mission second-level menu remains available. The reviewed screenshot is `packages/overlay/.scratch/new-chat-new-mission-manual-switch.png`; the visible root and Mission submenu are unclipped and the shared Composer retains one selector.

- Documentation:

  ```text
  bun test packages/opencorvus/test/script/historical-docs-links.test.ts
  21 pass, 0 fail
  bun test packages/opencorvus/test/script/document-health.test.ts
  62 pass, 0 fail
  ```

  The first document-health run reached 61 pass and correctly reported that this newly indexed record was not yet Git-tracked. The precise staged delivery state then passed all 62 document-health cases.

- Extended-browser classification: `project-directory-new-chat-browser.test.ts` currently fails before the selector path because it expects a second `GET /work-ledger` after creating Chat, while the current runtime hydrates the created session without that reload. A diagnostic fixture edit was removed; this pre-existing assertion is outside the direct-entry selector repair and is not included in the change set.
- Second review: the implementation restores the deleted control and state projection without adding another mode owner, alternate submit route, hidden message, fallback, or entry-specific Composer. Unrelated concurrent conversation, Task directory bar, Environment, generated, and scratch changes remain untouched.
