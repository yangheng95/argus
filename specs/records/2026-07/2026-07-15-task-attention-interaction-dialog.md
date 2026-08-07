# Task attention and interaction dialog repair

## Recall

### User requirement

- When a Mission gains child tasks, expand its left-sidebar task disclosure by default.
- When a task is waiting for user confirmation, show a visible attention marker beside the corresponding left-sidebar title.
- Redesign the confirmation dialog so long descriptions do not make the surface exceed the viewport: use a stable desktop size and a dedicated scroll region.
- Preserve the shared interaction renderer and the existing Kobalte dialog primitive; do not create a second confirmation implementation.

### Acceptance criteria

- A Mission with one or more child tasks is initially expanded; a newly added child reopens a disclosure that the user had collapsed.
- The Work Ledger projection exposes the canonical pending-interaction count for every Task, and a Mission aggregates the counts of its child tasks.
- Task and Mission titles render one accessible attention dot when their projected pending-interaction count is non-zero.
- A pending child task remains visible because its Mission disclosure is expanded.
- The interaction dialog has one stable desktop width and height contract, bounded by the viewport. Its header remains fixed while only the interaction content scrolls.
- Long question/option descriptions, action controls, keyboard focus, submission, rejection, and the inline interaction card continue to work.

### Hard constraints

- Follow `AGENTS.md`: no fallback or duplicate source, no ad-hoc dialog implementation, add regression tests, visually inspect a real Node-launched browser fixture, do not restart or refresh the user's running OpenCorvus/overlay process.
- Desktop-only delivery. No tablet/mobile scope is added.
- Existing unrelated environment-menu changes are preserved.

### Read material

- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-06/2026-06-26-mission-task-parallel-subtasks.md`
- `specs/records/2026-07/2026-07-15-codex-sidebar-search-environment-parity.md`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ProjectLedgerGroup.tsx`
- `packages/overlay/src/components/InteractionDialogHost.tsx`
- `packages/overlay/src/components/InteractionCard.tsx`
- `packages/overlay/src/components/primitives/Dialog.tsx`
- `packages/overlay/src/styles/surfaces/work-ledger.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/opencorvus/src/work-ledger/projection.ts`
- Existing Work Ledger, dialog-host, interaction-card browser, OpenAPI, and Software Development Kit tests.

### Whole-repository grep evidence

| Owner / call site | Decision |
| --- | --- |
| `work-ledger/projection.ts` `WorkLedgerTaskRow` | Add `pendingInteractions` from the existing `EngineInteractionRequestTable`; this is the single task-attention source. |
| `workLedgerTaskFromMissionTask` / `workLedgerTaskFromTaskID` | Project the same count for Mission children and top-level Tasks. |
| `WorkLedgerMissionRow` | Aggregate child-task counts so the user-facing Mission title also signals attention without a second lookup. |
| `overlay/services/work-ledger.ts` | Mirror the generated response contract; do not infer attention from title, status, notifications, or the currently selected card tree. |
| `WorkLedgerRowView` | Own the title dot and Mission child-disclosure expansion because it already owns both row title and child mounting. |
| `InteractionDialogHost` | Keep one shared `InteractionCard`, adding only a dialog-specific scroll-region wrapper. |
| `card.css` `.interaction-dialog-form` | Replace whole-form scrolling with fixed grid sizing and a bounded content scroll region. |
| `interaction-card-textarea-browser.test.ts` | Update real geometry assertions and screenshots for stable sizing, fixed header, scroll containment, actions, focus, and long content. |
| `work-ledger-consolidation.test.ts` and Work Ledger projection tests | Cover default/reopen behavior, accessible marker wiring, and canonical pending counts. |
| `packages/sdk/openapi.json` / `packages/sdk/js/src/gen/**` | Regenerate after the Work Ledger response contract changes. |

### Independent agent feedback

- None. The user did not request sub-agents; project instructions prohibit delegation for this turn.

## Implementation plan

