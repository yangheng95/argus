# Settings app-dialog context preservation

## Recall

### User requirement

Clicking **Uninstall** on the Expert Squad Settings page opens the confirmation dialog but switches the
background to the Conversation page. Keep the user on the same Settings page while the confirmation is
open and after it settles.

### Acceptance criteria

1. Opening the Expert Squad uninstall confirmation leaves the Settings dialog open on the Expert Squad
   Details tab; the Conversation page never becomes the confirmation background.
2. Cancelling preserves the mounted Settings page and performs no uninstall request.
3. Confirming performs the existing exact-scope uninstall, refreshes the catalog, and leaves Settings on
   the same tab with the completion notice visible.
4. The shared app-dialog lifecycle continues to await native-surface hide/restore ownership and preserves
   rapid-dialog replacement and error propagation.
5. Focused unit tests, the real Node-launched browser fixture, screenshot inspection, Overlay typecheck,
   documentation-health checks, and a second diff review pass.

### Hard constraints

- Fix the shared dialog ownership error; do not add an Expert Squad-only routing flag, fallback, delayed
  reopen, or a second confirmation implementation.
- Preserve the one `showAppDialog` host and the one owner-aware native-surface occlusion service.
- Do not restart, stop, refresh, or reuse the running OpenCorvus/Overlay. Browser validation uses the
  isolated repository fixture and Node runner; Playwright is not launched through Bun.
- Preserve unrelated dirty-worktree changes, create no worktree, use the `dsw-33987` commit prefix, and
  push the current delivery branch to `myhexin`.

### Sources read

- `AGENTS.md`
- User screenshot `codex-clipboard-f08c65e0-60fa-4d94-93da-53253ff4bc24.png`
- `specs/records/2026-07/2026-07-17-expert-squad-uninstall-reference-convergence.md`
- `specs/records/2026-07/2026-07-21-settings-extension-runtime-repairs.md`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/services/app-dialog.ts`
- `packages/overlay/src/services/config-dialog-control.ts`
- `packages/overlay/src/services/native-surface-occlusion.ts`
- `packages/overlay/src/store/dialog.ts`
- `packages/overlay/src/components/{AppDialogHost,ConfigDialogHost}.tsx`
- `packages/overlay/src/components/ui/Dialog.tsx`
- Focused app-dialog, native-surface, dialog single-source, Expert Squad unit, and Expert Squad browser tests
- `browser:control-in-app-browser` Skill for rendered-page verification requirements

### Whole-repository search evidence

- `rg -n "卸载|uninstall|Uninstall" packages/overlay packages/opencorvus specs/current specs/records/2026-07`
- `rg -n "showAppDialog\\(|nativeMessage\\(" packages/overlay/src`
- `rg -n "closeConfigDialog\\(|openConfigDialog\\(|setDialogStore\\(\"config\"" packages/overlay/src packages/overlay/test`
- `rg -n "hiddenDialogConfigOwner|config restoration|Settings owner|app-dialog owner" specs packages/overlay`
- `rg -n "dialog-overlay|config-dialog-overlay|z-index" packages/overlay/src/styles packages/overlay/src`
- `rg -n "expert-squad-uninstall" packages/overlay/src packages/overlay/test`
- Production has one direct Settings confirmation caller (`ExpertSquadPanel`) and Settings notification
  callers through `nativeMessage` in `ProvidersPanel` and `MemoryPanel`. All use the same app-dialog
  service. Non-Settings callers remain unaffected by preserving an already-open Settings owner.

### Independent agent feedback

No sub-agent was used. The user did not request delegation, and the active collaboration constraint
prohibits unsolicited sub-agents. The primary Agent owns the implementation and second review.

## Root-cause chain

- Observable symptom: after clicking Expert Squad **Uninstall**, the confirmation dialog is shown over
  the Conversation page instead of over Settings.
- Direct trigger: `showAppDialog()` reads the open Settings tab and immediately calls
  `closeConfigDialog()` before publishing `dialogStore.app.open = true`.
- Deeper cause: app-dialog lifetime was modeled as a replacement for the Settings dialog. The service
  stores `hiddenDialogConfigOwner`, unmounts the entire Settings panel, and reconstructs it with
  `openConfigDialog()` only after confirmation settles. Native Browser child-surface occlusion was later
  coupled to this close/reopen sequence even though the owner-aware occlusion service already supports
  simultaneous `config-dialog` and `app-dialog` owners.
- Why prior verification missed it: the Expert Squad browser test clicked Uninstall and captured a full
  screenshot, but asserted only the confirmation text. It did not assert that `#configDialog`, its active
  panel, and the selected squad remained mounted behind the confirmation.

