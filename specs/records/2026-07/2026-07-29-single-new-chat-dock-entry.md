# Single New Chat Dock Entry

## Recall

### User requirements

- Keep only the left Work Ledger `New chat` entry.
- Remove the sibling `New Work` and `New mission` entries.
- Preserve the Composer's existing mode switch so users can still choose Code or Work after entering the shared launcher; Mission routing through explicit references and Chat handoff remains unchanged.

### Acceptance criteria

- The left Work Ledger renders exactly one primary creation action: `work-ledger-new-chat`.
- `work-ledger-new-work` and `work-ledger-new-mission` are absent, including their Work Ledger-only callback props and error wrappers.
- `New chat` still opens the shared global launcher in Chat/Code mode and focuses the Composer.
- The Composer still renders the canonical `Code | Work` segmented control and can switch both directions.
- Direct Mission directives and semantic Chat-to-Mission routing remain owned by the existing Composer submission and panel paths.
- Focused tests, Overlay typecheck and internationalization checks, document health, and a Node-started real Vite browser screenshot pass without touching the user's running Overlay.

### Hard constraints

- Preserve unrelated Mirror Watch and generated-payload changes in the shared worktree.
- Do not restart, refresh, close, or otherwise operate the user's running OpenCorvus / Overlay.
- Do not add a replacement launcher, compatibility path, hidden action, state machine, or route gate.
- Use the existing `WorkLedgerNavigationAction`, shared global launcher, and Composer `SegmentedControl`.
- Run Playwright through Node.js, never Bun.
- Commit only task-owned paths with a `dsw-33987` subject and push the current `v0.0.24beta` branch to `myhexin`.

### Hard-disk sources read

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-25-composer-chat-mission-manual-switch-restoration.md`
- `specs/records/2026-07/2026-07-29-code-work-composer-and-grouped-references.md`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/main.tsx`
- Focused source and browser tests found by the searches below.

### Whole-repository search result

Repository-wide searches covered `work-ledger-new-chat`, `work-ledger-new-work`,
`work-ledger-new-mission`, `onCreateGlobal*`, `openGlobalComposer`,
`composerMode`, `onComposerModeChange`, and their locale tooltip keys.

| Owner / call sites | Finding | Disposition |
| --- | --- | --- |
| `WorkLedger.tsx` primary navigation | Three sibling actions preset Chat, Work, or expert-squad mode in the same launcher. | Keep only Chat. Delete the two unused action nodes, callback props, local wrappers, and diagnostics IDs. |
| `main.tsx` Work Ledger mount | Supplies three callbacks through `openGlobalComposer(mode)`. | Keep the Chat callback. Remove only Work Ledger's Work/Mission props; retain `openGlobalComposer` because Chat still uses it and Composer mode changes remain canonical. |
| `ChatComposer.tsx`, `main.tsx` submission | `composerMode` and `onComposerModeChange` own the visible Code/Work selector and actual Chat/Work submission identity; explicit Mission references still route through Mission submission. | Preserve unchanged and add regression assertions that the switch remains present after Dock convergence. |
| Overlay source tests | Several tests encode the old three-entry Dock contract. | Replace them with one-entry presence/absence assertions while retaining Work identity, Mission routing, and Composer-mode coverage. |
| Browser tests | Provider-error, command-palette, default-Chat, and visual fixtures click or wait for the removed Dock actions. | Route the affected acceptance through New Chat plus the Composer switch or through the command palette's independent command owner; add a real screenshot proving the resting single-entry Dock and visible Composer switch. |
| Locale keys | Work/Mission labels and explanations also describe concepts elsewhere in tests and documentation. | Do not delete shared concept copy solely because the Dock no longer renders it; remove only keys proven Work Ledger-only after focused searches. |
| Architecture record | `07-panel.md` currently states that all three top-level Work Ledger actions exist. | Update the current architecture to one `New Chat` Dock entry with mode selection in the shared Composer. |

### Independent-agent feedback

- No sub-agent was requested or used.

### Git baseline

- Branch: `v0.0.24beta`.
- Starting `HEAD`: `905e3e05ee2fe80b1dd1ed13aedea7c52304ee81`, aligned with `myhexin/v0.0.24beta`.
- During verification, the concurrent Mirror Watch owner committed and pushed
  `6b15b261a0130345de4c765b129d4da7fbd8f008`; this task continued from that
  current `HEAD` without rewriting or restaging those changes.
- The remaining untracked Watch protocol record is unrelated and remains untouched.

## Root design

The left Dock is an ingress, not the owner of conversation identity. It should
offer one obvious `New chat` action. The shared Composer remains the one visible
place that changes the actual Code/Work mode, while explicit Mission references
and semantic handoff retain the existing Mission path. Removing the two Dock
presets therefore reduces duplicate entry points without removing any runtime
capability or creating a new abstraction.

## Implementation plan

1. Remove the Work Ledger Work/Mission action nodes and their now-dead props, wrappers, and main-call-site callbacks.
2. Update current architecture and focused source/browser tests to assert one Dock entry while preserving Composer mode switching and Mission routing.
3. Run focused tests, typecheck, internationalization, documentation health, and a Node-started real Vite browser flow with an inspected screenshot.
4. Perform a second diff review, commit only task-owned paths, push `v0.0.24beta` to `myhexin`, and verify remote alignment.

## Progress

- [x] Read current architecture, prior decisions, component ownership, and repository-wide call sites.
- [x] Implement the single Dock entry and update tests/docs.
- [x] Complete automated and real-browser visual acceptance.
- [x] Complete second review, commit, push, and remote verification.

## Verification

- Focused Overlay source regressions: 47 passed, 0 failed.
- Overlay TypeScript typecheck and internationalization single-source check passed.
- Historical documentation and product-documentation checks passed after the new record was indexed.
- Node-started `global-new-chat-provider-error-browser.test.ts` passed and produced
  `.scratch/left-dock-direct-launch-alignment.png` plus
  `.scratch/single-new-chat-composer-switch.png`.
- Visual inspection confirmed that the left Dock contains only `新对话`, while
  the focused Composer visibly retains exactly `Code` and `Work`; switching to
  Work changes the placeholder and pressed state without exposing another Dock
  creation entry.
- Node-started `chat-default-assistant-browser.test.ts` passed, proving ordinary
  Code submission still uses the Chat conversation path and no Dock Work/Mission
  action is rendered.
- The broad command-palette fixture was attempted but stops before the changed
  launcher section on its existing rail-font calibration (`13px` expected,
  canonical rendered value `14px`). No backend or unrelated visual token was
  changed to bypass that independent failure.
- Implementation commit `a02f137666` passed the normal pre-push typecheck,
  API-route, documentation, internationalization, and secret-scan hooks and was
  pushed to `myhexin/v0.0.24beta`.