1. Extend the Work Ledger Task/Mission response schema with canonical pending-interaction counts and regenerate Application Programming Interface artifacts.
2. Add Mission disclosure auto-expansion and the accessible title attention marker in the existing row component.
3. Give the shared interaction dialog a stable grid shell and a dedicated content scroll region.
4. Add focused projection, component, and Node browser regressions.
5. Render the isolated browser fixture, inspect screenshots, fix visual issues, then run the relevant checks and second review.

## Result

- `WorkLedgerTaskRow.pendingInteractions` now comes from one grouped query over the canonical engine interaction table. Mission rows sum the counts of their projected child tasks; the Overlay does not infer attention from notification copy or the selected conversation.
- Mission task disclosure opens on the first non-zero child count and reopens whenever the count increases. Mission and Task titles render an accessible warning dot with the projected count.
- `InteractionDialogHost` still renders the single shared `InteractionCard`, now inside a dialog-only scroll region. The dialog is `720px × 600px` at the desktop scale, bounded by a `16px` viewport inset; its header stays fixed and only the content region scrolls.
- The former emoji prompt glyphs were replaced with Lucide `CircleHelp` and `LockKeyhole` icons through the shared Icon registry.
- Generated OpenAPI and JavaScript Software Development Kit response types include the new required Task/Mission count fields.

### Verification

- `bun test packages/opencorvus/test/server/work-ledger-routes.test.ts --timeout 20000`: 7 passed.
- `bun test packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/interaction-dialog-host.test.ts`: 16 passed.
- `node test/browser-runner.mjs test/browser/interaction-card-textarea-browser.test.ts`: passed through the required Node-launched Playwright sidecar. It verified initial Mission expansion, parent/child markers, fixed 720×600 geometry at 1280×860 and 1120×720, fixed header/content scroll separation, no horizontal overflow, keyboard focus, answer/skip actions, busy/error states, and cleanup.
- `bun run typecheck`: all 10 workspace packages passed, including Overlay, OpenCorvus, and the generated Software Development Kit.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: 73 passed.
- `bun run docs:check`, `bun run api:routes-check`, `bun run --cwd packages/overlay check:i18n`, and `git diff --check`: passed.

### Visual review

- `.scratch/interaction-card/work-ledger-task-attention-undimmed.png` confirms the Mission is expanded and both parent/child title markers remain legible without modal dimming.
- `.scratch/interaction-card/long-content-desktop.png` and `.scratch/interaction-card/long-content-minimum-window-page.png` confirm the wider fixed dialog, fixed header, compact Lucide question icon, readable option descriptions, and viewport containment.
- `.scratch/interaction-card/long-content-minimum-window-bottom.png` confirms the internal scroll reaches the action row without stretching the dialog or clipping controls.
- No running OpenCorvus/overlay process or window was restarted, refreshed, stopped, or reused for validation.

## Follow-up Recall — search-dialog visual parity

### User requirement

- Refine the confirmation dialog typography, spacing, line height, layout, and interaction behavior.
- Match the established visual language of the outer Command Palette instead of creating a separate popup style.

### Acceptance criteria

- The confirmation shell uses the Command Palette's border, large rounded frame, shadow depth, backdrop, and typography scale.
- Question choices read as full-width list rows: label and description have separate hierarchy, long content wraps without crushing either column, and the entire row is clickable.
- Hover, keyboard focus, and checked states are visually distinct; native radio/checkbox semantics and arrow-key behavior remain intact.
- The header and action area remain visible while only the content list scrolls; the dialog stays viewport-bounded at its stable desktop size.
- Inline conversation cards keep their existing compact card treatment; there remains one shared interaction renderer.

### Hard constraints

- Use the existing Kobalte `Dialog`, native form controls, shared `Button`, and shared `InteractionCard`; no duplicate dialog or custom listbox implementation.
- Preserve unrelated working-tree changes, including the in-progress empty-home changes in `command-palette.test.ts`.
- Validate through the existing Node-launched Playwright fixture and inspect real screenshots without touching the user's running OpenCorvus process.