## Call-point disposition

| Call point | Disposition |
| --- | --- |
| `ExpertSquadPanel.uninstallCurrent` | Keep the one confirmation and exact-scope uninstall flow unchanged. |
| Settings `nativeMessage` callers in Providers and Memory | Inherit the shared context-preserving behavior; add no local option or alternate dialog. |
| Other `showAppDialog` / `nativeMessage` callers | Keep current behavior; no Settings owner exists in those paths. |
| `app-dialog.ts` | Remove Settings close/snapshot/reopen ownership. Acquire and release only the app-dialog native-surface owner. |
| `config-dialog-control.ts` | Remain the sole explicit Settings open/close owner; no changes required. |
| `native-surface-occlusion.ts` | Retain overlapping owner semantics; Settings and app dialog remain simultaneous owners until each explicitly closes. |
| `app-dialog-timeout.test.ts` | Replace close/reopen mocks and assertions with proof that an already-open Settings store remains open and unchanged across open, replacement, settle, and restore failure. |
| Dialog single-source test | Assert that the app-dialog service no longer imports or invokes Settings lifecycle controls. |
| Expert Squad browser test | Assert the real confirmation is layered over the still-mounted Details tab, confirm the exact uninstall and refreshed notice, and capture task-scoped evidence. Cancellation is covered at the shared service plus handler-order boundary without coupling an unrelated second-dialog fixture cycle to this regression. |
| Specs indexes | Add this record without altering unrelated entries. |

## Verification plan

1. Run the app-dialog, native-surface occlusion, dialog single-source, and Expert Squad focused unit tests.
2. Run Overlay typecheck and the required historical/document-health/product-doc tests.
3. Launch the existing Expert Squad fixture through the repository Node browser runner. Inspect the
   task-scoped uninstall-confirmation screenshot and verify the active tab, focus, computed layer order,
   exact uninstall request, and visible completion state. Verify cancellation separately at the shared
   service boundary and preserve the handler guard before its uninstall call.
4. Run `git diff --check`, review every changed hunk against the call-point table, record any corrections,
   then commit only this task's files and push the current branch to `myhexin`.

## Verification results

### Automated checks

- Focused app-dialog, native-surface ownership, dialog single-source, Settings sizing, Dialog primitive,
  and Expert Squad surface tests: 61 passed.
- Overlay TypeScript typecheck: passed.
- Overlay Vite production build: passed.
- Node-launched Expert Squad browser fixture: 4 passed.
- Historical-link, document-health, and product-doc single-source checks: 87 passed after staging this
  record. The first run correctly rejected the README link while the target file was still untracked.
- `git diff --check`: passed.

### Rendered browser verification

The browser fixture used the real Settings and app-dialog hosts, API fixture responses, exact lifecycle
request, catalog refresh, and Kobalte controls. It asserted that `#configDialog` remained mounted on
`expert-squad`, the selected Frontend Replica row remained present, the OK button held focus, and both
the app-dialog content and scrim had a higher computed layer than Settings. Confirming removed the exact
package, posted `replacementID: "general"`, and rendered the replacement receipt without leaving
Settings.

The task-scoped screenshot `.scratch/expert-squad-uninstall-confirm-current.png` was inspected directly.
It shows the Uninstall confirmation centered above the dimmed Expert Squad Details page; the Conversation
page is not exposed, the selected squad remains readable as context, and neither Settings content nor
the titlebar intercepts the confirmation controls.

### Second review corrections

1. The initial service-only correction kept Settings mounted but exposed the pre-existing inverse CSS
   layer order: the non-modal full-screen Settings surface sat above the app confirmation and intercepted
   pointer input. Settings now uses the canonical overlay layer, while the modal confirmation content and
   its dedicated scrim use the canonical dialog layer.
2. The old queued-microtask focus attempt ran before portalled confirmation controls mounted. Focus is now
   assigned through Kobalte's `onOpenAutoFocus` lifecycle for input, select, and ordinary confirmations.
3. A speculative shared-Dialog change made while investigating a fixture-only immediate second opening
   was removed after it was not supported by evidence. Cancellation is instead proven directly through
   `settleAppDialog(false)` with an open Settings owner, and the Expert Squad source test proves the
   `dialog.confirmed` guard precedes the uninstall request.
4. The final call-point grep confirms `app-dialog.ts` has no Settings open/close import or hidden Settings
   snapshot, while `config-dialog-control.ts` remains the only explicit Settings lifecycle owner.
5. The final full Dialog test exposed a concurrently landed `ExpertSquadPanel` Dialog adoption missing
   from its exact owner inventory. The test inventory now includes that committed primitive user; no
   second Dialog implementation or production behavior was added.
