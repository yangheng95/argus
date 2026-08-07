# Image Menu And Empty Error Card Repair

Date: 2026-08-02

UI means User Interface. LLM means Large Language Model. PNG means Portable
Network Graphics.

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request          | The first image-preview issue stopped without a completion answer, and later prompts produced no visible response. The supplied screenshot shows the earlier Agent stopping after a `webfetch`, followed by two red-status empty `CHAT` cards for “这个问题修改完了吗” and “继续”.                                                                                                                                                                                                                                                                                                                                                                                        |
| Restored first issue  | The prior visible analysis established that image-copy success/failure already has local `copyFeedback`, but the image context menu does not close deterministically after Copy image, Fit width, Fit image, or Original size. Copy success should use a toast presentation instead of the old bottom status pill.                                                                                                                                                                                                                                                                                                                                                        |
| Acceptance            | Every image context-menu action deterministically closes through Kobalte's item-selection contract. Copy success and failure use the existing single `copyFeedback` source through a dialog-scoped toast layer that is not obscured by the menu. A failed pre-output Chat Session shows its canonical `errorReason` directly in the Agent card instead of an empty shell; the existing action-menu copy affordance remains secondary.                                                                                                                                                                                                                                     |
| Hard constraints      | Reuse `ImagePreviewHost`, Kobalte `ContextMenu`, `ChatBubble`, the canonical card-tree `errorReason`, and existing design tokens. Do not add another notification store, image source, fallback, gate, state machine, synthetic message, UI automated test, fixture, or screenshot baseline. Do not run UI automated tests. Preserve the unrelated benchmark-catalog modification.                                                                                                                                                                                                                                                                                        |
| Sources read          | `AGENTS.md`; `CLAUDE.md`; supplied screenshot; `ImagePreview.tsx`; `ui/ContextMenu.tsx`; `messages.css`; `ChatBubble.tsx`; `ConversationCard.tsx`; `utils/chat-bubble.ts`; `tree-writer.ts`; `CardHeaderChrome.tsx`; `chat-bubble.css`; `2026-06-18-image-preview-copy-single-source.md`; `2026-07-30-image-preview-reference-parity.md`; and `2026-07-31-conversation-pending-thinking-and-empty-stop.md`.                                                                                                                                                                                                                                                               |
| Whole-repository grep | `ContextMenu.Root` has one image-preview caller and three File Explorer callers. Only the image preview owns the affected copy/scale actions, so File Explorer remains unchanged. `copyFeedback`, `copyPreviewImage`, and `.image-preview-dialog__copy-status` exist only in `ImagePreview.tsx` and `messages.css`. `errorReason` is projected only by `tree-writer.ts`; `CardHeaderChrome.tsx` exposes it only inside the hover overflow menu, while `ChatBubble.tsx` renders no error body. `renderAsPendingAgent()` correctly reserves contentless running cards for `正在思考`, so the empty red cards are terminal-error presentation, not pending-state projection. |
| Independent review    | A session-local read-only child audit was requested for the image-menu boundary. Claude Code 2.1.147 was also invoked with read-only tools as required, but returned `authentication_failed` / `Not logged in`; it supplied no review evidence. The primary Agent independently verified all relevant owners.                                                                                                                                                                                                                                                                                                                                                             |
| Git baseline          | `work-v0.0.27beta-yr-0801` equals `legacy-remote/work-v0.0.27beta-yr-0801` at `c35c09367a`. The pre-existing modification to `specs/artifacts/opencorvus-workbuddy-qoderwork-multica-codex-benchmark-catalog.md` is unrelated and must remain untouched.                                                                                                                                                                                                                                                                                                                                                                                                                        |

## Causal Chain

### Image menu

1. `ImagePreviewHost` renders an uncontrolled `ContextMenu.Root`.
2. Its `ContextMenu.Portal` uses the default document-body mount even though the
   trigger lives inside a modal Kobalte `Dialog` dismissable layer.
3. The menu receives pointer-move hover presentation, but the parent modal layer
   prevents the outside portal from completing item selection. Once mounted
   inside the dialog, the preview body's pan handler would otherwise intercept
   the menu's primary pointer-down, prevent its default, and capture the pointer.
   Copy and scale handlers therefore never run, and the menu never receives its
   close unless both interaction-owner boundaries are corrected.
4. Kobalte's installed `ContextMenuRootProps` intentionally omits controlled
   `open` and `defaultOpen`; its mature dismissal contract is the item-level
   `closeOnSelect` option. The correct repair mounts the portal inside the
   existing dialog body, makes dismissal explicit on all four items, and keeps
   copy feedback in its one existing signal at the shared toast z-index.