### Read material and whole-repository grep evidence

| Owner / call site | Decision |
| --- | --- |
| `CommandPalette.tsx` + `cmdk.css` | Reuse the popup shell language: 28px scaled radius, strong border, layered shadow, title/control typography, 36px minimum row rhythm, muted secondary copy, and row hover/focus paint. |
| `Dialog.tsx` + `dialog.css` | Keep Kobalte focus ownership, Escape/backdrop dismissal, draggable header, and semantic title. Override only the confirmation form/header surface. |
| `InteractionDialogHost.tsx` | Mark the shared card as the dialog surface; no second renderer. |
| `InteractionCard.tsx` | Add a presentation surface prop and a content/action grid while preserving native radio/checkbox controls and reply ownership. |
| `card.css` | Scope spacious list rows, typography, scroll containment, sticky/fixed shell regions, and selected/focus feedback to the dialog variant; leave inline cards unchanged. |
| `interaction-dialog-host.test.ts` | Assert the single-renderer contract and dialog-surface/footer wiring. |
| `interaction-card-textarea-browser.test.ts` | Cover geometry, typography, wrapping, row click, native keyboard selection, focus/checked paint, fixed actions, scrolling, and screenshots. |
| All `InteractionCard` call sites (`CardParts`, dialog host) | Inline call remains the default; only the dialog host opts into the dialog presentation. |

### Independent agent feedback

- None. The user did not request sub-agents; delegation is disabled for this task.

### Follow-up implementation plan

1. Add one dialog presentation variant to the shared interaction renderer and expose its existing actions to the shared Dialog footer.
2. Apply the Command Palette shell and list-row design language with responsive viewport bounds and native-control focus states.
3. Extend focused static and Node Playwright regressions, render long Chinese/English content, inspect the screenshots, and iterate.
4. Run the relevant Overlay checks, review the diff, commit with the required prefix, fetch, and push to git-cc.

### Follow-up result

- Command Palette and the confirmation dialog now consume one focused-popup token set for the scrim, strong border, 28px scaled radius, and layered shadow.
- The shared `InteractionCard` owns one explicit `dialog` presentation. Its title, body, questions, reply state, and actions are still rendered and controlled in one component; inline cards remain the default presentation.
- The dialog is 840px × 640px at scale 1, viewport-bounded by a 16px inset. The semantic header and action row stay fixed while the content region alone scrolls.
- Dialog choices are full-width grid rows with separate label/description hierarchy, 48px minimum height, 14px control copy, 12px supporting copy, comfortable line height, full-row click targets, and distinct hover, native focus, and selected paint.
- Native radio/checkbox behavior remains intact. The browser regression proves full-row click and radio `ArrowDown` selection, while Escape/backdrop handling remains owned by Kobalte Dialog.

### Follow-up verification and visual review

- `bun test packages/overlay/test/interaction-dialog-host.test.ts packages/overlay/test/command-palette-primitive.test.ts packages/overlay/test/composer-textarea-unification.test.ts packages/overlay/test/dialog-primitive.test.ts`: 40 passed.
- `bun run --cwd packages/overlay typecheck` and `bun run --cwd packages/overlay check:i18n`: passed.
- `node test/browser-runner.mjs test/browser/interaction-card-textarea-browser.test.ts`: passed through the required Node launcher. It covers 840×640 geometry, 1120×720 containment, fixed actions, internal overflow, typography/line-height, full-row selection, native arrow-key selection, reply actions, focus, busy/error states, and browser-console cleanliness.
- `.scratch/interaction-card/long-content-desktop.png` confirms readable long label/description hierarchy and the fixed footer.
- `.scratch/interaction-card/long-content-minimum-window-page.png` confirms viewport containment and alignment with the outer focused popup shell.
- `.scratch/interaction-card/long-content-keyboard-selected.png` confirms the checked row, native radio focus ring, and selected row paint.
- No running OpenCorvus/overlay process or window was restarted, refreshed, stopped, or reused for validation.