### Empty failed Chat cards

1. `tree-writer.ts` correctly projects `session.error` and failed assistant
   messages into `CardNode.status = "error"` plus `CardNode.errorReason`.
2. `shouldHideSessionCard()` correctly keeps that failed card visible.
3. `ConversationCard` routes Agent cards to `ChatBubble`.
4. `ChatBubble` renders identity, ordinary parts, children, and review content,
   but never renders `errorReason`; the only consumer is a hover-only overflow
   menu in `CardHeaderChrome`.
5. Therefore the truthful failed Session appears as a red-dot empty shell. The
   root repair is to render the same canonical reason in the ordinary card body
   without changing lifecycle projection. Both production `ConversationCard`
   consumers pass `collapsible={false}`, so no parallel collapsed-error path is
   added.

## Call-Site Disposition

| Owner / call site                                  | Decision                                                                                                                      |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `ImagePreview.tsx::ContextMenu.Root`               | Keep Kobalte's uncontrolled owner; mount its portal inside the dialog and stop menu pointer-down from reaching the pan owner. |
| Four image menu items                              | Set the mature `closeOnSelect` contract explicitly on every action; do not special-case Copy image.                           |
| `ImagePreview.tsx::copyFeedback`                   | Retain as the only copy-result source and clear it on a bounded toast lifetime.                                               |
| `messages.css::.image-preview-dialog__copy-status` | Recompose the existing element as a dialog-scoped toast at `--ui-z-toast`; delete the obsolete bottom-pill placement.         |
| File Explorer context menus                        | Keep unchanged; no affected image action or feedback ownership.                                                               |
| `tree-writer.ts` lifecycle/error projection        | Keep unchanged; it already owns and preserves the canonical error reason.                                                     |
| `ChatBubble.tsx`                                   | Render `errorReason` directly in the failed card body; keep ordinary collapsed-preview logic unchanged.                       |
| `CardHeaderChrome.tsx`                             | Keep the existing copy-error action as a secondary utility, sourced from the same `CardNode.errorReason`.                     |
| UI tests                                           | Do not add, modify, update, or run.                                                                                           |

## Implementation And Verification Plan

1. Commit and push this plan before product edits.
2. Implement explicit Kobalte item dismissal on every image action and the
   dialog-scoped copy toast.
3. Render the canonical failure reason in the failed Agent card body.
4. Run Overlay typecheck, localization validation, Vite build, required
   document-health checks, and `git diff --check`; do not run UI tests.
5. Start an isolated current-source Overlay page without touching the running
   OpenCorvus/overlay process. Open a real PNG preview, invoke menu actions,
   capture the closed-menu toast state, and mount or reach a real failed Session
   card to capture its visible reason. Personally inspect the screenshots.
6. Recheck all owners and the scoped diff, commit task-owned files with the
   `dsw-33987` prefix, reconcile with legacy remote, and push the current branch.

## Verification Evidence

- `bun run --cwd packages/overlay typecheck` passed after the final portal and
  pointer-owner repair.
- `bun run --cwd packages/overlay build:vite` passed after transforming 7,063
  modules. Existing third-party module-directive and large-chunk warnings
  remained warnings.
- `bun run --cwd packages/overlay check:i18n` passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  passed 70 contracts.
- The required historical-document link suite passed its index check and
  retained one unrelated failure because the user's pre-existing benchmark
  catalog edit removed the legacy `E01`–`E10` / `N01`–`N10` identifiers. This
  repair did not modify that artifact or its contract test.
- A headed Node-driven Playwright session operated the isolated current-source
  Vite page at 1440 × 900 without adding or running a UI test. Against the real
  attachment in the current Chat, Copy image closed the menu and rendered the
  top-layer `Copied` toast; Fit width, Fit image, and Original size each closed
  the menu and applied their scale action. Reviewed screenshots:
  `.scratch/image-menu-open-final.png`,
  `.scratch/image-menu-copy-toast-final.png`, and
  `.scratch/image-menu-actions-closed-final.png`.
- The same real page opened the original affected conversation. Its two formerly
  empty red Agent cards now directly displayed the canonical provider error:
  the historical image data was not a valid supported image. Reviewed
  `.scratch/image-menu-original-session.png`.
- The historical conversation had no valid image preview trigger, confirming
  that its already-persisted attachment was corrupt. The existing pasted-image
  byte-capture repair protects new attachments; this task does not silently drop
  or rewrite historical conversation context.
- Every isolated Vite listener was stopped and port 5192 was verified free.
